import mongoose from 'mongoose';

/**
 * RhinoBridge Model
 * Tracks cross-chain bridge transactions from other chains to Solana via Rhino.fi
 */
const rhinoBridgeSchema = new mongoose.Schema({
  // User reference
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  userEmail: { type: String, index: true },

  // Quote information
  quoteId: { type: String, required: true, unique: true, index: true },

  // Bridge parameters
  chainIn: { type: String, required: true },  // e.g., 'ETHEREUM', 'ARBITRUM_ONE'
  chainOut: { type: String, default: 'SOLANA' },
  tokenIn: { type: String, required: true },   // e.g., 'USDT', 'USDC'
  tokenOut: { type: String, required: true },

  // Addresses
  depositAddress: { type: String, required: true },  // Where user sends funds on source chain
  recipientAddress: { type: String, required: true }, // Solana address to receive

  // Amounts
  payAmount: { type: String, required: true },
  payAmountUsd: { type: Number },
  receiveAmount: { type: String },
  receiveAmountUsd: { type: Number },

  // Fees
  fees: {
    fee: { type: String },
    feeUsd: { type: Number },
  },

  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'pending_confirmation', 'accepted', 'executed', 'cancelled', 'failed'],
    default: 'pending',
    index: true,
  },

  // Transaction hashes
  depositTxHash: { type: String },
  withdrawTxHash: { type: String },

  // Timing
  expiresAt: { type: Date },
  estimatedDuration: { type: Number },  // seconds
}, {
  timestamps: true,
});

// Compound indexes for common queries
rhinoBridgeSchema.index({ userEmail: 1, createdAt: -1 });
rhinoBridgeSchema.index({ userEmail: 1, status: 1 });
rhinoBridgeSchema.index({ depositAddress: 1 });

export const RhinoBridge: any = mongoose.model('RhinoBridge', rhinoBridgeSchema);
