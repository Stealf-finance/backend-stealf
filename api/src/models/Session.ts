import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: String },
  email: { type: String, required: true, index: true },  // Index pour lookup par email
  otpAttempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  gridResponse: { type: Object },
  isLogin: { type: Boolean, default: false, index: true },  // Index pour filtrer sessions login
  fallbackOtp: { type: String },
  useFallback: { type: Boolean, default: false }
}, {
  timestamps: true  // Gère automatiquement createdAt et updatedAt
});

// Index TTL pour auto-suppression après expiration
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index composé pour la requête fréquente : findOne({ isLogin: true, expiresAt: { $gt: ... } })
sessionSchema.index({ isLogin: 1, expiresAt: 1 });

export const Session = mongoose.model('Session', sessionSchema);
