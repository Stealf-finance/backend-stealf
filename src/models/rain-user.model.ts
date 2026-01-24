import mongoose, { Schema, Document } from 'mongoose';

/**
 * Rain User Model
 *
 * Stores Rain-specific data for users.
 * Links Rain KYC/Cards to the user's PUBLIC wallet only.
 */

export interface IRainUser extends Document {
  // Link to Stealf user
  userId: mongoose.Types.ObjectId;
  email: string;

  // Rain identifiers
  rainUserId: string;
  solanaAddress: string;

  // KYC Application
  applicationStatus: string;
  applicationCompletionUrl?: string;
  applicationReason?: string;

  // KYC Personal Info (stored for reference)
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };

  // Documents uploaded
  documentsUploaded: Array<{
    type: string;
    side?: string;
    uploadedAt: Date;
  }>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  kycApprovedAt?: Date;
}

const RainUserSchema: Schema = new Schema(
  {
    // Link to Stealf user
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },

    // Rain identifiers
    rainUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    solanaAddress: {
      type: String,
      required: true,
      index: true,
    },

    // KYC Application
    applicationStatus: {
      type: String,
      enum: [
        'notStarted',
        'pending',
        'approved',
        'needsInformation',
        'needsVerification',
        'manualReview',
        'denied',
        'locked',
        'canceled',
      ],
      default: 'notStarted',
    },
    applicationCompletionUrl: String,
    applicationReason: String,

    // KYC Personal Info
    firstName: String,
    lastName: String,
    birthDate: String,
    phoneCountryCode: String,
    phoneNumber: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      region: String,
      postalCode: String,
      countryCode: String,
    },

    // Documents
    documentsUploaded: [
      {
        type: { type: String },
        side: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    // Timestamps
    kycApprovedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
RainUserSchema.index({ userId: 1, rainUserId: 1 });
RainUserSchema.index({ applicationStatus: 1 });

export const RainUser = mongoose.model<IRainUser>('RainUser', RainUserSchema);
