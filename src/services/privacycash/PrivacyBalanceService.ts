import mongoose from 'mongoose';
import { PrivateBalance, IPrivateBalance } from '../../models/PrivateBalance';
import { SUPPORTED_TOKENS } from '../../config/privacyCash';

export class PrivacyBalanceService {
    /**
     * Get or create user's private balance
     */
    async getOrCreateBalance(userId: string): Promise<IPrivateBalance> {
        let balance = await PrivateBalance.findOne({ userId: new mongoose.Types.ObjectId(userId) });

        if (!balance) {
            balance = new PrivateBalance({
                userId: new mongoose.Types.ObjectId(userId),
                solBalance: 0,
                usdcBalance: 0,
            });
            await balance.save();
            console.log(`[PrivacyBalance] Created new balance for user ${userId}`);
        }

        return balance;
    }

    /**
     * Add balance after successful deposit
     */
    async addBalance(userId: string, amount: number, tokenMint?: string): Promise<IPrivateBalance> {
        const balance = await this.getOrCreateBalance(userId);

        const isSOL = !tokenMint;
        const isUSDC = tokenMint === SUPPORTED_TOKENS.USDC?.toBase58();

        if (isSOL) {
            balance.solBalance += amount;
        } else if (isUSDC) {
            balance.usdcBalance += amount;
        } else {
            throw new Error(`Unsupported token: ${tokenMint}`);
        }

        await balance.save();

        console.log(`[PrivacyBalance] Added ${amount} ${isSOL ? 'SOL' : 'USDC'} to user ${userId}. New balance: SOL=${balance.solBalance}, USDC=${balance.usdcBalance}`);

        return balance;
    }

    /**
     * Subtract balance before withdrawal
     */
    async subtractBalance(userId: string, amount: number, tokenMint?: string): Promise<IPrivateBalance> {
        const balance = await this.getOrCreateBalance(userId);

        const isSOL = !tokenMint;
        const isUSDC = tokenMint === SUPPORTED_TOKENS.USDC?.toBase58();

        if (isSOL) {
            if (balance.solBalance < amount) {
                throw new Error(`Insufficient SOL balance. Available: ${balance.solBalance}, Required: ${amount}`);
            }
            balance.solBalance -= amount;
        } else if (isUSDC) {
            if (balance.usdcBalance < amount) {
                throw new Error(`Insufficient USDC balance. Available: ${balance.usdcBalance}, Required: ${amount}`);
            }
            balance.usdcBalance -= amount;
        } else {
            throw new Error(`Unsupported token: ${tokenMint}`);
        }

        await balance.save();

        console.log(`[PrivacyBalance] Subtracted ${amount} ${isSOL ? 'SOL' : 'USDC'} from user ${userId}. New balance: SOL=${balance.solBalance}, USDC=${balance.usdcBalance}`);

        return balance;
    }

    /**
     * Get user's balance for a specific token
     */
    async getBalance(userId: string, tokenMint?: string): Promise<number> {
        const balance = await this.getOrCreateBalance(userId);

        const isSOL = !tokenMint;
        const isUSDC = tokenMint === SUPPORTED_TOKENS.USDC?.toBase58();

        if (isSOL) {
            return balance.solBalance;
        } else if (isUSDC) {
            return balance.usdcBalance;
        } else {
            throw new Error(`Unsupported token: ${tokenMint}`);
        }
    }

    /**
     * Get all balances for a user
     */
    async getAllBalances(userId: string): Promise<{ sol: number; usdc: number }> {
        const balance = await this.getOrCreateBalance(userId);

        return {
            sol: balance.solBalance,
            usdc: balance.usdcBalance,
        };
    }

    /**
     * Check if user has sufficient balance
     */
    async hasSufficientBalance(userId: string, amount: number, tokenMint?: string): Promise<boolean> {
        const currentBalance = await this.getBalance(userId, tokenMint);
        return currentBalance >= amount;
    }
}

// Export singleton instance
export const privacyBalanceService = new PrivacyBalanceService();
