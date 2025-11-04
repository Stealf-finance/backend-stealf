use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    #[instruction]
    pub fn encrypt_pda_address(input_ctxt: Enc<Shared, [u8; 32]>) -> Enc<Shared, [u8; 32]> {
        let input = input_ctxt.to_arcis();
        input_ctxt.owner.from_arcis(input)
    }

    #[instruction]
    pub fn decrypt_pda_address(input_ctxt: Enc<Shared, [u8; 32]>) -> [u8; 32] {
        input_ctxt.to_arcis().reveal()
    }
}
