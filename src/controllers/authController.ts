import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { check, success, z } from 'zod';
import { checkAvailabilitySchema } from '../utils/validations';
import { verifySessionJwtSignature } from '@turnkey/crypto';
import { is } from 'zod/v4/locales';
import { decodeSessionJwt } from '../middleware/verifyAuth';
import { createUser } from '../services/auth/createUser';
import * as magicLinkService from '../services/auth/magicLinkService';
import { PreAuthService } from '../services/auth/preAuthService';

export class UserController {

    static async checkAvailability(req: Request, res: Response, next: NextFunction) {

        try {
            const { email, pseudo} = checkAvailabilitySchema.parse(req.body);
            const delay = Math.floor(Math.random() * 100) + 200;

            await new Promise(resolve => setTimeout(resolve, delay));

            const unavailable: number[] = [];

            if (email && pseudo){
                const userExists = await User.findOne({ email, pseudo });
                if (userExists){
                    return res.status(200).json({
                        canProceed: false,
                        unavailable
                    });
                }
            }
            if (email) {
                const emailExists = await User.findOne({ email });
                if (emailExists){
                    unavailable.push(1);
                }
            }

            if (pseudo) {
                const pseudoExists = await User.findOne({ pseudo });
                if (pseudoExists){
                    unavailable.push(2);
                }
            }

            if (unavailable.length === 0 && email && pseudo) {
                try {
                    const preAuthToken = await PreAuthService.createPreAuthToken(email, pseudo);

                    await magicLinkService.sendMagicLink(email, pseudo);

                    console.log('Magic link sent and pre-auth token created');

                    return res.status(200).json({
                        canProceed: true,
                        unavailable: [],
                        preAuthToken,
                    });
                } catch (emailError) {
                    console.error('Failed to send magic link:', emailError);
                    return res.status(200).json({
                        canProceed: false,
                        unavailable: [],
                    });
                }
            }

            return res.status(200).json({
                canProceed: false,
                unavailable
            });

        } catch (error) {
            if (error instanceof z.ZodError) {

                const errors = error.issues.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }));


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
            const {
                email,
                pseudo,
                cash_wallet,
                stealf_wallet,
                coldWallet,
            } = req.body;

            if (!email || !pseudo || !cash_wallet || !stealf_wallet ){
                return res.status(400).json({
                    error: 'Missing required fields: email, pseudo, cash_wallet, stealf_wallet',
                });
            }

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

            const user = await createUser(email, pseudo, cash_wallet, stealf_wallet, turnkey_subOrgId, coldWallet);

            return res.status(201).json({
                success: true,
                data: {
                    user: {
                        userId: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        stealf_wallet: user.stealf_wallet,
                        coldWallet: user.coldWallet,
                        status: user.status,
                    },
                },
            });

        } catch (error) {
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

            return res.json({
                success: true,
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        pseudo: user.pseudo,
                        cash_wallet: user.cash_wallet,
                        stealf_wallet: user.stealf_wallet,
                        coldWallet: user.coldWallet,
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

