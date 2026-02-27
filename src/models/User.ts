import mongoose, {Document, Schema } from "mongoose";

export interface IUser extends Document{
    email: string;
    pseudo: string;
    cash_wallet: string;
    stealf_wallet: string;
    turnkey_subOrgId: string;
    authMethod: 'passkey' | 'wallet';
    status: 'pending' | 'active';
    createdAt: Date;
    updateAt: Date;
    lastLoginAt?: Date;
    // Yield-to-Card auto-sweep
    autoSweepEnabled: boolean;
    autoSweepInterval: 'daily' | 'weekly';
    autoSweepMinYield: number; // Minimum yield in SOL before sweeping
    autoSweepVaultType: 'sol_jito' | 'sol_marinade';
    // Stealth addresses wealth wallet (EIP-5564 adapté Solana) — Requirements 1.3, 1.4
    stealthEnabled: boolean;
    stealthSpendingPublic?: string;       // base58 32 bytes — clé publique ed25519
    stealthViewingPublic?: string;        // base58 32 bytes — clé publique X25519
    stealthViewingPrivateEnc?: string;    // AES-256-GCM chiffrée (format iv:tag:ciphertext)
    lastStealthScanAt?: Date;
    // Stealth addresses cash wallet (EIP-5564 adapté Solana) — Requirements 2.2, 4.1
    cashStealthEnabled: boolean;
    cashStealthSpendingPublic?: string;   // base58 32 bytes — clé publique ed25519
    cashStealthViewingPublic?: string;    // base58 32 bytes — clé publique X25519
    cashStealthViewingPrivateEnc?: string;// AES-256-GCM chiffrée (format iv:tag:ciphertext)
    // Points system
    points: number;
    lastDailyBonusAt?: Date;
}

const userSchema = new Schema<IUser>({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
    },
    pseudo: {
        type: String,
        required: [true, 'Pseudo is required'],
        unique: true,
        trim: true,
    },
    cash_wallet:{
        type: String,
        required: [true, 'Cash wallet is required'],
        unique: true,
        index: true,
    },
    stealf_wallet:{
        type: String,
        required: [true, 'Stealf wallet is required'],
        index: true,
    },
    authMethod: {
        type: String,
        enum: ['passkey', 'wallet'],
        default: 'passkey',
    },
    turnkey_subOrgId: {
    type: String,
    required: [true, 'Turnkey subOrgID is required'],
    unique: true,
    },
    status: {
        type: String,
        enum: ['pending', 'active'],
        default: 'pending',
    },
    lastLoginAt: {
        type: Date,
    },
    // Yield-to-Card auto-sweep
    autoSweepEnabled: {
        type: Boolean,
        default: false,
    },
    autoSweepInterval: {
        type: String,
        enum: ['daily', 'weekly'],
        default: 'weekly',
    },
    autoSweepMinYield: {
        type: Number,
        default: 0.01, // 0.01 SOL minimum
    },
    autoSweepVaultType: {
        type: String,
        enum: ['sol_jito', 'sol_marinade'],
        default: 'sol_jito',
    },
    // Stealth addresses
    stealthEnabled: {
        type: Boolean,
        default: false,
    },
    stealthSpendingPublic: {
        type: String,
    },
    stealthViewingPublic: {
        type: String,
    },
    stealthViewingPrivateEnc: {
        type: String,
    },
    lastStealthScanAt: {
        type: Date,
    },
    // Stealth cash wallet
    cashStealthEnabled: {
        type: Boolean,
        default: false,
    },
    cashStealthSpendingPublic: {
        type: String,
    },
    cashStealthViewingPublic: {
        type: String,
    },
    cashStealthViewingPrivateEnc: {
        type: String,
    },
    points: {
        type: Number,
        default: 0,
    },
    lastDailyBonusAt: {
        type: Date,
    },
}, {
    timestamps: true
});

// Index pour le scanner stealth wealth (uniquement les users avec stealth activé)
userSchema.index({ stealthEnabled: 1 });
// Index pour le scanner stealth cash (tâche 1.1)
userSchema.index({ cashStealthEnabled: 1 });

export const User = mongoose.model<IUser>('User', userSchema);