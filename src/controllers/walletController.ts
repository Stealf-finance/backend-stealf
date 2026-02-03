import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { solanaService } from '../services/helius/walletInit';
import { parseTransactions } from '../services/wallet/transactionParser';

import { privacyBalanceService } from '../services/privacycash/PrivacyBalanceService';

export class WalletController {
    /**
     * GET /api/wallet/walletInfos/:address?limit=10)
     */
    static async getHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;
            const limit = parseInt(req.query.limit as string) || 10;

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

    static async getBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;

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

    static async getPrivateBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const { idWallet } = req.params;

            console.log('[WalletController] Getting private balance for:', idWallet);
            const user = await User.findOne({ cash_wallet: idWallet });
            if (!user){
                console.error('[WalletController] User not found with cash_wallet:', idWallet);
                return res.status(404).json({ error: 'User not found' });
            }

            console.log('[WalletController] User found:', user._id);
            const privateBalances = await privacyBalanceService.getAllBalances(user._id.toString());

            console.log('[WalletController] Private balances:', privateBalances);
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
            console.error('[WalletController] Error getting private balance:', error);
            next(error);
        }
    }
}