import mongoose from 'mongoose';

const depositArtifactsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', index: true },

  // Essential data for claiming
  generationIndex: { type: String, required: true }, // U256 as hex
  commitmentInsertionIndex: { type: Number }, // Merkle tree position (from indexer)
  relayerPublicKey: { type: String, required: true },
  claimableBalance: { type: String, required: true }, // Amount after fees
  time: { type: Number, required: true }, // Unix timestamp (for linker hash)
  mint: { type: String, required: true }, // Token mint address

  // Claim status
  claimed: { type: Boolean, default: false, index: true },
  claimedAt: { type: Date },
  claimTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },

  // Additional metadata
  depositType: {
    type: String,
    enum: ['public', 'confidential'],
    default: 'public'
  },
  nullifierHash: { type: String, index: true }, // Stored for reference

  // Timestamps
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true
});

// Indexes
depositArtifactsSchema.index({ userId: 1, claimed: 1 });
depositArtifactsSchema.index({ userId: 1, createdAt: -1 });
depositArtifactsSchema.index({ generationIndex: 1 }, { unique: true });

export const DepositArtifacts = mongoose.model('DepositArtifacts', depositArtifactsSchema);
