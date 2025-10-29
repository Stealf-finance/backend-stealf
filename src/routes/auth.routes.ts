import { Router, Request, Response } from 'express';
import { SDKGridClient } from '../config/gridClient';
import { ErrorCode } from '../types/errors';

const router = Router();

/**
 * POST /grid/auth
 * Initiate authentication - Step 1: Request OTP code
 */
router.post('/grid/auth', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        const gridClient = SDKGridClient.getInstance();

        const response = await gridClient.initAuth(body);

        res.status(200).json(response);
    } catch (error: any) {
        const errorResponse = {
            error: error.message || 'An unknown error occurred',
            details: error.data?.details || [{ code: ErrorCode.UNKNOWN_ERROR }],
            status: error.status || 500
        };

        res.status(error.status || 500).json(errorResponse);
    }
});

/**
 * POST /grid/auth/verify
 * Verify OTP and complete authentication - Step 2
 */
router.post('/grid/auth/verify', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        console.log('📥 /grid/auth/verify - Request body:', JSON.stringify(body, null, 2));
        console.log('🔍 Email:', body.user?.email);
        console.log('🔍 OTP Code:', body.otpCode);
        console.log('🔍 Has sessionSecrets:', !!body.sessionSecrets);

        const gridClient = SDKGridClient.getInstance();

        const response = await gridClient.completeAuth(body);

        console.log('✅ /grid/auth/verify - Success');
        res.status(200).json(response);
    } catch (error: any) {
        console.error('❌ /grid/auth/verify - Error:', error.message);
        console.error('📋 Error code:', error.code);
        res.status(error.status || 500).json(error);
    }
});

/**
 * POST /grid/accounts
 * Create account - Step 1: Request OTP code
 */
router.post('/grid/accounts', async (req: Request, res: Response) => {
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
 * POST /grid/accounts/verify
 * Verify OTP and complete account creation - Step 2
 */
router.post('/grid/accounts/verify', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        const gridClient = SDKGridClient.getInstance();

        const payload = {
            otpCode: body.otp_code || body.otpCode,
            sessionSecrets: body.sessionSecrets,
            user: body.user || { email: body.email }
        };

        const response = await gridClient.completeAuthAndCreateAccount(payload);

        res.status(200).json(response);
    } catch (error: any) {
        res.status(error.status || 500).json(error);
    }
});

export default router;
