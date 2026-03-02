import mongoose, { Document, Schema } from "mongoose";
import crypto from "crypto";

// --- AES-256-GCM field encryption helpers (same pattern as VaultShare) ---

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

export type LoanPositionStatus = "active" | "repaid" | "liquidated";

export interface ILoanPosition extends Document {
  userId: mongoose.Types.ObjectId;
  obligationAddress: string;       // Kamino Obligation PDA — public on-chain, stored in clear
  collateralLamports: number;      // AES-256-GCM encrypted at rest
  borrowedUsdcBaseUnits: number;   // AES-256-GCM encrypted at rest
  status: LoanPositionStatus;
  openTimestamp: Date;
  closeTimestamp?: Date;
  depositTxSignature: string;
  borrowTxSignature?: string;
  repayTxSignature?: string;
  withdrawTxSignature?: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Schema ---

const loanPositionSchema = new Schema<ILoanPosition>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },
    obligationAddress: {
      type: String,
      required: [true, "obligationAddress is required"],
    },
    // Encrypted fields stored as strings in MongoDB, numbers in memory
    collateralLamports: {
      type: Schema.Types.Mixed,
      required: [true, "collateralLamports is required"],
    },
    borrowedUsdcBaseUnits: {
      type: Schema.Types.Mixed,
      required: [true, "borrowedUsdcBaseUnits is required"],
    },
    status: {
      type: String,
      enum: ["active", "repaid", "liquidated"],
      default: "active",
      required: true,
    },
    openTimestamp: {
      type: Date,
      required: [true, "openTimestamp is required"],
    },
    closeTimestamp: {
      type: Date,
    },
    depositTxSignature: {
      type: String,
      required: [true, "depositTxSignature is required"],
    },
    borrowTxSignature: {
      type: String,
    },
    repayTxSignature: {
      type: String,
    },
    withdrawTxSignature: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// --- Indexes ---
loanPositionSchema.index({ userId: 1, status: 1 });

// --- Encryption hooks ---

loanPositionSchema.pre("save", function () {
  if (this.isModified("collateralLamports") && typeof this.collateralLamports === "number") {
    (this as any).collateralLamports = encrypt(this.collateralLamports);
  }
  if (this.isModified("borrowedUsdcBaseUnits") && typeof this.borrowedUsdcBaseUnits === "number") {
    (this as any).borrowedUsdcBaseUnits = encrypt(this.borrowedUsdcBaseUnits);
  }
});

// Decrypt on read
function decryptFields(doc: any) {
  if (!doc) return doc;
  if (typeof doc.collateralLamports === "string" && doc.collateralLamports.includes(":")) {
    doc.collateralLamports = decrypt(doc.collateralLamports);
  }
  if (typeof doc.borrowedUsdcBaseUnits === "string" && doc.borrowedUsdcBaseUnits.includes(":")) {
    doc.borrowedUsdcBaseUnits = decrypt(doc.borrowedUsdcBaseUnits);
  }
  return doc;
}

loanPositionSchema.post("save", function (doc) {
  decryptFields(doc);
});

loanPositionSchema.post("findOne", function (doc) {
  decryptFields(doc);
});

loanPositionSchema.post("find", function (docs: any[]) {
  docs.forEach(decryptFields);
});

// --- Singleton access ---

let _LoanPosition: mongoose.Model<ILoanPosition> | null = null;

export function getLoanPositionModel(): mongoose.Model<ILoanPosition> {
  if (!_LoanPosition) {
    _LoanPosition = mongoose.model<ILoanPosition>("LoanPosition", loanPositionSchema);
  }
  return _LoanPosition;
}

export const LoanPosition = getLoanPositionModel();
