
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { PrivateWithdraw, IPrivateWithdraw } from '../../models/PrivateWithdraw';
import { User } from '../../models/User';
import { privacyCashService } from './PrivacyCashService';
import { privacyBalanceService } from './PrivacyBalanceService';
import { calculateWithdrawalFee } from '../../config/privacyCash';
import { getSocketService } from '../socket/socketService';

export interface InitiateWithdrawParams {
    userId: string;
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

export class PrivacyWithdrawService {
    private socketService = getSocketService();

    /**
     * Initiate and execute a private withdrawal
     */
    async initiateWithdraw(params: InitiateWithdrawParams): Promise<WithdrawStatus> {
        const { userId, recipient, amount, tokenMint } = params;

        // 1. Get user
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // 2. Check if token is supported
        if (!privacyCashService.isTokenSupported(tokenMint)) {
            throw new Error(`Token ${tokenMint} is not supported. Supported tokens: SOL, USDC`);
        }

        // 3. Calculate fee
        const fee = calculateWithdrawalFee(amount);
        const totalRequired = amount + fee;

        // 4. Check user's private balance (not global Privacy Cash balance)
        const userBalance = await privacyBalanceService.getBalance(userId, tokenMint);

        if (userBalance < totalRequired) {
            throw new Error(`Insufficient balance. Required: ${totalRequired} (${amount} + ${fee} fee), Available: ${userBalance}`);
        }

        // 6. Create withdraw record
        const reference = randomUUID();

        const withdraw = new PrivateWithdraw({
            userId: new mongoose.Types.ObjectId(userId),
            reference,
            sourceWallet: user.stealf_wallet,
            destinationWallet: recipient,
            amount,
            tokenMint: tokenMint || null,
            fee,
            status: 'withdraw_submitted',
            retryCount: 0,
        });

        await withdraw.save();

        console.log(`[PrivacyWithdraw] Withdraw ${withdraw._id} initiated for user ${userId}`);

        // 7. Execute withdrawal
        await this.executeWithdraw(withdraw, recipient, fee);

        return this.formatWithdrawStatus(withdraw, fee);
    }

    /**
     * Execute Privacy Cash withdrawal
     */
    private async executeWithdraw(withdraw: IPrivateWithdraw, recipient: string, fee: number): Promise<void> {
        console.log(`[PrivacyWithdraw] Executing withdraw for ${withdraw._id}`);

        try {
            // Mark as submitted
            withdraw.status = 'withdraw_submitted';
            await withdraw.save();
            this.notifyWithdrawUpdate(withdraw);

            const mintPubKey = privacyCashService.getTokenMintPublicKey(withdraw.tokenMint || undefined);

            let withdrawResult;
            if (mintPubKey) {
                withdrawResult = await privacyCashService.withdrawSPL(mintPubKey, withdraw.amount, recipient);
            } else {
                withdrawResult = await privacyCashService.withdrawSOL(withdraw.amount, recipient);
            }

            // Mark as withdrawn
            withdraw.privacyCashWithdrawTx = withdrawResult.tx;
            withdraw.status = 'withdrawn';
            await withdraw.save();

            console.log(`[PrivacyWithdraw] Withdraw completed: ${withdrawResult.tx}`);
            this.notifyWithdrawUpdate(withdraw);

            // Subtract balance (amount + fee) from user's private balance
            await privacyBalanceService.subtractBalance(
                withdraw.userId.toString(),
                withdraw.amount + withdraw.fee,
                withdraw.tokenMint || undefined
            );

        } catch (error) {
            console.error(`[PrivacyWithdraw] Withdraw failed for ${withdraw._id}:`, error);

            withdraw.status = 'failed';
            withdraw.errorMessage = error instanceof Error ? error.message : 'Unknown error';
            withdraw.retryCount += 1;
            await withdraw.save();

            this.notifyWithdrawUpdate(withdraw);

            throw error;
        }
    }

    private formatWithdrawStatus(withdraw: IPrivateWithdraw, fee: number): WithdrawStatus {
        return {
            withdrawId: withdraw._id.toString(),
            reference: withdraw.reference,
            status: withdraw.status,
            recipient: withdraw.destinationWallet || '',
            amount: withdraw.amount,
            tokenMint: withdraw.tokenMint || undefined,
            fee,
            transactions: {
                privacyCashWithdrawTx: withdraw.privacyCashWithdrawTx,
            },
            errorMessage: withdraw.errorMessage,
            createdAt: withdraw.createdAt,
            updatedAt: withdraw.updatedAt,
        };
    }

    private notifyWithdrawUpdate(withdraw: IPrivateWithdraw): void {
        this.socketService.emitPrivateTransferUpdate(withdraw.userId.toString(), {
            transferId: withdraw._id.toString(),
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
