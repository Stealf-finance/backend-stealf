import { z } from 'zod';

export const checkAvailabilitySchema = z.object({
    email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format').optional(),
    pseudo: z.string()
        .min(3, 'Pseudo must be at least 3 characters')
        .max(20, 'Pseudo must be max 20 characters')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Pseudo can only contain letter, number, _ and -')
        .optional(),
    inviteCode: z.string().min(1, 'Invite code is required').optional(),
}).refine(
    (data) => data.email || data.pseudo,
    { message: 'Either email or pseudo must be provided' }
);

const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const initiatePrivateTransferSchema = z.object({
    walletID: z.string()
        .regex(solanaAddressRegex, 'Invalid Solana address format')
        .length(44, 'Solana address must be 44 characters')
        .optional(),
    fromAddress: z.string()
        .regex(solanaAddressRegex, 'Invalid Solana address format')
        .length(44, 'Solana address must be 44 characters')
        .optional(),
    destinationWallet: z.string()
        .regex(solanaAddressRegex, 'Invalid Solana address format')
        .length(44, 'Solana address must be 44 characters')
        .optional(),
    amount: z.number()
        .positive('Amount must be positive')
        .min(0.001, 'Amount must be at least 0.001'),
    tokenMint: z.string()
        .regex(solanaAddressRegex, 'Invalid token mint address')
        .length(44, 'Token mint address must be 44 characters')
        .optional()
        .nullable(),
});

export const getTransferStatusSchema = z.object({
    transferId: z.string()
        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid transfer ID format'),
});

export const retryTransferSchema = z.object({
    transferId: z.string()
        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid transfer ID format'),
});

/**
 * Schema for user registration (POST /api/users/auth)
 */
export const authUserSchema = z.object({
    email: z.string()
        .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format')
        .max(254, 'Email must be max 254 characters')
        .transform(val => val.toLowerCase().trim()),
    pseudo: z.string()
        .min(3, 'Pseudo must be at least 3 characters')
        .max(20, 'Pseudo must be max 20 characters')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Pseudo can only contain letters, numbers, _ and -')
        .transform(val => val.trim()),
    cash_wallet: z.string()
        .regex(solanaAddressRegex, 'Invalid cash_wallet Solana address format')
        .length(44, 'cash_wallet must be 44 characters'),
    stealf_wallet: z.string()
        .regex(solanaAddressRegex, 'Invalid stealf_wallet Solana address format')
        .length(44, 'stealf_wallet must be 44 characters')
        .optional(),
    coldWallet: z.boolean().optional().default(false),
});

/**
 * Schema for Helius enhanced webhook payload validation (used by vault webhook)
 */
const heliusTransferSchema = z.object({
    fromUserAccount: z.string().optional(),
    toUserAccount: z.string().optional(),
    amount: z.number().optional(),
    tokenAmount: z.number().optional(),
    mint: z.string().optional(),
});

const heliusInstructionSchema = z.object({
    programId: z.string().optional(),
    program: z.string().optional(),
    data: z.string().optional(),
    memo: z.string().optional(),
});

const heliusAccountDataSchema = z.object({
    account: z.string(),
}).passthrough();

const heliusEnhancedTxSchema = z.object({
    signature: z.string(),
    nativeTransfers: z.array(heliusTransferSchema).optional(),
    tokenTransfers: z.array(heliusTransferSchema).optional(),
    instructions: z.array(heliusInstructionSchema).optional(),
    accountData: z.array(heliusAccountDataSchema).optional(),
}).passthrough();

export const heliusEnhancedPayloadSchema = z.array(heliusEnhancedTxSchema).or(heliusEnhancedTxSchema);

export const swapOrderSchema = z.object({
    inputMint: z.string()
        .regex(solanaAddressRegex, 'Invalid inputMint Solana address format'),
    amount: z.string()
        .regex(/^\d+$/, 'Amount must be a numeric string (lamports/native units)'),
    taker: z.string()
        .regex(solanaAddressRegex, 'Invalid taker Solana address format'),
    receiver: z.string()
        .regex(solanaAddressRegex, 'Invalid receiver Solana address format')
        .optional(),
});

export const swapExecuteSchema = z.object({
    requestId: z.string()
        .min(1, 'requestId is required'),
    signedTransaction: z.string()
        .min(1, 'signedTransaction is required'),
});

/**
 * Schema for yield withdrawal request (POST /api/yield/withdraw)
 * Frontend sends clear values — backend handles encryption for MPC.
 */
export const yieldWithdrawSchema = z.object({
    userId: z.string(),
    amount: z.number().int().positive('Amount must be positive (lamports)'),
    wallet: z.string().regex(solanaAddressRegex, 'Invalid destination wallet address'),
});

const rawTxSchema = z.object({
    blockTime: z.number().nullable(),
    slot: z.number(),
    meta: z.object({
        err: z.any().nullable(),
        fee: z.number(),
        preBalances: z.array(z.number()),
        postBalances: z.array(z.number()),
        preTokenBalances: z.array(z.any()).optional(),
        postTokenBalances: z.array(z.any()).optional(),
    }).passthrough(),
    transaction: z.object({
        message: z.object({
            accountKeys: z.array(z.string()),
        }).passthrough(),
        signatures: z.array(z.string()),
    }),
}).passthrough();

export const heliusWebhookPayloadSchema = z.array(rawTxSchema).or(rawTxSchema);
