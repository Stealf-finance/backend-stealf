/// Encryption module for Umbra-style encrypted amounts
/// Implements ChaCha20 encryption with ECDH key derivation
///
/// Following Umbra's encrypted balance architecture:
/// - Amounts are encrypted, not just hashed in commitments
/// - ECDH derives shared secrets for encryption keys
/// - Nonces ensure semantic security (IND-CPA)

use anchor_lang::prelude::*;
use sha2::{Sha256, Digest};
use chacha20::{
    ChaCha20,
    cipher::{KeyIvInit, StreamCipher},
};

/// Encrypt an amount using ChaCha20 with ECDH-derived key
///
/// # Arguments
/// * `amount` - The amount to encrypt (u64)
/// * `shared_secret` - 32-byte shared secret from ECDH
/// * `nonce` - 12-byte nonce for ChaCha20
///
/// # Returns
/// * `[u8; 8]` - Encrypted amount (8 bytes for u64)
pub fn encrypt_amount(
    amount: u64,
    shared_secret: &[u8; 32],
    nonce: &[u8; 12],
) -> Result<[u8; 8]> {
    // Derive encryption key from shared secret
    let mut hasher = Sha256::new();
    hasher.update(b"amount_encryption_v1");
    hasher.update(shared_secret);
    let key_hash = hasher.finalize();
    let key: [u8; 32] = key_hash.into();

    // Convert amount to bytes (little-endian)
    let plaintext = amount.to_le_bytes();

    // Initialize ChaCha20 cipher
    let mut cipher = ChaCha20::new(&key.into(), nonce.into());

    // Encrypt in-place
    let mut ciphertext = plaintext;
    cipher.apply_keystream(&mut ciphertext);

    Ok(ciphertext)
}

/// Decrypt an encrypted amount using ChaCha20 with ECDH-derived key
///
/// # Arguments
/// * `ciphertext` - The encrypted amount (8 bytes)
/// * `shared_secret` - 32-byte shared secret from ECDH
/// * `nonce` - 12-byte nonce used for encryption
///
/// # Returns
/// * `u64` - Decrypted amount
pub fn decrypt_amount(
    ciphertext: &[u8; 8],
    shared_secret: &[u8; 32],
    nonce: &[u8; 12],
) -> Result<u64> {
    // Derive decryption key (same as encryption)
    let mut hasher = Sha256::new();
    hasher.update(b"amount_encryption_v1");
    hasher.update(shared_secret);
    let key_hash = hasher.finalize();
    let key: [u8; 32] = key_hash.into();

    // Initialize ChaCha20 cipher
    let mut cipher = ChaCha20::new(&key.into(), nonce.into());

    // Decrypt in-place
    let mut plaintext = *ciphertext;
    cipher.apply_keystream(&mut plaintext);

    // Convert bytes back to u64
    Ok(u64::from_le_bytes(plaintext))
}

/// Compute ECDH shared secret (simplified version)
///
/// In production, use curve25519-dalek for real X25519 ECDH.
/// For now, using hash-based ECDH consistent with stealth.rs
///
/// # Arguments
/// * `my_private_key` - 32-byte private key
/// * `their_public_key` - 32-byte public key
///
/// # Returns
/// * `[u8; 32]` - Shared secret
pub fn compute_shared_secret(
    my_private_key: &[u8; 32],
    their_public_key: &[u8; 32],
) -> [u8; 32] {
    // Simplified ECDH using hash
    // For consistency with stealth.rs implementation
    let mut hasher = Sha256::new();
    hasher.update(b"ecdh_shared_v1");
    hasher.update(my_private_key);
    hasher.update(their_public_key);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_amount() {
        let amount = 500_000_000u64; // 0.5 SOL in lamports
        let shared_secret = [0x42u8; 32]; // Mock shared secret
        let nonce = [0x01u8; 12]; // Mock nonce

        // Encrypt
        let ciphertext = encrypt_amount(amount, &shared_secret, &nonce).unwrap();

        // Decrypt
        let decrypted = decrypt_amount(&ciphertext, &shared_secret, &nonce).unwrap();

        assert_eq!(amount, decrypted, "Decrypted amount should match original");
    }

    #[test]
    fn test_different_nonces_produce_different_ciphertexts() {
        let amount = 1_000_000_000u64;
        let shared_secret = [0x99u8; 32];
        let nonce1 = [0x01u8; 12];
        let nonce2 = [0x02u8; 12];

        let ct1 = encrypt_amount(amount, &shared_secret, &nonce1).unwrap();
        let ct2 = encrypt_amount(amount, &shared_secret, &nonce2).unwrap();

        assert_ne!(ct1, ct2, "Different nonces should produce different ciphertexts");
    }

    #[test]
    fn test_shared_secret_computation() {
        let priv1 = [0x11u8; 32];
        let pub2 = [0x22u8; 32];

        let secret = compute_shared_secret(&priv1, &pub2);

        assert_eq!(secret.len(), 32, "Shared secret should be 32 bytes");
    }
}
