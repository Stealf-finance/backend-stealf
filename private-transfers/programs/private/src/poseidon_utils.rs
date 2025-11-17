use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

/// Poseidon-style hash utilities for Umbra protocol
///
/// NOTE: Currently using SHA256 as a placeholder for Poseidon hash
/// TODO: Replace with actual light-poseidon implementation once integrated
///
/// This allows us to implement the full Umbra protocol structure
/// while deferring the ZK-friendly hash function for later optimization

/// Hash a commitment inner part: Hash(s, n, pk_U_low, pk_U_high)
pub fn hash_commitment_inner(
    secret: &[u8; 32],
    nullifier: &[u8; 32],
    recipient_low: &[u8; 32],
    recipient_high: &[u8; 32],
) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_commitment_inner_v1");
    hasher.update(secret);
    hasher.update(nullifier);
    hasher.update(recipient_low);
    hasher.update(recipient_high);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

/// Full commitment hash: Hash(V, I, inner_hash, pk_SOL, amount, timestamp_parts...)
/// Following Umbra spec structure
pub fn hash_commitment_full(
    version: u8,
    index: u64,
    inner_hash: &[u8; 32],
    depositor_pubkey: &Pubkey,
    amount: u64,
    timestamp: i64,
) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_commitment_full_v1");
    hasher.update(&[version]);
    hasher.update(&index.to_le_bytes());
    hasher.update(inner_hash);
    hasher.update(&depositor_pubkey.to_bytes());
    hasher.update(&amount.to_le_bytes());
    hasher.update(&timestamp.to_le_bytes());

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

/// Hash nullifier: nh = Hash(n)
pub fn hash_nullifier(nullifier: &[u8; 32]) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_nullifier_v1");
    hasher.update(nullifier);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

/// Deposit Linker: L_D = Hash(k_ITK_D, pk_U_low, pk_U_high)
pub fn hash_deposit_linker(
    itk: &[u8; 32],
    recipient_low: &[u8; 32],
    recipient_high: &[u8; 32],
) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_deposit_linker_v1");
    hasher.update(itk);
    hasher.update(recipient_low);
    hasher.update(recipient_high);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

/// Claim Linker: L_C = Hash(k_ITK_C, I)
pub fn hash_claim_linker(
    itk: &[u8; 32],
    commitment_index: u64,
) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_claim_linker_v1");
    hasher.update(itk);
    hasher.update(&commitment_index.to_le_bytes());

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

/// Merkle tree hash: Hash(left, right)
pub fn hash_merkle_node(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    hasher.update(b"umbra_merkle_node_v1");
    hasher.update(left);
    hasher.update(right);

    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_nullifier() {
        let nullifier = [42u8; 32];
        let hash = hash_nullifier(&nullifier).unwrap();
        assert_ne!(hash, [0u8; 32]);
        assert_ne!(hash, nullifier); // Hash should be different from input
    }

    #[test]
    fn test_hash_commitment_inner() {
        let secret = [1u8; 32];
        let nullifier = [2u8; 32];
        let recipient_low = [3u8; 32];
        let recipient_high = [4u8; 32];

        let hash = hash_commitment_inner(&secret, &nullifier, &recipient_low, &recipient_high).unwrap();
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_hash_merkle_node() {
        let left = [10u8; 32];
        let right = [20u8; 32];

        let hash = hash_merkle_node(&left, &right).unwrap();
        assert_ne!(hash, [0u8; 32]);

        // Hash should be different for different inputs
        let hash_reversed = hash_merkle_node(&right, &left).unwrap();
        assert_ne!(hash, hash_reversed);
    }

    #[test]
    fn test_hash_deterministic() {
        let secret = [5u8; 32];
        let nullifier = [6u8; 32];
        let recipient_low = [7u8; 32];
        let recipient_high = [8u8; 32];

        let hash1 = hash_commitment_inner(&secret, &nullifier, &recipient_low, &recipient_high).unwrap();
        let hash2 = hash_commitment_inner(&secret, &nullifier, &recipient_low, &recipient_high).unwrap();

        // Same inputs should produce same hash
        assert_eq!(hash1, hash2);
    }
}
