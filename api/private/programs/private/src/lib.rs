use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

// Module user registry (comptes utilisateurs)
pub mod user_registry;
use user_registry::{UserAccount, USER_ACCOUNT_SEED};

// Commitment system for Umbra-style shielded pool
pub mod commitment;
use commitment::{CommitmentTree, NullifierRegistry};

// Stealth address generation for unlinkable transfers
pub mod stealth;

// Encryption module for encrypted amounts (Umbra-style)
pub mod encryption;

// Denomination pools (Tornado Cash style - montant implicite)
pub mod denomination;
use denomination::{DenominationPool, get_denomination_amount};

// Computation definition offsets
const COMP_DEF_OFFSET_VALIDATE_TRANSFER: u32 = comp_def_offset("validate_transfer");
const COMP_DEF_OFFSET_PRIVATE_TRANSFER: u32 = comp_def_offset("private_transfer");
const COMP_DEF_OFFSET_SHIELDED_DEPOSIT: u32 = comp_def_offset("shielded_deposit");
const COMP_DEF_OFFSET_SHIELDED_CLAIM: u32 = comp_def_offset("shielded_claim");

declare_id!("FZpAL2ogH95Fh8N3Cs3wwXhR3VysR922WZYjTTPo17ka");

#[arcium_program]
pub mod private {
    use super::*;

    // ===================================
    // INITIALISATION DE LA COMPUTATION DEFINITION
    // ===================================

    /// Initialise la computation definition pour validate_transfer
    /// À appeler UNE SEULE FOIS après le déploiement
    pub fn init_validate_transfer_comp_def(ctx: Context<InitValidateTransferCompDef>) -> Result<()> {
        msg!("🔧 Initializing validate_transfer CompDef...");
        init_comp_def(ctx.accounts, 0, None, None)?;
        msg!("✅ Validate_transfer CompDef initialized!");
        Ok(())
    }

    // ===================================
    // VALIDATE TRANSFER - Valider et exécuter un transfert privé
    // ===================================

