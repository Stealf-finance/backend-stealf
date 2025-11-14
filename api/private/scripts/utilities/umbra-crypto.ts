/**
 * Umbra-style cryptographic utilities
 * Matches the Rust implementation in stealth.rs and commitment.rs
 */

import { PublicKey } from "@solana/web3.js";
import { createHash, randomBytes } from "crypto";
import { BN } from "@coral-xyz/anchor";

/**
 * Keypair for Umbra-style dual-key system
 */
export interface UmbraKeypair {
  // Ed25519 spending key (for signing transactions)
  spendingPublicKey: PublicKey;
  spendingPrivateKey: Uint8Array;

  // X25519 encryption key (for ECDH and stealth addresses)
  encryptionPublicKey: Buffer;
  encryptionPrivateKey: Buffer;
}

/**
 * Generate a complete Umbra keypair
 */
export function generateUmbraKeypair(): UmbraKeypair {
  // Ed25519 spending key (standard Solana keypair)
  const spendingPrivateKey = randomBytes(64);
  const spendingPublicKey = new PublicKey(randomBytes(32)); // Simplified

  // X25519 encryption key
  const encryptionPrivateKey = randomBytes(32);
  const encryptionPublicKey = derivePublicKey(encryptionPrivateKey);

  return {
    spendingPublicKey,
    spendingPrivateKey,
    encryptionPublicKey,
    encryptionPrivateKey,
  };
}

/**
 * Derive public key from private key (simplified)
 * Matches: stealth.rs::derive_public_key()
 */
export function derivePublicKey(privKey: Buffer): Buffer {
  return createHash("sha256")
    .update(Buffer.from("derive_pubkey_v1"))
    .update(privKey)
    .digest();
}

/**
 * Compute ECDH shared secret (simplified)
 * Matches: stealth.rs::compute_shared_secret()
 */
export function computeSharedSecret(privKey: Buffer, pubKey: Buffer): Buffer {
  return createHash("sha256")
    .update(Buffer.from("stealth_ecdh_v1"))
    .update(privKey)
    .update(pubKey)
    .digest();
}

/**
 * Derive stealth address from shared secret
 * Matches: stealth.rs::derive_address_from_secret()
 */
export function deriveStealthAddress(
  sharedSecret: Buffer,
  basePubkey: PublicKey
): PublicKey {
  const stealthBytes = createHash("sha256")
    .update(sharedSecret)
    .update(basePubkey.toBuffer())
    .update(Buffer.from("stealth_derive_v1"))
    .digest();

  return new PublicKey(stealthBytes);
}

/**
 * Generate ephemeral keypair for one-time use
 * Matches: stealth.rs::generate_ephemeral_keypair()
 */
export function generateEphemeralKeypair(): {
  privateKey: Buffer;
  publicKey: Buffer;
} {
  const privateKey = randomBytes(32);
  const publicKey = derivePublicKey(privateKey);

  return { privateKey, publicKey };
}

/**
 * Generate stealth address for recipient
 * Matches: stealth.rs::generate_stealth_address()
 *
 * Returns:
 * - stealthAddress: The derived stealth address
 * - ephemeralPublicKey: To be included in deposit event for scanning
 */
export function generateStealthAddress(
  recipientEncryptionPubkey: Buffer,
  recipientSpendingPubkey: PublicKey,
  ephemeralPrivateKey: Buffer
): {
  stealthAddress: PublicKey;
  ephemeralPublicKey: Buffer;
  sharedSecret: Buffer;
} {
  // Compute shared secret
  const sharedSecret = computeSharedSecret(
    ephemeralPrivateKey,
    recipientEncryptionPubkey
  );

  // Derive stealth address
  const stealthAddress = deriveStealthAddress(sharedSecret, recipientSpendingPubkey);

  // Derive ephemeral public key
  const ephemeralPublicKey = derivePublicKey(ephemeralPrivateKey);

  return {
    stealthAddress,
    ephemeralPublicKey,
    sharedSecret,
  };
}

/**
 * Scan commitment to check if it belongs to recipient
 * Matches: stealth.rs::scan_commitment()
 *
 * Returns true if the commitment's stealth address was derived for this recipient
 */
export function scanCommitment(
  recipientEncryptionPrivKey: Buffer,
  recipientSpendingPubkey: PublicKey,
  ephemeralPublicKey: Buffer,
  commitmentStealthAddress: PublicKey
): boolean {
  // Recompute shared secret from recipient's perspective
  const sharedSecret = computeSharedSecret(
    recipientEncryptionPrivKey,
    ephemeralPublicKey
  );

  // Derive expected stealth address
  const expectedStealth = deriveStealthAddress(sharedSecret, recipientSpendingPubkey);

  // Check match
  return expectedStealth.equals(commitmentStealthAddress);
}

/**
 * Deposit note data structure
 * Matches: commitment.rs::DepositNote
 */
export interface DepositNote {
  secret: Buffer;
  nullifier: Buffer;
  recipientStealthAddress: PublicKey;
  amount: number;
  timestamp: number;
  ephemeralPublicKey: Buffer;
}

/**
 * Create commitment hash from deposit note
 * Matches: commitment.rs::DepositNote::create_commitment()
 */
export function createCommitment(note: DepositNote): Buffer {
  const hasher = createHash("sha256");

  hasher.update(note.secret);
  hasher.update(note.nullifier);
  hasher.update(note.recipientStealthAddress.toBuffer());
  hasher.update(Buffer.from(new BN(note.amount).toArray("le", 8)));
  hasher.update(Buffer.from(new BN(note.timestamp).toArray("le", 8)));
  hasher.update(note.ephemeralPublicKey);

  return hasher.digest();
}

/**
 * Create nullifier hash
 * Matches: commitment.rs::DepositNote::create_nullifier_hash()
 */
export function createNullifierHash(nullifier: Buffer): Buffer {
  return createHash("sha256").update(nullifier).digest();
}

/**
 * Generate random secret for commitment
 */
export function generateSecret(): Buffer {
  return randomBytes(32);
}

/**
 * Generate random nullifier for commitment
 */
export function generateNullifier(): Buffer {
  return randomBytes(32);
}

/**
 * Decode commitment from event data
 */
export function decodeDepositNote(
  secret: Buffer,
  nullifier: Buffer,
  commitment: Buffer,
  ephemeralPublicKey: Buffer,
  amount: number
): DepositNote | null {
  // In production: Decrypt encrypted metadata from event
  // For now: We need to know the stealth address separately
  // This is why scanning is done by recomputing stealth addresses

  // Placeholder: Cannot fully decode without additional context
  return null;
}

/**
 * Pretty print keypair for debugging
 */
export function printUmbraKeypair(keypair: UmbraKeypair): void {
  console.log("Umbra Keypair:");
  console.log("  Spending Public Key:", keypair.spendingPublicKey.toString());
  console.log("  Encryption Public Key:", keypair.encryptionPublicKey.toString("hex"));
  console.log("  Encryption Private Key:", "[REDACTED]");
}

/**
 * Convert array to Buffer (helper)
 */
export function toBuffer(arr: number[] | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(arr)) return arr;
  return Buffer.from(arr);
}

/**
 * Convert Buffer to array (helper)
 */
export function toArray(buf: Buffer): number[] {
  return Array.from(buf);
}
