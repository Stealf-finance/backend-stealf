import { randomUUID } from 'crypto';
import { User } from '../../models/User';
import { privacyCashService } from './PrivacyCashService';
import { privacyBalanceService } from './PrivacyBalanceService';
import { calculateWithdrawalFee } from '../../config/privacyCash';
import { getSocketService } from '../socket/socketService';
import { CacheService } from '../cache/cacheService';

export interface InitiateWithdrawParams {
    walletID: string;
    recipient: string;
    amount: number;
    tokenMint?: string;
}

export interface WithdrawStatus {
    withdrawId: string;
    reference: string;
    status: string;
    recipient: string;
    amount: number;
    tokenMint?: string;
    fee: number;
    transactions?: {
        privacyCashWithdrawTx?: string;
    };
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

interface CachedWithdraw {
    withdrawId: string;
    userId: string;
    reference: string;
    sourceWallet: string;
    destinationWallet: string;
    amount: number;
    tokenMint: string | null;
    fee: number;
    status: string;
    retryCount: number;
    privacyCashWithdrawTx?: string;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

export class PrivacyWithdrawService {
    private socketService = getSocketService();
    private readonly CACHE_TTL = 600;

    private getCacheKey(reference: string): string {
        return `withdraw:${reference}`;
    }

    /**
     * Initiate and execute a private withdrawal
     */
    async initiateWithdraw(params: InitiateWithdrawParams): Promise<WithdrawStatus> {
        const { walletID, recipient, amount, tokenMint } = params;

        console.log('[PrivacyWithdraw] Looking for user with cash_wallet:', walletID);

        const user = await User.findOne({ cash_wallet: walletID });
        if (!user) {
            console.error('[PrivacyWithdraw] User not found with cash_wallet:', walletID);
            throw new Error('User not found');
        }

        console.log('[PrivacyWithdraw] User found:', user._id);

        const userId = user._id.toString();

        if (!privacyCashService.isTokenSupported(tokenMint)) {
            throw new Error(`Token ${tokenMint} is not supported. Supported tokens: SOL, USDC`);
        }

        const fee = calculateWithdrawalFee(amount);
        const totalRequired = amount + fee;

        const userBalance = await privacyBalanceService.getBalance(userId, tokenMint);

        if (userBalance < totalRequired) {
            throw new Error(`Insufficient balance. Required: ${totalRequired} (${amount} + ${fee} fee), Available: ${userBalance}`);
        }

        const reference = randomUUID();
        const withdrawId = randomUUID();
        const now = new Date();

        const withdraw: CachedWithdraw = {
            withdrawId,
            userId,
            reference,
            sourceWallet: user.stealf_wallet,
            destinationWallet: recipient,
            amount,
            tokenMint: tokenMint || null,
            fee,
            status: 'withdraw_submitted',
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        await CacheService.set(this.getCacheKey(reference), withdraw, this.CACHE_TTL);

        console.log(`[PrivacyWithdraw] Withdraw ${withdrawId} initiated for user ${userId}`);

        await this.executeWithdraw(withdraw);

        return this.formatWithdrawStatus(withdraw);
    }

    /**
     * Execute Privacy Cash withdrawal
     */
    private async executeWithdraw(withdraw: CachedWithdraw): Promise<void> {
        console.log(`[PrivacyWithdraw] Executing withdraw for ${withdraw.withdrawId}`);

        try {
            // Mark as submitted
            withdraw.status = 'withdraw_submitted';
            withdraw.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(withdraw.reference), withdraw, this.CACHE_TTL);
            this.notifyWithdrawUpdate(withdraw);

            const mintPubKey = privacyCashService.getTokenMintPublicKey(withdraw.tokenMint || undefined);

            let withdrawResult;
            if (mintPubKey) {
                withdrawResult = await privacyCashService.withdrawSPL(mintPubKey, withdraw.amount, withdraw.destinationWallet);
            } else {
                withdrawResult = await privacyCashService.withdrawSOL(withdraw.amount, withdraw.destinationWallet);
            }

            // Mark as withdrawn
            withdraw.privacyCashWithdrawTx = withdrawResult.tx;
            withdraw.status = 'withdrawn';
            withdraw.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(withdraw.reference), withdraw, this.CACHE_TTL);

            console.log(`[PrivacyWithdraw] Withdraw completed: ${withdrawResult.tx}`);
            this.notifyWithdrawUpdate(withdraw);

            // Subtract balance (amount + fee) from user's private balance
            await privacyBalanceService.subtractBalance(
                withdraw.userId,
                withdraw.amount + withdraw.fee,
                withdraw.tokenMint || undefined
            );

            // Emit updated balance via socket
            const updatedBalances = await privacyBalanceService.getAllBalances(withdraw.userId);
            this.socketService.emitPrivateBalanceUpdate(withdraw.userId, updatedBalances);

            // Clean cache after successful completion
            await CacheService.del(this.getCacheKey(withdraw.reference));
            console.log(`[PrivacyWithdraw] Cache cleaned for withdraw ${withdraw.withdrawId}`);

        } catch (error) {
            console.error(`[PrivacyWithdraw] Withdraw failed for ${withdraw.withdrawId}:`, error);

            withdraw.status = 'failed';
            withdraw.errorMessage = error instanceof Error ? error.message : 'Unknown error';
            withdraw.retryCount += 1;
            withdraw.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(withdraw.reference), withdraw, this.CACHE_TTL);

            this.notifyWithdrawUpdate(withdraw);

            throw error;
        }
    }

    private formatWithdrawStatus(withdraw: CachedWithdraw): WithdrawStatus {
        return {
            withdrawId: withdraw.withdrawId,
            reference: withdraw.reference,
            status: withdraw.status,
            recipient: withdraw.destinationWallet,
            amount: withdraw.amount,
            tokenMint: withdraw.tokenMint || undefined,
            fee: withdraw.fee,
            transactions: {
                privacyCashWithdrawTx: withdraw.privacyCashWithdrawTx,
            },
            errorMessage: withdraw.errorMessage,
            createdAt: withdraw.createdAt,
            updatedAt: withdraw.updatedAt,
        };
    }

    private notifyWithdrawUpdate(withdraw: CachedWithdraw): void {
        this.socketService.emitPrivateTransferUpdate(withdraw.userId, {
            transferId: withdraw.withdrawId,
            status: withdraw.status,
            amount: withdraw.amount,
            tokenMint: withdraw.tokenMint || undefined,
            transactions: {
                privacyCashWithdrawTx: withdraw.privacyCashWithdrawTx,
            },
        });
    }
}

// Export singleton instance
export const privacyWithdrawService = new PrivacyWithdrawService();
