# Stealf Backend

Solana wallet backend with private transfers, real-time transaction tracking, and passwordless authentication.

## Quick Start

```bash
npm install
npm run dev

# For webhook reception (dev only)
ngrok http 3000
```

## Architecture

```
src/
├── config/          — Environment & service configuration
├── controllers/     — API route handlers
├── middleware/      — Auth, rate limiting, error handling
├── models/          — MongoDB schemas
├── routes/          — Express route definitions
├── services/        — Business logic (see below)
├── types/           — TypeScript definitions
└── utils/           — Validation schemas (Zod)
```

## Services

| Service | Description |
|---------|-------------|
| **auth/** | User creation, magic link login, pre-auth verification |
| **cache/** | Redis wrapper for balances, prices, transaction history |
| **helius/** | Helius webhook management + wallet transaction fetching |
| **pricing/** | SOL/USD price from CoinGecko with cache |
| **privacycash/** | Private deposits & withdrawals via zero-knowledge proofs |
| **socket/** | Socket.IO real-time updates (balances, transactions, transfers) |
| **wallet/** | Transaction parsing, token mapping, USD pricing |

## Controllers

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/*` | Registration, session validation, email checks |
| `GET /api/wallet/walletInfos/:address` | Wallet balance + transaction history |
| `POST /api/private-transfer/initiate` | Initiate private deposit |
| `POST /api/private-transfer/withdraw` | Initiate private withdrawal |
| `GET /api/private-transfer/balance` | Get private balance |
| `POST /api/helius/helius` | Helius webhook receiver |
| `GET /api/users/sol-price` | Current SOL/USD price |
| `GET /api/users/check-verification` | Magic link validation |

## Models

| Model | Purpose |
|-------|---------|
| **User** | Account info, Solana wallets (cash + stealf), Turnkey subOrg |
| **PrivateBalance** | Private vault balance (SOL + USDC) per user |
| **MagicLink** | One-time auth tokens for passwordless login |
| **WebhookHelius** | Helius webhook registration metadata |

## Middleware

- **verifyAuth** — Validates Turnkey JWT, extracts subOrgId, checks user exists
- **preAuth** — Stealf-managed JWT for pre-authentication flow
- **rateLimiter** — API rate limiting
- **socketAuth** — WebSocket authentication

## Stack

MongoDB · Redis · Express · Socket.IO · Helius SDK · Solana Web3.js · Turnkey · Zod
