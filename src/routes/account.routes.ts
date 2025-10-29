import { Router, Request, Response } from 'express';
import { SDKGridClient } from '../config/gridClient';

const router = Router();

/**
 * POST /grid/smart-accounts
 * Create a smart account
 */
router.post('/grid/smart-accounts', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        const gridClient = SDKGridClient.getInstance();

        const response = await gridClient.createAccount(body);

        res.status(200).json(response);
    } catch (error: any) {
        res.status(error.status || 500).json(error);
    }
});

/**
 * POST /grid/balance
 * Get account balance
 */
router.post('/grid/balance', async (req: Request, res: Response) => {
    try {
        const { smartAccountAddress } = req.body;

        if (!smartAccountAddress) {
            return res.status(400).json({
                error: 'smartAccountAddress is required'
            });
        }

        const gridClient = SDKGridClient.getInstance();
        const response = await gridClient.getAccountBalances(smartAccountAddress);

        res.status(200).json(response);
    } catch (error: any) {
        console.error('Error fetching balance:', error);
        res.status(error.status || 500).json(error);
    }
});

/**
 * GET /grid/transfers
 * Get transfers for a smart account
 */
router.get('/grid/transfers', async (req: Request, res: Response) => {
    try {
        const smartAccountAddress = req.query.smart_account_address as string;

        if (!smartAccountAddress) {
            return res.status(400).json({
                error: 'smartAccountAddress is required'
            });
        }

        console.log('📥 /grid/transfers - Request for address:', smartAccountAddress);

        const gridClient = SDKGridClient.getInstance();
        const response = await gridClient.getTransfers(smartAccountAddress);

        // Log transfer summary
        if (Array.isArray(response)) {
            console.log(`✅ /grid/transfers - Found ${response.length} transfer(s)`);

            // Log each transfer with details
            response.forEach((transfer: any, index: number) => {
                if ('Spl' in transfer) {
                    const spl = transfer.Spl;
                    console.log(`  [${index + 1}] SPL Transfer:`);
                    console.log(`      From: ${spl.from_address}`);
                    console.log(`      To: ${spl.to_address}`);
                    console.log(`      Amount: ${spl.ui_amount || spl.amount}`);
                    console.log(`      Status: ${spl.confirmation_status}`);
                    console.log(`      Signature: ${spl.signature}`);
                    console.log(`      Date: ${spl.created_at}`);
                } else if ('Bridge' in transfer) {
                    const bridge = transfer.Bridge;
                    console.log(`  [${index + 1}] Bridge Transfer:`);
                    console.log(`      ID: ${bridge.id}`);
                    console.log(`      Amount: ${bridge.amount} ${bridge.currency || 'USDC'}`);
                    console.log(`      State: ${bridge.state}`);
                    console.log(`      Date: ${bridge.created_at}`);
                }
            });
        } else {
            console.log('✅ /grid/transfers - Response:', response);
        }

        res.status(200).json(response);
    } catch (error: any) {
        console.error('❌ /grid/transfers - Error:', error.message);
        // Pass through the error data
        res.status(error.status || 500).json(error);
    }
});

export default router;
