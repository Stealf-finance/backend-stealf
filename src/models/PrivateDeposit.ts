import mongoose, { Document, Schema } from "mongoose";

export interface IPrivateDeposit extends Document {
    userId: mongoose.Types.ObjectId;
    reference: string;
    sourceWallet: string;
    amount: number;
    tokenMint?: string;

    status: 'pending_vault' | 'vault_tx_detected' | 'vault_received' | 'deposit_submitted' | 'deposited' | 'failed';

    vaultDepositTx?: string;
    privacyCashDepositTx?: string;

    errorMessage?: string;
    retryCount: number;

    createdAt: Date;
    updatedAt: Date;
}

const privateDepositSchema = new Schema<IPrivateDeposit>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    reference: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    sourceWallet: {
        type: String,
        required: true,
        trim: true,
    },
    amount: {
        type: Number,
        required: true,
        min: 0,
    },
    tokenMint: {
        type: String,
        trim: true,
        default: null,
    },
    status: {
        type: String,
        enum: ['pending_vault', 'vault_tx_detected', 'vault_received', 'deposit_submitted', 'deposited', 'failed'],
        default: 'pending_vault',
        index: true,
    },
    vaultDepositTx: {
        type: String,
        trim: true,
    },
    privacyCashDepositTx: {
        type: String,
        trim: true,
    },
    errorMessage: {
        type: String,
    },
    retryCount: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: true,
});

privateDepositSchema.index({ createdAt: -1 });
privateDepositSchema.index({ userId: 1, status: 1 });

export const PrivateDeposit = mongoose.model<IPrivateDeposit>('PrivateDeposit', privateDepositSchema);
