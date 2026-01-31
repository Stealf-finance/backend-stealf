import { CacheService } from '../cache/cacheService';
import { parseHeliusTransaction } from './transactionParser';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSocketService } from '../socket/socketService';
import { SolPriceService } from '../pricing/solPrice';
import { transferCorrelationService, WebhookTransactionData } from '../privacycash/TransferCorrelationService';
import { handleVaultDeposit } from '../privacycash/PrivacyDeposit';

export class TransactionHandler {
    private static processedTransactions = new Set<string>();

    private static getVaultAddress(): string {
        const address = process.env.VAULT_PUBLIC_KEY;
        if (!address) {
            console.error('[TransactionHandler] VAULT_PUBLIC_KEY not configured in environment');
        }
        return address || '';
    }

    static async handleTransaction(payload: any) {

        try {
            const transactions = Array.isArray(payload) ? payload : [payload];
            console.log(`[TransactionHandler] Processing ${transactions.length} transaction(s)`);

            const VAULT_ADDRESS = this.getVaultAddress();

            for (const transaction of transactions) {
                if (!transaction || (!transaction.nativeTransfers && !transaction.tokenTransfers)) {
                    console.log('[TransactionHandler] No transfers found in transaction');
                    continue;
                }

                const signature = transaction.signature;
                if (this.processedTransactions.has(signature)) {
                    console.log(`[TransactionHandler] Transaction ${signature} already processed, skipping`);
                    continue;
                }
                this.processedTransactions.add(signature);

                const affectedWallets = new Set<string>();

                if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0){
                    console.log(`[TransactionHandler] Found ${transaction.nativeTransfers.length} native transfer(s)`);
                    for (const transfer of transaction.nativeTransfers){
                        const { fromUserAccount, toUserAccount, amount } = transfer;
                        console.log(`[TransactionHandler] Native transfer: ${fromUserAccount} -> ${toUserAccount}, amount: ${amount}`);
                        console.log(`[TransactionHandler] Vault address: ${VAULT_ADDRESS}`);
                        console.log(`[TransactionHandler] Is vault deposit? ${toUserAccount === VAULT_ADDRESS}`);

                        if (toUserAccount === VAULT_ADDRESS && fromUserAccount) {
                            console.log('[TransactionHandler] 🎯 Vault deposit detected! Calling handleVaultDeposit...');
                            await handleVaultDeposit(transaction, transfer);
                        }

                        if (fromUserAccount){
                            await this.updateWalletBalance(fromUserAccount, -amount / LAMPORTS_PER_SOL);
                            affectedWallets.add(fromUserAccount);
                        }

                        if (toUserAccount){
                            await this.updateWalletBalance(toUserAccount, amount / LAMPORTS_PER_SOL);
                            affectedWallets.add(toUserAccount);
                        }
                    }
                }

                // Check for privacy cash vault deposits (Token transfers)
                if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
                    console.log(`[TransactionHandler] Found ${transaction.tokenTransfers.length} token transfer(s)`);
                    for (const transfer of transaction.tokenTransfers) {
                        const { fromUserAccount, toUserAccount, tokenAmount, mint } = transfer;
                        console.log(`[TransactionHandler] Token transfer: ${fromUserAccount} -> ${toUserAccount}, amount: ${tokenAmount}, mint: ${mint}`);
                        console.log(`[TransactionHandler] Vault address: ${VAULT_ADDRESS}`);
                        console.log(`[TransactionHandler] Is vault deposit? ${toUserAccount === VAULT_ADDRESS}`);

                        // Detect vault deposit for privacy cash (tokens)
                        if (toUserAccount === VAULT_ADDRESS && fromUserAccount) {
                            console.log('[TransactionHandler] 🎯 Vault token deposit detected! Calling handleVaultDeposit...');
                            await handleVaultDeposit(transaction, transfer, mint);
                        }

                        if (fromUserAccount){
                            await this.updateWalletBalance(fromUserAccount, -tokenAmount);
                            affectedWallets.add(fromUserAccount);
                        }

                        if (toUserAccount){
                            await this.updateWalletBalance(toUserAccount, tokenAmount);
                            affectedWallets.add(toUserAccount);
                        }
                    }
                }

                for (const walletAddress of affectedWallets) {
                    const parsedTx = parseHeliusTransaction(transaction, walletAddress);
                    await this.saveTransactionToHistory(walletAddress, parsedTx);
                }
            }

            console.log('Transaction(s) processed successfully');

        } catch(error) {
            console.error('Error handling transactions:', error);
            throw error;
        }
    }
    
    private static async updateWalletBalance(
        walletAddress: string,
        delta: number
    ) {
        try {
            const balanceKey = CacheService.balanceKey(walletAddress);

            const currentBalance = await CacheService.get<number>(balanceKey);

            const newBalance = (currentBalance || 0) + delta;

            await CacheService.set(balanceKey, newBalance, 0);

            const solPrice = await SolPriceService.getSolanaPrice();
            const balanceUSD = newBalance * solPrice;

            getSocketService().emitBalanceUpdate(walletAddress, balanceUSD);
        } catch (error) {
            console.error(`Error updating balance for ${walletAddress}`, error);
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
                return;
            }

            const newHistory = [transaction, ...currentHistory].slice(0, 100);

            await CacheService.set(historyKey, newHistory, 0);

            getSocketService().emitNewTransaction(walletAddress, transaction);
        } catch (error) {
            console.error(`Error saving transaction to history for ${walletAddress}:`, error);
            throw error;
        }
    }
}
