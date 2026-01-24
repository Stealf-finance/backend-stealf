import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  username: { type: String, unique: true, sparse: true, index: true },
  profileImage: { type: String }, // URL or base64 of profile image

  // Solana wallet (public)
  solanaWallet: { type: String, index: true },
  encryptedPrivateKey: { type: String }, // Encrypted wallet private key

  // Private wallet (for privacy transactions)
  privateWalletAddress: { type: String, index: true },
  encryptedPrivateWalletKey: { type: String }, // Encrypted private wallet key

  // Umbra Privacy (encrypted)
  masterViewingKey: { type: String }, // Encrypted master viewing key
  arciumX25519PublicKey: { type: String }, // Public key for Rescue cipher encryption

  // Privacy preferences
  preferredMode: {
    type: String,
    enum: ['public', 'confidential'],
    default: 'public'
  },

  // Grid integration
  gridUserId: { type: String, index: true },
  gridAddress: { type: String, index: true },

  // Rain Cards integration (linked to PUBLIC wallet only)
  rainUserId: { type: String, index: true }, // Rain's user ID
  rainKycStatus: {
    type: String,
    enum: ['notStarted', 'pending', 'approved', 'needsInformation', 'needsVerification', 'manualReview', 'denied', 'locked', 'canceled'],
    default: 'notStarted'
  },

  // Rain Card Balance (Self-Managed Ledger) - in cents USD
  rainCardBalance: { type: Number, default: 0 }, // Available balance for card spending
  rainCardBalanceUpdatedAt: { type: Date }, // Last balance update

  // Linked Bank Account (for on-ramp/off-ramp)
  linkedBankAccount: {
    accountId: { type: String }, // From payment processor (Plaid, etc.)
    bankName: { type: String },
    accountType: { type: String }, // checking, savings
    last4: { type: String },
    routingNumber: { type: String },
    isVerified: { type: Boolean, default: false },
    linkedAt: { type: Date },
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true
});

// Export as any to avoid TypeScript union type complexity error
export const User: any = mongoose.model('User', userSchema);
