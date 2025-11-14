use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

const COMP_DEF_OFFSET_LINK_WALLETS: u32 = comp_def_offset("link_wallets");

declare_id!("A26JcC1bfDZ1wV5Vkdo4rrwDcUzorjT55a6RGp7bAfzx");

#[arcium_program]
pub mod private_wallet {
    use super::*;

    /// Initialize the computation definition for wallet linking
    pub fn init_link_wallets_comp_def(ctx: Context<InitLinkWalletsCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, 0, None, None)?;
        Ok(())
    }

    /// Store encrypted wallet data on-chain
    ///
    /// # Arguments
    /// * `grid_wallet_low` - Lower 128 bits of grid wallet public key (encrypted)
    /// * `grid_wallet_high` - Upper 128 bits of grid wallet public key (encrypted)
    /// * `private_wallet_low` - Lower 128 bits of private wallet public key (encrypted)
    /// * `private_wallet_high` - Upper 128 bits of private wallet public key (encrypted)
    pub fn store_encrypted_wallets(
        ctx: Context<StoreEncryptedWallets>,
        grid_wallet_low: [u8; 32],
        grid_wallet_high: [u8; 32],
        private_wallet_low: [u8; 32],
        private_wallet_high: [u8; 32],
    ) -> Result<()> {
        let encrypted_wallets = &mut ctx.accounts.encrypted_wallets;
        encrypted_wallets.grid_wallet_low = grid_wallet_low;
        encrypted_wallets.grid_wallet_high = grid_wallet_high;
        encrypted_wallets.private_wallet_low = private_wallet_low;
        encrypted_wallets.private_wallet_high = private_wallet_high;
        Ok(())
    }

    /// Re-encrypt stored wallets with a new encryption key via MPC
    ///
    /// Triggers an Arcium MPC computation that decrypts the stored wallets
    /// and re-encrypts them with the client's key. The result is emitted
    /// as a WalletsLinkedEvent.
    ///
    /// # Arguments
    /// * `computation_offset` - Unique offset for this computation
    /// * `client_pub_key` - Client's x25519 public key (for output encryption)
    /// * `client_nonce` - Client's encryption nonce (for output)
    /// * `sender_pub_key` - Original encryption public key (for input decryption)
    /// * `sender_nonce` - Original encryption nonce (for input)
    pub fn link_wallets(
        ctx: Context<LinkWallets>,
        computation_offset: u64,
        client_pub_key: [u8; 32],
        client_nonce: u128,
        sender_pub_key: [u8; 32],
        sender_nonce: u128,
    ) -> Result<()> {
        let args = vec![
            Argument::ArcisPubkey(client_pub_key),
            Argument::PlaintextU128(client_nonce),
            Argument::ArcisPubkey(sender_pub_key),
            Argument::PlaintextU128(sender_nonce),
            Argument::Account(
                ctx.accounts.encrypted_wallets.key(),
                8,
                EncryptedWallets::INIT_SPACE as u32,
            ),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![LinkWalletsCallback::callback_ix(&[])],
            1,
        )?;

        Ok(())
    }

    /// Callback handler for link_wallets MPC computation
    #[arcium_callback(encrypted_ix = "link_wallets")]
    pub fn link_wallets_callback(
        ctx: Context<LinkWalletsCallback>,
        output: ComputationOutputs<LinkWalletsOutput>,
    ) -> Result<()> {
        let pair = match output {
            ComputationOutputs::Success(LinkWalletsOutput { field_0: pair }) => pair,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(WalletsLinkedEvent {
            nonce: pair.nonce.to_le_bytes(),
            grid_wallet_low: pair.ciphertexts[0],
            grid_wallet_high: pair.ciphertexts[1],
            private_wallet_low: pair.ciphertexts[2],
            private_wallet_high: pair.ciphertexts[3],
        });

        Ok(())
    }
}
/// Stores encrypted wallet data on-chain
#[account]
#[derive(InitSpace)]
pub struct EncryptedWallets {
    pub grid_wallet_low: [u8; 32],
    pub grid_wallet_high: [u8; 32],
    pub private_wallet_low: [u8; 32],
    pub private_wallet_high: [u8; 32],
}

#[queue_computation_accounts("link_wallets", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct LinkWallets<'info> {
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

    /// CHECK: Validated by Arcium program via derive_mempool_pda!()
    #[account(mut, address = derive_mempool_pda!())]
    pub mempool_account: UncheckedAccount<'info>,

    /// CHECK: Validated by Arcium program via derive_execpool_pda!()
    #[account(mut, address = derive_execpool_pda!())]
    pub executing_pool: UncheckedAccount<'info>,

    /// CHECK: Validated by Arcium program via derive_comp_pda!()
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_LINK_WALLETS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        seeds = [b"encrypted_wallets", payer.key().as_ref()],
        bump,
    )]
    pub encrypted_wallets: Account<'info, EncryptedWallets>,
}

#[callback_accounts("link_wallets")]
#[derive(Accounts)]
pub struct LinkWalletsCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_LINK_WALLETS))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    /// CHECK: Validated by Anchor as instructions sysvar
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct StoreEncryptedWallets<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + EncryptedWallets::INIT_SPACE,
        seeds = [b"encrypted_wallets", payer.key().as_ref()],
        bump,
    )]
    pub encrypted_wallets: Account<'info, EncryptedWallets>,

    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("link_wallets", payer)]
#[derive(Accounts)]
pub struct InitLinkWalletsCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Initialized by Arcium program
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct WalletsLinkedEvent {
    pub nonce: [u8; 16],
    pub grid_wallet_low: [u8; 32],
    pub grid_wallet_high: [u8; 32],
    pub private_wallet_low: [u8; 32],
    pub private_wallet_high: [u8; 32],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Computation aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
