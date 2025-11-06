# v0.3.x to v0.4.0

## 1. Update Rust toolchain and Solana CLI

Arcium v0.4.0 requires Rust 1.89.0 and Solana CLI 2.3.0. It also uses a new `rust-toolchain.toml` format and no longer requires Xargo.

### Update Rust Toolchain

Replace your existing `rust-toolchain` file with the new TOML format:

```bash  theme={null}
# Remove old rust-toolchain file if it exists
rm rust-toolchain 2>/dev/null || true

# Create new rust-toolchain.toml
cat > rust-toolchain.toml << 'EOF'
[toolchain]
channel = "1.89.0"
components = ["rustfmt","clippy"]
profile = "minimal"
EOF
```

### Remove Xargo Configuration

Xargo is no longer needed in v0.4.0. Remove the `Xargo.toml` file from each program directory:

```bash  theme={null}
# Remove Xargo.toml from all program directories
rm programs/*/Xargo.toml 2>/dev/null || true
```

### Update Solana CLI

Ensure you have Solana CLI 2.3.0 or later:

```bash  theme={null}
# Check current version
solana --version

# Update to 2.3.0 if needed
sh -c "$(curl -sSfL https://release.solana.com/v2.3.0/install)"
```

## 2. Remove Cargo patch

The `proc-macro2` patch is no longer required in v0.4.0. Remove it from your workspace `Cargo.toml`:

```toml  theme={null}
# Before v0.4.0
[workspace]
members = ["programs/*", "encrypted-ixs"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1

[patch.crates-io]
proc-macro2 = { git = 'https://github.com/arcium-hq/proc-macro2.git' }
```

```toml  theme={null}
# v0.4.0
[workspace]
members = ["programs/*", "encrypted-ixs"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1

# No [patch.crates-io] section needed
```

## 3. Update Arcium Rust dependencies

Update your dependencies to v0.4.0 and Anchor to 0.32.1:

```bash  theme={null}
# Update program dependencies
cd programs/your-program-name
cargo update --package arcium-client --precise 0.4.0
cargo update --package arcium-macros --precise 0.4.0
cargo update --package arcium-anchor --precise 0.4.0
cargo update --package anchor-lang --precise 0.32.1

# Update encrypted-ixs dependencies
cd ../../encrypted-ixs
cargo update --package arcis-imports --precise 0.4.0
```

## 4. Update Arcium TS dependencies

Update TypeScript dependencies to v0.4.0 and Anchor to 0.32.1:

<CodeGroup>
  ```bash npm theme={null}
  npm install @arcium-hq/client@0.4.0 @coral-xyz/anchor@0.32.1
  ```

  ```bash yarn theme={null}
  yarn add @arcium-hq/client@0.4.0 @coral-xyz/anchor@0.32.1
  ```

  ```bash pnpm theme={null}
  pnpm add @arcium-hq/client@0.4.0 @coral-xyz/anchor@0.32.1
  ```
</CodeGroup>

## 5. Update idl-build feature in program Cargo.toml

Add `arcium-anchor/idl-build` to the `idl-build` feature in your program's `Cargo.toml`:

```toml  theme={null}
# Before v0.4.0
[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]
```

```toml  theme={null}
# v0.4.0
[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "arcium-anchor/idl-build"]
```

## 6. (Optional) Add new Cargo.toml features and lints

Arcium v0.4.0 introduces new optional features and lints for improved developer experience. While not required, these are recommended additions to your program's `Cargo.toml`:

### New Optional Features

```toml  theme={null}
[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "arcium-anchor/idl-build"]
# New optional features below
anchor-debug = []
custom-heap = []
custom-panic = []
```

### New Lints Section

Add the following lints section to help catch configuration issues:

```toml  theme={null}
[lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = ['cfg(target_os, values("solana"))'] }
```

These additions help with debugging and ensure proper configuration for Solana programs.

## 7. Update init\_comp\_def call signature

The `init_comp_def` function signature has changed - the first boolean parameter has been removed:

```rust  theme={null}
// Before v0.4.0
pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, true, 0, None, None)?;
    Ok(())
}
```

```rust  theme={null}
// v0.4.0
pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, 0, None, None)?;
    Ok(())
}
```

## 8. Update queue\_computation call signature

The `queue_computation` function now requires a 6th parameter `num_callback_txs` to support multi-transaction callbacks:

```rust  theme={null}
// Before v0.4.0
queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    None,
    vec![FlipCallback::callback_ix(&[])],
)?;
```

