import { Request, Response } from 'express';
import { TransactionHandler } from '../services/wallet/transactionsHandler';

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

            await TransactionHandler.handleTransaction(req.body);

            return res.status(200).json({ success: true});
        } catch (error){
            console.error('Helius Webhook Error:', error);
            return res.status(500).json({ success: false });
        }
    }
}