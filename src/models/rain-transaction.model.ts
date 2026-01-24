import mongoose, { Schema, Document } from 'mongoose';

/**
 * Rain Transaction Model
 *
 * Stores Rain card transactions locally for tracking and Self-Managed ledger management.
 * Used for:
 * - Tracking authorization holds
 * - Recording settled transactions
 * - Managing the 24h hold rule after settlement
 */

export type RainTransactionStatus = 'pending' | 'reversed' | 'declined' | 'completed';
export type RainTransactionType = 'spend' | 'collateral' | 'payment' | 'fee';

export interface IRainTransaction extends Document {
  // Link to Stealf user
  userId: mongoose.Types.ObjectId;

  // Rain identifiers
  rainTransactionId: string;
  rainUserId: string;
  rainCardId: string;

  // Transaction type and status
  type: RainTransactionType;
  status: RainTransactionStatus;

  // Amounts (in cents)
  amount: number; // Final or current amount
  authorizedAmount?: number; // Original authorized amount
  localAmount?: number; // Amount in local currency
  currency: string;
  localCurrency?: string;

  // Hold tracking for Self-Managed
  holdAmount: number; // Current hold amount
  holdReleasedAt?: Date; // When hold was released
  isHoldActive: boolean;

  // Settlement tracking
  settledAt?: Date;
  fundsAvailableAt?: Date; // 24h after settlement

  // Merchant info
  merchantName: string;
  merchantCategory?: string;
  merchantCategoryCode?: string;
  merchantId?: string;
  merchantCity?: string;
  merchantCountry?: string;

  // Enriched merchant data
  enrichedMerchantName?: string;
  enrichedMerchantCategory?: string;
  enrichedMerchantIcon?: string;

  // Card info
  cardType: 'physical' | 'virtual';
  cardLast4?: string;

  // Authorization details
  authorizationMethod?: string;
  declinedReason?: string;

  // Refund tracking
  isRefund: boolean;
  originalTransactionId?: string; // For refunds, link to original

  // Timestamps
  authorizedAt: Date;
  postedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RainTransactionSchema: Schema = new Schema(
  {
    // Link to Stealf user
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Rain identifiers
    rainTransactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    rainUserId: {
      type: String,
      required: true,
      index: true,
    },
    rainCardId: {
      type: String,
      required: true,
      index: true,
    },

    // Transaction type and status
    type: {
      type: String,
      enum: ['spend', 'collateral', 'payment', 'fee'],
      required: true,
      default: 'spend',
    },
    status: {
      type: String,
      enum: ['pending', 'reversed', 'declined', 'completed'],
      required: true,
      default: 'pending',
    },

    // Amounts
    amount: {
      type: Number,
      required: true,
    },
    authorizedAmount: Number,
    localAmount: Number,
    currency: {
      type: String,
      required: true,
      default: 'USD',
    },
    localCurrency: String,

    // Hold tracking
    holdAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    holdReleasedAt: Date,
    isHoldActive: {
      type: Boolean,
      default: true,
    },

    // Settlement
    settledAt: Date,
    fundsAvailableAt: Date,

    // Merchant info
    merchantName: {
      type: String,
      required: true,
    },
    merchantCategory: String,
    merchantCategoryCode: String,
    merchantId: String,
    merchantCity: String,
    merchantCountry: String,

    // Enriched merchant
    enrichedMerchantName: String,
    enrichedMerchantCategory: String,
    enrichedMerchantIcon: String,

    // Card info
    cardType: {
      type: String,
      enum: ['physical', 'virtual'],
      required: true,
    },
    cardLast4: String,

    // Authorization
    authorizationMethod: String,
    declinedReason: String,

    // Refund tracking
    isRefund: {
      type: Boolean,
      default: false,
    },
    originalTransactionId: String,

    // Timestamps
    authorizedAt: {
      type: Date,
      required: true,
    },
    postedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
RainTransactionSchema.index({ userId: 1, status: 1, createdAt: -1 });
RainTransactionSchema.index({ rainCardId: 1, status: 1, createdAt: -1 });
RainTransactionSchema.index({ rainUserId: 1, createdAt: -1 });
RainTransactionSchema.index({ isHoldActive: 1, userId: 1 });
RainTransactionSchema.index({ status: 1, fundsAvailableAt: 1 }); // For 24h hold rule queries

export const RainTransaction = mongoose.model<IRainTransaction>('RainTransaction', RainTransactionSchema);
