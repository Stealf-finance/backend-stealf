import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { privacyDepositService } from '../services/privacycash/PrivacyDeposit'
import { privacyWithdrawService } from '../services/privacycash/PrivacyWithdraw'
import { privacyCashService } from '../services/privacycash/PrivacyCashService';
import { privacyBalanceService } from '../services/privacycash/PrivacyBalanceService';
import { initiatePrivateTransferSchema, getTransferStatusSchema, retryTransferSchema } from '../utils/validations';

export class PrivateTransferController {
    /**
     * POST /api/private-transfer/initiate
     * Initiate a new private transfer
     */
    static async initiatePrivateDeposit(req: Request, res: Response, next: NextFunction) {
        try {
            const validatedData = initiatePrivateTransferSchema.parse(req.body);
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            if (!validatedData.fromAddress) {
                return res.status(400).json({ error: 'fromAddress is required' });
            }

            const deposit = await privacyDepositService.initiateDeposit({
                userId,
                fromAddress: validatedData.fromAddress,
                amount: validatedData.amount,
                tokenMint: validatedData.tokenMint || undefined,
            });

            return res.status(201).json({
                success: true,
                data: {
                    deposit,
                    instructions: {
                        message: `Please send ${validatedData.amount} ${validatedData.tokenMint ? 'tokens' : 'SOL'} to the vault address`,
                        vaultAddress: deposit.vaultAddress,
                        amount: validatedData.amount,
                        tokenMint: validatedData.tokenMint,
                        depositId: deposit.depositId,
                        reference: deposit.reference,
                        memo: deposit.reference,
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
                    errors,
                });
            }
            next(error);
        }
    }

    static async initiatePrivateWithdraw(req: Request, res: Response, next: NextFunction) {
        try {
            const validatedData = initiatePrivateTransferSchema.parse(req.body);
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            if (!validatedData.destinationWallet) {
                return res.status(400).json({ error: 'Destination wallet is required for withdrawal' });
            }

            // SECURITY: Pass authenticated userId directly - service no longer queries by wallet
            const withdraw = await privacyWithdrawService.initiateWithdraw({
                userId,
                recipient: validatedData.destinationWallet,
                amount: validatedData.amount,
                tokenMint: validatedData.tokenMint || undefined,
            });

            return res.status(201).json({
                success: true,
                data: {
                    withdraw,
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
                    errors,
                });
            }
            next(error);
        }
    }

    /**
     * GET /api/private-transfer/:transferId
     * Get status of a private transfer
     */
    static async getStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const transferId = req.params.transferId as string;
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            getTransferStatusSchema.parse({ transferId });

            return res.status(404).json({
                success: false,
                error: 'Transfer not found or already completed (cache-only storage for privacy)'
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map(err => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    errors,
                });
            }
            next(error);
        }
    }

    /**
     * GET /api/private-transfer/user/:userId
     * Get all transfers for a user
     */
    static async getUserHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            return res.json({
                success: true,
                data: {
                    transfers: [],
                    count: 0,
                    message: 'Transfer history not available (cache-only storage for privacy)'
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/private-transfer/balance
     * Get user's private balance
     */
    static async getUserBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            const balances = await privacyBalanceService.getAllBalances(userId);

            return res.json({
                success: true,
                data: {
                    balances: {
                        sol: balances.sol,
                        usdc: balances.usdc,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/private-transfer/vault/balance
     * Get vault's total Privacy Cash balance (admin only or for monitoring)
     */
    static async getVaultBalance(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            const balances = await privacyCashService.getAllBalances();

            return res.json({
                success: true,
                data: {
                    balances: {
                        sol: balances.sol,
                        usdc: balances.usdc,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /api/private-transfer/:transferId/retry
     * Retry a failed transfer
     */
    static async retry(req: Request, res: Response, next: NextFunction) {
        try {
            const transferId = req.params.transferId as string;
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            retryTransferSchema.parse({ transferId });

            // NOTE: With cache-only storage, cannot query by transferId
            // Retry functionality not available with current privacy architecture
            return res.status(501).json({
                success: false,
                error: 'Retry functionality not available (cache-only storage for privacy)'
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map(err => ({
                    field: err.path.join('.'),
                    message: err.message,
                }));

                return res.status(400).json({
                    success: false,
                    errors,
                });
            }
            next(error);
        }
    }
}
