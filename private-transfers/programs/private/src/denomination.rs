use anchor_lang::prelude::*;
use crate::ErrorCode;

/// Fixed denomination pools for maximum privacy
/// Inspired by Tornado Cash - amounts are implicit, not parameters
///
/// Privacy advantage:
/// - Amount not visible in instruction data
/// - Large anonymity set per denomination
/// - Cannot link deposit amount to claim amount
///
/// Trade-off:
/// - Only fixed amounts allowed (0.1, 0.5, 1, 5, 10 SOL)
/// - Need multiple deposits for custom amounts

/// Denomination pool sizes (in lamports)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denomination {
    Pool01SOL = 0,   // 0.1 SOL = 100_000_000 lamports
    Pool05SOL = 1,   // 0.5 SOL = 500_000_000 lamports
    Pool1SOL = 2,    // 1.0 SOL = 1_000_000_000 lamports
    Pool5SOL = 3,    // 5.0 SOL = 5_000_000_000 lamports
    Pool10SOL = 4,   // 10.0 SOL = 10_000_000_000 lamports
}

impl Denomination {
    /// Get amount in lamports for this denomination
    pub fn amount_lamports(&self) -> u64 {
        match self {
            Denomination::Pool01SOL => 100_000_000,
            Denomination::Pool05SOL => 500_000_000,
            Denomination::Pool1SOL => 1_000_000_000,
            Denomination::Pool5SOL => 5_000_000_000,
            Denomination::Pool10SOL => 10_000_000_000,
        }
    }

    /// Get amount in SOL for display
    pub fn amount_sol(&self) -> f64 {
        match self {
            Denomination::Pool01SOL => 0.1,
            Denomination::Pool05SOL => 0.5,
            Denomination::Pool1SOL => 1.0,
            Denomination::Pool5SOL => 5.0,
            Denomination::Pool10SOL => 10.0,
        }
    }

    /// Convert pool_id to Denomination
    pub fn from_id(pool_id: u8) -> Result<Self> {
        match pool_id {
            0 => Ok(Denomination::Pool01SOL),
            1 => Ok(Denomination::Pool05SOL),
            2 => Ok(Denomination::Pool1SOL),
            3 => Ok(Denomination::Pool5SOL),
            4 => Ok(Denomination::Pool10SOL),
            _ => Err(ErrorCode::InvalidDenomination.into()),
        }
    }

    /// Get pool_id from Denomination
    pub fn to_id(&self) -> u8 {
        *self as u8
    }
}

/// Denomination Pool Account
/// Stores pool-specific data for a fixed denomination
#[account]
pub struct DenominationPool {
    /// Pool ID (0-4)
    pub pool_id: u8,

    /// Fixed amount for this pool (in lamports)
    pub amount: u64,

    /// Number of active deposits in this pool (anonymity set size)
    pub deposit_count: u64,

    /// Number of successful claims from this pool
    pub claim_count: u64,

    /// Total SOL deposited to this pool (all time)
    pub total_deposited: u64,

    /// Total SOL claimed from this pool (all time)
    pub total_claimed: u64,

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl DenominationPool {
    /// Size for account allocation
    pub const LEN: usize = 8 + // discriminator
        1 + // pool_id
        8 + // amount
        8 + // deposit_count
        8 + // claim_count
        8 + // total_deposited
        8 + // total_claimed
        1;  // bump

    /// Initialize a new denomination pool
    pub fn initialize(&mut self, pool_id: u8, bump: u8) -> Result<()> {
        let denomination = Denomination::from_id(pool_id)?;

        self.pool_id = pool_id;
        self.amount = denomination.amount_lamports();
        self.deposit_count = 0;
        self.claim_count = 0;
        self.total_deposited = 0;
        self.total_claimed = 0;
        self.bump = bump;

        Ok(())
    }

    /// Record a new deposit to this pool
    pub fn record_deposit(&mut self) -> Result<()> {
        self.deposit_count = self.deposit_count.checked_add(1)
            .ok_or(ErrorCode::Overflow)?;
        self.total_deposited = self.total_deposited.checked_add(self.amount)
            .ok_or(ErrorCode::Overflow)?;
        Ok(())
    }

    /// Record a successful claim from this pool
    pub fn record_claim(&mut self) -> Result<()> {
        // Deposit count can never go below 0
        require!(self.deposit_count > 0, ErrorCode::InsufficientPoolBalance);

        self.deposit_count = self.deposit_count.checked_sub(1)
            .ok_or(ErrorCode::Underflow)?;
        self.claim_count = self.claim_count.checked_add(1)
            .ok_or(ErrorCode::Overflow)?;
        self.total_claimed = self.total_claimed.checked_add(self.amount)
            .ok_or(ErrorCode::Overflow)?;
        Ok(())
    }

    /// Get anonymity set size (how many deposits are currently in pool)
    pub fn anonymity_set_size(&self) -> u64 {
        self.deposit_count
    }

    /// Get pool utilization percentage (0-100)
    pub fn utilization_rate(&self) -> u8 {
        if self.total_deposited == 0 {
            return 0;
        }
        let rate = (self.total_claimed * 100) / self.total_deposited;
        rate.min(100) as u8
    }
}

/// Derive Denomination Pool PDA address
pub fn derive_denomination_pool_address(pool_id: u8, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"denomination_pool",
            &[pool_id],
        ],
        program_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_denomination_amounts() {
        assert_eq!(Denomination::Pool01SOL.amount_lamports(), 100_000_000);
        assert_eq!(Denomination::Pool05SOL.amount_lamports(), 500_000_000);
        assert_eq!(Denomination::Pool1SOL.amount_lamports(), 1_000_000_000);
        assert_eq!(Denomination::Pool5SOL.amount_lamports(), 5_000_000_000);
        assert_eq!(Denomination::Pool10SOL.amount_lamports(), 10_000_000_000);
    }

    #[test]
    fn test_denomination_from_id() {
        assert_eq!(Denomination::from_id(0).unwrap(), Denomination::Pool01SOL);
        assert_eq!(Denomination::from_id(1).unwrap(), Denomination::Pool05SOL);
        assert_eq!(Denomination::from_id(2).unwrap(), Denomination::Pool1SOL);
        assert_eq!(Denomination::from_id(3).unwrap(), Denomination::Pool5SOL);
        assert_eq!(Denomination::from_id(4).unwrap(), Denomination::Pool10SOL);
        assert!(Denomination::from_id(5).is_err());
    }

    #[test]
    fn test_pool_stats() {
        let mut pool = DenominationPool {
            pool_id: 1,
            amount: 500_000_000,
            deposit_count: 0,
            claim_count: 0,
            total_deposited: 0,
            total_claimed: 0,
            bump: 255,
        };

        // Record deposits
        pool.record_deposit().unwrap();
        pool.record_deposit().unwrap();
        pool.record_deposit().unwrap();

        assert_eq!(pool.deposit_count, 3);
        assert_eq!(pool.total_deposited, 1_500_000_000); // 3 * 0.5 SOL
        assert_eq!(pool.anonymity_set_size(), 3);

        // Record claim
        pool.record_claim().unwrap();

        assert_eq!(pool.deposit_count, 2); // One claimed
        assert_eq!(pool.claim_count, 1);
        assert_eq!(pool.total_claimed, 500_000_000);
        assert_eq!(pool.utilization_rate(), 33); // 33% claimed
    }
}
