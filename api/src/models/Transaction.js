import mongoose from 'mongoose';
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Transaction type and status
    type: {
        type: String,
        enum: ['deposit', 'withdraw', 'claim', 'transfer'],
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'failed'],
        required: true,
        default: 'pending',
        index: true
    },
    // Deposit/Claim tracking
    generationIndex: { type: String, index: true },
    nullifierHash: { type: String, index: true },
    commitmentInsertionIndex: { type: Number },
    // Transaction identifiers
    signature: { type: String, index: true },
    mint: { type: String, required: true },
    amount: { type: String, required: true },
    claimableBalance: { type: String },
    // Privacy metadata
    linkerHash: { type: String },
    relayerPublicKey: { type: String },
    // Timestamps
    confirmedAt: { type: Date },
    // Additional metadata
    metadata: {
        time: { type: Number },
        mode: { type: String },
        optionalData: { type: String }, // SHA3 hash
    }
}, {
    timestamps: true // Adds createdAt and updatedAt
});
// Indexes for efficient queries
transactionSchema.index({ userId: 1, type: 1, status: 1 });
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ nullifierHash: 1 }, { unique: true, sparse: true });
export const Transaction = mongoose.model('Transaction', transactionSchema);
