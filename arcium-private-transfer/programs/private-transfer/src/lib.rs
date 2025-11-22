use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};

// Computation definition offset for encrypted_transfer
const COMP_DEF_OFFSET_ENCRYPTED_TRANSFER: u32 = comp_def_offset("encrypted_transfer");

declare_id!("G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp");

/// Arcium Private Transfer Program
///
/// Provides encrypted private transfers using Arcium MPC.
/// Amounts are encrypted and never revealed on-chain.
#[arcium_program]
pub mod arcium_private_transfer {
    use super::*;

    /// Initialize the computation definition for encrypted transfers
    pub fn init_encrypted_transfer_comp_def(
        ctx: Context<InitEncryptedTransferCompDef>
    ) -> Result<()> {
        // Use OffChain circuit source to avoid uploading 2.5MB circuit on-chain
        // Circuit file hash: bb93e9026fc505903f436f9986a76b628dd61c9b23f5df3c467a4ef7d085fff6
        init_comp_def(
            ctx.accounts,
            0,     // Compute units (0 = use default)
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://cold-pumas-reply.loca.lt/encrypted_transfer.arcis".to_string(),
                hash: [0; 32], // Hash verification not enforced yet in v0.4.0
            })),
            None,  // No finalize authority
        )?;
        Ok(())
    }

    /// Execute an encrypted private transfer
    ///
    /// The amount is encrypted client-side and processed by Arcium MPC.
    /// The blockchain only sees encrypted values.
    pub fn encrypted_transfer(
        ctx: Context<EncryptedTransfer>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],
        encrypted_timestamp: [u8; 32],
        sender_pubkey: [u8; 32],
        nonce: u128,
        recipient: Pubkey,
    ) -> Result<()> {
        // Build arguments for the encrypted instruction
        let args = vec![
            Argument::ArcisPubkey(sender_pubkey),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_amount),
            Argument::EncryptedU64(encrypted_timestamp),
        ];

        // Set sign PDA bump (required by Arcium v0.3.0)
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Store transfer metadata in transfer account
        let transfer_account = &mut ctx.accounts.transfer_account;
        transfer_account.sender = ctx.accounts.sender.key();
        transfer_account.recipient = recipient;
        transfer_account.encrypted_amount = encrypted_amount;
        transfer_account.nonce = nonce.to_le_bytes();
        transfer_account.sender_pubkey = sender_pubkey;
        transfer_account.timestamp = Clock::get()?.unix_timestamp;
        transfer_account.status = TransferStatus::Pending;

        // Queue computation to Arcium
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None, // No callback server needed (result fits in transaction)
            vec![EncryptedTransferCallback::callback_ix(&[])],
            1, // num_callback_txs: number of transactions needed for callback
        )?;

        msg!("Encrypted transfer queued - Amount hidden via MPC");
        Ok(())
    }

    /// Callback function executed after MPC computation
    #[arcium_callback(encrypted_ix = "encrypted_transfer")]
    pub fn encrypted_transfer_callback(
        ctx: Context<EncryptedTransferCallback>,
        output: ComputationOutputs<EncryptedTransferOutput>,
    ) -> Result<()> {
        // Extract encrypted result from computation
        let result = match output {
            ComputationOutputs::Success(EncryptedTransferOutput { field_0 }) => field_0,
            _ => {
                return Err(ErrorCode::ComputationAborted.into());
            }
        };

        // Update transfer account with encrypted result
        let transfer_account = &mut ctx.accounts.transfer_account;
        transfer_account.encrypted_result_amount = result.ciphertexts[0];
        transfer_account.result_nonce = result.nonce.to_le_bytes();
        transfer_account.result_encryption_key = result.encryption_key;
        transfer_account.status = TransferStatus::Completed;

        // Emit event with encrypted data (recipient can decrypt)
        emit!(EncryptedTransferEvent {
            sender: transfer_account.sender,
            recipient: transfer_account.recipient,
            encrypted_amount: result.ciphertexts[0],
            nonce: result.nonce.to_le_bytes(),
            encryption_key: result.encryption_key,
            timestamp: transfer_account.timestamp,
        });

        msg!("Encrypted transfer completed - Result stored");
        Ok(())
    }
}

/// Transfer account storing encrypted transfer data
#[account]
#[derive(InitSpace)]
pub struct TransferAccount {
    pub sender: Pubkey,                       // 32 bytes
    pub recipient: Pubkey,                    // 32 bytes
    pub encrypted_amount: [u8; 32],           // 32 bytes (encrypted)
    pub nonce: [u8; 16],                      // 16 bytes
    pub sender_pubkey: [u8; 32],              // 32 bytes (x25519)
    pub timestamp: i64,                       // 8 bytes
    pub status: TransferStatus,               // 1 byte
    pub encrypted_result_amount: [u8; 32],    // 32 bytes (from callback)
    pub result_nonce: [u8; 16],               // 16 bytes
    pub result_encryption_key: [u8; 32],      // 32 bytes
}

/// Transfer status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TransferStatus {
    Pending,
    Completed,
    Failed,
}

/// Initialize computation definition accounts
#[init_computation_definition_accounts("encrypted_transfer", payer)]
#[derive(Accounts)]
pub struct InitEncryptedTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Encrypted transfer instruction accounts
#[queue_computation_accounts("encrypted_transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct EncryptedTransfer<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + TransferAccount::INIT_SPACE,
        seeds = [b"transfer", sender.key().as_ref(), &computation_offset.to_le_bytes()],
        bump
    )]
    pub transfer_account: Account<'info, TransferAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!()
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool_account, checked by the arcium program
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool, checked by the arcium program
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account, checked by the arcium program
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPTED_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut)]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

/// Callback accounts for encrypted transfer
#[callback_accounts("encrypted_transfer")]
#[derive(Accounts)]
pub struct EncryptedTransferCallback<'info> {
    // Standard callback accounts
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPTED_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    /// CHECK: instructions_sysvar, checked by constraint
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom accounts
    #[account(mut)]
    pub transfer_account: Account<'info, TransferAccount>,
}

/// Event emitted when encrypted transfer is completed
#[event]
pub struct EncryptedTransferEvent {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub encrypted_amount: [u8; 32],
    pub nonce: [u8; 16],
    pub encryption_key: [u8; 32],
    pub timestamp: i64,
}

/// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Computation was aborted")]
    ComputationAborted,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
