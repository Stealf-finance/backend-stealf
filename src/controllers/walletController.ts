import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { solanaService } from '../services/helius/walletInit';
import { parseTransactions } from '../services/wallet/transactionParser';
import { SolPriceService } from '../services/pricing/solPrice';
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

            const balanceInSOL = await solanaService.getBalance(address);
            const SolInUSD = await SolPriceService.getSolanaPrice();
            const balance = balanceInSOL * SolInUSD;

            return res.status(200).json({
                success: true,
                data: {
                    address,
                    balance,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getPrivateBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const { cash_wallet } = req.params;

            const user = await User.findOne({ cash_wallet: cash_wallet });
            if (!user){
                return res.status(404).json({ error: 'User not found '});
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
}