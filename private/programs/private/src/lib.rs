use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource, CallbackAccount};

const SHIELD_COMP_DEF_OFFSET: u32 = comp_def_offset("shield");
const ANONYMOUS_TRANSFER_COMP_DEF_OFFSET: u32 = comp_def_offset("anonymous_transfer");
const UNSHIELD_COMP_DEF_OFFSET: u32 = comp_def_offset("unshield");
const UNSHIELD_V2_COMP_DEF_OFFSET: u32 = comp_def_offset("unshield_v2");

declare_id!("AobX7Y7KRkNEqv38R7HnyWKEPCsTw366g54xU9xWDiEX");

#[arcium_program]
pub mod private {
    use super::*;

    /// Initialize computation definition for shield operation
    pub fn init_shield_comp_def(ctx: Context<InitShieldCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            true,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://files.catbox.moe/eisvh9.arcis".to_string(),
                hash: [0; 32],
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize computation definition for anonymous transfer
    pub fn init_anonymous_transfer_comp_def(ctx: Context<InitAnonymousTransferCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            true,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://files.catbox.moe/4wncjr.arcis".to_string(),
                hash: [0; 32],
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize computation definition for unshield v1
    pub fn init_unshield_comp_def(ctx: Context<InitUnshieldCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            true,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://files.catbox.moe/ub7kas.arcis".to_string(),
                hash: [0; 32],
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize computation definition for unshield v2
    pub fn init_unshield_v2_comp_def(ctx: Context<InitUnshieldV2CompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            true,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://files.catbox.moe/8mprev.arcis".to_string(),
                hash: [0; 32],
            })),
            None,
        )?;
        Ok(())
    }

    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.encrypted_total = vec![];
        pool.commitments = vec![];
        pool.nullifiers = vec![];
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn shield(
        ctx: Context<Shield>,
        computation_offset: u64,
        pub_key: [u8; 32],
        nonce: u128,
        encrypted_amount: [u8; 32],
        encrypted_secret: [u8; 32],
    ) -> Result<()> {
        const FIXED_AMOUNT: u64 = 50_000_000; // 0.05 SOL

        // Transfer SOL to pool vault
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &ctx.accounts.pool_vault.key(),
            FIXED_AMOUNT,
        );

        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_amount),
            Argument::EncryptedU64(encrypted_secret),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ShieldCallback::callback_ix(&[])],
        )?;

        Ok(())
    }

    pub fn anonymous_transfer(
        ctx: Context<AnonymousTransfer>,
        computation_offset: u64,
        pub_key: [u8; 32],
        nonce: u128,
        encrypted_sender_secret: [u8; 32],
        encrypted_amount: [u8; 32],
        encrypted_receiver_secret: [u8; 32],
    ) -> Result<()> {
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_sender_secret),
            Argument::EncryptedU64(encrypted_amount),
            Argument::EncryptedU64(encrypted_receiver_secret),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![AnonymousTransferCallback::callback_ix(&[])],
        )?;

        Ok(())
    }

    pub fn unshield_v2(
        ctx: Context<UnshieldV2>,
        computation_offset: u64,
        amount: u64,
        recipient: Pubkey,
        pub_key: [u8; 32],
        nonce: u128,
        encrypted_secret: [u8; 32],
    ) -> Result<()> {
        const FIXED_AMOUNT: u64 = 50_000_000; 

        require!(!ctx.accounts.user_commitment_account.spent, ErrorCode::CommitmentAlreadySpent);
        require!(amount == FIXED_AMOUNT, ErrorCode::InvalidAmount);

        ctx.accounts.user_commitment_account.amount = amount;
        ctx.accounts.user_commitment_account.recipient = recipient;
        ctx.accounts.pool_vault.bump = ctx.bumps.pool_vault;

        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_secret),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let pool_vault_key = ctx.accounts.pool_vault.key();
        let user_commitment_key = ctx.accounts.user_commitment_account.key();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![UnshieldV2Callback::callback_ix(&[
                CallbackAccount {
                    pubkey: pool_vault_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: user_commitment_key,
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: recipient,
                    is_writable: true,
                },
            ])],
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "shield")]
    pub fn shield_callback(
        ctx: Context<ShieldCallback>,
        output: ComputationOutputs<ShieldOutput>,
    ) -> Result<()> {
        msg!("Shield callback received");
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "anonymous_transfer")]
    pub fn anonymous_transfer_callback(
        ctx: Context<AnonymousTransferCallback>,
        output: ComputationOutputs<AnonymousTransferOutput>,
    ) -> Result<()> {
        msg!("Anonymous transfer callback received");
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "unshield_v2")]
    pub fn unshield_v2_callback(
        ctx: Context<UnshieldV2Callback>,
        output: ComputationOutputs<UnshieldV2Output>,
    ) -> Result<()> {
        let _result = match output {
            ComputationOutputs::Success(result) => result,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        let amount = ctx.accounts.user_commitment_account.amount;
        let vault_balance = ctx.accounts.pool_vault.to_account_info().lamports();

        require!(vault_balance >= amount, ErrorCode::InsufficientFunds);

        let bump = ctx.accounts.pool_vault.bump;
        let seeds = &[b"pool_vault".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.pool_vault.key(),
            &ctx.accounts.recipient.key(),
            amount,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
            ],
            signer_seeds,
        )?;

        ctx.accounts.user_commitment_account.spent = true;

        Ok(())
    }
}