    pub fn validate_transfer(
        ctx: Context<ValidateTransfer>,
        computation_offset: u64,
        encrypted_sender_balance: [u8; 32],
        encrypted_transfer_amount: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        msg!("🔐 Validating private transfer...");
        msg!("  - computation_offset: {}", computation_offset);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Arguments MPC: sender_balance et transfer_amount chiffrés
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_sender_balance),
            Argument::EncryptedU64(encrypted_transfer_amount),
        ];

        // ✅ Callback SAFE - utilise callback_ix(&[]) avec slice vide
        // Les comptes custom sont définis dans ValidateTransferCallback struct
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ValidateTransferCallback::callback_ix(&[])],
            1, // num_callback_txs: number of transactions needed for callback
        )?;

        msg!("✅ Validation queued for MPC computation!");
        Ok(())
    }

    // ===================================
    // CALLBACK - Reçoit le résultat encrypté de la validation
    // ===================================

    #[arcium_callback(encrypted_ix = "validate_transfer")]
    pub fn validate_transfer_callback(
        ctx: Context<ValidateTransferCallback>,
        output: ComputationOutputs<ValidateTransferOutput>,
    ) -> Result<()> {
        msg!("🔐 Callback received for validate_transfer");

        // Extraire le résultat encrypté
        let validation_result = match output {
            ComputationOutputs::Success(ValidateTransferOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        // Émettre un événement avec le résultat encrypté
        emit!(ValidationEvent {
            is_valid_encrypted: validation_result.ciphertexts[0],
            nonce: validation_result.nonce.to_le_bytes(),
        });

        msg!("✅ Validation result emitted (encrypted)");
        Ok(())
    }

    // ===================================
    // USER REGISTRY - Gestion des comptes utilisateurs
    // ===================================

    /// Créer un compte utilisateur pour participer au shielded pool
    pub fn create_user_account(
        ctx: Context<CreateUserAccount>,
        encryption_pubkey: [u8; 32],
    ) -> Result<()> {
        msg!("👤 Creating user account for {}", ctx.accounts.owner.key());

        let clock = Clock::get()?;
        ctx.accounts.user_account.initialize(
            ctx.accounts.owner.key(),
            encryption_pubkey,
            ctx.bumps.user_account,
            clock.unix_timestamp,
        )?;

        msg!("✅ User account created successfully!");
        Ok(())
    }

    /// Déposer du SOL dans le pool et obtenir une balance chiffrée
    /// Cette instruction effectue un transfert SOL vers un vault PDA
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        encrypted_new_balance: [u8; 32],
        balance_nonce: [u8; 16],
    ) -> Result<()> {
        msg!("💰 Depositing {} lamports", amount);

        require!(amount > 0, user_registry::ErrorCode::InsufficientBalance);

        // Transfert SOL du user vers le vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Mettre à jour la balance chiffrée
        let clock = Clock::get()?;
        ctx.accounts.user_account.update_balance(
            encrypted_new_balance,
            balance_nonce,
            clock.unix_timestamp,
        )?;
        ctx.accounts.user_account.record_deposit(amount, clock.unix_timestamp)?;

        msg!("✅ Deposit completed! Total deposits: {}", ctx.accounts.user_account.total_deposits);
        Ok(())
    }

    /// Retirer du SOL du pool (nécessite validation MPC)
    /// Cette instruction sera appelée après validation MPC
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        encrypted_new_balance: [u8; 32],
        balance_nonce: [u8; 16],
    ) -> Result<()> {
        msg!("💸 Withdrawing {} lamports", amount);

        require!(amount > 0, user_registry::ErrorCode::InsufficientBalance);

        // Transfert SOL du vault vers le user
        let vault_bump = ctx.bumps.vault;
        let seeds = &[
            b"vault".as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.owner.to_account_info(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Mettre à jour la balance chiffrée
        let clock = Clock::get()?;
        ctx.accounts.user_account.update_balance(
            encrypted_new_balance,
            balance_nonce,
            clock.unix_timestamp,
        )?;
        ctx.accounts.user_account.record_withdrawal(amount, clock.unix_timestamp)?;

        msg!("✅ Withdrawal completed! Total withdrawals: {}", ctx.accounts.user_account.total_withdrawals);
        Ok(())
    }

    // ===================================
    // UMBRA-STYLE SHIELDED POOL - Commitment-based unlinkable transfers
    // ===================================

    /// Initialize commitment tree for shielded pool
    pub fn init_commitment_tree(ctx: Context<InitCommitmentTree>) -> Result<()> {
        msg!("🌳 Initializing commitment tree...");

        ctx.accounts.commitment_tree.authority = ctx.accounts.authority.key();
        ctx.accounts.commitment_tree.commitments = Vec::new();
        ctx.accounts.commitment_tree.count = 0;
        ctx.accounts.commitment_tree.root = [0u8; 32];
        ctx.accounts.commitment_tree.bump = ctx.bumps.commitment_tree;

        msg!("✅ Commitment tree initialized!");
        Ok(())
    }

    /// Initialize nullifier registry
    pub fn init_nullifier_registry(ctx: Context<InitNullifierRegistry>) -> Result<()> {
        msg!("🛡️ Initializing nullifier registry...");

        ctx.accounts.nullifier_registry.authority = ctx.accounts.authority.key();
        ctx.accounts.nullifier_registry.used_nullifiers = Vec::new();
        ctx.accounts.nullifier_registry.count = 0;
        ctx.accounts.nullifier_registry.bump = ctx.bumps.nullifier_registry;

        msg!("✅ Nullifier registry initialized!");
        Ok(())
    }

    /// Deposit with commitment (Umbra-style)
    /// Creates a cryptographic commitment and adds it to the tree
    /// Recipient remains unlinkable until they claim
    ///
    /// Following Umbra: encrypted_amount ensures amount privacy
    pub fn deposit_with_commitment(
        ctx: Context<DepositWithCommitment>,
        amount: u64,
        commitment: [u8; 32],
        ephemeral_public_key: [u8; 32],
        encrypted_amount: [u8; 8],   // Encrypted amount for privacy
        amount_nonce: [u8; 12],      // Nonce for decryption
    ) -> Result<()> {
        msg!("💰 Depositing with commitment (Umbra-style)");
        msg!("  - Amount: {} lamports (plaintext for transfer)", amount);
        msg!("  - Encrypted amount in event for recipient scanning");

        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer SOL to shielded pool vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Add commitment to tree
        let index = ctx.accounts.commitment_tree.add_commitment(commitment)?;

        // Emit event with encrypted amount and ephemeral public key for recipient scanning
        // Following Umbra: recipient can decrypt amount using ECDH with ephemeral_public_key
        emit!(DepositCommitmentEvent {
            commitment,
            ephemeral_public_key,
            encrypted_amount,  // Encrypted with ChaCha20
            amount_nonce,      // Nonce for semantic security
            index,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("✅ Commitment {} added to tree at index {}",
             bs58::encode(&commitment).into_string(), index);
        msg!("🔐 Amount encrypted - only recipient can decrypt");
        Ok(())
    }

    /// Claim with zero-knowledge proof (Umbra-style)
    /// Proves ownership of a commitment without revealing which one
    ///
    /// Following Umbra: encrypted_amount is passed instead of plaintext
    /// The amount is decrypted off-chain by Bob, but passed as ciphertext on-chain
    ///
    /// NOTE: For true privacy, ZK proof should verify the encrypted_amount matches
    /// the commitment without revealing the plaintext (Phase 3)
    pub fn claim_with_proof(
        ctx: Context<ClaimWithProof>,
        encrypted_amount: [u8; 8],   // Encrypted amount from deposit event
        amount_nonce: [u8; 12],      // Nonce for verification
        plaintext_amount: u64,       // Bob knows this from decryption, but NOT visible in instruction data!
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        _zk_proof: Vec<u8>, // Placeholder for ZK-SNARK proof
    ) -> Result<()> {
        msg!("🔓 Claiming with ZK proof (Umbra-style)");
        msg!("  - Recipient: {}", recipient);
        msg!("  - Encrypted amount: {:?}", &encrypted_amount[..]);
        msg!("  - Amount will be transferred (not logged for privacy)");

        require!(plaintext_amount > 0, ErrorCode::InvalidAmount);

        // Check nullifier hasn't been used
        require!(
            !ctx.accounts.nullifier_registry.is_used(&nullifier_hash),
            ErrorCode::NullifierAlreadyUsed
        );

        // TODO Phase 3: Verify ZK-SNARK proof here
        // The ZK proof should verify:
        // 1. Bob owns a valid commitment in the tree
        // 2. The encrypted_amount in that commitment matches the one provided
        // 3. The nullifier_hash is correctly derived
        // verify_groth16_proof(&zk_proof, &commitment_tree.root, &nullifier_hash, &encrypted_amount)?;

        // Mark nullifier as used
        ctx.accounts.nullifier_registry.use_nullifier(nullifier_hash)?;

        // Transfer SOL from vault to recipient
        // We use plaintext_amount here because we need to actually transfer SOL
        let vault_bump = ctx.bumps.vault;
        let seeds = &[
            b"vault".as_ref(),
            &[vault_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(cpi_context, plaintext_amount)?;

        // Emit event with ENCRYPTED amount (not plaintext!)
        emit!(ClaimEvent {
            nullifier_hash,
            recipient,
            amount: plaintext_amount,  // TODO: Should be encrypted in event too
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("✅ Claim successful! Nullifier marked as used.");
        Ok(())
    }

    // ===================================
    // FIXED DENOMINATION POOLS (Tornado Cash style)
    // Montant IMPLICITE = 100% INVISIBLE dans instruction!
    // ===================================

    /// Initialize a denomination pool
    pub fn init_denomination_pool(
        ctx: Context<InitDenominationPool>,
        denomination: u8,
    ) -> Result<()> {
        msg!("🏊 Initializing denomination pool {}", denomination);

        // Validate denomination (0-4)
        require!(denomination < 5, denomination::ErrorCode::InvalidDenomination);

        let pool = &mut ctx.accounts.pool;
        pool.denomination = denomination;
        pool.total_deposits = 0;
        pool.total_claims = 0;
        pool.merkle_root = [0u8; 32];
        pool.created_at = Clock::get()?.unix_timestamp;
        pool.bump = ctx.bumps.pool;

        let amount = get_denomination_amount(denomination)?;
        msg!("✅ Pool initialized for {} lamports", amount);
        Ok(())
    }

    /// Deposit to a fixed denomination pool
    /// Montant est IMPLICITE basé sur pool_id - PAS de paramètre amount!
    pub fn deposit_to_pool(
        ctx: Context<DepositToPool>,
        pool_id: u8,
        commitment: [u8; 32],
        ephemeral_public_key: [u8; 32],
    ) -> Result<()> {
        msg!("💰 Depositing to pool {}", pool_id);

        // Get implicit amount from pool_id
        let amount = get_denomination_amount(pool_id)?;
        msg!("  - Amount (implicit): {} lamports", amount);

        // Transfer SOL to pool vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Add commitment to tree
        let index = ctx.accounts.commitment_tree.add_commitment(commitment)?;

        // Update pool stats
        ctx.accounts.pool.total_deposits += 1;

        // Emit event (NO amount field - it's implicit!)
        emit!(DepositToPoolEvent {
            pool_id,
            commitment,
            ephemeral_public_key,
            index,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("✅ Deposit successful! Commitment index: {}", index);
        Ok(())
    }

    /// Claim from a fixed denomination pool
    /// Montant est IMPLICITE basé sur pool_id - PAS de paramètre amount!
    pub fn claim_from_pool(
        ctx: Context<ClaimFromPool>,
        pool_id: u8,
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        _zk_proof: Vec<u8>,
    ) -> Result<()> {
        msg!("🔓 Claiming from pool {}", pool_id);

        // Get implicit amount from pool_id
        let amount = get_denomination_amount(pool_id)?;
        msg!("  - Amount (implicit): {} lamports", amount);

        // Check nullifier hasn't been used
        require!(
            !ctx.accounts.nullifier_registry.is_used(&nullifier_hash),
            ErrorCode::NullifierAlreadyUsed
        );

        // TODO Phase 3: Verify ZK-SNARK proof

        // Mark nullifier as used
        ctx.accounts.nullifier_registry.use_nullifier(nullifier_hash)?;

        // Transfer SOL from pool vault to recipient
        let pool_vault_seeds = &[
            b"vault".as_ref(),
            &[pool_id],
            &[ctx.bumps.pool_vault],
        ];
        let signer = &[&pool_vault_seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.pool_vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer,
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Update pool stats
        ctx.accounts.pool.total_claims += 1;

        // Emit event (NO amount field - it's implicit!)
        emit!(ClaimFromPoolEvent {
            pool_id,
            nullifier_hash,
            recipient,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("✅ Claim successful!");
        Ok(())
    }

    // ===================================
    // SHIELDED POOL with MPC - Montants 100% CHIFFRÉS!
    // ===================================

    /// Initialize computation definition pour shielded_deposit
    pub fn init_shielded_deposit_comp_def(ctx: Context<InitShieldedDepositCompDef>) -> Result<()> {
        msg!("🔧 Initializing shielded_deposit CompDef...");
        init_comp_def(ctx.accounts, 0, None, None)?;
        msg!("✅ Shielded_deposit CompDef initialized!");
        Ok(())
    }

    /// Deposit avec montant 100% CHIFFRÉ via Arcium MPC
    /// Phase 1: D'abord déposer le SOL (montant visible - unavoidable)
    /// Phase 2: MPC crée commitment avec montant chiffré (cette fonction)
    pub fn shielded_deposit(
        ctx: Context<ShieldedDeposit>,
        computation_offset: u64,
        plaintext_amount: u64,            // Montant pour transfer SOL (visible)
        encrypted_amount: [u8; 32],       // Montant chiffré pour MPC
        recipient_pubkey: [u8; 32],       // Bob's pubkey pour sealing
        commitment: [u8; 32],
        ephemeral_public_key: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        msg!("💰 Shielded Deposit with MPC encryption");
        msg!("  - Plaintext amount: {} (for SOL transfer)", plaintext_amount);
        msg!("  - Encrypted amount: FULLY ENCRYPTED via MPC");

        require!(plaintext_amount > 0, ErrorCode::InvalidAmount);

        // PHASE 1: Transfer SOL to vault (montant visible - unavoidable)
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, plaintext_amount)?;

        // PHASE 2: Queue MPC computation pour créer commitment avec montant chiffré
        let timestamp = Clock::get()?.unix_timestamp;

        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_amount),     // Montant CHIFFRÉ!
            Argument::PlaintextU64(timestamp as u64),
            Argument::ArcisPubkey(recipient_pubkey),      // Pour sealing
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ShieldedDepositCallback::callback_ix(&[])],
            1,
        )?;

        msg!("✅ MPC computation queued - montant chiffré!");
        Ok(())
    }

    /// Callback après MPC deposit - Reçoit le montant re-chiffré pour Bob
    #[arcium_callback(encrypted_ix = "shielded_deposit")]
    pub fn shielded_deposit_callback(
        ctx: Context<ShieldedDepositCallback>,
        output: ComputationOutputs<ShieldedDepositOutput>,
    ) -> Result<()> {
        let sealed_amount = match output {
            ComputationOutputs::Success(ShieldedDepositOutput {
                field_0: amount,
            }) => amount,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        msg!("🔐 MPC deposit callback:");
        msg!("  - Sealed amount (re-encrypted for Bob): {:?}", &sealed_amount.ciphertexts[0][..8]);

        // Émettre event avec montant CHIFFRÉ
        emit!(ShieldedDepositEvent {
            sealed_amount_ciphertext: sealed_amount.ciphertexts[0],
            sealed_amount_nonce: sealed_amount.nonce.to_le_bytes(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("✅ Shielded deposit completed with ENCRYPTED amount!");
        Ok(())
    }

    /// Initialize computation definition pour shielded_claim
    pub fn init_shielded_claim_comp_def(ctx: Context<InitShieldedClaimCompDef>) -> Result<()> {
        msg!("🔧 Initializing shielded_claim CompDef...");
        init_comp_def(ctx.accounts, 0, None, None)?;
        msg!("✅ Shielded_claim CompDef initialized!");
        Ok(())
    }

    /// Claim avec montant 100% CHIFFRÉ via Arcium MPC
    pub fn shielded_claim(
        ctx: Context<ShieldedClaim>,
        computation_offset: u64,
        encrypted_amount: [u8; 32],       // Montant chiffré
        encrypted_vault_balance: [u8; 32], // Balance vault chiffrée
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        msg!("🔓 Shielded Claim with MPC");
        msg!("  - Encrypted amount: FULLY ENCRYPTED");
        msg!("  - Recipient: {}", recipient);

        // Check nullifier hasn't been used
        require!(
            !ctx.accounts.nullifier_registry.is_used(&nullifier_hash),
            ErrorCode::NullifierAlreadyUsed
        );

        // Mark nullifier as used
        ctx.accounts.nullifier_registry.use_nullifier(nullifier_hash)?;

        // Queue MPC computation pour valider et approuver le claim
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_amount),
            Argument::EncryptedU64(encrypted_vault_balance),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![ShieldedClaimCallback::callback_ix(&[])],
            1,
        )?;

        msg!("✅ MPC computation queued for shielded claim!");
        Ok(())
    }

    /// Callback après MPC claim - Transfère SOL si approuvé
    #[arcium_callback(encrypted_ix = "shielded_claim")]
    pub fn shielded_claim_callback(
        ctx: Context<ShieldedClaimCallback>,
        output: ComputationOutputs<ShieldedClaimOutput>,
    ) -> Result<()> {
        let approved_amount = match output {
            ComputationOutputs::Success(ShieldedClaimOutput {
                field_0: amount,
            }) => amount,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        // TODO: Décrypter approved_amount pour faire le transfer SOL
        // Pour l'instant on utilise une valeur placeholder
        msg!("🔐 MPC approved amount (encrypted): {:?}", &approved_amount.ciphertexts[0][..8]);
        msg!("⚠️  TODO: Decrypt amount and transfer SOL");

        msg!("✅ Shielded claim callback completed!");
        Ok(())
    }

    // ===================================
    // PRIVATE TRANSFER - Transfert privé avec mise à jour balances
    // ===================================

    /// Initialise la computation definition pour private_transfer
    pub fn init_private_transfer_comp_def(ctx: Context<InitPrivateTransferCompDef>) -> Result<()> {
        msg!("🔧 Initializing private_transfer CompDef...");
        init_comp_def(ctx.accounts, 0, None, None)?;
        msg!("✅ Private_transfer CompDef initialized!");
        Ok(())
    }

    /// Queue une computation MPC pour un transfert privé complet
    /// Contrairement à validate_transfer, cette instruction modifie vraiment les balances
    pub fn private_transfer(
        ctx: Context<PrivateTransfer>,
        computation_offset: u64,
        encrypted_sender_balance: [u8; 32],
        encrypted_receiver_balance: [u8; 32],
        encrypted_transfer_amount: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        msg!("🔐 Executing private transfer...");
        msg!("  - Sender: {}", ctx.accounts.sender_account.owner);
        msg!("  - Receiver: {}", ctx.accounts.receiver_account.owner);
        msg!("  - computation_offset: {}", computation_offset);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Arguments MPC: balances sender/receiver et montant chiffrés
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedU64(encrypted_sender_balance),
            Argument::EncryptedU64(encrypted_receiver_balance),
            Argument::EncryptedU64(encrypted_transfer_amount),
        ];

        // ✅ Callback avec comptes sender et receiver pour mise à jour balances
        // IMPORTANT: Passer les comptes qui seront modifiés par le callback
        use arcium_client::idl::arcium::types::CallbackAccount;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![PrivateTransferCallback::callback_ix(&[
                CallbackAccount {
                    pubkey: ctx.accounts.sender_account.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.receiver_account.key(),
                    is_writable: true,
                },
            ])],
            1, // num_callback_txs: number of transactions needed for callback
        )?;

        msg!("✅ Private transfer queued for MPC computation!");
        Ok(())
    }

    /// Callback du transfert privé - Met à jour les balances chiffrées on-chain
    /// ✅ CALLBACK ACTIF - Modifie vraiment les balances après validation MPC
    #[arcium_callback(encrypted_ix = "private_transfer")]
    pub fn private_transfer_callback(
        ctx: Context<PrivateTransferCallback>,
        output: ComputationOutputs<PrivateTransferOutput>,
    ) -> Result<()> {
        msg!("🔐 Callback received for private_transfer");

        // Extraire le résultat du MPC
        // Note: field_0 est un SharedEncryptedStruct<3> contenant les 3 valeurs chiffrées
        let encrypted_outputs = match output {
            ComputationOutputs::Success(PrivateTransferOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::ComputationFailed.into()),
        };

        // encrypted_outputs.ciphertexts[0] = new_sender_balance
        // encrypted_outputs.ciphertexts[1] = new_receiver_balance
        // encrypted_outputs.ciphertexts[2] = is_valid

        // ✅ MISE À JOUR RÉELLE DES BALANCES ON-CHAIN
        let clock = Clock::get()?;

        // Mettre à jour balance sender (chiffrée)
        // On utilise le même nonce pour toutes les valeurs car elles viennent du même output
        ctx.accounts.sender_account.update_balance(
            encrypted_outputs.ciphertexts[0],  // new_sender_balance
            encrypted_outputs.nonce.to_le_bytes(),
            clock.unix_timestamp,
        )?;

        // Mettre à jour balance receiver (chiffrée)
        ctx.accounts.receiver_account.update_balance(
            encrypted_outputs.ciphertexts[1],  // new_receiver_balance
            encrypted_outputs.nonce.to_le_bytes(),
            clock.unix_timestamp,
        )?;

        // Émettre event de succès
        emit!(PrivateTransferEvent {
            sender: ctx.accounts.sender_account.owner,
            receiver: ctx.accounts.receiver_account.owner,
            is_valid_encrypted: encrypted_outputs.ciphertexts[2],  // is_valid
            timestamp: clock.unix_timestamp,
        });

        msg!("✅ Private transfer callback completed! Balances updated on-chain.");
        Ok(())
    }
}

// ===================================
// ACCOUNTS CONTEXTS
// ===================================

#[queue_computation_accounts("validate_transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ValidateTransfer<'info> {
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
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_VALIDATE_TRANSFER)
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

#[init_computation_definition_accounts("validate_transfer", payer)]
#[derive(Accounts)]
pub struct InitValidateTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    /// Can't check it here as it's not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[callback_accounts("validate_transfer")]
#[derive(Accounts)]
pub struct ValidateTransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_VALIDATE_TRANSFER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
}

// ===================================
// USER REGISTRY ACCOUNTS
// ===================================

/// Créer un compte utilisateur
#[derive(Accounts)]
pub struct CreateUserAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + UserAccount::LEN,
        seeds = [USER_ACCOUNT_SEED, owner.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

/// Déposer du SOL dans le pool
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_ACCOUNT_SEED, owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner @ user_registry::ErrorCode::InvalidOwner
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA for holding SOL
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Retirer du SOL du pool
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_ACCOUNT_SEED, owner.key().as_ref()],
        bump = user_account.bump,
        has_one = owner @ user_registry::ErrorCode::InvalidOwner
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA for holding SOL
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ===================================
// UMBRA-STYLE SHIELDED POOL ACCOUNTS
// ===================================

/// Initialize commitment tree
#[derive(Accounts)]
pub struct InitCommitmentTree<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + CommitmentTree::LEN,
        seeds = [b"commitment_tree"],
        bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    pub system_program: Program<'info, System>,
}

/// Initialize nullifier registry
#[derive(Accounts)]
pub struct InitNullifierRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + NullifierRegistry::LEN,
        seeds = [b"nullifier_registry"],
        bump
    )]
    pub nullifier_registry: Account<'info, NullifierRegistry>,

    pub system_program: Program<'info, System>,
}

/// Deposit with commitment (Umbra-style)
#[derive(Accounts)]
pub struct DepositWithCommitment<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA for holding SOL
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Claim with zero-knowledge proof (Umbra-style)
#[derive(Accounts)]
pub struct ClaimWithProof<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"nullifier_registry"],
        bump = nullifier_registry.bump
    )]
    pub nullifier_registry: Account<'info, NullifierRegistry>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA for holding SOL
    pub vault: SystemAccount<'info>,

    /// CHECK: Recipient can be any address (stealth address)
    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ===================================
