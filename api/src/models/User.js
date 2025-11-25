import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, index: true },
    // Solana wallet
    solanaWallet: { type: String, index: true },
    encryptedPrivateKey: { type: String },
    // Umbra Privacy (encrypted)
    masterViewingKey: { type: String },
    arciumX25519PublicKey: { type: String },
    // Privacy preferences
    preferredMode: {
        type: String,
        enum: ['public', 'confidential'],
        default: 'public'
    },
    // Grid integration
    gridUserId: { type: String, index: true },
    gridAddress: { type: String, index: true },
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, {
    timestamps: true
});
export const User = mongoose.model('User', userSchema);
