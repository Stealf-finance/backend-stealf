/**
 * MongoDB connection and schemas for Arcium private wallet management
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Schema pour stocker les PDAs avec leurs nonces
const PrivatePDASchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  walletId: { type: String, required: true, index: true }, // "privacy_1", "yield_1", etc.
  nonce: { type: Number, required: true },
  pda: { type: String, required: true, unique: true },
  transactionSignature: { type: String, required: true },
  amount: { type: Number, required: true },
  encryptedData: { type: String, required: true }, // Arcium encrypted data
  createdAt: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ['pending', 'confirmed', 'spent'], default: 'pending' }
});

// Index composite pour récupérer tous les PDAs d'un wallet privé
PrivatePDASchema.index({ userId: 1, walletId: 1 });

export const PrivatePDA = mongoose.model('PrivatePDA', PrivatePDASchema);

// Connexion MongoDB
let isConnected = false;

export async function connectMongoDB(): Promise<void> {
  if (isConnected) {
    console.log('✅ MongoDB already connected');
    return;
  }

  try {
    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
      console.warn('⚠️  MONGODB_URI not found - PDA tracking disabled');
      return;
    }

    // Fix password encoding
    let finalUri = MONGODB_URI;
    const password = process.env.MONGODB_PASSWORD;

    if (password) {
      const encodedPassword = encodeURIComponent(password);

      if (MONGODB_URI.includes('<db_password>')) {
        finalUri = MONGODB_URI.replace('<db_password>', encodedPassword);
      } else if (MONGODB_URI.includes('elsocor842b.')) {
        finalUri = MONGODB_URI.replace('elsocor842b.', encodedPassword);
      }
    }

    await mongoose.connect(finalUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });

    isConnected = true;
    console.log('✅ Connected to MongoDB for PDA tracking');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    console.warn('⚠️  PDA tracking disabled - continuing without database');
  }
}

export async function disconnectMongoDB(): Promise<void> {
  if (!isConnected) return;

  await mongoose.disconnect();
  isConnected = false;
  console.log('🔌 Disconnected from MongoDB');
}

/**
 * Stocker un nouveau PDA après une transaction
 */
export async function storePDA(data: {
  userId: string;
  walletId: string;
  nonce: number;
  pda: string;
  transactionSignature: string;
  amount: number;
  encryptedData: string;
}): Promise<void> {
  if (!isConnected) {
    console.warn('⚠️  MongoDB not connected - PDA not stored');
    return;
  }

  try {
    const privatePDA = new PrivatePDA(data);
    await privatePDA.save();
    console.log(`💾 Stored PDA: ${data.pda.substring(0, 8)}... (nonce: ${data.nonce})`);
  } catch (error) {
    console.error('❌ Failed to store PDA:', error);
  }
}

/**
 * Récupérer tous les PDAs d'un wallet privé
 */
export async function getAllPDAs(userId: string, walletId: string): Promise<Array<{
  nonce: number;
  pda: string;
  amount: number;
  transactionSignature: string;
  status: string;
  createdAt: Date;
}>> {
  if (!isConnected) {
    console.warn('⚠️  MongoDB not connected - cannot retrieve PDAs');
    return [];
  }

  try {
    const pdas = await PrivatePDA.find({ userId, walletId })
      .sort({ createdAt: -1 })
      .lean();

    return pdas.map(pda => ({
      nonce: pda.nonce,
      pda: pda.pda,
      amount: pda.amount,
      transactionSignature: pda.transactionSignature,
      status: pda.status,
      createdAt: pda.createdAt
    }));
  } catch (error) {
    console.error('❌ Failed to retrieve PDAs:', error);
    return [];
  }
}

/**
 * Calculer la balance totale d'un wallet privé
 * (somme de tous les PDAs non dépensés)
 */
export async function getPrivateWalletBalance(userId: string, walletId: string): Promise<number> {
  if (!isConnected) {
    return 0;
  }

  try {
    const result = await PrivatePDA.aggregate([
      { $match: { userId, walletId, status: { $ne: 'spent' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    return result.length > 0 ? result[0].total : 0;
  } catch (error) {
    console.error('❌ Failed to calculate balance:', error);
    return 0;
  }
}

/**
 * Marquer un PDA comme dépensé
 */
export async function markPDAAsSpent(pda: string): Promise<void> {
  if (!isConnected) return;

  try {
    await PrivatePDA.updateOne({ pda }, { status: 'spent' });
    console.log(`✅ Marked PDA as spent: ${pda.substring(0, 8)}...`);
  } catch (error) {
    console.error('❌ Failed to mark PDA as spent:', error);
  }
}
