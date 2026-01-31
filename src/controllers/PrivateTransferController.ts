import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { privacyDepositService } from '../services/privacycash/PrivacyDeposit'
import { privacyWithdrawService } from '../services/privacycash/PrivacyWithdraw'
import { privacyCashService } from '../services/privacycash/PrivacyCashService';
import { privacyBalanceService } from '../services/privacycash/PrivacyBalanceService';
import { PrivateDeposit } from '../models/PrivateDeposit';
import { PrivateWithdraw } from '../models/PrivateWithdraw';
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

            if (!validatedData.walletID) {
                return res.status(400).json({ error: 'walletID is required' });
            }

            if (!validatedData.destinationWallet) {
                return res.status(400).json({ error: 'Destination wallet is required for withdrawal' });
            }

            const withdraw = await privacyWithdrawService.initiateWithdraw({
                walletID: validatedData.walletID,
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

            let transfer = await PrivateDeposit.findById(transferId);
            let type = 'deposit';

            if (!transfer) {
                transfer = await PrivateWithdraw.findById(transferId);
                type = 'withdraw';
            }

            if (!transfer) {
                return res.status(404).json({
                    success: false,
                    error: 'Transfer not found'
                });
            }

            if (transfer.userId.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'Unauthorized access to transfer'
                });
            }

            return res.json({
                success: true,
                data: {
                    transfer,
                    type
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
     * GET /api/private-transfer/user/:userId
     * Get all transfers for a user
     */
    static async getUserHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = (req as any).user?.mongoUserId;

            if (!userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            const limit = parseInt(req.query.limit as string) || 10;

            // Get deposits and withdraws
            const deposits = await PrivateDeposit.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            const withdraws = await PrivateWithdraw.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            // Add type to each transfer
            const depositsWithType = deposits.map(d => ({ ...d, type: 'deposit' }));
            const withdrawsWithType = withdraws.map(w => ({ ...w, type: 'withdraw' }));

            // Combine and sort by createdAt
            const allTransfers = [...depositsWithType, ...withdrawsWithType]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, limit);

            return res.json({
                success: true,
                data: {
                    transfers: allTransfers,
                    count: allTransfers.length,
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

            // Try to find in deposits first
            let transfer = await PrivateDeposit.findById(transferId);
            let type: 'deposit' | 'withdraw' = 'deposit';

            // If not found, try withdraws
            if (!transfer) {
                transfer = await PrivateWithdraw.findById(transferId);
                type = 'withdraw';
            }

            if (!transfer) {
                return res.status(404).json({
                    success: false,
                    error: 'Transfer not found'
                });
            }

            // Verify transfer belongs to user
            if (transfer.userId.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'Unauthorized access to transfer'
                });
            }

            // Check if transfer is in failed status
            if (transfer.status !== 'failed') {
                return res.status(400).json({
                    success: false,
                    error: 'Only failed transfers can be retried'
                });
            }

            // TODO: Implement retry logic based on transfer type (deposit vs withdraw)
            // For now, just return not implemented
            return res.status(501).json({
                success: false,
                error: 'Retry functionality not yet implemented',
                type
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
