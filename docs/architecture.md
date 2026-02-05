# STEALF Backend Architecture

**Tech Stack**: Express.js 5.2.1, TypeScript, MongoDB (Mongoose), Redis, Socket.io, Solana/Helius

## Directory Structure

```
src/
├── config/              # Configuration
│   ├── database.ts      # MongoDB connection
│   ├── redis.ts         # Redis client
│   └── privacyCash.ts   # Privacy Cash client
├── controllers/         # Request handlers (8 files)
│   ├── authController.ts
│   ├── magicLinkController.ts
│   ├── walletController.ts
│   ├── PrivateTransferController.ts
│   ├── WebhookHeliusController.ts
│   └── solPriceController.ts
├── middleware/
│   ├── verifyAuth.ts    # JWT verification (Turnkey)
│   ├── errorHandler.ts  # Global error handling
│   ├── rateLimiter.ts   # Rate limiting
│   └── socketAuth.ts    # Socket.io auth
├── models/              # MongoDB schemas
│   ├── User.ts          # email, pseudo, cash_wallet, stealf_wallet, turnkey_subOrgId
│   ├── MagicLink.ts     # tokenHash, email, pseudo, expiresAt, used
│   ├── PrivateBalance.ts # userId, solBalance, usdcBalance
│   └── WebhookHelius.ts # Helius webhook config
├── routes/
│   ├── userRoutes.ts    # /api/users/*
│   ├── walletRoutes.ts  # /api/wallet/*
│   ├── privateTransferRoutes.ts # /api/private-transfer/*
│   └── webhookHeliusRoutes.ts   # /api/helius/*
├── services/
│   ├── auth/            # magicLinkService, preAuthService, createUser
│   ├── cache/           # Redis CacheService
│   ├── helius/          # walletInit (SolanaService), webhookManager
│   ├── privacycash/     # PrivacyCashService, Deposit, Withdraw, Balance
│   ├── wallet/          # transactionParser, transactionsHandler
│   ├── pricing/         # solPrice (CoinGecko)
│   └── socket/          # socketService (real-time updates)
├── utils/
│   └── validations.ts   # Zod schemas
└── server.ts            # Entry point
```

## API Endpoints

### User Routes (`/api/users`)
| Method | Path | Auth | Handler |
|--------|------|------|---------|
| POST | /auth | JWT | Create user |
| POST | /check-availability | Rate limited | Check email/pseudo |
| GET | /check-verification | - | Check magic link status |
| GET | /verify-magic-link | - | Verify token |
| GET | /sol-price | verifyAuth | Get SOL price |
| GET | /:userId | verifyAuth | Get user by wallet |

### Wallet Routes (`/api/wallet`)
| Method | Path | Auth | Handler |
|--------|------|------|---------|
| GET | /history/:address | verifyAuth | Transaction history |
| GET | /balance/:address | verifyAuth | Wallet balance |
| GET | /privacybalance/:idWallet | verifyAuth | Private balance |

### Private Transfer Routes (`/api/private-transfer`)
| Method | Path | Auth | Handler |
|--------|------|------|---------|
| POST | /initiatedeposit | verifyAuth | Start deposit |
| POST | /initiatewithdraw | verifyAuth | Start withdrawal |
| GET | /balance | verifyAuth | User's private balance |
| GET | /vault/balance | verifyAuth | Total vault balance |
| GET | /user/history | verifyAuth | Transfer history |
| GET | /:transferId | verifyAuth | Transfer status |
| POST | /:transferId/retry | verifyAuth | Retry failed |

### Webhook Routes (`/api/helius`)
| Method | Path | Auth | Handler |
|--------|------|------|---------|
| POST | /helius | Secret header | Helius webhooks |

## Authentication Flow

```
1. User submits email + pseudo
   → POST /check-availability
   → Creates MagicLink record (tokenHash, 10min expiry)
   → Stores pre-auth token in Redis
   → Sends magic link email via Resend

2. User clicks magic link
   → GET /verify-magic-link?token=xxx
   → Verifies token hash, marks used
   → Updates Redis pre-auth status

3. Frontend exchanges pre-auth + Turnkey JWT
   → POST /auth
   → verifySessionJwtSignature() validates JWT
   → Creates User in MongoDB
   → Adds wallets to Helius webhook
   → Creates PrivateBalance record
```

## Auth Middleware (verifyAuth)

```typescript
// Extracts Bearer token
// Verifies JWT signature via Turnkey
// Decodes payload manually (base64)
// Checks expiry
// Looks up user by turnkey_subOrgId
// Attaches to req.user: { sessionType, userId, organizationId, expiry, publicKey, mongoUserId }
```

## Real-time (Socket.io)

Events emitted:
- `balance:updated` - Wallet balance changes
- `transaction:new` - New transaction detected
- `private-transfer:status-update` - Deposit/withdraw status
- `private-balance:updated` - Private balance changes

## Caching (Redis)

Keys:
- `balance:{address}` - Wallet balance cache
- `history:{address}:{limit}` - Transaction history
- `preauth:{sessionId}` - Pre-auth token status
- `deposit:{reference}` - Pending deposit (10min TTL)
- `withdraw:{reference}` - Pending withdraw (10min TTL)

## Key Environment Variables

```
PORT, MONGODB_URI, REDIS_URL
SOLANA_RPC_URL, HELIUS_API_KEY
RESEND_API_KEY, BACKEND_URL
JWT_SECRET, TURNKEY_ORG_ID
WEBHOOK_URL, HELIUS_WEBHOOK_SECRET
VAULT_PUBLIC_KEY
```
