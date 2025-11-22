use arcis_imports::*;

/// Encrypted Private Transfer Circuit
///
/// This circuit handles confidential transfers where the amount is encrypted
/// using Arcium's MPC framework. The amount remains hidden on-chain.
#[encrypted]
mod circuits {
    use arcis_imports::*;

    /// Transfer data structure containing encrypted amount and recipient info
    #[derive(Clone)]
    pub struct TransferData {
        pub amount: u64,
        pub timestamp: u64,
    }

    /// Encrypted private transfer instruction
    ///
    /// Takes encrypted transfer data and returns the encrypted amount
    /// for the recipient to decrypt.
    ///
    /// Privacy guarantees:
    /// - Amount is never revealed to MPC nodes
    /// - Only sender and recipient can decrypt the amount
    /// - Transaction appears on-chain with encrypted values only
    #[instruction]
    pub fn encrypted_transfer(
        transfer_data: Enc<Shared, TransferData>
    ) -> Enc<Shared, u64> {
        let data = transfer_data.to_arcis();

        // Return the encrypted amount for the recipient
        // The amount stays encrypted throughout the computation
        transfer_data.owner.from_arcis(data.amount)
    }

    /// Verify encrypted balance instruction
    ///
    /// Verifies that the sender has sufficient balance without revealing
    /// the actual balance or transfer amount.
    #[instruction]
    pub fn verify_balance(
        encrypted_balance: Enc<Shared, u64>,
        encrypted_amount: Enc<Shared, u64>
    ) -> Enc<Shared, bool> {
        let balance = encrypted_balance.to_arcis();
        let amount = encrypted_amount.to_arcis();

        // Check if balance >= amount without revealing values
        let has_sufficient_balance = balance >= amount;

        // Return encrypted result
        encrypted_balance.owner.from_arcis(has_sufficient_balance)
    }

    /// Calculate encrypted new balance after transfer
    ///
    /// Computes new balance = old_balance - amount
    /// Everything stays encrypted.
    #[instruction]
    pub fn calculate_new_balance(
        old_balance: Enc<Shared, u64>,
        transfer_amount: Enc<Shared, u64>
    ) -> Enc<Shared, u64> {
        let balance = old_balance.to_arcis();
        let amount = transfer_amount.to_arcis();

        // Subtract amount from balance (in encrypted domain)
        let new_balance = balance - amount;

        // Return encrypted new balance
        old_balance.owner.from_arcis(new_balance)
    }
}
