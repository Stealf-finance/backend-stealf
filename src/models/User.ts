import mongoose, {Document, Schema } from "mongoose";

export interface IUser extends Document{
    email: string;
    pseudo: string;
    cash_wallet: string;
    turnkey_subOrgId: string;
    authMethod: 'passkey' | 'wallet';
    status: 'pending' | 'active';
    createdAt: Date;
    updateAt: Date;
    lastLoginAt?: Date;
    points: number;
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
    points: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: true
});


export const User = mongoose.model<IUser>('User', userSchema);