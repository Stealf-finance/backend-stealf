# Stealf - Privacy Infrastructure for Solana


---

At the moment, we are in the development phase to test the programs they must be compiled separately and then tested with the files in the /tests folder.

---

## 🎯 Overview

**Stealf** is a comprehensive privacy infrastructure built on Solana that combines cutting-edge cryptographic techniques to enable truly private transactions and wallet management. The project leverages **Arcium's Multi-Party Computation (MPC)** framework to perform confidential computations without revealing sensitive data.


---

## 📁 Repository Structure

```
backend-stealf/
│
├── private-link/              # Private Wallet Linking System
│   ├── programs/
│   │   └── anonyme_transfer/  # Solana program for wallet linking
│   │       └── src/lib.rs     # Main program logic (230 lines)
│   ├── encrypted-ixs/         # Arcium MPC circuits
│   │   └── src/lib.rs         # Wallet linking circuit (22 lines)
│   ├── tests/                 # Integration tests
│   │   └── anonyme_transfer.ts
│   └── target/idl/            # Generated IDL files
│
├── private-transfers/         # Private Transactions System
│   ├── programs/
│   │   └── private/           # Main Solana program
│   │       └── src/
│   │           ├── lib.rs                 # Main program (2045 lines)
│   │           ├── user_registry.rs       # User accounts (119 lines)
│   │           ├── commitment.rs          # Commitment tree (228 lines)
│   │           ├── denomination.rs        # Fixed pools (220 lines)
│   │           ├── encrypted_balance.rs   # Encrypted balances (363 lines)
│   │           ├── encryption.rs          # ChaCha20 encryption (151 lines)
│   │           ├── stealth.rs             # Stealth addresses (202 lines)
│   │           ├── merkle_tree.rs         # Merkle trees (268 lines)
│   │           ├── poseidon_utils.rs      # Poseidon hashing (165 lines)
│   │           └── zk_proof.rs            # ZK proof verification (166 lines)
│   ├── encrypted-ixs/         # Arcium MPC circuits
│   │   └── src/lib.rs         # 4 MPC circuits (162 lines)
│   ├── tests/                 # Integration tests
│   ├── scripts/               # Utility scripts
│   └── target/idl/            # Generated IDL files
│
├── sdk/                       # TypeScript SDK
│   ├── src/
│   │   ├── client/
│   │   │   └── WalletLinkClient.ts    # Wallet linking client
│   │   ├── core/
│   │   │   ├── types.ts               # TypeScript types
│   │   │   ├── constants.ts           # Program IDs & config
│   │   │   └── errors.ts              # Error definitions
│   │   ├── utils/
│   │   │   ├── encryption.ts          # x25519 + RescueCipher
│   │   │   └── pda.ts                 # PDA derivation utilities
│   │   ├── idl/
│   │   │   └── private_wallet.json    # Private link IDL
│   │   └── index.ts                   # SDK exports
│   ├── dist/                  # Compiled SDK (npm link target)
│   ├── docs/                  # SDK documentation
│   └── package.json
│
├── config/                    # Shared configuration
│   └── devnet.json           # Devnet deployment config
│
├── docs/                      # Project documentation
│   ├── ARCIS_COMPLIANCE_REPORT.md
│   ├── PRIVATE_TRANSFERS_ANALYSIS.md
│   ├── VERIFICATION_CHECKLIST.md
│   └── FRONTEND_INTEGRATION.md
│
├── Arcium.toml                # Arcium MPC configuration (per module)
│
├── .gitignore
├── README.md                  # This file
└── package.json              # Root package.json
```

---

## ✨ Features

### 🔗 Private Link (Private Wallet Linking)

**Status:** ✅ Production Ready

Link a Grid Smart Account with a private wallet using MPC, ensuring the connection remains confidential on-chain.

**Key Features:**
- Automatic private wallet generation
- MPC-based encryption (x25519 + RescueCipher)
- PDA-based storage (one per user)
- Event-driven MPC computation
- TypeScript SDK with full type safety

**Program ID (Devnet):** `CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm`

