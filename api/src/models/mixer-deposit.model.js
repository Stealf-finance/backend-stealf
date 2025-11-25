import mongoose, { Schema } from 'mongoose';
const MixerDepositSchema = new Schema({
    claimHash: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    amount: {
        type: Number,
        required: true,
        min: 0,
    },
    mint: {
        type: String,
        required: true,
        default: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    },
    depositedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true,
    },
    claimed: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
    },
    claimedAt: {
        type: Date,
    },
    destinationAddress: {
        type: String,
    },
    depositTxSignature: {
        type: String,
        required: true,
        index: true,
    },
    withdrawalTxSignature: {
        type: String,
    },
    poolSize: {
        type: String,
    },
}, {
    timestamps: true,
});
// Compound index for efficient queries
MixerDepositSchema.index({ claimed: 1, depositedAt: 1 });
MixerDepositSchema.index({ claimHash: 1, claimed: 1 });
export const MixerDeposit = mongoose.model('MixerDeposit', MixerDepositSchema);
