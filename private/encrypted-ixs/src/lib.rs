use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    #[instruction]
    pub fn shield(
        input_ctxt: Enc<Shared, (u64, u64)>,
    ) -> Enc<Shared, bool> {
        let (amt, sec) = input_ctxt.to_arcis();
        let _commitment = sec + amt;
        let success = amt > 0;
        input_ctxt.owner.from_arcis(success)
    }

    #[instruction]
    pub fn anonymous_transfer(
        input_ctxt: Enc<Shared, (u64, u64, u64)>,
    ) -> Enc<Shared, bool> {
        let (sender_sec, amt, receiver_sec) = input_ctxt.to_arcis();
        let _nullifier = sender_sec;
        let _new_commitment = receiver_sec + amt;
        let success = amt > 0 && sender_sec != receiver_sec;
        input_ctxt.owner.from_arcis(success)
    }

    #[instruction]
    pub fn unshield(
        input_ctxt: Enc<Shared, (u64, u64)>,
    ) -> Enc<Shared, bool> {
        let (sec, amt) = input_ctxt.to_arcis();
        let _nullifier = sec;
        let success = amt > 0;
        input_ctxt.owner.from_arcis(success)
    }

    #[instruction]
    pub fn unshield_v2(
        input_ctxt: Enc<Shared, u64>,
    ) -> Enc<Shared, bool> {
        let secret = input_ctxt.to_arcis();
        let success = secret > 0;
        input_ctxt.owner.from_arcis(success)
    }
}
