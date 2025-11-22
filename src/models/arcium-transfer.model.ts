import mongoose, { Schema, Document } from 'mongoose';

/**
 * Arcium Encrypted Transfer Model
 *
 * Stores encrypted private transfer data.
 * Amounts are encrypted and only sender/recipient can decrypt.
 */

export interface IArciumTransfer extends Document {
  userId: string;
  sender: string;
  recipient: string;
  encryptedAmount: Buffer;
  encryptedTimestamp: Buffer;
  nonce: Buffer;
  senderPublicKey: Buffer;
  computationOffset: string;
  status: 'pending' | 'completed' | 'failed';
  computationSignature?: string;
  finalizationSignature?: string;
  encryptedResultAmount?: Buffer;
  resultNonce?: Buffer;
  resultEncryptionKey?: Buffer;
  amount?: string; // For testing only, removed in production
  timestamp: Date;
  metadata?: Record<string, any>;
}

const ArciumTransferSchema = new Schema<IArciumTransfer>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  sender: {
    type: String,
    required: true,
    index: true,
  },
  recipient: {
    type: String,
    required: true,
    index: true,
  },
  encryptedAmount: {
    type: Buffer,
    required: true,
  },
  encryptedTimestamp: {
    type: Buffer,
    required: true,
  },
  nonce: {
    type: Buffer,
    required: true,
  },
  senderPublicKey: {
    type: Buffer,
    required: true,
  },
  computationOffset: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },
  computationSignature: {
    type: String,
  },
  finalizationSignature: {
    type: String,
  },
  encryptedResultAmount: {
    type: Buffer,
  },
  resultNonce: {
    type: Buffer,
  },
  resultEncryptionKey: {
    type: Buffer,
  },
  amount: {
    type: String,
    // For testing/debugging only
    // In production, this should be removed as amounts should remain encrypted
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
ArciumTransferSchema.index({ sender: 1, timestamp: -1 });
ArciumTransferSchema.index({ recipient: 1, timestamp: -1 });
ArciumTransferSchema.index({ status: 1, timestamp: -1 });

export const ArciumTransfer = mongoose.model<IArciumTransfer>('ArciumTransfer', ArciumTransferSchema);
