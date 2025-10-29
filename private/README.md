# Stealf - Anonymous Shielded Pool

## Overview

Solana program implementing an anonymous shielded pool using Arcium Network for Multi-Party Computation (MPC). Enables private SOL deposits, anonymous transfers, and withdrawals with full privacy guarantees.

## Program Architecture

This project uses Arcium's confidential computing framework with two main components:

### 1. Solana Program (`programs/private/src/lib.rs`)
Main on-chain program handling:
- Shield: Deposit SOL with encrypted commitment
- Anonymous Transfer: Private transfers between users
- Unshield: Withdraw SOL from pool
- Callbacks: Process MPC computation results

### 2. MPC Circuits (`encrypted-ixs/src/lib.rs`)
Off-chain confidential computations:
- Shield circuit: Generate encrypted commitments
- Transfer circuit: Validate and update balances privately
- Unshield circuit: Verify commitment ownership

## Deployed on Devnet

- **Program ID:** `AobX7Y7KRkNEqv38R7HnyWKEPCsTw366g54xU9xWDiEX`
- **Network:** Solana Devnet
- **Cluster:** Public Arcium Devnet (offset: 1078779259)

## Quick Start

### Build
```bash
arcium build
```

### Deploy
```bash
solana program deploy target/deploy/private.so \
  --program-id target/deploy/private-keypair.json \
  --url devnet
```

### Initialize
```bash
# Initialize MXE
arcium deploy --skip-deploy --cluster-offset 1078779259

# Initialize Computation Definitions
npx ts-node scripts/init-comp-defs-direct.ts
```

### Test
```bash
# Complete flow (shield + unshield)
npx ts-node scripts/test-shield-unshield-flow.ts

# Simple shield operation
npx ts-node scripts/test-shield-simple.ts
```

## Key Features

- **Privacy**: All sensitive data processed via MPC
- **Double-spend Protection**: Spent commitments tracked on-chain
- **Secure Pool**: PDA-based vault for pooled SOL
- **Callback Architecture**: MPC results delivered via callbacks

## Dependencies

- Anchor 0.31.1
- Arcium SDK 0.3.1
- Solana CLI 1.18+

## Project Structure

```
private/
├── programs/private/src/lib.rs    # Main program
├── encrypted-ixs/src/lib.rs       # MPC circuits
├── scripts/                       # Deployment & test scripts
├── target/                        # Build artifacts
└── tests/                         # Anchor tests
```

## Documentation

See [CLAUDE.md](../../../CLAUDE.md) in the project root for detailed technical documentation.
