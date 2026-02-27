/**
 * StealthPayment — Modèle MongoDB pour les paiements stealth détectés par le scanner.
 *
 * Invariants :
 * - Un document avec status 'spent' ne peut jamais repasser à 'spendable'
 * - txSignature est unique par userId (déduplication scanner)
 * - amountLamports est stocké en String pour éviter les problèmes de précision BigInt
 * - walletType discrimine les UTXOs wealth (défaut) des UTXOs cash (tâche 1.2)
 *
 * Requirements : 3.4, 3.7, 4.3, 4.4, 5.4, 5.5
 */

import mongoose, { Document, Schema } from 'mongoose';

export type StealthPaymentStatus = 'pending' | 'spendable' | 'spent';
export type StealthPaymentWalletType = 'wealth' | 'cash';

export interface IStealthPayment extends Document {
  userId: mongoose.Types.ObjectId;
  stealthAddress: string;       // base58 — adresse one-time où les fonds ont été reçus
  amountLamports: string;       // stocké en String (BigInt safe)
  txSignature: string;          // TX d'envoi (unique par userId)
  ephemeralR: string;           // base58 32 bytes — clé éphémère du memo
  viewTag: number;              // 0–255
  detectedAt: Date;
  status: StealthPaymentStatus;
  walletType: StealthPaymentWalletType; // discriminant : 'wealth' (défaut) ou 'cash'
  spendTxSignature?: string;    // TX de dépense (défini une fois status = 'spent')
  spentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stealthPaymentSchema = new Schema<IStealthPayment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    stealthAddress: {
      type: String,
      required: [true, 'stealthAddress is required'],
    },
    amountLamports: {
      type: String,
      required: [true, 'amountLamports is required'],
    },
    txSignature: {
      type: String,
      required: [true, 'txSignature is required'],
    },
    ephemeralR: {
      type: String,
      required: [true, 'ephemeralR is required'],
    },
    viewTag: {
      type: Number,
      required: [true, 'viewTag is required'],
      min: 0,
      max: 255,
    },
    detectedAt: {
      type: Date,
      required: [true, 'detectedAt is required'],
    },
    status: {
      type: String,
      enum: ['pending', 'spendable', 'spent'],
      default: 'pending',
      required: true,
    },
    // Discriminant wallet (tâche 1.2) — 'wealth' par défaut pour rétrocompatibilité
    walletType: {
      type: String,
      enum: ['wealth', 'cash'],
      default: 'wealth',
      required: true,
    },
    // Champs de dépense — définis uniquement après status = 'spent'
    spendTxSignature: {
      type: String,
    },
    spentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// --- Indexes ---

// Déduplication scanner : une seule entrée par (userId, txSignature)
stealthPaymentSchema.index({ userId: 1, txSignature: 1 }, { unique: true });

// Query paiements par utilisateur, type de wallet et statut (optimise la query balance cash)
stealthPaymentSchema.index({ userId: 1, walletType: 1, status: 1 });

// Tri historique par date de détection (DESC)
stealthPaymentSchema.index({ detectedAt: -1 });

// --- Invariant : spent → ne peut pas redevenir spendable ---

stealthPaymentSchema.pre('save', function () {
  if (
    this.isModified('status') &&
    this.status !== 'spent' &&
    (this as any)._previousStatus === 'spent'
  ) {
    throw new Error('StealthPayment: un paiement spent ne peut pas redevenir spendable');
  }
});

export const StealthPayment = mongoose.model<IStealthPayment>(
  'StealthPayment',
  stealthPaymentSchema,
);
