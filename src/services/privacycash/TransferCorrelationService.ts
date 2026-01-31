import { PrivateDeposit } from '../../models/PrivateDeposit';

export interface WebhookTransactionData {
    signature: string;
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
    tokenMint?: string;
    memo?: string;
    timestamp: number;
}

export class TransferCorrelationService {
    private readonly VAULT_ADDRESS = process.env.VAULT_PUBLIC_KEY!;
    private readonly CORRELATION_TIME_WINDOW_MS = 20 * 60 * 1000; // 20 minutes

    /**
     * Primary method: Correlate by memo/reference UUID
     */
    async correlateByReference(reference: string, amount: number, tokenMint?: string): Promise<boolean> {
        try {
            console.log(`[Correlation] Attempting correlation by reference: ${reference}`);

            const transfer = await PrivateDeposit.findOne({
                reference,
                status: 'pending_vault',
            });

            if (!transfer) {
                console.warn(`[Correlation] No transfer found with reference: ${reference}`);
                return false;
            }

            const amountVariance = Math.abs(transfer.amount - amount);
            const maxVariance = transfer.amount * 0.01; // 1% variance allowed

            if (amountVariance > maxVariance) {
                console.warn(`[Correlation] Amount mismatch for reference ${reference}: expected ${transfer.amount}, got ${amount}`);
                return false;
            }

            const expectedToken = transfer.tokenMint || null;
            const actualToken = tokenMint || null;

            if (expectedToken !== actualToken) {
                console.warn(`[Correlation] Token mismatch for reference ${reference}: expected ${expectedToken}, got ${actualToken}`);
                return false;
            }

            console.log(`[Correlation] ✅ Transfer ${transfer._id} matched by reference ${reference}`);

            return true;
        } catch (error) {
            console.error('[Correlation] Error in correlateByReference:', error);
            return false;
        }
    }

    /**
     * Fallback method: Correlate by transaction details (without memo)
     */
    async correlateByTransactionDetails(txData: WebhookTransactionData): Promise<boolean> {
        try {
            console.log('[Correlation] Attempting fallback correlation by transaction details');

            // Only process if it's a transaction TO the vault
            if (txData.toUserAccount !== this.VAULT_ADDRESS) {
                console.log('[Correlation] Transaction not to vault address, skipping');
                return false;
            }

            const timeWindowStart = new Date(txData.timestamp - this.CORRELATION_TIME_WINDOW_MS);

            // Find matching transfer by: from wallet, amount, tokenMint, time window
            const transfer = await PrivateDeposit.findOne({
                status: 'pending_vault',
                sourceWallet: txData.fromUserAccount,
                amount: txData.amount,
                tokenMint: txData.tokenMint || null,
                createdAt: { $gte: timeWindowStart },
            }).sort({ createdAt: -1 });

            if (!transfer) {
                console.warn(`[Correlation] No matching transfer found for fallback correlation`);
                console.warn(`[Correlation] Details: from=${txData.fromUserAccount}, amount=${txData.amount}, tokenMint=${txData.tokenMint}`);
                return false;
            }

            console.log(`[Correlation] ✅ Deposit ${transfer._id} matched by transaction details (fallback)`);
            return true;
        } catch (error) {
            console.error('[Correlation] Error in correlateByTransactionDetails:', error);
            return false;
        }
    }

    /**
     * Main correlation method that tries reference first, then fallback
     */
    async correlateTransaction(txData: WebhookTransactionData): Promise<boolean> {
        try {
            if (txData.memo) {
                const correlatedByRef = await this.correlateByReference(
                    txData.memo,
                    txData.amount,
                    txData.tokenMint
                );

                if (correlatedByRef) {
                    return true;
                }
            }

            return await this.correlateByTransactionDetails(txData);
        } catch (error) {
            console.error('[Correlation] Error in correlateTransaction:', error);
            return false;
        }
    }
}

export const transferCorrelationService = new TransferCorrelationService();
