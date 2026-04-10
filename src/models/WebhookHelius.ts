import mongoose, { Document, Schema } from "mongoose";

export interface IWebhookHelius extends Omit<Document, '_id'> {
    _id: string;
    provider: string;
    network: string;
    webhookId: string;
    url: string;
    accountCount: number;
    env: 'development' | 'production';
    status: 'active' | 'inactive' | 'error';
    createdAt: Date;
    updatedAt: Date;
}

const webhookHeliusSchema = new Schema<IWebhookHelius>(
    {
        _id: {
            type: String,
            required: true,
        },
        provider: {
            type: String,
            required: true,
            trim: true,
        },
        network: {
            type: String,
            required: true,
            trim: true,
        },
        webhookId: {
            type: String,
            required: true,
            trim: true,
        },
        url: {
            type: String,
            required: true,
            trim: true,
        },
        accountCount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        env: {
            type: String,
            required: true,
            enum: ['development', 'production'],
        },
        status: {
            type: String,
            required: true,
            enum: ['active', 'inactive', 'error'],
            default: 'active',
        },
    },
    {
        timestamps: true,
        _id: false,
    }
);

webhookHeliusSchema.index({ provider: 1, network: 1 });

export const WebhookHelius = mongoose.model<IWebhookHelius>('WebhookHelius', webhookHeliusSchema);