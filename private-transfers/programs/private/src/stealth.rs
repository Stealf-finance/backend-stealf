use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

/// Stealth address system following Umbra's design
/// Uses X25519 keys for ECDH key agreement

/// Generate a stealth address from recipient's public encryption key
/// and sender's ephemeral private key
///
/// Following Umbra:
/// 1. Sender generates ephemeral keypair (eph_priv, eph_pub)
/// 2. Computes shared_secret = ECDH(eph_priv, recipient_X25519_pub)
/// 3. Derives stealth_address = hash(shared_secret, recipient_spending_key)
///
/// Returns: (stealth_address_pubkey, ephemeral_public_key)
pub fn generate_stealth_address(
    recipient_encryption_pubkey: &[u8; 32],
    recipient_spending_pubkey: &Pubkey,
    ephemeral_private_key: &[u8; 32],
) -> Result<(Pubkey, [u8; 32])> {
    // Compute shared secret via ECDH
    // In production: use x25519_dalek::x25519 function
    // For now: simplified hash-based derivation
    let shared_secret = compute_shared_secret(
        ephemeral_private_key,
        recipient_encryption_pubkey,
    )?;

    // Derive stealth address from shared secret + recipient's spending key
    let stealth_address = derive_address_from_secret(
        &shared_secret,
        recipient_spending_pubkey,
    )?;

    // Compute ephemeral public key (for recipient to scan)
    let ephemeral_public_key = derive_public_key(ephemeral_private_key)?;

    Ok((stealth_address, ephemeral_public_key))
}

/// Scan commitments to detect which belong to the recipient
/// Recipient uses their X25519 private key to recompute stealth addresses
///
/// Returns: true if commitment belongs to recipient
pub fn scan_commitment(
    recipient_encryption_privkey: &[u8; 32],
    recipient_spending_pubkey: &Pubkey,
    ephemeral_public_key: &[u8; 32],
    commitment_stealth_address: &Pubkey,
) -> Result<bool> {
    // Recompute shared secret from recipient's perspective
    let shared_secret = compute_shared_secret(
        recipient_encryption_privkey,
        ephemeral_public_key,
    )?;

    // Derive expected stealth address
    let expected_stealth = derive_address_from_secret(
        &shared_secret,
        recipient_spending_pubkey,
    )?;

    // Check if it matches the commitment's stealth address
    Ok(expected_stealth == *commitment_stealth_address)
}

/// Compute shared secret using ECDH
/// shared_secret = ECDH(privkey_a, pubkey_b)
///
/// NOTE: This is a simplified implementation for demonstration.
/// Production should use proper X25519 ECDH from solana_program::ed25519_program
/// or integrate with a Solana-compatible X25519 implementation.
fn compute_shared_secret(
    privkey: &[u8; 32],
    pubkey: &[u8; 32],
) -> Result<[u8; 32]> {
    // Simplified: hash-based derivation (placeholder for proper ECDH)
    // TODO: Replace with solana_program::curve25519 when available
    let mut hasher = Sha256::new();
    hasher.update(b"stealth_ecdh_v1");
    hasher.update(privkey);
    hasher.update(pubkey);

    let result = hasher.finalize();
    let mut shared_secret = [0u8; 32];
    shared_secret.copy_from_slice(&result);

    Ok(shared_secret)
}

/// Derive a Solana address from shared secret and base pubkey
/// stealth_addr = base_pubkey + hash(shared_secret)
fn derive_address_from_secret(
    shared_secret: &[u8; 32],
    base_pubkey: &Pubkey,
) -> Result<Pubkey> {
    // Hash the shared secret to get a scalar
    let mut hasher = Sha256::new();
    hasher.update(shared_secret);
    hasher.update(base_pubkey.as_ref());
    hasher.update(b"stealth_derive_v1");

    let hash = hasher.finalize();

    // Create new pubkey from hash (simplified)
    // Production: proper ed25519 point addition
    let mut stealth_bytes = [0u8; 32];
    stealth_bytes.copy_from_slice(&hash);

    Ok(Pubkey::from(stealth_bytes))
}

/// Derive public key from private key
///
/// NOTE: Simplified implementation for demonstration.
/// Production should use proper Ed25519/X25519 scalar multiplication.
fn derive_public_key(privkey: &[u8; 32]) -> Result<[u8; 32]> {
    // Simplified: hash the private key (placeholder)
    // TODO: Use proper curve operations when Solana-compatible crypto lib available
    let mut hasher = Sha256::new();
    hasher.update(b"derive_pubkey_v1");
    hasher.update(privkey);

    let result = hasher.finalize();
    let mut pubkey = [0u8; 32];
    pubkey.copy_from_slice(&result);

    Ok(pubkey)
}

/// Generate a random ephemeral keypair
/// Returns: (private_key, public_key)
pub fn generate_ephemeral_keypair() -> Result<([u8; 32], [u8; 32])> {
    // In production: use proper RNG from solana_program::sysvar::slot_hashes
    // For now: derive from clock (NOT secure, just for structure)
    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let mut hasher = Sha256::new();
    hasher.update(timestamp.to_le_bytes());
    hasher.update(b"ephemeral_privkey_v1");

    let privkey_hash = hasher.finalize();
    let mut privkey = [0u8; 32];
    privkey.copy_from_slice(&privkey_hash);

    let pubkey = derive_public_key(&privkey)?;

    Ok((privkey, pubkey))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stealth_address_generation() {
        // Mock keys
        let recipient_encryption_pubkey = [1u8; 32];
        let recipient_spending_pubkey = Pubkey::new_unique();
        let ephemeral_privkey = [2u8; 32];

        let result = generate_stealth_address(
            &recipient_encryption_pubkey,
            &recipient_spending_pubkey,
            &ephemeral_privkey,
        );

        assert!(result.is_ok());
        let (stealth_addr, eph_pub) = result.unwrap();
        assert_ne!(stealth_addr, recipient_spending_pubkey);
        assert_ne!(eph_pub, [0u8; 32]);
    }

    #[test]
    fn test_commitment_scanning() {
        let recipient_encryption_privkey = [3u8; 32];
        let recipient_spending_pubkey = Pubkey::new_unique();
        let ephemeral_privkey = [4u8; 32];

        // Generate stealth address
        let recipient_encryption_pubkey = derive_public_key(&recipient_encryption_privkey).unwrap();

        let (stealth_addr, eph_pub) = generate_stealth_address(
            &recipient_encryption_pubkey,
            &recipient_spending_pubkey,
            &ephemeral_privkey,
        )
        .unwrap();

        // Scan: should detect as belonging to recipient
        let belongs = scan_commitment(
            &recipient_encryption_privkey,
            &recipient_spending_pubkey,
            &eph_pub,
            &stealth_addr,
        )
        .unwrap();

        assert!(belongs);
    }
}