**Use Cases:**
- Secure wallet pairing
- Privacy-preserving account management
- Confidential wallet relationships

---

### 💸 Private Transfers (Confidential Transactions)

**Status:** 🚧 In Development

Comprehensive private transaction system combining three major privacy protocols.

**Key Features:**

#### 1. User Registry with Encrypted Balances
- Encrypted balance storage (ChaCha20 + x25519)
- Deposit/Withdraw flows with MPC validation
- Public accountability (total deposits/withdrawals)
- Per-user PDA accounts

#### 2.Shielded Pool
- Cryptographic commitments
- Stealth address generation
- Encrypted amounts (ChaCha20)
- Incremental Merkle tree
- Nullifier registry (anti double-spend)
- Event scanning for recipients

#### 3.Denomination Pools
- Fixed denomination amounts (0.1, 0.5, 1, 5, 10 SOL)
- **Amount NOT in transaction parameters** (maximum privacy!)
- Large anonymity sets per denomination
- Unlinkable deposits and claims
- ZK-SNARK proof verification (TODO)

#### 4. Shielded Pool with MPC
- 100% encrypted amounts via Arcium MPC
- MPC sealing (re-encryption for recipient)
- MPC-validated claims
- No amount visibility on-chain

#### 5. Encrypted Balance System
- TRUE hidden amounts (Umbra-inspired)
- ECDH-based encryption
- Amounts hidden until withdrawal
- Poseidon commitment hashing
- Merkle tree proofs



## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- Rust >= 1.70.0
- Solana CLI >= 1.18.0
- Anchor CLI >= 0.32.0
- **Arcium CLI** (for MPC circuits)

### About Arcium (formerly Arcis)

This project uses **Arcium's Multi-Party Computation (MPC)** framework to perform confidential computations on encrypted data. The MPC circuits are defined in the `encrypted-ixs/` directories using Rust with the `arcis-imports` crate (v0.4.0).

**How Arcium works in this project:**
1. **MPC Circuits** (`encrypted-ixs/src/lib.rs`) define confidential computations using `#[encrypted]` and `#[instruction]` macros
2. **Arcium CLI** compiles these circuits into deployable MPC programs
3. **Client encryption** uses x25519 + RescueCipher to encrypt inputs before sending to MPC nodes
4. **MPC execution** happens on Arcium's Cerberus backend (configured in `Arcium.toml`)
5. **Results** are returned encrypted and can only be decrypted by the authorized client

**Where Arcium is used:**

**MPC Circuits (using `arcis-imports` v0.4.0):**
- `private-link/encrypted-ixs/src/lib.rs` - Wallet linking circuit
- `private-transfers/encrypted-ixs/src/lib.rs` - 4 transfer circuits (validate, private_transfer, shielded_deposit, shielded_claim)

**Solana Programs (using `arcium_anchor`):**
- `private-link/programs/anonyme_transfer/src/lib.rs` - #[arcium_program], queue_computation(), #[arcium_callback]
- `private-transfers/programs/private/src/lib.rs` - 4 MPC computation queues with arcium_anchor integration

**SDK (TypeScript):**
- `sdk/src/client/WalletLinkClient.ts` - MPC computation queueing and finalization
- `sdk/src/utils/encryption.ts` - Client-side encryption using `@arcium-hq/client`

**Key Arcium commands:**
```bash
arcium build              # Compile MPC circuits
arcium deploy --devnet    # Deploy circuits to devnet
arcium test               # Run MPC circuit tests
```

### Installation


#### 2. Install dependencies

```bash
# Install all dependencies (root + SDK)
npm install

# Install SDK dependencies
cd sdk
npm install
cd ..

# Install private-link dependencies
cd private-link
npm install
cd ..

# Install private-transfers dependencies
cd private-transfers
npm install
cd ..
```

#### 3. Build programs

**Private Link:**
```bash
cd private-link
arcium build  # Build MPC circuits
```

**Private Transfers:**
```bash
cd private-transfers
arcium build  # Build MPC circuits
cd ..
```

#### 4. Build SDK

```bash
cd sdk
npm run build
cd ..
```
