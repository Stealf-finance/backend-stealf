import { CacheService } from '../cache/cacheService';
import { parseHeliusTransaction } from './transactionParser';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSocketService } from '../socket/socketService';
import { SolPriceService } from '../pricing/solPrice';

import { handleVaultDeposit } from '../privacycash/PrivacyDeposit';
import { WalletBalance } from '../helius/walletInit';

const isDev = process.env.NODE_ENV === 'development';
const TAG = '[TransactionHandler]';

function log(...args: unknown[]) {
    if (isDev) console.log(TAG, ...args);
}

function logError(...args: unknown[]) {
    console.error(TAG, ...args);
}

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

export class TransactionHandler {
    private static processedTransactions = new Set<string>();

    private static getVaultAddress(): string {
        const address = process.env.VAULT_PUBLIC_KEY;
        if (!address) {
            logError('VAULT_PUBLIC_KEY not configured');
        }
        return address || '';
    }

    static async handleTransaction(payload: any) {
        try {
            const transactions = Array.isArray(payload) ? payload : [payload];
            log(`Received ${transactions.length} transaction(s)`);

            const VAULT_ADDRESS = this.getVaultAddress();

            for (const transaction of transactions) {
                const signature = transaction?.signature;
                const nativeTransfers: Transfer[] = transaction?.nativeTransfers || [];
                const tokenTransfers: Transfer[] = transaction?.tokenTransfers || [];

                if (!signature || (nativeTransfers.length === 0 && tokenTransfers.length === 0)) {
                    log('Skipping — no signature or no transfers');
                    continue;
                }

                if (this.processedTransactions.has(signature)) {
                    log(`Skipping — already processed: ${signature.slice(0, 12)}...`);
                    continue;
                }
                this.processedTransactions.add(signature);

                log(`--- Processing ${signature.slice(0, 12)}... ---`);
                log(`  Native transfers: ${nativeTransfers.length} | Token transfers: ${tokenTransfers.length}`);

                const deltas: WalletDeltas = {};
                const affectedWallets = new Set<string>();

                // Accumulate native (SOL) deltas
                for (const transfer of nativeTransfers) {
                    const { fromUserAccount, toUserAccount, amount } = transfer;
                    const solAmount = (amount || 0) / LAMPORTS_PER_SOL;

                    // Vault deposit detection
                    if (toUserAccount === VAULT_ADDRESS && fromUserAccount) {
                        log(`  → Vault SOL deposit detected!`);
                        await handleVaultDeposit(transaction, transfer);
                    }

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

                    // Vault deposit detection
                    if (toUserAccount === VAULT_ADDRESS && fromUserAccount) {
                        log(`  → Vault token deposit detected!`);
                        await handleVaultDeposit(transaction, transfer, mint ?? undefined);
                    }

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

                    const parsedTx = parseHeliusTransaction(transaction, walletAddress);
                    await this.saveTransactionToHistory(walletAddress, parsedTx);
                }

                log(`  Affected wallets: ${[...affectedWallets].map(w => w.slice(0, 8) + '...').join(', ')}`);
            }

            log('All transactions processed');

        } catch (error) {
            logError('Failed to handle transactions:', error);
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

            for (const [, { mint, delta }] of Object.entries(tokenDeltas)) {
                if (delta === 0) continue;

                let token = walletBalance.tokens.find(t => t.tokenMint === mint);
                if (!token) {
                    const symbol = mint === null ? 'SOL'
                        : mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC'
                        : mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ? 'USDT'
                        : 'UNKNOWN';
                    const decimals = mint === null ? 9 : 6;
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

                log(`  Balance: ${walletAddress.slice(0, 8)}... | ${token.tokenSymbol} ${delta > 0 ? '+' : ''}${delta} → ${token.balance}`);
            }

            walletBalance.totalUSD = walletBalance.tokens.reduce((sum, t) => sum + t.balanceUSD, 0);

            await CacheService.set(balanceKey, walletBalance, 0);
            getSocketService().emitBalanceUpdate(walletAddress, walletBalance);
        } catch (error) {
            logError(`Failed to apply deltas for ${walletAddress}:`, error);
            throw error;
        }
    }

    private static async saveTransactionToHistory(
        walletAddress: string,
        transaction: any
    ) {
        try {
            const historyKey = CacheService.historyKey(walletAddress, 100);

            const currentHistory = await CacheService.get<any[]>(historyKey) || [];

            const isDuplicate = currentHistory.some(
                (tx) => tx.signature === transaction.signature
            );

            if (isDuplicate) {
                log(`  History: duplicate skipped for ${walletAddress.slice(0, 8)}...`);
                return;
            }

            const newHistory = [transaction, ...currentHistory].slice(0, 100);

            await CacheService.set(historyKey, newHistory, 0);

            getSocketService().emitNewTransaction(walletAddress, transaction);

            log(`  History updated: ${walletAddress.slice(0, 8)}... (${newHistory.length} entries)`);
        } catch (error) {
            logError(`Failed to save history for ${walletAddress}:`, error);
            throw error;
        }
    }
}
