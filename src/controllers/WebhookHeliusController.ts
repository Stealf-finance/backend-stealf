import { Request, Response } from 'express';
import { z } from 'zod';
import { TransactionHandler } from '../services/wallet/transactionsHandler';
import { heliusWebhookPayloadSchema } from '../utils/validations';

export class WebhookHeliusController {

    static async handleHelius(req: Request, res: Response){

        try{
            const authHeader = req.headers.authorization;
            const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;

            if (!expectedSecret) {
                console.error('HELIUS_WEBHOOK_SECRET not configured in environment');
                return res.status(500).json({ success: false, error: 'Server configuration error' });
            }

            if (!authHeader || authHeader !== expectedSecret) {
                console.error('Unauthorized webhook request - invalid secret');
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            // SECURITY: Validate webhook payload structure
            const validatedPayload = heliusWebhookPayloadSchema.parse(req.body);

            await TransactionHandler.handleTransaction(validatedPayload);

            return res.status(200).json({ success: true});
        } catch (error){
            if (error instanceof z.ZodError) {
                console.error('Webhook payload validation failed:', error.issues);
                return res.status(400).json({ success: false, error: 'Invalid payload format' });
            }
            console.error('Helius Webhook Error:', error);
            return res.status(500).json({ success: false });
        }
    }
}