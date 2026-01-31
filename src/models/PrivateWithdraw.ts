import mongoose, { Document, Schema } from "mongoose";

export interface IPrivateWithdraw extends Document {
    userId: mongoose.Types.ObjectId;
    reference: string;
    sourceWallet: string;
    destinationWallet: string;
    amount: number;
    tokenMint?: string;
    fee: number;

    status: 'withdraw_submitted' | 'withdrawn' | 'failed';

    privacyCashWithdrawTx?: string;

    errorMessage?: string;
    retryCount: number;

    createdAt: Date;
    updatedAt: Date;
}

const privateWithdrawSchema = new Schema<IPrivateWithdraw>({
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
    destinationWallet: {
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
    fee: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    status: {
        type: String,
        enum: ['withdraw_submitted', 'withdrawn', 'failed'],
        default: 'withdraw_submitted',
        index: true,
    },
    privacyCashWithdrawTx: {
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

privateWithdrawSchema.index({ createdAt: -1 });
privateWithdrawSchema.index({ userId: 1, status: 1 });

export const PrivateWithdraw = mongoose.model<IPrivateWithdraw>('PrivateWithdraw', privateWithdrawSchema);
