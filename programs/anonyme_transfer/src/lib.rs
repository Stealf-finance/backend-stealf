use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};

const COMP_DEF_OFFSET_ENCRYPT: u32 = comp_def_offset("encrypt_pda_address");
const COMP_DEF_OFFSET_DECRYPT: u32 = comp_def_offset("decrypt_pda_address");

declare_id!("A26JcC1bfDZ1wV5Vkdo4rrwDcUzorjT55a6RGp7bAfzx");

#[arcium_program]
pub mod anonyme_transfer {
    use super::*;

    pub fn init_encrypt_pda_comp_def(ctx: Context<InitEncryptPdaCompDef>) -> Result<()> {
        // TODO: Upload encrypt_pda_address_testnet.arcis to public storage and replace URL
        init_comp_def(
            ctx.accounts,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://adxlhblyyxeugiuqjgxp.supabase.co/storage/v1/object/public/arcium-circuits/encrypt_pda_address_testnet.arcis".to_string(),
                hash: [0; 32], // Hash verification not enforced yet
            })),
            None,
        )?;
        Ok(())
    }

    pub fn encrypt_pda(
        ctx: Context<EncryptPda>,
        computation_offset: u64,
        ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU8(ciphertext),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![EncryptPdaAddressCallback::callback_ix(&[])],
            1,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "encrypt_pda_address")]
    pub fn encrypt_pda_address_callback(
        ctx: Context<EncryptPdaAddressCallback>,
        output: ComputationOutputs<EncryptPdaAddressOutput>,
    ) -> Result<()> {
        let o = match output {
            ComputationOutputs::Success(EncryptPdaAddressOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(EncryptedPdaEvent {
            encrypted_address: o.ciphertexts[0],
            nonce: o.nonce.to_le_bytes(),
        });
        Ok(())
    }

    pub fn store_encrypted_address(
        ctx: Context<StoreEncryptedAddress>,
        encrypted_pda_address: [u8; 32],
    ) -> Result<()> {
        let storage = &mut ctx.accounts.smart_account_storage;

        storage.owner = ctx.accounts.owner.key();
        storage.smart_account = ctx.accounts.smart_account.key();
        storage.encrypted_pda_address = encrypted_pda_address;
        storage.bump = ctx.bumps.smart_account_storage;

        msg!("Encrypted PDA address stored for smart account: {}", ctx.accounts.smart_account.key());

        Ok(())
    }

    pub fn init_decrypt_pda_comp_def(ctx: Context<InitDecryptPdaCompDef>) -> Result<()> {
        // TODO: Upload decrypt_pda_address_testnet.arcis to public storage and replace URL
        init_comp_def(
            ctx.accounts,
            0,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://adxlhblyyxeugiuqjgxp.supabase.co/storage/v1/object/public/arcium-circuits/decrypt_pda_address_testnet.arcis".to_string(),
                hash: [0; 32], // Hash verification not enforced yet
            })),
            None,
        )?;
        Ok(())
    }

    pub fn decrypt_pda(
        ctx: Context<DecryptPda>,
        computation_offset: u64,
        ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU8(ciphertext),
        ];

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![DecryptPdaAddressCallback::callback_ix(&[])],
            1,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "decrypt_pda_address")]
    pub fn decrypt_pda_address_callback(
        ctx: Context<DecryptPdaAddressCallback>,
        output: ComputationOutputs<DecryptPdaAddressOutput>,
    ) -> Result<()> {
        let decrypted_address = match output {
            ComputationOutputs::Success(DecryptPdaAddressOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(DecryptedPdaEvent {
            decrypted_address,
        });
        Ok(())
    }

}

#[queue_computation_accounts("encrypt_pda_address", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct EncryptPda<'info> {
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
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("encrypt_pda_address")]
#[derive(Accounts)]
pub struct EncryptPdaAddressCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_ENCRYPT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("encrypt_pda_address", payer)]
#[derive(Accounts)]
pub struct InitEncryptPdaCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}


#[queue_computation_accounts("decrypt_pda_address", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DecryptPda<'info> {
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
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!()
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_DECRYPT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("decrypt_pda_address")]
#[derive(Accounts)]
pub struct DecryptPdaAddressCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_DECRYPT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("decrypt_pda_address", payer)]
#[derive(Accounts)]
pub struct InitDecryptPdaCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StoreEncryptedAddress<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 1,
        seeds = [b"smart_account_storage", smart_account.key().as_ref()],
        bump
    )]
    pub smart_account_storage: Account<'info, SmartAccountStorage>,

    /// CHECK: Smart Account Grid address, used as seed for PDA derivation
    pub smart_account: AccountInfo<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[event]
pub struct EncryptedPdaEvent {
    pub encrypted_address: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct DecryptedPdaEvent {
    pub decrypted_address: [u8; 32],
}

#[account]
pub struct SmartAccountStorage {
    pub owner: Pubkey,
    pub smart_account: Pubkey,
    pub encrypted_pda_address: [u8; 32],
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
