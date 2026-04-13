# Real-time balance & history updates

## Architecture

```
┌─────────────┐    socket.io     ┌─────────────┐
│   Backend    │ ───────────────> │   Frontend   │
│  (watches    │  balance:updated │ useWalletInfos│
│   wallets)   │  transaction:new │  setQueryData │
└─────────────┘                  └──────┬────────┘
                                        │
                                   React Query
                                   cache update
                                        │
                                     UI re-render
```

## Two update mechanisms

### 1. Socket events (automatic, real-time)

The backend monitors subscribed wallet addresses on-chain. When a change is detected, it emits:

- **`balance:updated`** → `{ address, tokens[], totalUSD, timestamp }`
- **`transaction:new`** → `{ address, transaction, timestamp }`

Frontend listeners in `src/hooks/wallet/useWalletInfos.ts` call `queryClient.setQueryData()` directly — no refetch, instant UI update.

**Works for:** simple SOL/SPL transfers (send, receive)

**Does NOT work for:** Umbra program interactions (shield, unshield, depositFromCash, claim, sendPrivate, selfShield). The backend doesn't detect these as wallet events because the tx originates from or goes to the Umbra program PDA, not a simple transfer between wallets.

### 2. Query invalidation (manual, after Umbra operations)

After an Umbra operation, we call `queryClient.invalidateQueries()` to force a refetch from the API/indexer.

**Two types of data to invalidate:**

| Query key | Source | When to invalidate |
|---|---|---|
| `['shielded-balance']` | Umbra indexer (`fetchEncryptedBalances`) | After any operation that changes the encrypted balance: shield, unshield, depositFromCash, claim, sendPrivate |
| `['wallet-balance', address]` | Backend API | After Umbra ops that debit/credit an ATA without socket coverage: shield (stealth ATA), unshield (stealth ATA) |
| `['pending-claims']` | Umbra indexer (`fetchPendingClaims`) | After claimReceived |
| `['pending-claims-cash']` | Umbra indexer (`fetchPendingClaimsForCash`) | After claimSelfToPublic, selfShield |

## Timing constraints

### Shielded balance (encrypted)

The `deposit()` function submits a tx that **queues an Arcium MPC computation**. The encrypted balance is only updated after the MPC callback finalizes. This can take several seconds.

→ Immediate invalidation may return the old value. Use retries if needed:
```ts
[5000, 10000, 20000].forEach((d) =>
  setTimeout(() => queryClient.invalidateQueries({ queryKey: ['shielded-balance'] }), d)
);
```

### Wallet balance (public ATA)

After an Umbra program interaction, the Solana RPC may not have confirmed the tx yet when the invalidation fires.

→ Use a small delay (3s) before invalidating:
```ts
setTimeout(() => {
  queryClient.invalidateQueries({ queryKey: ['wallet-balance', address] });
}, 3000);
```

## Per-screen invalidation map

| Screen | Operation | Invalidations |
|---|---|---|
| `shield.tsx` | deposit (stealth public → encrypted) | `shielded-balance` (immediate) + `wallet-balance stealth` (3s delay) |
| `unshield.tsx` | withdraw (encrypted → stealth public) | `shielded-balance` (immediate) + `wallet-balance stealth` (3s delay) |
| `moove.tsx` (toPrivacy) | depositFromCash (cash → stealth encrypted) | `shielded-balance` (immediate + retries 5/10/20s) + `wallet-balance cash` + `wallet-balance stealth` + `pending-claims-cash` |
| `moove.tsx` (toCash) | selfShield (stealth encrypted → cash claim) | `wallet-balance cash` + `wallet-balance stealth` + `shielded-balance` + `pending-claims-cash` |
| `receive-cash.tsx` | claimSelfToPublic | `pending-claims-cash` + `wallet-balance cash` |
| `receive-private.tsx` | claimReceived | `pending-claims` + `shielded-balance` |
| `send-private-confirmation.tsx` | sendPrivate | `shielded-balance` |
| `send-confirmation.tsx` | sendTransaction | none (socket handles it) |

## Query cache config

- `wallet-balance`: `staleTime: Infinity` — never auto-refetches, only via invalidation or socket
- `wallet-history`: `staleTime: Infinity` — same
- `shielded-balance`: `staleTime: 30_000` — auto-refetches every 30s
- `pending-claims`: `staleTime: 20_000`, `refetchInterval: 30_000`
- `pending-claims-cash`: `staleTime: 20_000`, `refetchInterval: 30_000`
- `sol-price`: `staleTime: 60_000`, `refetchInterval: 60_000` (CoinGecko)

## SOL price

SOL/USD price is fetched from CoinGecko via `useSolPrice()` hook (60s cache). It is NOT derived from wallet balances — this avoids the bug where an empty wallet returns price=0 and all USD-denominated displays break.

## Socket subscription

Managed by `AuthContext.tsx` on login:
```ts
socketService.connect(sessionToken);
socketService.subscribeToWallet(cash_wallet);
socketService.subscribeToWallet(stealf_wallet);
```

Listeners attached in `useWalletInfos.ts`:
- `handleBalanceUpdate` → `setQueryData(['wallet-balance', address], ...)`
- `handleNewTransaction` → `setQueryData(['wallet-history', address], ...)`
