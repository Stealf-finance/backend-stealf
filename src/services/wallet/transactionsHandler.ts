import { CacheService } from '../cache/cacheService';
import { parseHeliusTransaction } from './transactionParser';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSocketService } from '../socket/socketService';
import { SolPriceService } from '../pricing/solPrice';

export class TransactionHandler {

    static async handleTransaction(payload: any) {

        try {
            const transactions = Array.isArray(payload) ? payload : [payload];

            for (const transaction of transactions) {
                if (!transaction || (!transaction.nativeTransfers && !transaction.tokenTransfers)) {
                    console.log('No transfers found in transaction');
                    continue;
                }

                const affectedWallets = new Set<string>();

                if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0){
                    for (const transfer of transaction.nativeTransfers){
                        const { fromUserAccount, toUserAccount, amount } = transfer;

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

                if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
                    for (const transfer of transaction.tokenTransfers) {
                        const { fromUserAccount, toUserAccount, tokenAmount } = transfer;

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

            console.log(`Balance updated for ${walletAddress}: ${currentBalance || 0} + ${delta} = ${newBalance} SOL ($${balanceUSD.toFixed(2)} USD)`);
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

            console.log(`Transaction ${transaction.signature} added to history for ${walletAddress}`);
            getSocketService().emitNewTransaction(walletAddress, transaction);
        } catch (error) {
            console.error(`Error saving transaction to history for ${walletAddress}:`, error);
            throw error;
        }
    }
}
