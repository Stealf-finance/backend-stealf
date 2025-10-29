import { Router, Request, Response } from 'express';
import { SDKGridClient } from '../config/gridClient';
import { ErrorCode } from '../types/errors';

const router = Router();

/**
 * POST /grid/payment-intent
 * Prepare a payment intent (transaction)
 * Body:
 *   - payload: CreatePaymentIntentRequest (amount, grid_user_id, source, destination)
 *   - smartAccountAddress: string (the account address)
 *   - useMpcProvider: boolean (optional, default: false)
 */
router.post('/grid/payment-intent', async (req: Request, res: Response) => {
    try {
        const { payload, smartAccountAddress, useMpcProvider } = req.body;

        if (!payload || !smartAccountAddress) {
            return res.status(400).json({
                error: 'payload and smartAccountAddress are required'
            });
        }

        const gridClient = SDKGridClient.getInstance();
        const response = await gridClient.createPaymentIntent(smartAccountAddress, payload);

        res.status(200).json(response);
    } catch (error: any) {
        console.error('Error preparing payment intent:', error);
        res.status(error.status || 500).json(error);
    }
});

/**
 * POST /grid/confirm
 * Confirm and send a signed transaction
 */
router.post('/grid/confirm', async (req: Request, res: Response) => {
    try {
        const { address, signedTransactionPayload } = req.body;

        if (!address || !signedTransactionPayload) {
            return res.status(400).json({
                error: 'address and signedTransactionPayload are required'
            });
        }

        const gridClient = SDKGridClient.getInstance();

        const signature = await gridClient.send({
            signedTransactionPayload,
            address
        });

        res.status(200).json(signature);
    } catch (error: any) {
        console.error('Error confirming payment:', error);

        // Check if it's a session expired error
        const errorMessage = error.message || '';
        const errorData = error.data || {};

        if (
            errorMessage.includes('API_KEY_EXPIRED') ||
            errorMessage.includes('session key is expired') ||
            (errorData.details &&
                errorData.details.some(
                    (detail: any) =>
                        detail.turnkeyErrorCode === 'API_KEY_EXPIRED' ||
                        detail.message?.includes('expired api key')
                ))
        ) {
            return res.status(401).json({
                error: 'API key expired',
                code: ErrorCode.SESSION_EXPIRED,
                details: [{ code: 'API_KEY_EXPIRED' }]
            });
        }

        res.status(error.status || 500).json(error);
    }
});

export default router;
