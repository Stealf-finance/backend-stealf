import mongoose, { Schema, Document } from 'mongoose';

/**
 * Mixer Deposit Interface
 *
 * Stores deposit information for the simple mixer.
 * Privacy design:
 * - Only stores hashed claim secret (not the secret itself)
 * - No user ID linking (user provides claim secret to withdraw)
 * - Timestamps help enforce minimum delays
 */
export interface IMixerDeposit extends Document {
  /**
   * SHA-256 hash of the claim secret
   * Privacy: Only hash is stored, user must provide original secret to withdraw
   */
  claimHash: string;

  /**
   * Deposit amount in lamports
   */
  amount: number;

  /**
   * Token mint address (default: SOL wrapped)
   * Future support for SPL tokens
   */
  mint: string;

  /**
   * Timestamp when deposit was made
   * Used to enforce minimum withdrawal delay
   */
  depositedAt: Date;

  /**
   * Whether this deposit has been claimed
   */
  claimed: boolean;

  /**
   * Timestamp when deposit was claimed (if claimed)
   */
  claimedAt?: Date;

  /**
   * Destination address for withdrawal (set when claimed)
   * Privacy: Not linked to depositor
   */
  destinationAddress?: string;

  /**
   * Transaction signature of deposit
   */
  depositTxSignature: string;

  /**
   * Transaction signature of withdrawal (if claimed)
   */
  withdrawalTxSignature?: string;

  /**
   * Pool size category (if standardized pools enabled)
   * e.g., "0.1", "1", "5", "10" SOL
   */
  poolSize?: string;
}

const MixerDepositSchema: Schema = new Schema(
  {
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
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
MixerDepositSchema.index({ claimed: 1, depositedAt: 1 });
MixerDepositSchema.index({ claimHash: 1, claimed: 1 });

// Export as any to avoid TypeScript union type complexity error
export const MixerDeposit: any = mongoose.model('MixerDeposit', MixerDepositSchema);
