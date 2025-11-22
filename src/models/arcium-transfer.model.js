import mongoose, { Schema } from 'mongoose';
const ArciumTransferSchema = new Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    sender: {
        type: String,
        required: true,
        index: true,
    },
    recipient: {
        type: String,
        required: true,
        index: true,
    },
    encryptedAmount: {
        type: Buffer,
        required: true,
    },
    encryptedTimestamp: {
        type: Buffer,
        required: true,
    },
    nonce: {
        type: Buffer,
        required: true,
    },
    senderPublicKey: {
        type: Buffer,
        required: true,
    },
    computationOffset: {
        type: String,
        required: true,
        unique: true,
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending',
        index: true,
    },
    computationSignature: {
        type: String,
    },
    finalizationSignature: {
        type: String,
    },
    encryptedResultAmount: {
        type: Buffer,
    },
    resultNonce: {
        type: Buffer,
    },
    resultEncryptionKey: {
        type: Buffer,
    },
    amount: {
        type: String,
        // For testing/debugging only
        // In production, this should be removed as amounts should remain encrypted
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
    },
    metadata: {
        type: Schema.Types.Mixed,
    },
}, {
    timestamps: true,
});
// Indexes for efficient queries
ArciumTransferSchema.index({ sender: 1, timestamp: -1 });
ArciumTransferSchema.index({ recipient: 1, timestamp: -1 });
ArciumTransferSchema.index({ status: 1, timestamp: -1 });
export const ArciumTransfer = mongoose.model('ArciumTransfer', ArciumTransferSchema);
