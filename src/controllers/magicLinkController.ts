import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth/magicLinkService';
import { PreAuthService } from '../services/auth/preAuthService';

export class MagicLinkController{

    /**
     * GET /api/users/check-verification
     * Token should be in Authorization: Bearer <preAuthToken> header
     */
    static async checkVerification(req: Request, res: Response, next: NextFunction) {
        try {
            const authHeader = req.headers.authorization;
            let token: string | undefined;

            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }

            if (!token && req.query.token && typeof req.query.token === 'string') {
                token = req.query.token;
            }

            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: 'Pre-auth token is required in Authorization header'
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

    static async verifyMagicLink(req: Request, res: Response, next: NextFunction) {
        try {
            const { token } = req.query;

            if (!token || typeof token !== 'string') {
                const errorDeepLink = `stealf://auth/error?message=${encodeURIComponent('Token is required')}`;
                return res.status(200).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Error - Stealf</title>
                    </head>
                    <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; background: #f5f5f5;">
                        <div style="background: white; padding: 40px; border-radius: 12px; max-width: 400px; margin: 0 auto;">
                            <h1 style="color: #dc2626;">❌ Error</h1>
                            <p style="color: #666;">Token is required</p>
                            <a href="${errorDeepLink}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px;">
                                Open Stealf App
                            </a>
                        </div>
                        <script>
                            setTimeout(function() { window.location.href = '${errorDeepLink}'; }, 100);
                        </script>
                    </body>
                    </html>
                `);
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
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                            }
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                background: #000000;
                                color: #ffffff;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .container {
                                max-width: 500px;
                                width: 100%;
                                text-align: center;
                            }
                            .icon {
                                font-size: 72px;
                                margin-bottom: 32px;
                            }
                            h1 {
                                font-size: 32px;
                                font-weight: 600;
                                margin-bottom: 24px;
                                letter-spacing: -0.5px;
                            }
                            p {
                                font-size: 16px;
                                line-height: 1.6;
                                opacity: 0.8;
                                margin-bottom: 12px;
                            }
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
        } catch (error: any){
            console.error('Error verifying magic link:', error);

            const errorDeepLink = `stealf://auth/error?message=${encodeURIComponent(error.message || 'Invalid or expired token')}`;

            return res.status(200).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Error - Stealf Finance</title>
                        <style>
                            * {
                                margin: 0;
                                padding: 0;
                                box-sizing: border-box;
                            }
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                background: #000000;
                                color: #ffffff;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                padding: 20px;
                            }
                            .container {
                                max-width: 500px;
                                width: 100%;
                                text-align: center;
                            }
                            .icon {
                                font-size: 72px;
                                margin-bottom: 32px;
                                color: #dc2626;
                            }
                            h1 {
                                font-size: 32px;
                                font-weight: 600;
                                margin-bottom: 24px;
                                letter-spacing: -0.5px;
                                color: #dc2626;
                            }
                            p {
                                font-size: 16px;
                                line-height: 1.6;
                                opacity: 0.8;
                                margin-bottom: 12px;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="icon">✕</div>
                            <h1>Error</h1>
                            <p>Invalid or expired link</p>
                            <p>Please return to the Stealf app and try again.</p>
                        </div>
                    </body>
                    </html>
            `);
        }
    }
}