```rust  theme={null}
// v0.4.0
queue_computation(
    ctx.accounts,
    computation_offset,
    args,
    None,
    vec![FlipCallback::callback_ix(&[])],
    1, // num_callback_txs: number of transactions needed for callback
)?;
```

The `num_callback_txs` parameter specifies how many transactions are needed to process the callback. For most simple computations, this will be `1`. Larger computations with extensive callback data may require multiple transactions.

## 9. Update derive\_cluster\_pda! macro

The `derive_cluster_pda!` macro now requires an error code as the second parameter:

```rust  theme={null}
// Before v0.4.0
#[account(
    mut,
    address = derive_cluster_pda!(mxe_account)
)]
pub cluster_account: Account<'info, Cluster>,
```

```rust  theme={null}
// v0.4.0
#[account(
    mut,
    address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
)]
pub cluster_account: Account<'info, Cluster>,
```

Make sure you have the corresponding error code defined in your program:

```rust  theme={null}
#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
```

## 10. Verify Migration

After completing all migration steps, verify that everything works correctly:

### Build Test

```bash  theme={null}
# From your workspace root
arcium build
```

### Type Checking

```bash  theme={null}
# Ensure all new types compile correctly
cargo check --all
```

### Test Your Changes

```bash  theme={null}
# Run your existing tests to ensure functionality is preserved
arcium test
```

## Complete Example

Here's a complete before/after example of a typical computation function:

### Before v0.4.0:

```rust  theme={null}
// rust-toolchain file (plain text)
1.88.0

// Cargo.toml (workspace)
[workspace]
members = ["programs/*", "encrypted-ixs"]
resolver = "2"

[patch.crates-io]
proc-macro2 = { git = 'https://github.com/arcium-hq/proc-macro2.git' }

// programs/coinflip/Cargo.toml
[dependencies]
anchor-lang = { version = "0.31.1", features = ["init-if-needed"] }
arcium-client = { version = "0.3.0", default-features = false }
arcium-macros = { version = "0.3.0" }
arcium-anchor = { version = "0.3.0" }

[features]
idl-build = ["anchor-lang/idl-build"]

// programs/coinflip/src/lib.rs
pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, true, 0, None, None)?;
    Ok(())
}

pub fn flip(
    ctx: Context<Flip>,
    computation_offset: u64,
    user_choice: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    let args = vec![
        Argument::ArcisPubkey(pub_key),
        Argument::PlaintextU128(nonce),
        Argument::EncryptedU8(user_choice),
    ];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![FlipCallback::callback_ix(&[])],
    )?;

    Ok(())
}

#[queue_computation_accounts("flip", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Flip<'info> {
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
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,
    // ... other accounts
}
```

### v0.4.0:

```rust  theme={null}
// rust-toolchain.toml (TOML format)
[toolchain]
channel = "1.89.0"
components = ["rustfmt","clippy"]
profile = "minimal"

// Cargo.toml (workspace)
[workspace]
members = ["programs/*", "encrypted-ixs"]
resolver = "2"

// No [patch.crates-io] section

// programs/coinflip/Cargo.toml
[dependencies]
anchor-lang = { version = "0.32.1", features = ["init-if-needed"] }
arcium-client = { version = "0.4.0", default-features = false }
arcium-macros = { version = "0.4.0" }
arcium-anchor = { version = "0.4.0" }

[features]
idl-build = ["anchor-lang/idl-build", "arcium-anchor/idl-build"]
# Optional features
anchor-debug = []
custom-heap = []
custom-panic = []

[lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = ['cfg(target_os, values("solana"))'] }

// programs/coinflip/src/lib.rs
pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, 0, None, None)?;  // Removed first boolean parameter
    Ok(())
}

pub fn flip(
    ctx: Context<Flip>,
    computation_offset: u64,
    user_choice: [u8; 32],
    pub_key: [u8; 32],
    nonce: u128,
) -> Result<()> {
    let args = vec![
        Argument::ArcisPubkey(pub_key),
        Argument::PlaintextU128(nonce),
        Argument::EncryptedU8(user_choice),
    ];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![FlipCallback::callback_ix(&[])],
        1,  // Added num_callback_txs parameter
    )?;

    Ok(())
}

#[queue_computation_accounts("flip", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Flip<'info> {
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
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)  // Added error code parameter
    )]
    pub cluster_account: Account<'info, Cluster>,
    // ... other accounts
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,  // Required for derive_cluster_pda! macro
}
```

That's it! Your program should now be compatible with Arcium tooling v0.4.0.
