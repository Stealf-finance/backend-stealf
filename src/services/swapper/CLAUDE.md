# Stealf Swapper

Module de swap SPL token → USDC via Jupiter Ultra API, utilisé côté front (React Native / Expo).

## Flow

1 token, 1 TX, 1 signature Turnkey.

```
User choisit : token SPL + montant + recipient
       │
       ▼
   order() → Jupiter GET /ultra/v1/order
       │      (quote + TX unsigned en 1 appel)
       │      receiver = recipient wallet
       │
       ▼
   User voit le montant USDC estimé, confirme
       │
       ▼
   Front signe la TX via Turnkey (1 passkey)
       │
       ▼
   execute() → Jupiter POST /ultra/v1/execute
       │        (broadcast TX signée, Jupiter gère le landing)
       │
       ▼
   Recipient reçoit USDC directement
```

Le sender envoie son token SPL, Jupiter swap en USDC et l'envoie directement au recipient via le param `receiver`. Pas de passage par le sender ATA USDC.

## Structure

```
swapper/
├── srcs/
│   ├── index.ts                          # Exports publics (order, execute)
│   ├── constants.ts                      # USDC_MINT, JUPITER_ULTRA_URL, JUPITER_API_KEY
│   ├── types/
│   │   └── swap.ts                       # OrderRequest/Response, ExecuteRequest/Response
│   └── services/
│       ├── jupiter/
│       │   ├── orderService.ts           # GET /ultra/v1/order (quote + TX)
│       │   └── executeService.ts         # POST /ultra/v1/execute (broadcast)
│       └── swap/
│           └── swapOrchestrator.ts       # Orchestre order + execute
├── .env                                  # JUPITER_API_KEY
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## API publique

```typescript
import { order, execute } from 'stealf-swapper';

// 1. Order (quote + TX en 1 appel)
const res = await order({
  inputMint: 'So11111111111111111111111111111111111111112',
  amount: '10000000',
  taker: senderWalletAddress,
  receiver: recipientWalletAddress,
});
// res.outAmount = montant USDC, res.transaction = TX base64 unsigned

// 2. Signer via Turnkey (côté front)
const signedTx = await turnkey.signTransaction(res.transaction);

// 3. Execute (Jupiter broadcast)
const result = await execute(res.requestId, signedTx);
// result.signature = TX signature on-chain
```

## Contraintes

- **1 token, 1 TX** : un swap par transaction, pas de multi-token
- **Output toujours USDC** : mint fixe `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Destination directe** : le USDC arrive chez le recipient via param `receiver`
- **Turnkey signer** : TX sérialisée base64 signée par passkey, pas de keypair exposé
- **Jupiter Ultra API** : nécessite une clé API (header `x-api-key`), endpoints `/ultra/v1/order` et `/ultra/v1/execute`
- **Pas de RPC nécessaire** : Jupiter Ultra gère le broadcast et le landing des TX