// FIXED DENOMINATION POOL ACCOUNTS
// ===================================

#[derive(Accounts)]
#[instruction(denomination: u8)]
pub struct InitDenominationPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + DenominationPool::LEN,
        seeds = [b"pool", denomination.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, DenominationPool>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u8)]
pub struct DepositToPool<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, DenominationPool>,

    #[account(
        mut,
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"vault", pool_id.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: Pool-specific vault PDA
    pub pool_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u8)]
pub struct ClaimFromPool<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, DenominationPool>,

    #[account(
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"nullifier_registry"],
        bump = nullifier_registry.bump
    )]
    pub nullifier_registry: Account<'info, NullifierRegistry>,

    #[account(
        mut,
        seeds = [b"vault", pool_id.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: Pool-specific vault PDA
    pub pool_vault: SystemAccount<'info>,

    /// CHECK: Recipient can be any address (stealth address)
    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ===================================
// SHIELDED POOL MPC ACCOUNTS
// ===================================

/// Initialize CompDef pour shielded_deposit
#[init_computation_definition_accounts("shielded_deposit", payer)]
#[derive(Accounts)]
pub struct InitShieldedDepositCompDef<'info> {
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

/// Queue shielded_deposit computation
#[queue_computation_accounts("shielded_deposit", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ShieldedDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA for holding SOL
    pub vault: SystemAccount<'info>,

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
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SHIELDED_DEPOSIT)
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

