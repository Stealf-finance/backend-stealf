use anchor_lang::prelude::*;

/// Fixed denominations pour pools (Tornado Cash style)
/// Le montant est IMPLICITE basé sur le pool_id
pub const DENOMINATION_AMOUNTS: [u64; 5] = [
    100_000_000,      // 0: 0.1 SOL
    500_000_000,      // 1: 0.5 SOL
    1_000_000_000,    // 2: 1 SOL
    5_000_000_000,    // 3: 5 SOL
    10_000_000_000,   // 4: 10 SOL
];

/// Get amount for a denomination pool ID
pub fn get_denomination_amount(pool_id: u8) -> Result<u64> {
    DENOMINATION_AMOUNTS
        .get(pool_id as usize)
        .copied()
        .ok_or(ErrorCode::InvalidDenomination.into())
}

/// Denomination pool account - stores stats for each pool
#[account]
pub struct DenominationPool {
    /// Pool ID (0-4 pour 0.1, 0.5, 1, 5, 10 SOL)
    pub denomination: u8,

    /// Total number of deposits in this pool
    pub total_deposits: u64,

    /// Total number of claims from this pool
    pub total_claims: u64,

    /// Merkle root (simplified for now)
    pub merkle_root: [u8; 32],

    /// Timestamp of creation
    pub created_at: i64,

    /// PDA bump
    pub bump: u8,
}

impl DenominationPool {
    pub const LEN: usize = 8  // discriminator
        + 1   // denomination
        + 8   // total_deposits
        + 8   // total_claims
        + 32  // merkle_root
        + 8   // created_at
        + 1;  // bump
}

/// Error codes for denomination pools
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid denomination pool ID (must be 0-4)")]
    InvalidDenomination,

    #[msg("Pool already initialized")]
    PoolAlreadyInitialized,
}
