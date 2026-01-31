import mongoose, { Document, Schema } from "mongoose";

export interface IPrivateBalance extends Document {
    userId: mongoose.Types.ObjectId;
    solBalance: number;
    usdcBalance: number;
    createdAt: Date;
    updatedAt: Date;
}

const privateBalanceSchema = new Schema<IPrivateBalance>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    solBalance: {
        type: Number,
        default: 0,
        min: 0,
    },
    usdcBalance: {
        type: Number,
        default: 0,
        min: 0,
    }
}, {
    timestamps: true,
});

privateBalanceSchema.index({ userId: 1 });

export const PrivateBalance = mongoose.model<IPrivateBalance>('PrivateBalance', privateBalanceSchema);
