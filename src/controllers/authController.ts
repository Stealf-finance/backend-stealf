import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { InviteCode } from '../models/InviteCode';
import { check, success, z } from 'zod';
import { checkAvailabilitySchema, authUserSchema } from '../utils/validations';
import { verifySessionJwtSignature } from '@turnkey/crypto';
import { is } from 'zod/v4/locales';
import { decodeSessionJwt } from '../middleware/verifyAuth';
import { createUser } from '../services/auth/createUser';
import * as magicLinkService from '../services/auth/magicLinkService';
import { PreAuthService } from '../services/auth/preAuthService';
import { StatsService } from '../services/stats.service';
import logger from '../config/logger';

export class UserController {

    /**
     * POST /api/users/check-availability
     */
    static async checkAvailability(req: Request, res: Response, next: NextFunction) {
        const startTime = Date.now();
        const MIN_RESPONSE_TIME = 500;

        try {
            const { email, pseudo, inviteCode } = checkAvailabilitySchema.parse(req.body);
            const unavailable: number[] = [];

            if (!inviteCode) {
                const elapsed = Date.now() - startTime;
                if (elapsed < MIN_RESPONSE_TIME) {
                    await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
                }
                return res.status(200).json({ canProceed: false, unavailable: [], errors: [{ field: 'inviteCode', message: 'Invite code is required' }] });
            }

            const codeExists = await InviteCode.findOne({ code: inviteCode });
            if (!codeExists) {
                const elapsed = Date.now() - startTime;
                if (elapsed < MIN_RESPONSE_TIME) {
                    await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
                }
                return res.status(200).json({ canProceed: false, unavailable: [], errors: [{ field: 'inviteCode', message: 'Invalid invite code' }] });
            }

            const [emailExists, pseudoExists] = await Promise.all([
                email ? User.findOne({ email }).lean() : Promise.resolve(null),
                pseudo ? User.findOne({ pseudo }).lean() : Promise.resolve(null),
            ]);

            if (emailExists) {
                unavailable.push(1);
            }
            if (pseudoExists) {
                unavailable.push(2);
            }

            let responseData: any;

            if (unavailable.length === 0 && email && pseudo) {
                const preAuthToken = await PreAuthService.createPreAuthToken(email, pseudo);

                // Delete the invite code (single use)
                await InviteCode.deleteOne({ code: inviteCode });

                // Fire-and-forget — don't block the response on email delivery
                magicLinkService.sendMagicLink(email, pseudo).catch((err) =>
                    logger.error({ err }, 'Failed to send magic link'),
                );

                responseData = {
                    canProceed: true,
                    unavailable: [],
                    preAuthToken,
                };
            } else {
                responseData = {
                    canProceed: false,
                    unavailable
                };
            }

            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_RESPONSE_TIME) {
                await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
            }

            return res.status(200).json(responseData);

        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }));

                const elapsed = Date.now() - startTime;
                if (elapsed < MIN_RESPONSE_TIME) {
                    await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed));
                }

                return res.status(200).json({
                    canProceed: false,
                    unavailable: [],
                    errors: errors
                });
            }
            next(error);
        }
    }

    /**
     * POST /api/users/send-magic-link
     */
    static async sendMagicLink(req: Request, res: Response, next: NextFunction) {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Missing pre-auth token' });
            }

            const preAuthToken = authHeader.substring(7);
            const preAuthStatus = await PreAuthService.verifyPreAuthToken(preAuthToken);

            if (!preAuthStatus) {
                return res.status(401).json({ error: 'Invalid or expired pre-auth token' });
            }

            if (preAuthStatus.verified) {
                return res.status(200).json({ success: true, alreadyVerified: true });
            }

            await magicLinkService.sendMagicLink(preAuthStatus.email, preAuthStatus.pseudo);

            return res.status(200).json({ success: true });
        } catch (error) {
            logger.error({ err: error }, 'Failed to send magic link');
            next(error);
        }
    }

     /**
     * POST /api/users/auth
     */
    static async authUser(req: Request, res: Response, next: NextFunction){
        try {
            const validatedData = authUserSchema.parse(req.body);
            const { email, pseudo, cash_wallet, stealf_wallet } = validatedData;

            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')){
                return res.status(401).json({ error:'Missing authorization header' });
            }

            const sessionJWT = authHeader.substring(7);

            const isValid = await verifySessionJwtSignature(sessionJWT);
            if (!isValid){
                return res.status(401).json({ error: 'Invalid JWT signature' });
            }

            const preAuthToken = req.headers['x-preauth-token'] as string;
            if (preAuthToken) {
                const preAuthStatus = await PreAuthService.verifyPreAuthToken(preAuthToken);
                if (!preAuthStatus || !preAuthStatus.verified) {
                    return res.status(403).json({ error: 'Email verification required' });
                }
                if (preAuthStatus.email !== email || preAuthStatus.pseudo !== pseudo) {
                    return res.status(403).json({ error: 'Pre-auth token does not match registration data' });
                }
            }

            const decoded = decodeSessionJwt(sessionJWT);
            const turnkey_subOrgId = decoded.organizationId;

            const user = await createUser(email, pseudo, cash_wallet, turnkey_subOrgId, stealf_wallet);

            return res.status(201).json({
                success: true,
                data: {
                    user: {
                        userId: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        turnkey_subOrgId: user.turnkey_subOrgId,
                        points: user.points,
                        status: user.status,
                    },
                },
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map(err => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    errors,
                });
            }
            next(error);
        }
        }

    /**
     * GET /api/users/:userId
     */
    static async getUser(req: Request, res: Response, next: NextFunction) {
        try {
            const { userId } = req.params;
            const mongoUserId = (req as any).user?.mongoUserId;

            logger.debug({ userId }, 'getUser called');
            const user = await User.findOne({ cash_wallet: userId });
            if (!user){
                return res.status(404).json({ error: 'User not found '});
            }

            if (!mongoUserId || user._id.toString() !== mongoUserId) {
                return res.status(403).json({ error: 'Access denied' });
            }

            StatsService.incrementDailyLogins().catch(() => {});

            return res.json({
                success: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        subOrgId: user.turnkey_subOrgId,
                        points: user.points,
                        status: user.status,
                    }
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * DELETE /api/users/account
     */
    static async deleteAccount(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user?.mongoUserId;
            if (!userId) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            await User.findByIdAndDelete(userId);

            logger.info({ userId, email: user.email }, 'Account deleted');

            return res.status(200).json({ success: true });
        } catch (error) {
            next(error);
        }
    }

}

export const userController = new UserController();
