use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    // ===================================
    // STRUCTURES MPC
    // ===================================

    /// Input pour validate_transfer (validation simple)
    pub struct TransferInput {
        sender_balance: u64,
        transfer_amount: u64,
    }

    /// Input pour private_transfer (transfert complet avec balances)
    pub struct PrivateTransferInput {
        sender_balance: u64,
        receiver_balance: u64,
        transfer_amount: u64,
    }

    /// Output du transfert privé avec nouvelles balances
    pub struct PrivateTransferOutput {
        new_sender_balance: u64,
        new_receiver_balance: u64,
        is_valid: bool,
    }

    // ===================================
    // VALIDATE TRANSFER - Validation simple (version actuelle)
    // ===================================

    #[instruction]
    pub fn validate_transfer(input_ctxt: Enc<Shared, TransferInput>) -> Enc<Shared, bool> {
        let input = input_ctxt.to_arcis();

        // Validation en MPC (données jamais révélées)
        // Vérifie que le montant est positif et que le sender a assez de fonds
        let is_valid = input.transfer_amount > 0
                       && input.transfer_amount <= input.sender_balance;

        // Retourne le résultat encrypté
        input_ctxt.owner.from_arcis(is_valid)
    }

    // ===================================
    // PRIVATE TRANSFER - Transfert complet avec mise à jour balances
    // ===================================

    #[instruction]
    pub fn private_transfer(
        input_ctxt: Enc<Shared, PrivateTransferInput>
    ) -> Enc<Shared, PrivateTransferOutput> {
        let input = input_ctxt.to_arcis();

        // Validation en MPC
        let is_valid = input.transfer_amount > 0
                       && input.transfer_amount <= input.sender_balance;

        // Calcul des nouvelles balances (seulement si validation OK)
        let new_sender_balance = if is_valid {
            input.sender_balance - input.transfer_amount
        } else {
            input.sender_balance  // Pas de changement si invalide
        };

        let new_receiver_balance = if is_valid {
            input.receiver_balance + input.transfer_amount
        } else {
            input.receiver_balance  // Pas de changement si invalide
        };

        // Retourne les nouvelles balances + validation status
        input_ctxt.owner.from_arcis(PrivateTransferOutput {
            new_sender_balance,
            new_receiver_balance,
            is_valid,
        })
    }

    // ===================================
    // SHIELDED POOL - Deposit avec montant chiffré
    // ===================================

    /// Input pour créer un deposit commitment avec montant chiffré
    /// Le montant reste TOUJOURS chiffré, jamais révélé au MPC
    pub struct ShieldedDepositInput {
        encrypted_amount: u64,  // Montant chiffré
        timestamp: i64,
    }

    /// Output du deposit: montant re-chiffré pour le recipient
    pub struct ShieldedDepositOutput {
        sealed_amount: u64,     // Montant re-chiffré pour Bob
        is_valid: bool,
    }

    /// Circuit MPC pour créer un deposit avec montant chiffré
    /// Le montant est re-chiffré pour le recipient (sealing)
    #[instruction]
    pub fn shielded_deposit(
        input_ctxt: Enc<Shared, ShieldedDepositInput>,
        recipient: Shared  // Bob's public key pour sealing
    ) -> Enc<Shared, ShieldedDepositOutput> {
        let input = input_ctxt.to_arcis();

        // Validation: montant > 0
        let is_valid = input.encrypted_amount > 0;

        // Re-chiffre le montant pour Bob (sealing)
        let sealed_amount = input.encrypted_amount;

        // Retourne le montant re-chiffré pour Bob
        recipient.from_arcis(ShieldedDepositOutput {
            sealed_amount,
            is_valid,
        })
    }

    // ===================================
    // SHIELDED POOL - Claim avec montant chiffré
    // ===================================

    /// Input pour claim: montant chiffré + validation
    pub struct ShieldedClaimInput {
        encrypted_amount: u64,  // Montant à claim (chiffré)
        vault_balance: u64,     // Balance du vault (pour vérification)
    }

    /// Output du claim: montant vérifié et approuvé
    pub struct ShieldedClaimOutput {
        approved_amount: u64,   // Montant approuvé pour transfer
        is_valid: bool,
    }

    /// Circuit MPC pour claim avec validation du montant
    #[instruction]
    pub fn shielded_claim(
        input_ctxt: Enc<Shared, ShieldedClaimInput>
    ) -> Enc<Shared, ShieldedClaimOutput> {
        let input = input_ctxt.to_arcis();

        // Validation: montant > 0 ET vault a assez de SOL
        let is_valid = input.encrypted_amount > 0
                       && input.encrypted_amount <= input.vault_balance;

        let approved_amount = if is_valid {
            input.encrypted_amount
        } else {
            0  // Refusé
        };

        // Retourne le montant approuvé
        input_ctxt.owner.from_arcis(ShieldedClaimOutput {
            approved_amount,
            is_valid,
        })
    }
}
