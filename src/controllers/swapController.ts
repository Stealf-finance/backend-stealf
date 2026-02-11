import { Request, Response, NextFunction } from 'express';
import { isAxiosError } from 'axios';
import { jupiterSwapService } from '../services/swapper/jupiterSwapService';
import { swapOrderSchema, swapExecuteSchema } from '../utils/validations';
import { CacheService } from '../services/cache/cacheService';
import { ZodError } from 'zod';

function handleSwapError(error: unknown, res: Response, next: NextFunction) {
    if (error instanceof ZodError) {
        return res.status(400).json({
            error: 'Validation failed',
            details: error.issues,
        });
    }
    if (isAxiosError(error) && error.response) {
        return res.status(error.response.status).json({
            error: 'Jupiter API error',
            details: error.response.data,
        });
    }
    next(error);
}

export class SwapController {
    /**
     * POST /api/swap/order
     * Forward order request to Jupiter Ultra API and return quote + unsigned TX
     */
    static async order(req: Request, res: Response, next: NextFunction) {
        try {
            const validated = swapOrderSchema.parse(req.body);

            const orderResponse = await jupiterSwapService.getOrder(validated);

            // Store wallets associated with this order for cache invalidation on execute
            await CacheService.set(`swap:order:${orderResponse.requestId}`, {
                taker: validated.taker,
                receiver: validated.receiver,
            }, 300);

            return res.status(200).json({
                success: true,
                data: orderResponse,
            });
        } catch (error) {
            handleSwapError(error, res, next);
        }
    }

    /**
     * POST /api/swap/execute
     * Forward signed transaction to Jupiter Ultra API and return signature
     */
    static async execute(req: Request, res: Response, next: NextFunction) {
        try {
            const validated = swapExecuteSchema.parse(req.body);

            const executeResponse = await jupiterSwapService.executeSwap(validated);

            // Invalidate cache for taker and receiver so next fetch gets fresh on-chain data
            const orderKey = `swap:order:${validated.requestId}`;
            const orderWallets = await CacheService.get<{ taker: string; receiver?: string }>(orderKey);
            if (orderWallets) {
                const walletsToInvalidate = [orderWallets.taker, orderWallets.receiver].filter(Boolean) as string[];
                for (const wallet of walletsToInvalidate) {
                    await CacheService.del(CacheService.balanceKey(wallet));
                    await CacheService.del(CacheService.historyKey(wallet, 100));
                }
                await CacheService.del(orderKey);
            }

            return res.status(200).json({
                success: true,
                data: executeResponse,
            });
        } catch (error) {
            handleSwapError(error, res, next);
        }
    }
}
