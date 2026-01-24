import mongoose, {Document, Schema } from "mongoose";
import bcrypt from 'bcryptjs';

export interface IUser extends Document{
    email: string;
    pseudo: string;
    cash_wallet: string;
    stealf_wallet: string;
    turnkey_subOrgId: string;
    status: 'pending' | 'active';
    createdAt: Date;
    updateAt: Date;
    lastLoginAt?: Date;
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
    },
    stealf_wallet:{
        type: String,
        required: [true, 'Cash wallet is required'],
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
}, {
    timestamps: true
});

export const User = mongoose.model<IUser>('User', userSchema);