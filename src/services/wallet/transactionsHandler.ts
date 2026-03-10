import { CacheService } from '../cache/cacheService';
import { parseHeliusTransaction, parseTransactions } from './transactionParser';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSocketService } from '../socket/socketService';
import { SolPriceService } from '../pricing/solPrice';
import { TokenMetadataService } from '../token/TokenMetadataService';
import { WalletBalance } from '../helius/walletInit';
import baseLogger from '../../config/logger';

const txLogger = baseLogger.child({ module: 'TransactionHandler' });

interface Transfer {
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
    tokenAmount?: number;
    mint?: string;
}

// Accumulated delta per wallet per token
interface WalletDeltas {
    [walletAddress: string]: {
        [tokenKey: string]: { mint: string | null; delta: number };
    };
}

const MAX_DEDUP_SIZE = 10_000;

export class TransactionHandler {
    private static processedTransactions = new Set<string>();

    static async handleTransaction(payload: any) {
        try {
            const transactions = Array.isArray(payload) ? payload : [payload];
            txLogger.debug({ count: transactions.length }, 'Received transactions');

            for (const transaction of transactions) {
                const signature = transaction?.signature;
                const nativeTransfers: Transfer[] = transaction?.nativeTransfers || [];
                const tokenTransfers: Transfer[] = transaction?.tokenTransfers || [];

                if (!signature || (nativeTransfers.length === 0 && tokenTransfers.length === 0)) {
                    txLogger.debug('Skipping: no signature or no transfers');
                    continue;
                }

                if (this.processedTransactions.has(signature)) {
                    txLogger.debug({ signature: signature.slice(0, 12) }, 'Skipping: already processed');
                    continue;
                }
                this.processedTransactions.add(signature);

                // Evict oldest entries when set gets too large to prevent memory leak
                if (this.processedTransactions.size > MAX_DEDUP_SIZE) {
                    const it = this.processedTransactions.values();
                    for (let i = 0; i < MAX_DEDUP_SIZE / 2; i++) {
                        this.processedTransactions.delete(it.next().value!);
                    }
                }

                txLogger.debug({ signature: signature.slice(0, 12), nativeTransfers: nativeTransfers.length, tokenTransfers: tokenTransfers.length }, 'Processing transaction');

                const deltas: WalletDeltas = {};
                const affectedWallets = new Set<string>();

                // Accumulate native (SOL) deltas
                for (const transfer of nativeTransfers) {
                    const { fromUserAccount, toUserAccount, amount } = transfer;
                    const solAmount = (amount || 0) / LAMPORTS_PER_SOL;

                    if (fromUserAccount) {
                        this.addDelta(deltas, fromUserAccount, null, -solAmount);
                        affectedWallets.add(fromUserAccount);
                    }
                    if (toUserAccount) {
                        this.addDelta(deltas, toUserAccount, null, solAmount);
                        affectedWallets.add(toUserAccount);
                    }
                }

                // Accumulate SPL token deltas
                for (const transfer of tokenTransfers) {
                    const { fromUserAccount, toUserAccount, tokenAmount, mint } = transfer;

                    if (fromUserAccount) {
                        this.addDelta(deltas, fromUserAccount, mint || null, -(tokenAmount || 0));
                        affectedWallets.add(fromUserAccount);
                    }
                    if (toUserAccount) {
                        this.addDelta(deltas, toUserAccount, mint || null, tokenAmount || 0);
                        affectedWallets.add(toUserAccount);
                    }
                }

                // Batch: one Redis read + write + socket emit per wallet
                const solPrice = await SolPriceService.getSolanaPrice();

                for (const walletAddress of affectedWallets) {
                    await this.applyDeltas(walletAddress, deltas[walletAddress] || {}, solPrice);

                    const rawTx = await parseHeliusTransaction(transaction, walletAddress);
                    const [formattedTx] = await parseTransactions([rawTx], walletAddress);
                    await this.saveTransactionToHistory(walletAddress, formattedTx);
                }

                txLogger.debug({ affectedWallets: [...affectedWallets].map(w => w.slice(0, 8)) }, 'Affected wallets');
            }

            txLogger.debug('All transactions processed');

        } catch (error) {
            txLogger.error({ err: error }, 'Failed to handle transactions');
            throw error;
        }
    }

