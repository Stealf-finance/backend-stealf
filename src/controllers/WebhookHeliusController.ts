import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { TransactionHandler } from '../services/helius/transactionsHandler';
import { heliusWebhookPayloadSchema } from '../utils/validations';
import logger from '../config/logger';

export class WebhookHeliusController {

    static async handleHelius(req: Request, res: Response){

        try{
            const authHeader = req.headers.authorization;
            const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;

            if (!expectedSecret) {
                logger.error('HELIUS_WEBHOOK_SECRET not configured in environment');
                return res.status(500).json({ success: false, error: 'Server configuration error' });
            }

            const authBuffer = Buffer.from(authHeader || '');
            const expectedBuffer = Buffer.from(expectedSecret);
            if (authBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(authBuffer, expectedBuffer)) {
                logger.warn('Unauthorized webhook request - invalid secret');
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const first = Array.isArray(req.body) ? req.body[0] : req.body;
            logger.info({ keys: Object.keys(first || {}), sample: JSON.stringify(first).slice(0, 500) }, 'RAW WEBHOOK BODY');

            const validatedPayload = heliusWebhookPayloadSchema.parse(req.body);

            await TransactionHandler.handleTransaction(validatedPayload);

            return res.status(200).json({ success: true});
        } catch (error){
            if (error instanceof z.ZodError) {
                logger.warn({ issues: error.issues }, 'Webhook payload validation failed');
                return res.status(400).json({ success: false, error: 'Invalid payload format' });
            }
            logger.error({ err: error }, 'Helius webhook error');
            return res.status(500).json({ success: false });
        }
    }
}
