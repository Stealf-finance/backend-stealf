import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth/magicLinkService';
import { PreAuthService } from '../services/auth/preAuthService';
import logger from '../config/logger';

export class MagicLinkController{

    /**
     * GET /api/users/check-verification
     * Token should be in Authorization: Bearer <preAuthToken> header
     */
    static async checkVerification(req: Request, res: Response, next: NextFunction) {
        try {
            let token: string | undefined;

            // Accept token from Authorization header or query param
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            } else if (req.query.token && typeof req.query.token === 'string') {
                token = req.query.token;
            }

            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: 'Pre-auth token is required'
                });
            }

            const status = await PreAuthService.verifyPreAuthToken(token);

            if (!status) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired pre-auth token'
                });
            }

            return res.status(200).json({
                success: true,
                verified: status.verified,
                email: status.email,
                pseudo: status.pseudo
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/users/verify-magic-link?token=xxx
     * Verifies the magic link token and displays result page.
     * Token is one-time use (deleted after verification).
     * Referrer-Policy: no-referrer prevents token leakage via Referer header.
     * Cache-Control: no-store prevents caching of the token URL.
     */
    static async verifyMagicLink(req: Request, res: Response, _next: NextFunction) {
        // Prevent token leakage and caching
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

        try {
            const { token } = req.query;

            if (!token || typeof token !== 'string') {
                return res.status(200).send(MagicLinkController.renderErrorPage('Token is required'));
            }

            const userData = await authService.verifyMagicLink(token);
            await PreAuthService.markAsVerified(userData.email, userData.pseudo);

            return res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Email Verified - Stealf Finance</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #000; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                        .container { max-width: 500px; width: 100%; text-align: center; }
                        .icon { font-size: 72px; margin-bottom: 32px; }
                        h1 { font-size: 32px; font-weight: 600; margin-bottom: 24px; letter-spacing: -0.5px; }
                        p { font-size: 16px; line-height: 1.6; opacity: 0.8; margin-bottom: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">✓</div>
                        <h1>Welcome to Stealf Finance</h1>
                        <p>Your email has been verified successfully.</p>
                        <p>You can now close this window and return on stealf app.</p>
                    </div>
                </body>
                </html>
            `);
        } catch (error: any) {
            logger.error({ err: error }, 'Error verifying magic link');
            return res.status(200).send(MagicLinkController.renderErrorPage('Invalid or expired link'));
        }
    }

    private static renderErrorPage(message: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Error - Stealf Finance</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #000; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                    .container { max-width: 500px; width: 100%; text-align: center; }
                    .icon { font-size: 72px; margin-bottom: 32px; color: #dc2626; }
                    h1 { font-size: 32px; font-weight: 600; margin-bottom: 24px; color: #dc2626; }
                    p { font-size: 16px; line-height: 1.6; opacity: 0.8; margin-bottom: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">✕</div>
                    <h1>Error</h1>
                    <p>${message}</p>
                    <p>Please return to the Stealf app and try again.</p>
                </div>
            </body>
            </html>
        `;
    }
}
