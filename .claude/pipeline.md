# Pipeline — Flows Backend / Frontend

## 1. Authentification

```
┌──────────┐                    ┌──────────┐                  ┌─────────┐
│  Mobile  │                    │ Backend  │                  │ Turnkey │
│  App     │                    │          │                  │         │
└────┬─────┘                    └────┬─────┘                  └────┬────┘
     │                               │                             │
     │  POST /api/users/auth         │                             │
     │  {email, pseudo, wallets,     │                             │
     │   turnkeyToken}               │                             │
     │──────────────────────────────>│                             │
     │                               │  Verify JWT                 │
     │                               │────────────────────────────>│
     │                               │  OK + organizationId       │
     │                               │<────────────────────────────│
     │                               │                             │
     │                               │  Upsert User (MongoDB)     │
     │                               │  Register webhook (Helius) │
     │                               │  Generate pre-auth token   │
     │                               │  Send magic link (Resend)  │
     │                               │                             │
     │  { preAuthToken }             │                             │
     │<──────────────────────────────│                             │
     │                               │                             │
     │  User clicks magic link       │                             │
     │  GET /verify-magic-link?t=... │                             │
     │──────────────────────────────>│                             │
     │                               │  Verify token hash (bcrypt)│
     │                               │  Mark session verified     │
     │  { verified: true }           │                             │
     │<──────────────────────────────│                             │
     │                               │                             │
     │  GET /check-verification      │                             │
     │  (polling avec preAuthToken)  │                             │
     │──────────────────────────────>│                             │
     │  { status, jwt }             │                             │
     │<──────────────────────────────│                             │
```

## 2. Dépôt Yield (SOL → JitoSOL chiffré)

```
┌──────────┐              ┌──────────┐              ┌──────────┐
│  Mobile  │              │ Backend  │              │  Solana  │
│  App     │              │          │              │          │
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     │  1. Préparer le memo    │                         │
     │  {hashUserId,           │                         │
     │   ephemeralPublicKey,   │                         │
     │   nonce, ciphertext}    │                         │
     │                         │                         │
     │  2. TX: Transfer SOL    │                         │
     │     + SPL Memo          │                         │
     │     → sol_vault PDA     │                         │
     │─────────────────────────┼────────────────────────>│
     │                         │                         │
     │                         │  3. Helius Webhook      │
     │                         │  POST /api/helius/vault │
     │                         │<────────────────────────│
     │                         │                         │
     │                         │  4. Réponse 200         │
     │                         │  (immédiate)            │
     │                         │────────────────────────>│
     │                         │                         │
     │                         │  ┌─── Background ──────────────────┐
     │                         │  │                                  │
     │                         │  │  5. Parse memo (base58 → JSON)  │
     │                         │  │  6. Dedup signature              │
     │                         │  │  7. Check minimum deposit        │
     │                         │  │                                  │
     │                         │  │  8. Enqueue (serialize)          │
     │                         │  │  ┌────────────────────────────┐  │
     │                         │  │  │ stakeToJito(lamports)      │  │
     │                         │  │  │  → SOL → JitoSOL           │  │
     │                         │  │  │  → Return jitosolAmount    │  │
     │                         │  │  │                            │  │
     │                         │  │  │ processDeposit(            │  │
     │                         │  │  │   userIdHash,              │  │
     │                         │  │  │   jitosolAmount,           │  │
     │                         │  │  │   memoEphPub,              │  │
     │                         │  │  │   memoNonce,               │  │
     │                         │  │  │   memoCt)                  │  │
     │                         │  │  │  → X25519 encrypt amount   │  │
     │                         │  │  │  → TX process_deposit      │  │
     │                         │  │  │  → Await MPC finalization  │  │
     │                         │  │  └────────────────────────────┘  │
     │                         │  └──────────────────────────────────┘
```

### Détail du memo

```
Frontend construit le memo JSON :

  userId (UUID)
       │
       ▼
  uuidToU128(userId)              → bigint u128
       │
       ▼
  u128ToLE(bigint)                → Buffer 16 bytes (little-endian)
       │
       ▼
  SHA256(le_bytes)                → hashUserId (32 bytes hex)
       │
       ▼
  x25519 ephemeral keypair       → ephemeralPublicKey (32 bytes hex)
       │
       ▼
  RescueCipher.encrypt(userId)   → nonce (16 bytes hex) + ciphertext (32 bytes hex)
       │
       ▼
  JSON.stringify({hashUserId, ephemeralPublicKey, nonce, ciphertext})
       │
       ▼
  SPL Memo instruction (UTF-8 → base58 on-chain)
```

## 3. Retrait Yield (JitoSOL chiffré → SOL)

