import mongoose, { Schema, Document } from 'mongoose';

/**
 * Rain Card Model
 *
 * Stores Rain card data locally for caching and tracking.
 * Cards are linked to the user's PUBLIC wallet only.
 */

export interface IRainCard extends Document {
  // Link to Stealf user
  userId: mongoose.Types.ObjectId;

  // Rain identifiers
  rainCardId: string;
  rainUserId: string;

  // Card info
  type: 'physical' | 'virtual';
  status: 'notActivated' | 'active' | 'locked' | 'canceled';
  last4: string;
  expirationMonth: string;
  expirationYear: string;

  // Limits
  limit?: {
    amount: number; // in cents
    frequency: string;
  };

  // Display info
  displayName?: string;

  // For physical cards
  shipping?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    countryCode: string;
    method?: string;
    firstName?: string;
    lastName?: string;
  };

  // Billing address
  billing?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    countryCode: string;
  };

  // Mobile wallet tokenization
  tokenWallets?: string[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date;
  lockedAt?: Date;
  canceledAt?: Date;
}

const RainCardSchema: Schema = new Schema(
  {
    // Link to Stealf user
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Rain identifiers
    rainCardId: {
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

    // Card info
    type: {
      type: String,
      enum: ['physical', 'virtual'],
      required: true,
    },
    status: {
      type: String,
      enum: ['notActivated', 'active', 'locked', 'canceled'],
      required: true,
      default: 'notActivated',
    },
    last4: {
      type: String,
      required: true,
    },
    expirationMonth: {
      type: String,
      required: true,
    },
    expirationYear: {
      type: String,
      required: true,
    },

    // Limits
    limit: {
      amount: Number,
      frequency: String,
    },

    // Display info
    displayName: String,

    // Shipping (physical cards)
    shipping: {
      line1: String,
      line2: String,
      city: String,
      region: String,
      postalCode: String,
      countryCode: String,
      method: String,
      firstName: String,
      lastName: String,
    },

    // Billing
    billing: {
      line1: String,
      line2: String,
      city: String,
      region: String,
      postalCode: String,
      countryCode: String,
    },

    // Mobile wallets
    tokenWallets: [String],

    // Timestamps
    activatedAt: Date,
    lockedAt: Date,
    canceledAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
RainCardSchema.index({ userId: 1, status: 1 });
RainCardSchema.index({ rainUserId: 1, status: 1 });
RainCardSchema.index({ type: 1, status: 1 });

export const RainCard = mongoose.model<IRainCard>('RainCard', RainCardSchema);
