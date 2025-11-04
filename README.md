# Anonymous Transfer - Arcium MPC Program

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FLOW ENCRYPTION / DECRYPTION                │
└─────────────────────────────────────────────────────────────────┘

![workflow-link-wallet](./app/assets/workflow-link-wallet.png)
```


## Current Status

⚠️ **Environment: LOCALNET only**

This program is currently configured to work on **localnet** only. MPC circuits are stored on Supabase (offchain storage) to avoid size issues.


## Project Structure

This project follows the classic Anchor structure with an Arcium-specific addition:

- **`programs/`**: Solana program (on-chain instructions)
- **`encrypted-ixs/`**: MPC circuits for confidential computing (Arcis framework)
- **`tests/`**: TypeScript tests
- **`build/`**: Compiled circuits (.arcis files)


## Commands

### Build

Compiles the Solana program and MPC circuits:

```bash
arcium build
```

This command:
- Compiles Arcis circuits (`encrypted-ixs/`) into `.arcis` files
- Compiles the Solana Anchor program
- Generates the IDL

### Test

Runs tests on an Arcium localnet:

```bash
arcium test
```

This command:
- Starts a local Solana validator
- Launches 2 Arcium MPC nodes via Docker
- Executes TypeScript tests
- Cleans up the environment

**Note**: Requires Docker and only works on **Linux AMD64**.

### Other Useful Commands

```bash
# Clean artifacts
arcium clean

# Build circuits only
arcium build --circuits-only

# Deploy to testnet (configure in Anchor.toml)
arcium deploy --network testnet
```

## Configuration

### Offchain Circuit Storage

Circuits are stored on Supabase. URLs are configured in:
- `programs/anonyme_transfer/src/lib.rs` (lines 21 and 94)

To change storage, modify the URLs in the `init_encrypt_pda_comp_def` and `init_decrypt_pda_comp_def` functions.

### Network

Configured in `Anchor.toml`:

```toml
[provider]
cluster = "localnet"  # or "testnet", "devnet", "mainnet-beta"
```

## Code Examples

### MPC Circuit (encrypted-ixs/src/lib.rs)

```rust
#[instruction]
pub fn encrypt_pda_address(input_ctxt: Enc<Shared, [u8; 32]>) -> Enc<Shared, [u8; 32]> {
    let input = input_ctxt.to_arcis();
    input_ctxt.owner.from_arcis(input)
}
```

### Solana Program (programs/anonyme_transfer/src/lib.rs)

```rust
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
    )?;

    Ok(())
}
```
