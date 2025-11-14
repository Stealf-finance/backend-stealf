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
}
