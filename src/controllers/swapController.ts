import { Request, Response, NextFunction } from 'express';
import { jupiterSwapService } from '../services/swapper/jupiterSwapService';
import { swapOrderSchema, swapExecuteSchema } from '../utils/validations';
import { ZodError } from 'zod';

export class SwapController {
    /**
     * POST /api/swap/order
     * Forward order request to Jupiter Ultra API and return quote + unsigned TX
     */
    static async order(req: Request, res: Response, next: NextFunction) {
        try {
            const validated = swapOrderSchema.parse(req.body);

            const orderResponse = await jupiterSwapService.getOrder(validated);

            return res.status(200).json({
                success: true,
                data: orderResponse,
            });
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: error.issues,
                });
            }
            next(error);
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

            return res.status(200).json({
                success: true,
                data: executeResponse,
            });
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: error.issues,
                });
            }
            next(error);
        }
    }
}
