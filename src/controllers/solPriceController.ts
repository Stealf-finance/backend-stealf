import { Request, Response, NextFunction } from 'express';
import { SolPriceService } from '../services/pricing/solPrice';
import { success } from 'zod';

export class SolPriceController {

    /**
     * GET /api/users/sol-price
     */
    static async getSolPrice(req: Request, res: Response, next: NextFunction) {
        try {
            const price = await SolPriceService.getSolanaPrice();

            return res.status(200).json({
                success: true,
                data: {
                    netword: 'Solana',
                    price_usd: price,
                    timestamp: new Date(),
                },
            });
        } catch (error) {
            next(error);
        }
    }
}