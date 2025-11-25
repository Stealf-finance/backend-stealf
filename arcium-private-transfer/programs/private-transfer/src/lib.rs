use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_ENCRYPTED_TRANSFER: u32 = comp_def_offset("encrypted_transfer");
const CLUSTER_OFFSET: u64 = 768109697;

declare_id!("9iLVPsyFbARWtNex6SetuE1JD7xyXPxV3Y9paMJ7MFAh");

#[arcium_program]
pub mod arcium_private_transfer {
    use super::*;

    pub fn init_encrypted_transfer_comp_def(
        ctx: Context<InitEncryptedTransferCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    pub fn encrypted_transfer(
        ctx: Context<EncryptedTransfer>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        encrypted_timestamp: [u8; 32],
        sender_pubkey: [u8; 32],
        nonce: u128,
        recipient: Pubkey,
    ) -> Result<()> {
        let transfer_account = &mut ctx.accounts.transfer_account;
        transfer_account.sender = ctx.accounts.payer.key();
        transfer_account.recipient = recipient;
        transfer_account.encrypted_amount = encrypted_amount;
        transfer_account.nonce = nonce;
        transfer_account.sender_pubkey = sender_pubkey;
        transfer_account.timestamp = Clock::get()?.unix_timestamp;
        transfer_account.bump = ctx.bumps.transfer_account;

        let args = vec![
            Argument::ArcisPubkey(sender_pubkey),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_amount),
            Argument::EncryptedU64(encrypted_timestamp),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![EncryptedTransferCallback::callback_ix(&[])],
            0,
        )?;

        msg!("Encrypted transfer queued");
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "encrypted_transfer")]
    pub fn encrypted_transfer_callback(
        ctx: Context<EncryptedTransferCallback>,
        output: ComputationOutputs<EncryptedTransferOutput>,
    ) -> Result<()> {
        let result = match output {
            ComputationOutputs::Success(r) => r,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        let amount_bytes = result.field_0.ciphertexts[0];
        let amount = u64::from_le_bytes(amount_bytes[..8].try_into().unwrap());
        msg!("Transfer verified: {} lamports", amount);
        Ok(())
    }
}

#[account]
pub struct TransferAccount {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub encrypted_amount: [u8; 32],
    pub nonce: u128,
    pub sender_pubkey: [u8; 32],
    pub timestamp: i64,
    pub bump: u8,
}

impl TransferAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 16 + 32 + 8 + 1;
}

#[init_computation_definition_accounts("encrypted_transfer", payer)]
#[derive(Accounts)]
pub struct InitEncryptedTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account created via CPI
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("encrypted_transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct EncryptedTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPTED_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ComputationFailed))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        init,
        payer = payer,
        space = TransferAccount::SIZE,
        seeds = [b"transfer", payer.key().as_ref(), &computation_offset.to_le_bytes()],
        bump,
    )]
    pub transfer_account: Account<'info, TransferAccount>,
}

#[callback_accounts("encrypted_transfer")]
#[derive(Accounts)]
pub struct EncryptedTransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPTED_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("MPC computation failed")]
    ComputationFailed,
}
