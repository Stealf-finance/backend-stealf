import mongoose, { Document, Schema }from "mongoose";

export interface IMagicLink extends Document {
    tokenHash: string;
    email: string;
    pseudo: string;
    expiresAt: Date;
    used: boolean;
    createdAt: Date;
}

const magicLinkSchema = new Schema<IMagicLink>({
    tokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    pseudo: {
        type: String,
        required: true,
        trim: true,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    used: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
});

magicLinkSchema.index({ expiresAt: 1}, { expireAfterSeconds: 3600});

export const MagicLink = mongoose.model<IMagicLink>('MagicLink', magicLinkSchema);
