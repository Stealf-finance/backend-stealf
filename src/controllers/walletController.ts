import { Request, Response, NextFunction } from 'express';
import { solanaService } from '../services/helius/walletInit';
import { parseTransactions } from '../services/wallet/transactionParser';
import { SolPriceService } from '../services/pricing/solPrice';
export class WalletController {
    
    /**
     * GET /api/wallet/walletInfos/:address?limit=10)
     */
    static async getHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;
            const limit = parseInt(req.query.limit as string) || 10;

            const rawTransactions = await solanaService.getTransactions(address, limit);
            console.log(`[getHistory] Fetched ${rawTransactions.length} raw transactions for ${address} (limit: ${limit})`);

            const parsedTransactions = await parseTransactions(rawTransactions, address);
            console.log(`[getHistory] Returning ${parsedTransactions.length} parsed transactions`);

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


}