```
┌──────────┐              ┌──────────┐              ┌──────────┐
│  Mobile  │              │ Backend  │              │  Solana  │
│  App     │              │          │              │          │
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     │  POST /api/yield/withdraw                         │
     │  {userId, amount, wallet}                         │
     │────────────────────────>│                         │
     │                         │                         │
     │                         │  1. Encrypt for MPC     │
     │                         │     - userId → ct       │
     │                         │     - amount → ct       │
     │                         │     - wallet → ct       │
     │                         │       (hi/lo 128 bits)  │
     │                         │                         │
     │                         │  2. TX process_withdrawal│
     │                         │────────────────────────>│
     │                         │                         │
     │                         │  3. Await MPC           │
     │                         │  finalization (~30s)    │
     │                         │<────────────────────────│
     │                         │                         │
     │                         │  4. Unstake JitoSOL     │
     │                         │     → Jupiter swap      │
     │                         │     JitoSOL → SOL       │
     │                         │────────────────────────>│
     │                         │                         │
     │                         │  5. Transfer SOL        │
     │                         │     → user wallet       │
     │                         │────────────────────────>│
     │                         │                         │
     │  {mpcSignature,         │                         │
     │   transferSignature,    │                         │
     │   estimatedSolOut}      │                         │
     │<────────────────────────│                         │
```

## 4. Consultation Balance

```
┌──────────┐              ┌──────────┐              ┌──────────┐
│  Mobile  │              │ Backend  │              │  Solana  │
│  App     │              │          │              │  (MPC)   │
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     │  GET /api/yield/balance/:userId                   │
     │────────────────────────>│                         │
     │                         │                         │
     │                         │  1. Generate ephemeral  │
     │                         │     X25519 keypair      │
     │                         │                         │
     │                         │  2. TX get_balance      │
     │                         │     (ephPub + dummy ct) │
     │                         │────────────────────────>│
     │                         │                         │
     │                         │  3. MPC decrypts shares │
     │                         │     re-encrypts with    │
     │                         │     shared secret       │
     │                         │     (ephPub + MXE key)  │
     │                         │                         │
     │                         │  4. Await finalization  │
     │                         │<────────────────────────│
     │                         │                         │
     │                         │  5. Read computation    │
     │                         │     account output      │
     │                         │  6. Decrypt with ephPriv│
     │                         │     → plaintext balance │
     │                         │                         │
     │  {balanceLamports,      │                         │
     │   balanceJitosol,       │                         │
     │   balanceSol,           │                         │
     │   rate, apy}            │                         │
     │<────────────────────────│                         │
```

**Note** : Le backend voit le solde en clair après déchiffrement. C'est un compromis
accepté car le backend est notre propre infrastructure sécurisée (auth JWT obligatoire).

## 5. Swap (Jupiter)

```
┌──────────┐              ┌──────────┐              ┌──────────┐
│  Mobile  │              │ Backend  │              │ Jupiter  │
│  App     │              │          │              │ Ultra API│
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     │  POST /api/swap/order   │                         │
     │  {inputMint, outputMint,│                         │
     │   amount, taker}        │                         │
     │────────────────────────>│                         │
     │                         │  POST /order             │
     │                         │────────────────────────>│
     │                         │  {transaction, requestId}│
     │                         │<────────────────────────│
     │  {transaction, requestId}                         │
     │<────────────────────────│                         │
     │                         │                         │
     │  Sign transaction       │                         │
     │  (Turnkey embedded)     │                         │
     │                         │                         │
     │  POST /api/swap/execute │                         │
     │  {requestId, signedTx}  │                         │
     │────────────────────────>│                         │
     │                         │  POST /execute           │
     │                         │────────────────────────>│
     │                         │  {signature, status}     │
     │                         │<────────────────────────│
     │  {signature, status}    │                         │
     │<────────────────────────│                         │
```

## 6. Temps réel (WebSocket)

```
┌──────────┐              ┌──────────┐              ┌──────────┐
│  Mobile  │              │ Backend  │              │  Helius  │
│  App     │              │ Socket.IO│              │ Webhook  │
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     │  WS connect + JWT       │                         │
     │────────────────────────>│                         │
     │                         │  Verify JWT             │
     │  Connected              │                         │
     │<────────────────────────│                         │
     │                         │                         │
     │  subscribe:wallet       │                         │
     │  {address}              │                         │
     │────────────────────────>│                         │
     │                         │  Join room(address)     │
     │                         │                         │
     │                         │  POST /api/helius/helius│
     │                         │<────────────────────────│
     │                         │                         │
     │                         │  Parse transaction      │
     │                         │  Update balances        │
     │                         │                         │
     │  wallet:transaction     │                         │
     │  {type, amount, from,   │                         │
     │   to, signature}        │                         │
     │<────────────────────────│                         │
     │                         │                         │
     │  wallet:balance         │                         │
     │  {sol, tokens[]}        │                         │
     │<────────────────────────│                         │
```

## Concurrence des dépôts

```
Plusieurs dépôts simultanés → serialization queue

  Deposit A ──┐
  Deposit B ──┤     ┌──────────────────────────────────────┐
  Deposit C ──┘     │         Promise Chain (FIFO)          │
                    │                                        │
                    │  ┌─────────┐  ┌─────────┐  ┌────────┐│
                    │  │ Stake A │→ │ Stake B │→ │Stake C ││
                    │  │ + MPC A │  │ + MPC B │  │+ MPC C ││
                    │  └─────────┘  └─────────┘  └────────┘│
                    │                                        │
                    │  Chaque stake vérifie le delta JitoSOL │
                    │  avant/après → doit être séquentiel    │
                    └────────────────────────────────────────┘
```
