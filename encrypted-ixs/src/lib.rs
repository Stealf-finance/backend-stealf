use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub struct WalletPair {
        pub grid_wallet_low: u128,
        pub grid_wallet_high: u128,
        pub private_wallet_low: u128,
        pub private_wallet_high: u128,
    }

    #[instruction]
    pub fn link_wallets(
        client: Shared,
        input_ctxt: Enc<Shared, WalletPair>,
    ) -> Enc<Shared, WalletPair> {
        let input = input_ctxt.to_arcis();
        client.from_arcis(input)
    }
}