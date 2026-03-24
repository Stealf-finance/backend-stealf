import { Request, Response, NextFunction } from 'express';
import { solanaService } from '../services/helius/walletInit';
import { parseTransactions } from '../services/wallet/transactionParser';
import { getHeliusWebhookManager } from '../services/helius/webhookManager';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class WalletController {
    /**
     * POST /api/wallet/privacy-wallet
     * Register a stealf wallet to Helius webhook (not stored in DB)
     */
    static async registerPrivacyWallet(req: Request, res: Response, next: NextFunction) {
        try {
            const mongoUserId = (req as any).user?.mongoUserId;
            if (!mongoUserId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const { walletAddress } = req.body;
            if (!walletAddress || !SOLANA_ADDRESS_RE.test(walletAddress)) {
                return res.status(400).json({ error: 'Invalid wallet address' });
            }

            const webhookManager = getHeliusWebhookManager();
            await webhookManager.addUserWallets(walletAddress);

            return res.status(200).json({
                data: { stealf_wallet: walletAddress }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/wallet/history/:address?limit=10
     */
    static async getHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const address = req.params.address as string;
            if (!SOLANA_ADDRESS_RE.test(address)) {
                return res.status(400).json({ error: 'Invalid wallet address' });
            }
            const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);

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
            if (!SOLANA_ADDRESS_RE.test(address)) {
                return res.status(400).json({ error: 'Invalid wallet address' });
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
}
