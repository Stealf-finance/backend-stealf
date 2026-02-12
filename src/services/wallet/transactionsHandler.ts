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

                const affectedWallets = new Set<string>();

                // Process native (SOL) transfers
                for (const transfer of nativeTransfers) {
                    const { fromUserAccount, toUserAccount, amount } = transfer;
                    const solAmount = (amount || 0) / LAMPORTS_PER_SOL;

                    log(`  SOL: ${fromUserAccount?.slice(0, 8)}... → ${toUserAccount?.slice(0, 8)}... | ${solAmount} SOL`);

                    await this.processTransfer({
                        from: fromUserAccount,
                        to: toUserAccount,
                        amount: solAmount,
                        mint: null,
                        vaultAddress: VAULT_ADDRESS,
                        transaction,
                        transfer,
                        affectedWallets,
                    });
                }

                // Process SPL token transfers
                for (const transfer of tokenTransfers) {
                    const { fromUserAccount, toUserAccount, tokenAmount, mint } = transfer;

                    log(`  Token: ${fromUserAccount?.slice(0, 8)}... → ${toUserAccount?.slice(0, 8)}... | ${tokenAmount} (mint: ${mint?.slice(0, 8)}...)`);

                    await this.processTransfer({
                        from: fromUserAccount,
                        to: toUserAccount,
                        amount: tokenAmount || 0,
                        mint: mint || null,
                        vaultAddress: VAULT_ADDRESS,
                        transaction,
                        transfer,
                        affectedWallets,
                    });
                }

                // Save to history for each affected wallet
                for (const walletAddress of affectedWallets) {
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

    private static async processTransfer(params: {
        from?: string;
        to?: string;
        amount: number;
        mint: string | null;
        vaultAddress: string;
        transaction: any;
        transfer: Transfer;
        affectedWallets: Set<string>;
    }) {
        const { from, to, amount, mint, vaultAddress, transaction, transfer, affectedWallets } = params;

        // Detect vault deposit (privacy cash)
        if (to === vaultAddress && from) {
            log(`  → Vault deposit detected!`);
            await handleVaultDeposit(transaction, transfer, mint ?? undefined);
        }

        if (from) {
            await this.updateWalletBalance(from, -amount, mint);
            affectedWallets.add(from);
        }

        if (to) {
            await this.updateWalletBalance(to, amount, mint);
            affectedWallets.add(to);
        }
    }

    private static async updateWalletBalance(
        walletAddress: string,
        delta: number,
        tokenMint: string | null = null
    ) {
        try {
            const balanceKey = CacheService.balanceKey(walletAddress);
            const solPrice = await SolPriceService.getSolanaPrice();

            let walletBalance = await CacheService.get<WalletBalance>(balanceKey);

            if (!walletBalance) {
                walletBalance = { tokens: [], totalUSD: 0 };
            }

            // Find or create token entry
            let token = walletBalance.tokens.find(t => t.tokenMint === tokenMint);
            if (!token) {
                const symbol = tokenMint === null ? 'SOL'
                    : tokenMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC'
                    : tokenMint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ? 'USDT'
                    : 'UNKNOWN';
                const decimals = tokenMint === null ? 9 : 6;
                token = { tokenMint, tokenSymbol: symbol, tokenDecimals: decimals, balance: 0, balanceUSD: 0 };
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

            walletBalance.totalUSD = walletBalance.tokens.reduce((sum, t) => sum + t.balanceUSD, 0);

            await CacheService.set(balanceKey, walletBalance, 0);

            getSocketService().emitBalanceUpdate(walletAddress, walletBalance);

            log(`  Balance updated: ${walletAddress.slice(0, 8)}... | ${token.tokenSymbol} ${delta > 0 ? '+' : ''}${delta} → ${token.balance}`);
        } catch (error) {
            logError(`Failed to update balance for ${walletAddress}:`, error);
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
