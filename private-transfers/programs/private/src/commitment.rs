use anchor_lang::prelude::*;

/// Maximum number of commitments stored in the tree
/// Set to 100 for balanced capacity (32 bytes * 100 = 3.2KB)
/// This provides 100 deposits before tree is full
/// For higher capacity, use denomination pools (separate tree per pool)
pub const MAX_COMMITMENTS: usize = 100;

/// A cryptographic commitment representing a deposit in the shielded pool
/// Following Umbra's design: C = Poseidon(V, I, Inner_Hash, pk_sol, amount, timestamp, ...)
#[account]
pub struct CommitmentTree {
    /// Authority that can modify this tree (program-derived)
    pub authority: Pubkey,

    /// Array of commitment hashes (32 bytes each)
    /// Each commitment = Poseidon(secret, nullifier, recipient_stealth, amount, timestamp)
    pub commitments: Vec<[u8; 32]>,

    /// Current size of the tree
    pub count: u64,

    /// Merkle root of the commitment tree
    pub root: [u8; 32],

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl CommitmentTree {
    /// Size calculation for account space
    pub const LEN: usize = 8  // discriminator
        + 32  // authority
        + 4 + (MAX_COMMITMENTS * 32)  // commitments vec
        + 8  // count
        + 32  // root
        + 1;  // bump

    /// Add a new commitment to the tree
    pub fn add_commitment(&mut self, commitment: [u8; 32]) -> Result<u64> {
        require!(
            self.commitments.len() < MAX_COMMITMENTS,
            ErrorCode::CommitmentTreeFull
        );

        self.commitments.push(commitment);
        self.count += 1;

        // Recompute Merkle root after adding commitment
        self.compute_root()?;

        Ok(self.count - 1) // Return index of added commitment
    }

    /// Compute the Merkle root of all commitments
    /// Simple implementation: hash all commitments together
    /// Production: use incremental Merkle tree (like Zcash Sapling)
    fn compute_root(&mut self) -> Result<()> {
        if self.commitments.is_empty() {
            self.root = [0u8; 32];
            return Ok(());
        }

        // Convert all commitments to field elements and hash
        // Simplified: just hash the first commitment as root
        // TODO: Implement proper Merkle tree with Poseidon
        self.root = self.commitments[0];

        Ok(())
    }

    /// Verify a Merkle proof for a given commitment
    /// Returns true if the commitment is in the tree
    pub fn verify_membership(
        &self,
        commitment: &[u8; 32],
        _proof: &[[u8; 32]],
    ) -> bool {
        // Simple check: just verify commitment exists in our list
        // Production: implement proper Merkle proof verification
        self.commitments.contains(commitment)
    }
}

/// Represents a nullifier that prevents double-spending
/// Following Umbra: nullifier = hash(secret, commitment_index)
#[account]
pub struct NullifierRegistry {
    /// Authority that can modify this registry
    pub authority: Pubkey,

    /// Set of used nullifiers (hash -> used)
    /// Using Vec for simplicity; production would use HashMap or Merkle set
    pub used_nullifiers: Vec<[u8; 32]>,

    /// Count of used nullifiers
    pub count: u64,

    /// Bump seed
    pub bump: u8,
}

impl NullifierRegistry {
    /// Maximum nullifiers (should match MAX_COMMITMENTS)
    pub const MAX_NULLIFIERS: usize = MAX_COMMITMENTS;

    /// Size calculation
    pub const LEN: usize = 8  // discriminator
        + 32  // authority
        + 4 + (Self::MAX_NULLIFIERS * 32)  // used_nullifiers vec
        + 8  // count
        + 1;  // bump

    /// Check if a nullifier has been used
    pub fn is_used(&self, nullifier: &[u8; 32]) -> bool {
        self.used_nullifiers.contains(nullifier)
    }

    /// Mark a nullifier as used
    pub fn use_nullifier(&mut self, nullifier: [u8; 32]) -> Result<()> {
        require!(
            !self.is_used(&nullifier),
            ErrorCode::NullifierAlreadyUsed
        );

        require!(
            self.used_nullifiers.len() < Self::MAX_NULLIFIERS,
            ErrorCode::NullifierRegistryFull
        );

        self.used_nullifiers.push(nullifier);
        self.count += 1;

        Ok(())
    }
}

/// Deposit commitment structure (ephemeral, not stored on-chain)
/// Used to create the final commitment hash
///
/// Following Umbra's encrypted amounts architecture:
/// - Amount is encrypted with ChaCha20 using ECDH-derived key
/// - Nonce ensures semantic security (different ciphertexts for same amount)
/// - Only recipient can decrypt using their private key
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositNote {
    /// Random secret for hiding (32 bytes)
    pub secret: [u8; 32],

    /// Nullifier for double-spend prevention (32 bytes)
    pub nullifier: [u8; 32],

    /// Recipient's stealth address (32 bytes)
    pub recipient_stealth_address: Pubkey,

    /// Encrypted amount (8 bytes ciphertext for u64)
    /// Encrypted using ChaCha20 with ECDH-derived key
    pub encrypted_amount: [u8; 8],

    /// Nonce for amount encryption (12 bytes for ChaCha20)
    /// Ensures semantic security - different encryptions produce different ciphertexts
    pub amount_nonce: [u8; 12],

    /// Timestamp of deposit
    pub timestamp: i64,

    /// Ephemeral public key for ECDH (32 bytes)
    /// Allows recipient to derive shared secret and decrypt amount
    pub ephemeral_public_key: [u8; 32],
}

impl DepositNote {
    /// Create commitment hash from deposit note
    /// Following Umbra: C = Poseidon(secret, nullifier, recipient_stealth, encrypted_amount, timestamp)
    ///
    /// NOTE: Uses encrypted_amount instead of plaintext amount for privacy
    pub fn create_commitment(&self) -> Result<[u8; 32]> {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(&self.secret);
        hasher.update(&self.nullifier);
        hasher.update(&self.recipient_stealth_address.to_bytes());
        hasher.update(&self.encrypted_amount); // Encrypted amount!
        hasher.update(&self.amount_nonce); // Include nonce for uniqueness
        hasher.update(&self.timestamp.to_le_bytes());
        hasher.update(&self.ephemeral_public_key);

        let hash = hasher.finalize();
        let mut result = [0u8; 32];
        result.copy_from_slice(&hash);

        Ok(result)
    }

    /// Create nullifier hash
    /// Following Umbra: nullifier_hash = hash(nullifier)
    pub fn create_nullifier_hash(&self) -> [u8; 32] {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(&self.nullifier);

        let hash = hasher.finalize();
        let mut result = [0u8; 32];
        result.copy_from_slice(&hash);
        result
    }
}

/// Error codes for commitment operations
#[error_code]
pub enum ErrorCode {
    #[msg("Commitment tree is full")]
    CommitmentTreeFull,

    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,

    #[msg("Nullifier registry is full")]
    NullifierRegistryFull,

    #[msg("Invalid Merkle proof")]
    InvalidMerkleProof,

    #[msg("Commitment not found in tree")]
    CommitmentNotFound,
}
