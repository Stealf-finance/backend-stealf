use anchor_lang::prelude::*;

/// Compte utilisateur pour le shielded pool
/// Stocke la balance chiffrée et les métadonnées
/// Following Umbra's dual-key architecture
#[account]
pub struct UserAccount {
    /// Propriétaire du compte (Ed25519 spending key)
    pub owner: Pubkey,

    /// X25519 encryption public key (for ECDH and stealth addresses)
    /// Follows Umbra's separation of spending and encryption keys
    pub encryption_pubkey: [u8; 32],

    /// Balance chiffrée (Enc<Shared, u64>)
    /// Cette balance est stockée sous forme de ciphertext
    /// et ne peut être déchiffrée que par l'utilisateur ou le MPC
    pub encrypted_balance: [u8; 32],

    /// Nonce utilisé pour le chiffrement de la balance
    pub balance_nonce: [u8; 16],

    /// Total SOL déposé dans le pool (public pour accountability)
    pub total_deposits: u64,

    /// Total SOL retiré du pool (public)
    pub total_withdrawals: u64,

    /// Timestamp de création du compte
    pub created_at: i64,

    /// Timestamp de dernière mise à jour
    pub last_updated: i64,

    /// Bump seed pour le PDA
    pub bump: u8,
}

impl UserAccount {
    /// Taille du compte en bytes (SANS discriminator - ajouté par Anchor avec space = 8 + LEN)
    /// 32 (owner) + 32 (encryption_pubkey) + 32 (encrypted_balance) + 16 (balance_nonce)
    /// + 8 (total_deposits) + 8 (total_withdrawals) + 8 (created_at) + 8 (last_updated) + 1 (bump)
    pub const LEN: usize = 32 + 32 + 32 + 16 + 8 + 8 + 8 + 8 + 1; // = 145 bytes

    /// Initialise un nouveau compte utilisateur
    pub fn initialize(
        &mut self,
        owner: Pubkey,
        encryption_pubkey: [u8; 32],
        bump: u8,
        current_timestamp: i64,
    ) -> Result<()> {
        self.owner = owner;
        self.encryption_pubkey = encryption_pubkey;
        self.encrypted_balance = [0; 32]; // Balance initiale = 0 (chiffré)
        self.balance_nonce = [0; 16]; // Sera mis à jour lors du premier deposit
        self.total_deposits = 0;
        self.total_withdrawals = 0;
        self.created_at = current_timestamp;
        self.last_updated = current_timestamp;
        self.bump = bump;
        Ok(())
    }

    /// Met à jour la balance chiffrée
    pub fn update_balance(
        &mut self,
        new_encrypted_balance: [u8; 32],
        new_nonce: [u8; 16],
        current_timestamp: i64,
    ) -> Result<()> {
        self.encrypted_balance = new_encrypted_balance;
        self.balance_nonce = new_nonce;
        self.last_updated = current_timestamp;
        Ok(())
    }

    /// Enregistre un dépôt
    pub fn record_deposit(&mut self, amount: u64, current_timestamp: i64) -> Result<()> {
        self.total_deposits = self.total_deposits
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        self.last_updated = current_timestamp;
        Ok(())
    }

    /// Enregistre un retrait
    pub fn record_withdrawal(&mut self, amount: u64, current_timestamp: i64) -> Result<()> {
        self.total_withdrawals = self.total_withdrawals
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        self.last_updated = current_timestamp;
        Ok(())
    }
}

/// Seed pour dériver le PDA UserAccount
pub const USER_ACCOUNT_SEED: &[u8] = b"user_account";

/// Macro helper pour dériver l'adresse du UserAccount
#[macro_export]
macro_rules! derive_user_account_address {
    ($owner:expr, $program_id:expr) => {{
        Pubkey::find_program_address(
            &[USER_ACCOUNT_SEED, $owner.as_ref()],
            $program_id,
        )
    }};
}

#[error_code]
pub enum ErrorCode {
    #[msg("Arithmetic overflow occurred")]
    Overflow,
    #[msg("Insufficient balance for operation")]
    InsufficientBalance,
    #[msg("Invalid account owner")]
    InvalidOwner,
}