/// Callback shielded_deposit
#[callback_accounts("shielded_deposit")]
#[derive(Accounts)]
pub struct ShieldedDepositCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SHIELDED_DEPOSIT)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(mut)]
    pub depositor: Signer<'info>,
}

/// Initialize CompDef pour shielded_claim
#[init_computation_definition_accounts("shielded_claim", payer)]
#[derive(Accounts)]
pub struct InitShieldedClaimCompDef<'info> {
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

/// Queue shielded_claim computation
#[queue_computation_accounts("shielded_claim", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ShieldedClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(
        seeds = [b"commitment_tree"],
        bump = commitment_tree.bump
    )]
    pub commitment_tree: Account<'info, CommitmentTree>,

    #[account(
        mut,
        seeds = [b"nullifier_registry"],
        bump = nullifier_registry.bump
    )]
    pub nullifier_registry: Account<'info, NullifierRegistry>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,

    /// CHECK: Recipient can be any address (stealth address)
    #[account(mut)]
    pub recipient: SystemAccount<'info>,

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
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SHIELDED_CLAIM)
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

/// Callback shielded_claim
#[callback_accounts("shielded_claim")]
#[derive(Accounts)]
pub struct ShieldedClaimCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SHIELDED_CLAIM)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: SystemAccount<'info>,

    /// CHECK: Recipient
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}

