# Privacy Cash Integration

Private Solana transactions using zero-knowledge proofs. No transfer history is stored — only current balances are persisted.

## Deposit Flow

1. User calls `POST /api/private-transfer/initiate` with amount, token, and source wallet
2. A deposit record is created in cache (10min TTL) with a unique reference UUID
3. User sends funds to the Stealf vault  with the reference as memo
4. Webhook detects the transaction — `TransferCorrelationService` matches it by memo + amount
5. `PrivacyCashService.depositSOL()` or `depositSPL()` executes the private deposit
6. User's private balance is updated and emitted via Socket.IO
7. Cache entry is deleted

## Withdraw Flow

1. User calls `POST /api/private-transfer/withdraw` with amount, token, and recipient address
2. Balance is checked (amount + fee)
3. `PrivacyCashService.withdrawSOL()` or `withdrawSPL()` executes immediately
4. Balance is subtracted (amount + fee) and emitted via Socket.IO
5. Cache entry is deleted

## Architecture

```
Controller
  src/controllers/PrivateTransferController.ts    — API endpoints (deposit, withdraw, balance)

Services
  src/services/privacycash/PrivacyCashService.ts          — Low-level deposit/withdraw calls (SOL + SPL)
  src/services/privacycash/PrivacyDeposit.ts              — Deposit orchestration
  src/services/privacycash/PrivacyWithdraw.ts             — Withdraw orchestration
  src/services/privacycash/PrivacyBalanceService.ts       — Balance tracking (SOL + USDC)
  src/services/privacycash/TransferCorrelationService.ts  — Matches webhook tx to deposits via memo

Model
  src/models/PrivateBalance.ts                    — Stores userId + solBalance + usdcBalance
```