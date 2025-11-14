/**
 * Encryption utilities for Umbra-style encrypted amounts
 * Implements stream cipher encryption with ECDH key derivation (client-side)
 *
 * NOTE: Using simplified XOR stream cipher for prototype
 * Production should use proper ChaCha20 (via @stablelib/chacha20poly1305)
 *
 * Matches the architecture in programs/private/src/encryption.rs
 */

import { createHash, randomBytes } from "crypto";

/**
 * Derive shared secret from ECDH (simplified, symmetric)
 * MUST match the approach used in generateStealthAddress
 *
 * Uses hash(pubkey1, pubkey2) for consistency with stealth.rs
 * Both Alice and Bob compute: hash(recipient_pubkey, ephemeral_pubkey)
 */
export function computeSharedSecret(
  recipientPubkey: Buffer,
  ephemeralPubkey: Buffer
): Buffer {
  const hasher = createHash("sha256");
  hasher.update(Buffer.from("stealth_ecdh_v1"));  // Same domain separator
  hasher.update(recipientPubkey);  // Recipient's pubkey
  hasher.update(ephemeralPubkey);  // Ephemeral pubkey
  return hasher.digest();
}

/**
 * Derive keystream from key and nonce (simplified stream cipher)
 * In production, use proper ChaCha20
 */
function deriveKeystream(key: Buffer, nonce: Buffer, length: number): Buffer {
  const hasher = createHash("sha256");
  hasher.update(key);
  hasher.update(nonce);
  hasher.update(Buffer.from("keystream_v1"));

  // Generate enough keystream bytes
  let keystream = Buffer.alloc(0);
  let counter = 0;
  while (keystream.length < length) {
    const blockHasher = createHash("sha256");
    blockHasher.update(hasher.digest());
    blockHasher.update(Buffer.from([counter]));
    keystream = Buffer.concat([keystream, blockHasher.digest()]);
    counter++;
  }

  return keystream.subarray(0, length);
}

/**
 * Encrypt amount using stream cipher
 * Matches Rust architecture (simplified)
 */
export function encryptAmount(
  amount: number,
  sharedSecret: Buffer,
  nonce: Buffer
): Buffer {
  // Derive encryption key from shared secret
  const keyHasher = createHash("sha256");
  keyHasher.update(Buffer.from("amount_encryption_v1"));
  keyHasher.update(sharedSecret);
  const key = keyHasher.digest(); // 32 bytes

  // Convert amount to 8-byte buffer (little-endian u64)
  const plaintext = Buffer.alloc(8);
  plaintext.writeBigUInt64LE(BigInt(amount), 0);

  // Generate keystream and XOR
  const keystream = deriveKeystream(key, nonce, 8);
  const ciphertext = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    ciphertext[i] = plaintext[i] ^ keystream[i];
  }

  return ciphertext;
}

/**
 * Decrypt encrypted amount
 * XOR is symmetric, so same operation as encryption
 */
export function decryptAmount(
  ciphertext: Buffer,
  sharedSecret: Buffer,
  nonce: Buffer
): number {
  // Derive decryption key (same as encryption)
  const keyHasher = createHash("sha256");
  keyHasher.update(Buffer.from("amount_encryption_v1"));
  keyHasher.update(sharedSecret);
  const key = keyHasher.digest();

  // Generate keystream and XOR
  const keystream = deriveKeystream(key, nonce, 8);
  const plaintext = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    plaintext[i] = ciphertext[i] ^ keystream[i];
  }

  // Convert 8-byte buffer back to number
  const amount = Number(plaintext.readBigUInt64LE(0));
  return amount;
}

/**
 * Generate random nonce for ChaCha20 (12 bytes)
 */
export function generateNonce(): Buffer {
  return randomBytes(12);
}
