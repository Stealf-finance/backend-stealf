# Private Wallet Link

A Solana program built with Arcium MPC (Multi-Party Computation) that enables secure storage and re-encryption of wallet keypairs. This program demonstrates how to link a public "grid wallet" with a private wallet while keeping all sensitive data encrypted on-chain.

## Why MPC?

With Arcium:
- The encrypted data is stored on-chain
- **Only the MPC nodes** can decrypt and process the data in a secure, distributed environment
- The MPC nodes can perform computations (like re-encryption) without exposing the plaintext
- The Solana program can trigger these computations and receive encrypted results
- No single party (including the program) ever sees the plaintext data

This enables **confidential on-chain computation** - the program can work with sensitive data it cannot directly read.

## Features

- **Encrypted Storage**: Store wallet keypairs encrypted on-chain using Rescue cipher
- **MPC Re-encryption**: Use Arcium's Multi-Party Computation to re-encrypt data without exposing plaintext
- **Event-Based Results**: Emit encrypted results as Solana events for client-side decryption
- **Zero-Knowledge**: Wallet data never exists in plaintext on-chain

## Architecture

### Components

1. **Solana Program** (`programs/anonyme_transfer/src/lib.rs`)
   - `store_encrypted_wallets`: Store encrypted wallet data on-chain
   - `link_wallets`: Trigger MPC computation to re-encrypt wallets
   - `link_wallets_callback`: Handle MPC results and emit events

2. **MPC Circuit** (`encrypted-ixs/src/lib.rs`)
   - Defines the computation logic for re-encrypting wallet data
   - Runs securely inside Arcium's MXE (Multi-party Execution Environment)

3. **Client** (`tests/anonyme_transfer.ts`)
   - Encrypt wallet data using x25519 + Rescue cipher
   - Submit to program and await MPC results
   - Decrypt results client-side

### Data Flow

```
1. Client encrypts wallets (grid + private) with their key
   └─> Stored on-chain in EncryptedWallets PDA

2. Client requests re-encryption via link_wallets
   └─> MPC circuit decrypts with original key
   └─> MPC circuit re-encrypts with new client key
   └─> Result emitted as WalletsLinkedEvent

3. Client receives event and decrypts locally
   └─> Original wallets recovered
```

## Prerequisites

- **Rust**: 1.89.0
- **Solana CLI**: 2.3.0
- **Arcium CLI**: Latest version
- **Node.js**: v16 or higher
- **Anchor**: 0.32.1
- **Docker**: Required for running Arcium local network

## Installation

### 1. Install Dependencies

```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup install 1.89.0

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v2.3.0/install)"

# Install Arcium CLI
npm install -g @arcium-hq/cli

# Install project dependencies
npm install
```

### 2. Configure Solana

```bash
# Set to localnet for development
solana config set --url localhost

# Create a keypair if you don't have one
solana-keygen new
```

### 3. Start Arcium Local Network

```bash
arcium start
```

This will start:
- Local Solana validator
- 2 Arcium MXE nodes (via Docker)
- Required infrastructure

**Note**: Requires Docker and only works on **Linux AMD64**.

## Building

```bash
# Build the program and circuits
arcium build
```

This compiles:
- Solana program (`programs/anonyme_transfer/`)
- MPC circuits (`encrypted-ixs/`)
- Generates TypeScript types

## Testing

```bash
# Run all tests
arcium test

# Or use npm
npm test
```

### Test Output

The test demonstrates:
1. Generating two random wallets (grid + private)
2. Encrypting them with a client key
3. Storing encrypted data on-chain
4. Re-encrypting via MPC
5. Decrypting and verifying the results

Expected output:
```
Initializing computation definition...
CompDef initialized: <signature>
Grid Wallet: <address>
Private Wallet: <address>
Encrypted wallets stored: <signature>
Computation queued: <signature>
Decrypting wallets...

Decrypted wallets:
   Grid Wallet:    <address>
   Private Wallet: <address>

Verification:
   Grid Wallet match:    [PASS]
   Private Wallet match: [PASS]
```

## Program Instructions

### `store_encrypted_wallets`

Stores encrypted wallet data on-chain.

