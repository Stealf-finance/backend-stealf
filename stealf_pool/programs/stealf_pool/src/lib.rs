use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("55RNcHf6ktm89ko4vraLGHhdkAvpuykzKP2Kosyci62E");

#[program]
pub mod stealf_pool {
    use super::*;

    /// Initialize the privacy pool
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.total_deposits = 0;
        pool.total_withdrawals = 0;
        pool.bump = ctx.bumps.pool;
        msg!("Privacy pool initialized");
        Ok(())
    }

    /// Deposit SOL into the privacy pool
    /// The sender's identity is recorded but will be "mixed" with other deposits
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, PoolError::InvalidAmount);

        // Transfer SOL from user to pool PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.sender.to_account_info(),
                    to: ctx.accounts.pool.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update pool stats
        let pool = &mut ctx.accounts.pool;
        pool.total_deposits = pool.total_deposits.checked_add(amount).unwrap();

        msg!("Deposited {} lamports into privacy pool", amount);

        // Emit event for indexing (but receiver is not known yet!)
        emit!(DepositEvent {
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Withdraw SOL from the privacy pool to a recipient
    /// Only the pool authority (backend) can trigger withdrawals
    /// This breaks the on-chain link between sender and receiver
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, PoolError::InvalidAmount);

        let pool = &ctx.accounts.pool;
        let pool_balance = pool.to_account_info().lamports();

        // Keep minimum rent-exempt balance
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(Pool::LEN);
        require!(
            pool_balance.saturating_sub(amount) >= min_balance,
            PoolError::InsufficientPoolBalance
        );

        // Transfer SOL from pool PDA to recipient using invoke_signed
        **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

        // Update pool stats
        let pool = &mut ctx.accounts.pool;
        pool.total_withdrawals = pool.total_withdrawals.checked_add(amount).unwrap();

        msg!("Withdrew {} lamports from privacy pool to {}", amount, ctx.accounts.recipient.key());

        // Emit event (no link to original depositor!)
        emit!(WithdrawEvent {
            recipient: ctx.accounts.recipient.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::LEN,
        seeds = [b"privacy_pool"],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"privacy_pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"privacy_pool"],
        bump = pool.bump,
        has_one = authority
    )]
    pub pool: Account<'info, Pool>,

    /// The backend authority that controls withdrawals
    pub authority: Signer<'info>,

    /// CHECK: Any account can receive SOL
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Pool {
    pub authority: Pubkey,      // Backend wallet that controls withdrawals
    pub total_deposits: u64,    // Total SOL deposited
    pub total_withdrawals: u64, // Total SOL withdrawn
    pub bump: u8,               // PDA bump
}

impl Pool {
    pub const LEN: usize = 32 + 8 + 8 + 1; // authority + deposits + withdrawals + bump
}

#[event]
pub struct DepositEvent {
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawEvent {
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum PoolError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient pool balance")]
    InsufficientPoolBalance,
}
