# Stealf Backend — Claude Context

## Project Overview

Stealf is a privacy-focused Solana mobile wallet. This is the Express/TypeScript backend.
Core features: authentication (Turnkey), wallet management, Jupiter swaps, and **private yield**
(JitoSOL staking with MPC-encrypted balances via Arcium).

## Current State

- **Branch**: `developpement`
- **Status**: Yield system (deposit, withdraw, balance, stats) fully wired
- **Last updated**: 2026-03-13

## Architecture

- See `.claude/architecture.md` for full architecture with ASCII diagrams
- See `.claude/pipeline.md` for frontend/backend flow diagrams
- See `.claude/audit-security.md` for security audit status

## Key Concepts

### Two Solana Programmes
- **stealf_vault** (`4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA`) — SOL custody vault
- **private_yield** (`F3ypFyPnffVd4sq3wDRZjHLz3F9GBnYoKw3gSHjN2Uts`) — Arcium MPC encrypted ledger

### Yield Flow
- **Deposit**: Frontend sends SOL + JSON memo to vault → Helius webhook → backend stakes to JitoSOL → MPC records encrypted balance
- **Withdraw**: Frontend POST → backend encrypts params → MPC verifies/decrements → unstake JitoSOL → send SOL
- **Balance**: Backend calls `get_balance` MPC instruction → decrypts result → returns plaintext over HTTPS

### UUID to PDA
```
UUID → uuidToU128() → u128ToLE() → SHA256() → userIdHash → PDA seeds["user_state", hash]
```

### Memo Format (deposit)
Frontend sends JSON via SPL Memo (base58 encoded on-chain):
```json
{"hashUserId": "hex32", "ephemeralPublicKey": "hex32", "nonce": "hex16", "ciphertext": "hex32"}
```

## Tech Stack

Express.js, TypeScript, MongoDB (Mongoose), Redis (ioredis), Socket.IO,
@solana/web3.js, @coral-xyz/anchor, @arcium-hq/client, Helius SDK,
Jupiter Ultra API, Pino logging, Zod validation, Helmet, Sentry

## API Routes

```
POST   /api/users/auth              — Register/login (Turnkey JWT)
POST   /api/users/check-availability — Check email/pseudo
GET    /api/users/check-verification — Pre-auth status
GET    /api/users/verify-magic-link  — Verify magic link
GET    /api/users/sol-price          — SOL/USD price
DELETE /api/users/account            — Delete account

POST   /api/wallet/privacy-wallet   — Register stealf wallet
GET    /api/wallet/history/:address  — Transaction history
GET    /api/wallet/balance/:address  — Wallet balance

POST   /api/swap/order              — Jupiter swap quote
POST   /api/swap/execute            — Execute signed swap

POST   /api/helius/helius           — Wallet transaction webhook
POST   /api/helius/vault            — Vault deposit webhook

GET    /api/yield/mxe-pubkey        — MXE public key for encryption
GET    /api/yield/balance/:userId   — Encrypted balance (MPC query)
GET    /api/yield/stats             — JitoSOL rate + APY
POST   /api/yield/withdraw          — Withdrawal via MPC

GET    /api/stats                   — Public app statistics
```

## Development

```bash
npm run dev          # Dev server (ts-node-dev)
npm run build        # TypeScript compilation
npm run start        # Production
```

## Important Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Entry point, Express + Socket.IO setup |
| `src/services/yield/` | MPC yield system (deposit, withdraw, balance, staking) |
| `src/services/yield/constant.ts` | Program IDs, PDA derivation, helpers |
| `src/services/yield/anchorProvider.ts` | Anchor singleton, MXE key, finalization |
| `src/services/yield/scanner.ts` | Webhook vault → deposit pipeline |
| `src/idl/private_yield.json` | Anchor IDL for MPC programme |
| `src/utils/validations.ts` | Zod schemas for all inputs |
| `src/config/env.ts` | Zod-validated environment variables |

## Conventions

- Controllers are classes with static methods
- Services are standalone functions or singleton classes
- All input validation via Zod at API boundary
- Structured logging with Pino (no console.log)
- Redis cache-aside pattern (5min TTL) for external API data
- Auth JWT verified via Turnkey on every protected route

## Security Notes

- `VAULT_AUTHORITY_PRIVATE_KEY` in .env — consider HSM for production
- Rate limiting disabled in development (`NODE_ENV !== 'production'`)
- CORS restricted to `FRONTEND_URL` in production only
- Webhook dedup is in-memory — consider Redis SET for persistence
- Balance endpoint returns plaintext over HTTPS (auth required)
