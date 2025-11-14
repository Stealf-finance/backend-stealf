import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  gridAddress: { type: String, index: true },  // Index pour lookups fréquents
  gridUserId: { type: String, index: true },   // Index pour lookups fréquents
  solanaWallet: { type: String, index: true }, // Adresse publique wallet Solana généré
  solanaPrivateWallet: { type: String, index: true }, // Wallet privé (Privacy 1) pour transactions Arcium
  arciumUserId: { type: Number, index: true }, // ID unique Arcium MPC pour ce user
  kycStatus: { type: String, default: 'pending' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true  // Gère automatiquement createdAt et updatedAt
});

// Index composé pour les requêtes combinées
userSchema.index({ email: 1, isActive: 1 });

export const User = mongoose.model('User', userSchema);
