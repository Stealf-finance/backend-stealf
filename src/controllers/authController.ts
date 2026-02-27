import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { check, success, z } from 'zod';
import { checkAvailabilitySchema, authUserSchema } from '../utils/validations';
import { verifySessionJwtSignature } from '@turnkey/crypto';
import { is } from 'zod/v4/locales';
import { decodeSessionJwt } from '../middleware/verifyAuth';
import { createUser } from '../services/auth/createUser';
import * as magicLinkService from '../services/auth/magicLinkService';
import { awardPoints } from '../services/points.service';
import { PreAuthService } from '../services/auth/preAuthService';

export class UserController {

    /**
     * POST /api/users/check-availability
     * Check if email/pseudo are available and initiate magic link flow
     * SECURITY: Uses constant-time response to prevent timing-based enumeration
     */
    static async checkAvailability(req: Request, res: Response, next: NextFunction) {
        const startTime = Date.now();
        const MIN_RESPONSE_TIME = 500;

        try {
            const { email, pseudo} = checkAvailabilitySchema.parse(req.body);
            const unavailable: number[] = [];

            // Always perform both lookups to prevent timing-based enumeration
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
                try {
                    const preAuthToken = await PreAuthService.createPreAuthToken(email, pseudo);
                    await magicLinkService.sendMagicLink(email, pseudo);

                    responseData = {
                        canProceed: true,
                        unavailable: [],
                        preAuthToken,
                    };
                } catch (emailError) {
                    console.error('Failed to send magic link:', emailError);
                    responseData = {
                        canProceed: false,
                        unavailable: [],
                    };
                }
            } else {
                responseData = {
                    canProceed: false,
                    unavailable
                };
            }

            // Enforce minimum response time to normalize timing
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

                // Still enforce minimum time on errors
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
     * POST /api/users/auth
     * create user
     */
    static async authUser(req: Request, res: Response, next: NextFunction){
        try {
            // SECURITY: Validate input with Zod schema
            const validatedData = authUserSchema.parse(req.body);
            const { email, pseudo, cash_wallet, stealf_wallet, coldWallet } = validatedData;

            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')){
                return res.status(401).json({ error:'Missing authorization header' });
            }

            const sessionJWT = authHeader.substring(7);

            const isValid = await verifySessionJwtSignature(sessionJWT);
            if (!isValid){
                return res.status(401).json({ error: 'Invalid JWT signature' });
            }

            const decoded = decodeSessionJwt(sessionJWT);
            const turnkey_subOrgId = decoded.organizationId;

            const user = await createUser(email, pseudo, cash_wallet, stealf_wallet, turnkey_subOrgId);

            return res.status(201).json({
                success: true,
                data: {
                    user: {
                        userId: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        stealf_wallet: user.stealf_wallet,
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
     * retrieve user's infos by cash_wallet address
     */
    static async getUser(req: Request, res: Response, next: NextFunction) {
        try {
            const { userId } = req.params;

            console.log(userId);
            const user = await User.findOne({ cash_wallet: userId });
            if (!user){
                return res.status(404).json({ error: 'User not found '});
            }

            user.lastLoginAt = new Date();
            await user.save();
            awardPoints(user._id.toString(), 'daily_bonus').catch(() => {});

            return res.json({
                success: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        stealf_wallet: user.stealf_wallet,
                        status: user.status,
                    }
                },
            });
        } catch (error) {
            next(error);
        }
    }

}

export const userController = new UserController();

