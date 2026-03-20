/**
 * MixerArtifact — track les UTXOs déposés dans le Mixer Umbra
 * Les champs generationIndex et claimableBalance sont chiffrés AES-256-GCM au repos.
 * Requirements: 3.1, 3.2, 3.4
 */
import mongoose, { Document, Schema } from 'mongoose';
import { encryptString, decryptString } from '../utils/umbra-encryption';

export type ClaimStatus = 'pending' | 'processing' | 'claimed' | 'pending_retry';

export interface IMixerArtifact extends Document {
  userId: string;
  txSignature: string;                // TX de deposit on-chain — unique
  generationIndexEnc: string;         // AES-256-GCM: iv:tag:ciphertext (U256 as string)
  mint: string;                       // Adresse mint (SOL natif ou USDC)
  claimableBalanceEnc: string;        // AES-256-GCM: iv:tag:ciphertext (bigint as string)
  recipientWallet: 'cash' | 'wealth';
  claimed: boolean;
  claimTxSignature?: string;
  claimStatus: ClaimStatus;
  createdAt: Date;
  updatedAt: Date;
}

const mixerArtifactSchema = new Schema<IMixerArtifact>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    txSignature: {
      type: String,
      required: true,
      unique: true,
    },
    generationIndexEnc: {
      type: String,
      required: true,
    },
    mint: {
      type: String,
      required: true,
    },
    claimableBalanceEnc: {
      type: String,
      required: true,
    },
    recipientWallet: {
      type: String,
      enum: ['cash', 'wealth'],
      required: true,
    },
    claimed: {
      type: Boolean,
      default: false,
    },
    claimTxSignature: {
      type: String,
    },
    claimStatus: {
      type: String,
      enum: ['pending', 'processing', 'claimed', 'pending_retry'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Index pour GET /utxos (artefacts non-claimés par user)
mixerArtifactSchema.index({ userId: 1, claimed: 1 });

export const MixerArtifact = mongoose.model<IMixerArtifact>('MixerArtifact', mixerArtifactSchema);

/**
 * Helpers pour chiffrer/déchiffrer les champs sensibles avant persistance / après lecture.
 * Usage : les services appellent ces helpers explicitement (pas de hooks Mongoose
 * pour rester prévisible et éviter les surprises avec les aggregations).
 */
export function encryptArtifactField(value: string): string {
  return encryptString(value);
}

export function decryptArtifactField(encrypted: string): string {
  return decryptString(encrypted);
}