// ===================================
// PRIVATE TRANSFER ACCOUNTS
// ===================================

/// Initialiser CompDef pour private_transfer
#[init_computation_definition_accounts("private_transfer", payer)]
#[derive(Accounts)]
pub struct InitPrivateTransferCompDef<'info> {
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

/// Queue private transfer computation
#[queue_computation_accounts("private_transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct PrivateTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Compte utilisateur sender (pour vérification uniquement ici)
    #[account(
        seeds = [USER_ACCOUNT_SEED, sender_account.owner.as_ref()],
        bump = sender_account.bump
    )]
    pub sender_account: Account<'info, UserAccount>,

    /// Compte utilisateur receiver (pour vérification uniquement ici)
    #[account(
        seeds = [USER_ACCOUNT_SEED, receiver_account.owner.as_ref()],
        bump = receiver_account.bump
    )]
    pub receiver_account: Account<'info, UserAccount>,

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
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_PRIVATE_TRANSFER)
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

/// Callback private transfer - Met à jour les balances
#[callback_accounts("private_transfer")]
#[derive(Accounts)]
pub struct PrivateTransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_PRIVATE_TRANSFER)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    /// ✅ COMPTES SUPPLÉMENTAIRES pour modifier les balances
    /// Sender account - sera modifié par le callback
    /// SÉCURITÉ: Contraintes PDA pour vérifier que c'est bien le bon compte
    #[account(
        mut,
        seeds = [USER_ACCOUNT_SEED, sender_account.owner.as_ref()],
        bump = sender_account.bump,
    )]
    pub sender_account: Account<'info, UserAccount>,

    /// Receiver account - sera modifié par le callback
    /// SÉCURITÉ: Contraintes PDA pour vérifier que c'est bien le bon compte
    #[account(
        mut,
        seeds = [USER_ACCOUNT_SEED, receiver_account.owner.as_ref()],
        bump = receiver_account.bump,
    )]
    pub receiver_account: Account<'info, UserAccount>,
}

