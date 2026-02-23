import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { solanaService } from '../services/helius/walletInit';
import { parseTransactions } from '../services/wallet/transactionParser';
import { privacyBalanceService } from '../services/privacycash/PrivacyBalanceService';
import { signAndSendCashWalletTransaction } from '../services/auth/turnkeySign.service';

export class WalletController {
    /**
     * Verify that the requested address belongs to the authenticated user
     */
    private static async verifyWalletOwnership(req: Request, address: string): Promise<{ authorized: boolean; user?: any }> {
        const mongoUserId = (req as any).user?.mongoUserId;
        if (!mongoUserId) {
            return { authorized: false };
        }

        const user = await User.findById(mongoUserId);
        if (!user) {
            return { authorized: false };
        }

        const isOwner = user.cash_wallet === address || user.stealf_wallet === address;
        return { authorized: isOwner, user };
    }

    /**
     * GET /api/wallet/history/:address?limit=10
     */
    static async getHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;
            const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);

            const { authorized } = await WalletController.verifyWalletOwnership(req, address);
            if (!authorized) {
                return res.status(403).json({ error: 'Access denied: wallet does not belong to authenticated user' });
            }

            const rawTransactions = await solanaService.getTransactions(address, limit);
            const parsedTransactions = await parseTransactions(rawTransactions, address);

            return res.status(200).json({
                success: true,
                data: {
                    address,
                    count: parsedTransactions.length,
                    transactions: parsedTransactions,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/wallet/balance/:address
     */
    static async getBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;

            const { authorized } = await WalletController.verifyWalletOwnership(req, address);
            if (!authorized) {
                return res.status(403).json({ error: 'Access denied: wallet does not belong to authenticated user' });
            }

            const walletBalance = await solanaService.getBalance(address);

            return res.status(200).json({
                success: true,
                data: {
                    address,
                    tokens: walletBalance.tokens,
                    totalUSD: walletBalance.totalUSD,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/wallet/privacybalance/:idWallet
     */
    static async getPrivateBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const idWallet = req.params.idWallet as string;

            const { authorized, user } = await WalletController.verifyWalletOwnership(req, idWallet);
            if (!authorized || !user) {
                return res.status(403).json({ error: 'Access denied: wallet does not belong to authenticated user' });
            }

            const privateBalances = await privacyBalanceService.getAllBalances(user._id.toString());

            return res.json({
                success: true,
                data: {
                    privateBalance: {
                        sol: privateBalances.sol,
                        usdc: privateBalances.usdc,
                    },
                },
            });
        } catch (error){
            next(error);
        }
    }

    /**
     * POST /api/wallet/sign-and-send
     * Signs and sends a transaction from the user's Cash wallet via Turnkey.
     * Body: { unsignedTransaction: string (hex-encoded) }
     */
    static async signAndSendFromCashWallet(req: Request, res: Response, next: NextFunction) {
        try {
            const { unsignedTransaction } = req.body;
            if (!unsignedTransaction) {
                return res.status(400).json({ error: 'unsignedTransaction is required' });
            }

            const mongoUserId = (req as any).user?.mongoUserId;
            if (!mongoUserId) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const user = await User.findById(mongoUserId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (!user.turnkey_subOrgId) {
                return res.status(400).json({ error: 'No Turnkey sub-organization found' });
            }

            const txSignature = await signAndSendCashWalletTransaction(
                user.turnkey_subOrgId,
                unsignedTransaction,
                user.cash_wallet || undefined
            );

            return res.status(200).json({
                success: true,
                data: { txSignature },
            });
        } catch (error) {
            next(error);
        }
    }
}