import { z } from 'zod';

export const checkAvailabilitySchema = z.object({
    email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format').optional(),
    pseudo: z.string()
        .min(3, 'Pseudo must be at least 3 characters')
        .max(20, 'Pseudo must be max 20 characters')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Pseudo can only contain letter, number, _ and -')
        .optional()
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
        .length(44, 'stealf_wallet must be 44 characters'),
    coldWallet: z.boolean().optional().default(false),
});

/**
 * Schema for Helius webhook payload validation
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

export const heliusWebhookPayloadSchema = z.array(
    z.object({
        signature: z.string(),
        nativeTransfers: z.array(heliusTransferSchema).optional(),
        tokenTransfers: z.array(heliusTransferSchema).optional(),
        instructions: z.array(heliusInstructionSchema).optional(),
    })
).or(
    z.object({
        signature: z.string(),
        nativeTransfers: z.array(heliusTransferSchema).optional(),
        tokenTransfers: z.array(heliusTransferSchema).optional(),
        instructions: z.array(heliusInstructionSchema).optional(),
    })
);