#[account]
pub struct ShieldedPool {
    pub encrypted_total: Vec<u8>,
    pub commitments: Vec<[u8; 32]>,
    pub nullifiers: Vec<[u8; 32]>,
    pub bump: u8,
}

impl Space for ShieldedPool {
    const INIT_SPACE: usize = 4 + 256 + 4 + (32 * 100) + 4 + (32 * 100) + 1;
}

#[account]
pub struct PoolVault {
    pub bump: u8,
}

impl Space for PoolVault {
    const INIT_SPACE: usize = 1;
}

#[account]
pub struct UserCommitmentAccount {
    pub encrypted_commitment: [u8; 32],
    pub nonce: u128,
    pub encryption_pubkey: [u8; 32],
    pub spent: bool,
    pub owner: Pubkey,
    pub amount: u64,
    pub recipient: Pubkey,
}

impl Space for UserCommitmentAccount {
    const INIT_SPACE: usize = 153;
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ShieldedPool::INIT_SPACE,
        seeds = [b"shielded_pool"],
        bump
    )]
    pub pool: Account<'info, ShieldedPool>,

    pub system_program: Program<'info, System>,
}


#[queue_computation_accounts("shield", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Shield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(SHIELD_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PoolVault::INIT_SPACE,
        seeds = [b"pool_vault"],
        bump,
    )]
    pub pool_vault: Account<'info, PoolVault>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UserCommitmentAccount::INIT_SPACE,
        seeds = [b"user_commitment", payer.key().as_ref()],
        bump,
    )]
    pub user_commitment_account: Account<'info, UserCommitmentAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("anonymous_transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct AnonymousTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(ANONYMOUS_TRANSFER_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("unshield_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct UnshieldV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(UNSHIELD_V2_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    #[account(
        mut,
        seeds = [b"pool_vault"],
        bump,
    )]
    pub pool_vault: Account<'info, PoolVault>,

    #[account(
        mut,
        seeds = [b"user_commitment", payer.key().as_ref()],
        bump,
    )]
    pub user_commitment_account: Account<'info, UserCommitmentAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[init_computation_definition_accounts("shield", payer)]
#[derive(Accounts)]
pub struct InitShieldCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("anonymous_transfer", payer)]
#[derive(Accounts)]
pub struct InitAnonymousTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("unshield", payer)]
#[derive(Accounts)]
pub struct InitUnshieldCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("unshield_v2", payer)]
#[derive(Accounts)]
pub struct InitUnshieldV2CompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[callback_accounts("shield")]
#[derive(Accounts)]
pub struct ShieldCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(SHIELD_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("anonymous_transfer")]
#[derive(Accounts)]
pub struct AnonymousTransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(ANONYMOUS_TRANSFER_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[callback_accounts("unshield_v2")]
#[derive(Accounts)]
pub struct UnshieldV2Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(UNSHIELD_V2_COMP_DEF_OFFSET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub pool_vault: Account<'info, PoolVault>,

    #[account(mut)]
    pub user_commitment_account: Account<'info, UserCommitmentAccount>,

    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Computation failed or aborted")]
    ComputationFailed,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Commitment already spent")]
    CommitmentAlreadySpent,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient funds in pool vault")]
    InsufficientFunds,
}
