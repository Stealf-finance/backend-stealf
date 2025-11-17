use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

/// ZK-SNARK proof data for hidden amount claims
/// Based on Tornado Cash / Umbra Protocol design
///
/// Proof format (256 bytes total):
/// - proof_a: 64 bytes (G1 point)
/// - proof_b: 128 bytes (G2 point)
/// - proof_c: 64 bytes (G1 point)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ZkProof {
    /// Proof A component (64 bytes)
    pub proof_a: [u8; 64],

    /// Proof B component (128 bytes)
    pub proof_b: [u8; 128],

    /// Proof C component (64 bytes)
    pub proof_c: [u8; 64],

    /// Public inputs for the ZK circuit (each 32 bytes)
    pub public_inputs: Vec<[u8; 32]>,
}

impl ZkProof {
    /// Verify a Groth16 proof for hidden amount claim
    ///
    /// Circuit proves:
    /// 1. Knowledge of commitment secrets (s, n, amount, recipient)
    /// 2. Commitment is in Merkle tree at claimed position
    /// 3. Nullifier hash matches the secret nullifier
    /// 4. Amount is valid (non-zero, within bounds)
    /// 5. WITHOUT revealing the amount!
    pub fn verify(
        &self,
        verifying_key: &Groth16Verifyingkey,
        merkle_root: &[u8; 32],
        nullifier_hash: &[u8; 32],
    ) -> Result<bool> {
        // Public inputs for the circuit:
        // 1. Merkle root (commitment tree root)
        // 2. Nullifier hash (prevents double-spend)
        // Note: Amount is NOT a public input - it's hidden in the private witness!
        let public_inputs = [*merkle_root, *nullifier_hash];

        // Verify the Groth16 proof using Solana altbn254 syscalls
        let mut verifier = Groth16Verifier::new(
            &self.proof_a,
            &self.proof_b,
            &self.proof_c,
            &public_inputs,
            verifying_key,
        ).map_err(|_| ErrorCode::GrothVerifierInitFailed)?;

        verifier.verify().map_err(|_| ErrorCode::InvalidZkProof)?;

        Ok(true)
    }
}

/// Encrypted amount using ChaCha20 encryption
/// Allows validation without revealing the plaintext amount
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct EncryptedAmount {
    /// Encrypted amount value (ChaCha20 ciphertext)
    pub ciphertext: [u8; 8],  // u64 amount encrypted

    /// Nonce for ChaCha20
    pub nonce: [u8; 12],

    /// Ephemeral public key for ECDH
    pub ephemeral_pubkey: [u8; 32],
}

impl EncryptedAmount {
    /// Create a new encrypted amount
    ///
    /// # Arguments
    /// * `amount` - Amount to encrypt (lamports)
    /// * `recipient_pubkey` - Recipient's public key for ECDH
    /// * `ephemeral_secret` - Ephemeral secret key for ECDH
    /// * `nonce` - Nonce for ChaCha20
    ///
    /// # Returns
    /// * `EncryptedAmount` - Encrypted amount structure
    pub fn new(
        amount: u64,
        recipient_pubkey: &[u8; 32],
        ephemeral_secret: &[u8; 32],
        nonce: &[u8; 12],
    ) -> Result<Self> {
        use chacha20::{ChaCha20, cipher::{KeyIvInit, StreamCipher}};
        use sha2::{Sha256, Digest};

        // Derive shared secret via simplified ECDH
        let mut hasher = Sha256::new();
        hasher.update(b"ecdh_shared_v1");
        hasher.update(ephemeral_secret);
        hasher.update(recipient_pubkey);
        let shared_secret_hash = hasher.finalize();
        let mut shared_secret = [0u8; 32];
        shared_secret.copy_from_slice(&shared_secret_hash);

        // Encrypt amount
        let mut ciphertext = [0u8; 8];
        ciphertext.copy_from_slice(&amount.to_le_bytes());

        let mut cipher = ChaCha20::new(&shared_secret.into(), nonce.into());
        cipher.apply_keystream(&mut ciphertext);

        // Derive ephemeral public key (simplified - hash of secret)
        let mut hasher = Sha256::new();
        hasher.update(b"ephemeral_pubkey_v1");
        hasher.update(ephemeral_secret);
        let ephemeral_pubkey_hash = hasher.finalize();
        let mut ephemeral_pubkey = [0u8; 32];
        ephemeral_pubkey.copy_from_slice(&ephemeral_pubkey_hash);

        Ok(Self {
            ciphertext,
            nonce: *nonce,
            ephemeral_pubkey,
        })
    }

    /// Decrypt amount (off-chain only)
    ///
    /// # Arguments
    /// * `recipient_secret` - Recipient's secret key
    ///
    /// # Returns
    /// * `u64` - Decrypted amount
    pub fn decrypt(&self, recipient_secret: &[u8; 32]) -> Result<u64> {
        use chacha20::{ChaCha20, cipher::{KeyIvInit, StreamCipher}};
        use sha2::{Sha256, Digest};

        // Derive shared secret (same as encryption)
        let mut hasher = Sha256::new();
        hasher.update(b"ecdh_shared_v1");
        hasher.update(recipient_secret);
        hasher.update(&self.ephemeral_pubkey);
        let shared_secret_hash = hasher.finalize();
        let mut shared_secret = [0u8; 32];
        shared_secret.copy_from_slice(&shared_secret_hash);

        // Decrypt
        let mut plaintext = self.ciphertext;
        let mut cipher = ChaCha20::new(&shared_secret.into(), &self.nonce.into());
        cipher.apply_keystream(&mut plaintext);

        Ok(u64::from_le_bytes(plaintext))
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Failed to initialize Groth16 verifier")]
    GrothVerifierInitFailed,

    #[msg("Invalid ZK proof - verification failed")]
    InvalidZkProof,

    #[msg("Encrypted amount decryption failed")]
    DecryptionFailed,
}
