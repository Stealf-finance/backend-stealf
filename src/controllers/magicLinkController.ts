import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth/magicLinkService';
import { PreAuthService } from '../services/auth/preAuthService';

export class MagicLinkController{

    /**
     * GET /api/users/check-verification?token=preAuthToken
     */
    static async checkVerification(req: Request, res: Response, next: NextFunction) {
        try {
            const { token } = req.query;

            if (!token || typeof token !== 'string') {
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
                    <title>Email Verified - Stealf</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            margin: 0;
                            padding: 20px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 16px;
                            max-width: 400px;
                            width: 100%;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                            text-align: center;
                        }
                        .icon {
                            font-size: 64px;
                            margin-bottom: 20px;
                        }
                        h1 {
                            color: #10b981;
                            margin: 0 0 16px 0;
                            font-size: 24px;
                        }
                        .message {
                            color: #666;
                            margin-bottom: 30px;
                            font-size: 16px;
                            line-height: 1.5;
                        }
                        .info-box {
                            background: #f0f0f0;
                            padding: 20px;
                            border-radius: 8px;
                            margin: 20px 0;
                        }
                        .info-box p {
                            margin: 8px 0;
                            font-size: 14px;
                            color: #333;
                        }
                        .cta {
                            background: #4F46E5;
                            color: white;
                            padding: 16px 32px;
                            border-radius: 8px;
                            font-weight: 600;
                            font-size: 16px;
                            margin-top: 24px;
                            display: inline-block;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">✅</div>
                        <h1>Email Verified!</h1>
                        <p class="message">
                            Your email has been successfully verified.<br>
                            <strong>Return to the Stealf app to continue.</strong>
                        </p>
                        <div class="info-box">
                            <p><strong>Email:</strong> ${userData.email}</p>
                            <p><strong>Pseudo:</strong> ${userData.pseudo}</p>
                        </div>
                        <div class="cta">
                            📱 Open the Stealf app now
                        </div>
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
                    <title>Error - Stealf</title>
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; background: #f5f5f5;">
                    <div style="background: white; padding: 40px; border-radius: 12px; max-width: 400px; margin: 0 auto;">
                        <h1 style="color: #dc2626;">❌ Error</h1>
                        <p style="color: #666;">${error.message || 'Invalid or expired token'}</p>
                        <a href="${errorDeepLink}" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px;">
                            Open Stealf App
                        </a>
                    </div>
                    <script>
                        setTimeout(function() { window.location.href = '${errorDeepLink}'; }, 500);
                    </script>
                </body>
                </html>
            `);
        }
    }
}