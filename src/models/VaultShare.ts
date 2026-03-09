import mongoose, { Document, Schema } from "mongoose";
import crypto from "crypto";

// --- AES-256-GCM field encryption helpers ---

function getEncryptionKey(): Buffer {
  const key = process.env.VAULT_SHARES_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("VAULT_SHARES_ENCRYPTION_KEY is not set");
  }
  return Buffer.from(key, "hex");
}

function encrypt(value: number): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(value.toString());
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(data: string): number {
  const key = getEncryptionKey();
  const [ivHex, tagHex, ciphertextHex] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return Number(decrypted.toString());
}

// --- Types ---

export type VaultType = "sol_jito";
export type VaultShareStatus = "active" | "withdrawn" | "pending";

export interface IVaultShare extends Document {
  userId: mongoose.Types.ObjectId;
  vaultType: VaultType;
  sharesAmount: number;
  depositAmountLamports: number;
  depositRate: number;
  depositTimestamp: Date;
  status: VaultShareStatus;
  txSignature: string;
  withdrawAmountLamports?: number;
  withdrawTimestamp?: Date;
  withdrawTxSignature?: string;
  arciumTxSignature?: string;
  encryptedOnChain?: boolean;
  batchId?: string;
  batchStatus?: "pending" | "staked" | "failed";
  snapshotIndex?: number;
  createdAt: Date;
  updatedAt: Date;
}

// --- Schema ---

const vaultShareSchema = new Schema<IVaultShare>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },
    vaultType: {
      type: String,
      enum: ["sol_jito"],
      required: [true, "vaultType is required"],
    },
    // Encrypted fields stored as strings
    sharesAmount: {
      type: Schema.Types.Mixed,
      required: [true, "sharesAmount is required"],
    },
    depositAmountLamports: {
      type: Schema.Types.Mixed,
      required: [true, "depositAmountLamports is required"],
    },
    depositRate: {
      type: Schema.Types.Mixed,
      required: [true, "depositRate is required"],
    },
    depositTimestamp: {
      type: Date,
      required: [true, "depositTimestamp is required"],
    },
    status: {
      type: String,
      enum: ["active", "withdrawn", "pending"],
      default: "pending",
      required: true,
    },
    txSignature: {
      type: String,
      required: [true, "txSignature is required"],
      index: true,
    },
    // Withdrawal fields (optional)
    withdrawAmountLamports: {
      type: Schema.Types.Mixed,
    },
    withdrawTimestamp: {
      type: Date,
    },
    withdrawTxSignature: {
      type: String,
    },
    // Arcium MPC bookkeeping fields
    arciumTxSignature: {
      type: String,
    },
    encryptedOnChain: {
      type: Boolean,
      default: false,
    },
    batchId: {
      type: String,
    },
    batchStatus: {
      type: String,
      enum: ["pending", "staked", "failed"],
    },
    snapshotIndex: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// --- Composite indexes ---
vaultShareSchema.index({ userId: 1, status: 1 });
vaultShareSchema.index({ userId: 1, vaultType: 1, status: 1 });
vaultShareSchema.index({ status: 1 });
vaultShareSchema.index({ batchId: 1, batchStatus: 1 });

// --- Encryption hooks ---

vaultShareSchema.pre("save", function () {
  if (this.isModified("sharesAmount") && typeof this.sharesAmount === "number") {
    (this as any).sharesAmount = encrypt(this.sharesAmount);
  }
  if (this.isModified("depositAmountLamports") && typeof this.depositAmountLamports === "number") {
    (this as any).depositAmountLamports = encrypt(this.depositAmountLamports);
  }
  if (this.isModified("depositRate") && typeof this.depositRate === "number") {
    (this as any).depositRate = encrypt(this.depositRate);
  }
  if (this.isModified("withdrawAmountLamports") && typeof this.withdrawAmountLamports === "number") {
    (this as any).withdrawAmountLamports = encrypt(this.withdrawAmountLamports);
  }
});

// Decrypt on read
function decryptFields(doc: any) {
  if (!doc) return doc;
  if (typeof doc.sharesAmount === "string" && doc.sharesAmount.includes(":")) {
    doc.sharesAmount = decrypt(doc.sharesAmount);
  }
  if (typeof doc.depositAmountLamports === "string" && doc.depositAmountLamports.includes(":")) {
    doc.depositAmountLamports = decrypt(doc.depositAmountLamports);
  }
  if (typeof doc.depositRate === "string" && doc.depositRate.includes(":")) {
    doc.depositRate = decrypt(doc.depositRate);
  }
  if (typeof doc.withdrawAmountLamports === "string" && doc.withdrawAmountLamports.includes(":")) {
    doc.withdrawAmountLamports = decrypt(doc.withdrawAmountLamports);
  }
  return doc;
}

vaultShareSchema.post("save", function (doc) {
  decryptFields(doc);
});

vaultShareSchema.post("findOne", function (doc) {
  decryptFields(doc);
});

vaultShareSchema.post("find", function (docs: any[]) {
  docs.forEach(decryptFields);
});

export const VaultShare = mongoose.model<IVaultShare>("VaultShare", vaultShareSchema);