**Parameters:**
- `grid_wallet_low`: Lower 128 bits of grid wallet (encrypted)
- `grid_wallet_high`: Upper 128 bits of grid wallet (encrypted)
- `private_wallet_low`: Lower 128 bits of private wallet (encrypted)
- `private_wallet_high`: Upper 128 bits of private wallet (encrypted)

**Accounts:**
- `payer`: Signer and fee payer
- `encrypted_wallets`: PDA to store encrypted data
- `system_program`: Solana system program

### `link_wallets`

Triggers MPC computation to re-encrypt stored wallets.

**Parameters:**
- `computation_offset`: Unique identifier for this computation
- `client_pub_key`: Client's x25519 public key (for output encryption)
- `client_nonce`: Client's nonce (for output encryption)
- `sender_pub_key`: Original public key (for input decryption)
- `sender_nonce`: Original nonce (for input decryption)

**Accounts:**
- All Arcium MPC accounts (payer, mxe, mempool, etc.)
- `encrypted_wallets`: PDA containing encrypted wallet data

**Events:**
- `WalletsLinkedEvent`: Contains re-encrypted wallet data

## Usage Example

### Client-Side Encryption

```typescript
import { RescueCipher, x25519 } from "@arcium-hq/client";

// Generate encryption keys
const clientSecretKey = x25519.utils.randomSecretKey();
const clientPubKey = x25519.getPublicKey(clientSecretKey);
const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
const cipher = new RescueCipher(sharedSecret);

// Split wallet public keys into u128 chunks
const gridBytes = gridWallet.publicKey.toBytes();
const gridLow = BigInt('0x' + Buffer.from(gridBytes.slice(0, 16)).toString('hex'));
const gridHigh = BigInt('0x' + Buffer.from(gridBytes.slice(16, 32)).toString('hex'));

// Encrypt
const nonce = randomBytes(16);
const ciphertexts = cipher.encrypt([gridLow, gridHigh, privateLow, privateHigh], nonce);

// Store on-chain
await program.methods
  .storeEncryptedWallets(...ciphertexts)
  .rpc();
```

### Re-encryption via MPC

```typescript
// Request re-encryption
await program.methods
  .linkWallets(
    computationOffset,
    clientPubKey,
    clientNonce,
    senderPubKey,  // Original encryption key
    senderNonce
  )
  .accounts({ encryptedWallets: pdaAddress, ... })
  .rpc();

// Listen for result event
program.addEventListener("walletsLinkedEvent", (event) => {
  const decrypted = cipher.decrypt([
    event.gridWalletLow,
    event.gridWalletHigh,
    event.privateWalletLow,
    event.privateWalletHigh
  ], event.nonce);

  // Reconstruct wallets from u128 values
  const gridWallet = reconstructPublicKey(decrypted[0], decrypted[1]);
  const privateWallet = reconstructPublicKey(decrypted[2], decrypted[3]);
});
```

## Project Structure

```
.
├── programs/
│   └── anonyme_transfer/
│       └── src/
│           └── lib.rs           # Main Solana program
├── encrypted-ixs/
│   └── src/
│       └── lib.rs               # MPC circuit definition
├── tests/
│   └── anonyme_transfer.ts      # Integration tests
├── Anchor.toml                  # Anchor configuration
├── Cargo.toml                   # Workspace configuration
└── package.json                 # Node.js dependencies
```

## Commands

### Build

```bash
# Build everything
arcium build

# Build circuits only
arcium build --circuits-only
```

### Test

```bash
# Run tests with Arcium localnet
arcium test

# Or use npm
npm test
```

### Clean

```bash
# Clean build artifacts
arcium clean
```

### Deploy

```bash
# Deploy to devnet
arcium deploy --network devnet

# Deploy to mainnet
arcium deploy --network mainnet-beta
```

## Security Considerations

1. **Key Management**: Client secret keys should be stored securely and never exposed
2. **Nonce Uniqueness**: Always use unique nonces for encryption
3. **Account Validation**: The program validates all Arcium accounts via macros
4. **PDA Seeds**: Encrypted data is stored in PDAs derived from owner's public key

## Troubleshooting

### Error: "Blockhash not found"
Ensure your local validator is running:
```bash
arcium test
```

### Error: "InvalidArguments"
Check that you're passing both client and sender encryption contexts correctly. Even if they're the same, both must be provided.

### Error: "Computation aborted"
Check the Arcium node logs in `artifacts/` directory for detailed MPC execution logs.

