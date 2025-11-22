// Stub for getrandom in Solana BPF target
// Solana programs don't have access to system randomness
use core::num::NonZeroU32;

#[no_mangle]
pub extern "C" fn getrandom(buf: *mut u8, len: usize) -> i32 {
    // Return error code: getrandom not available
    -1
}

pub fn stub_error() -> NonZeroU32 {
    NonZeroU32::new(getrandom::Error::UNSUPPORTED.code().get()).unwrap()
}

// Register as custom getrandom implementation
getrandom::register_custom_getrandom!(stub_getrandom);

fn stub_getrandom(_buf: &mut [u8]) -> Result<(), getrandom::Error> {
    Err(getrandom::Error::UNSUPPORTED)
}
