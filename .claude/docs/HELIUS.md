# Helius Integration

Real-time Solana wallet monitoring using Helius webhooks and enhanced transaction API.

## Webhook Flow

1. On startup, `HeliusWebhookManager` creates/updates a Helius webhook monitoring all user wallets
2. When a new user registers, their wallets (cash_wallet, stealf_wallet) are added to the webhook
3. Helius sends a POST to `/api/helius/helius` on every detected transaction
4. `TransactionHandler` processes the payload:
   - Detects SOL and SPL token transfers
   - Identifies vault deposits (triggers Privacy Cash deposit flow)
   - Updates wallet balance in cache
   - Saves transaction to history cache (max 100 per wallet)
   - Emits updates via Socket.IO

## Transaction History Flow

1. Client calls `GET /api/wallet/walletInfos/:address`
2. Check cache for existing history
3. If not cached, fetch from Helius API (paginated)
4. `parseHeliusTransaction()` normalizes raw data into standard format
5. `parseTransactions()` adds USD values and formatted dates
6. Return to client

## Architecture

```
Controller
  src/controllers/WebhookHeliusController.ts  — Receives Helius webhook POST requests
  src/controllers/walletController.ts         — Wallet balance + transaction history endpoints

Services
  src/services/helius/webhookManager.ts       — Webhook lifecycle (create, add/remove wallets)
  src/services/helius/transactionsHandler.ts  — Processes webhook payloads, detects vault deposits
  src/services/helius/walletInit.ts           — Fetches historical transactions from Helius API

Utils
  src/services/wallet/transactionParser.ts    — Parses enhanced transactions, token mapping, USD pricing
```