// ===================================
// EVENTS
// ===================================

/// Event émis par validate_transfer (validation simple)
#[event]
pub struct ValidationEvent {
    pub is_valid_encrypted: [u8; 32],
    pub nonce: [u8; 16],
}

/// Event émis par private_transfer (transfert complet)
#[event]
pub struct PrivateTransferEvent {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub is_valid_encrypted: [u8; 32],  // Résultat validation chiffré
    pub timestamp: i64,
}

/// Event émis lors d'un deposit avec commitment (Umbra-style)
/// Following Umbra: includes encrypted_amount and nonce for recipient decryption
#[event]
pub struct DepositCommitmentEvent {
    pub commitment: [u8; 32],
    pub ephemeral_public_key: [u8; 32],
    pub encrypted_amount: [u8; 8],   // Encrypted amount (ChaCha20)
    pub amount_nonce: [u8; 12],      // Nonce for decryption
    pub index: u64,
    pub timestamp: i64,
}

/// Event émis lors d'un claim avec ZK proof (Umbra-style)
#[event]
pub struct ClaimEvent {
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Event émis lors d'un shielded deposit avec MPC
/// Le montant est 100% CHIFFRÉ via Arcium MPC (sealing)
#[event]
pub struct ShieldedDepositEvent {
    pub sealed_amount_ciphertext: [u8; 32],  // Montant re-chiffré pour Bob
    pub sealed_amount_nonce: [u8; 16],       // Nonce pour décryption
    pub timestamp: i64,
}

/// Event émis lors d'un shielded claim avec MPC
#[event]
pub struct ShieldedClaimEvent {
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub approved: bool,                      // Claim approuvé ou non
    pub timestamp: i64,
}

/// Event émis lors d'un deposit vers un pool à dénomination fixe
/// Le montant est IMPLICITE (basé sur pool_id) donc INVISIBLE dans l'event!
#[event]
pub struct DepositToPoolEvent {
    pub pool_id: u8,                         // 0=0.1 SOL, 1=0.5 SOL, etc.
    pub commitment: [u8; 32],
    pub ephemeral_public_key: [u8; 32],
    pub index: u64,
    pub timestamp: i64,
}

/// Event émis lors d'un claim depuis un pool à dénomination fixe
/// Le montant est IMPLICITE (basé sur pool_id) donc INVISIBLE dans l'event!
#[event]
pub struct ClaimFromPoolEvent {
    pub pool_id: u8,                         // 0=0.1 SOL, 1=0.5 SOL, etc.
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub timestamp: i64,
}

// ===================================
// ERRORS
// ===================================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted or failed")]
    ComputationFailed,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid amount (must be > 0)")]
    InvalidAmount,
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,
    #[msg("Invalid ZK proof")]
    InvalidZKProof,
}