    private static addDelta(
        deltas: WalletDeltas,
        wallet: string,
        mint: string | null,
        amount: number
    ) {
        const tokenKey = mint || 'SOL';
        if (!deltas[wallet]) deltas[wallet] = {};
        if (!deltas[wallet][tokenKey]) {
            deltas[wallet][tokenKey] = { mint, delta: 0 };
        }
        deltas[wallet][tokenKey].delta += amount;
    }

    private static async applyDeltas(
        walletAddress: string,
        tokenDeltas: { [tokenKey: string]: { mint: string | null; delta: number } },
        solPrice: number
    ) {
        try {
            const balanceKey = CacheService.balanceKey(walletAddress);
            let walletBalance = await CacheService.get<WalletBalance>(balanceKey);

            if (!walletBalance) {
                walletBalance = { tokens: [], totalUSD: 0 };
            }

            // Pre-resolve metadata for all unknown mints in this batch
            const unknownMints = Object.values(tokenDeltas)
                .filter(({ mint }) => mint !== null && !walletBalance!.tokens.some(t => t.tokenMint === mint))
                .map(({ mint }) => mint as string);
            const metadataMap = unknownMints.length > 0
                ? await TokenMetadataService.getMetadataBatch(unknownMints)
                : new Map();

            for (const [, { mint, delta }] of Object.entries(tokenDeltas)) {
                if (delta === 0) continue;

                let token = walletBalance.tokens.find(t => t.tokenMint === mint);
                if (!token) {
                    let symbol = 'SOL';
                    let decimals = 9;
                    if (mint !== null) {
                        const meta = metadataMap.get(mint);
                        symbol = meta?.symbol || 'UNKNOWN';
                        decimals = meta?.decimals ?? 9;
                    }
                    token = { tokenMint: mint, tokenSymbol: symbol, tokenDecimals: decimals, balance: 0, balanceUSD: 0 };
                    walletBalance.tokens.push(token);
                }

                token.balance += delta;
                if (token.balance < 0) token.balance = 0;

                if (token.tokenSymbol === 'SOL') {
                    token.balanceUSD = token.balance * solPrice;
                } else if (token.tokenSymbol === 'USDC' || token.tokenSymbol === 'USDT') {
                    token.balanceUSD = token.balance;
                } else {
                    token.balanceUSD = 0;
                }

                txLogger.debug({ wallet: walletAddress.slice(0, 8), symbol: token.tokenSymbol, delta, newBalance: token.balance }, 'Balance updated');
            }

            walletBalance.totalUSD = walletBalance.tokens.reduce((sum, t) => sum + t.balanceUSD, 0);

            await CacheService.set(balanceKey, walletBalance, 300);
            getSocketService().emitBalanceUpdate(walletAddress, walletBalance);
        } catch (error) {
            txLogger.error({ err: error, wallet: walletAddress.slice(0, 8) }, 'Failed to apply deltas');
            throw error;
        }
    }

    private static async saveTransactionToHistory(
        walletAddress: string,
        transaction: any
    ) {
        try {
            const historyKey = CacheService.historyKey(walletAddress, 100);

            let currentHistory = await CacheService.get<any[]>(historyKey);
            if (!currentHistory) {
                const { solanaService } = await import('../helius/walletInit');
                try {
                    currentHistory = await solanaService.getTransactions(walletAddress, 100);
                } catch {
                    currentHistory = [];
                }
            }

            const isDuplicate = currentHistory.some(
                (tx) => tx.signature === transaction.signature
            );

            if (isDuplicate) {
                txLogger.debug({ wallet: walletAddress.slice(0, 8) }, 'History: duplicate skipped');
                return;
            }

            const newHistory = [transaction, ...currentHistory].slice(0, 100);

            await CacheService.set(historyKey, newHistory, 300);

            getSocketService().emitNewTransaction(walletAddress, transaction);

            txLogger.debug({ wallet: walletAddress.slice(0, 8), entries: newHistory.length }, 'History updated');
        } catch (error) {
            txLogger.error({ err: error, wallet: walletAddress.slice(0, 8) }, 'Failed to save history');
            throw error;
        }
    }
}
