import { CacheService } from '../cache/cacheService';

export interface WebhookTransactionData {
    signature: string;
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
    tokenMint?: string;
    memo?: string;
    timestamp: number;
}

interface CachedDeposit {
    depositId: string;
    userId: string;
    reference: string;
    sourceWallet: string;
    amount: number;
    tokenMint: string | null;
    status: string;
    retryCount: number;
    vaultDepositTx?: string;
    privacyCashDepositTx?: string;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

export class TransferCorrelationService {
    private readonly VAULT_ADDRESS = process.env.VAULT_PUBLIC_KEY!;

    private getCacheKey(reference: string): string {
        return `deposit:${reference}`;
    }

    /**
     * Primary method: Correlate by memo/reference UUID
     */
    async correlateByReference(reference: string, amount: number, tokenMint?: string): Promise<boolean> {
        try {
            console.log(`[Correlation] Attempting correlation by reference: ${reference}`);

            const transfer = await CacheService.get<CachedDeposit>(this.getCacheKey(reference));

            if (!transfer || transfer.status !== 'pending_vault') {
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

            console.log(`[Correlation] ✅ Transfer ${transfer.depositId} matched by reference ${reference}`);

            return true;
        } catch (error) {
            console.error('[Correlation] Error in correlateByReference:', error);
            return false;
        }
    }

    /**
     * Fallback method: Correlate by transaction details (without memo)
     *
     * NOTE: With cache-only storage, cannot query by multiple fields.
     * This fallback method is disabled for cache architecture.
     */
    async correlateByTransactionDetails(txData: WebhookTransactionData): Promise<boolean> {
        try {
            console.log('[Correlation] Fallback correlation not available with cache-only storage');
            console.warn('[Correlation] Transaction without memo cannot be correlated (privacy mode)');
            return false;
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
