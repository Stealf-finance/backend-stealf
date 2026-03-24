# Architecture — Stealf Backend

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                      │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                     │
│   │ Mobile   │    │ Helius   │    │ Socket   │                     │
│   │ App (RN) │    │ Webhooks │    │ Clients  │                     │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘                     │
└────────┼───────────────┼───────────────┼────────────────────────────┘
         │ HTTPS         │ HTTPS         │ WSS
         ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXPRESS SERVER (:3000)                           │
│                                                                     │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Helmet  │  │  CORS    │  │ Rate Limit │  │  Body Parser     │  │
│  │ Headers │  │ Origins  │  │ Per-route  │  │ 10kb / 5mb helius│  │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  └───────┬──────────┘  │
│       └─────────────┴──────────────┴─────────────────┘             │
│                            │                                        │
│  ┌─────────────────────────┼────────────────────────────────────┐  │
│  │                    ROUTES                                     │  │
│  │                                                               │  │
│  │  /api/users/*     Auth, magic links, prix SOL                │  │
│  │  /api/wallet/*    Soldes, historique, enregistrement          │  │
│  │  /api/swap/*      Jupiter swap (order + execute)              │  │
│  │  /api/helius/*    Webhooks (wallets + vault)                  │  │
│  │  /api/yield/*     MPC balance, withdraw, stats, mxe-pubkey   │  │
│  │  /api/stats       Statistiques publiques                      │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┼──────────────────────────────────┐  │
│  │                   MIDDLEWARE                                   │  │
│  │  verifyAuth (JWT Turnkey) │ errorHandler │ socketAuth         │  │
│  └───────────────────────────┼──────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┼──────────────────────────────────┐  │
│  │                   CONTROLLERS                                 │  │
│  │  authController    walletController    swapController         │  │
│  │  YieldController   WebhookHeliusCtrl   WebhookVaultCtrl      │  │
│  │  SolPriceCtrl      magicLinkCtrl       StatsController       │  │
│  └───────────────────────────┼──────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┼──────────────────────────────────┐  │
│  │                    SERVICES                                   │  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │  Auth    │  │  Wallet  │  │  Yield   │  │  Pricing    │  │  │
│  │  │----------│  │----------│  │----------│  │-------------│  │  │
│  │  │createUser│  │walletInit│  │balance.ts│  │solPrice.ts  │  │  │
│  │  │magicLink │  │txParser  │  │deposit.ts│  │jitoRate.ts  │  │  │
│  │  │preAuth   │  │txHandler │  │withdraw  │  └─────────────┘  │  │
│  │  └──────────┘  └──────────┘  │staking   │                   │  │
│  │                              │unstaking │  ┌─────────────┐  │  │
│  │  ┌──────────┐  ┌──────────┐  │scanner   │  │  Helius     │  │  │
│  │  │  Swap    │  │  Socket  │  │anchor    │  │-------------│  │  │
│  │  │----------│  │----------│  │constant  │  │webhookMgr   │  │  │
│  │  │jupiter   │  │socketSvc │  └──────────┘  └─────────────┘  │  │
│  │  └──────────┘  └──────────┘                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌──────────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐
│   MongoDB    │ │   Redis   │ │  Solana   │ │  External APIs   │
│              │ │           │ │  RPC      │ │                  │
│ - Users      │ │ - Sessions│ │ - Anchor  │ │ - Helius         │
│ - MagicLinks │ │ - Cache   │ │ - Arcium  │ │ - Jupiter        │
│ - Webhooks   │ │ - Prices  │ │ - Jito    │ │ - CoinGecko      │
│              │ │ - Rates   │ │ - Vault   │ │ - Resend         │
└──────────────┘ └───────────┘ └───────────┘ └──────────────────┘
```

## Structure des dossiers

```
backend-stealf/
├── src/
│   ├── server.ts                  # Point d'entrée, Express + HTTP + Socket.IO
│   ├── config/
│   │   ├── env.ts                 # Validation Zod des env vars
│   │   ├── cors.ts                # CORS (dev: all, prod: FRONTEND_URL)
│   │   ├── logger.ts              # Pino structured logging
│   │   ├── redis.ts               # Client Redis + retry
│   │   └── sentry.ts              # Sentry error tracking
│   ├── controllers/
│   │   ├── authController.ts      # Inscription, disponibilité, suppression
│   │   ├── magicLinkController.ts # Vérification magic link + pré-auth
│   │   ├── walletController.ts    # Soldes, historique, enregistrement wallet
│   │   ├── swapController.ts      # Jupiter swap (order + execute)
│   │   ├── WebhookHeliusController.ts  # Webhook transactions wallet
│   │   ├── WebhookVaultController.ts   # Webhook dépôts vault
│   │   ├── YieldController.ts     # Balance MPC, withdraw, stats
│   │   ├── SolPriceController.ts  # Prix SOL/USD
│   │   └── StatsController.ts     # Stats publiques
│   ├── middleware/
│   │   ├── auth.ts                # JWT Turnkey verification
│   │   ├── socketAuth.ts          # WebSocket auth
│   │   └── errorHandler.ts        # Global error handler + Sentry
│   ├── models/
│   │   ├── User.ts                # Schéma utilisateur
│   │   ├── MagicLink.ts           # Tokens magic link (TTL)
│   │   └── WebhookHelius.ts       # Références webhooks Helius
│   ├── routes/
│   │   ├── userRoutes.ts          # /api/users/*
│   │   ├── walletRoutes.ts        # /api/wallet/*
│   │   ├── swapRoutes.ts          # /api/swap/*
│   │   ├── webhookHeliusRoutes.ts # /api/helius/*
│   │   ├── yieldRoutes.ts         # /api/yield/*
│   │   └── statsRoutes.ts         # /api/stats
│   ├── services/
│   │   ├── auth/
│   │   │   ├── createUser.ts      # Création user + webhook Helius
│   │   │   ├── magicLinkService.ts # Génération/vérif magic links
│   │   │   └── preAuthService.ts  # Sessions pré-auth Redis
│   │   ├── wallet/
│   │   │   ├── walletInit.ts      # Fetch soldes/TX via Helius API
│   │   │   ├── transactionParser.ts # Normalisation transactions
│   │   │   └── transactionsHandler.ts # Traitement + émission Socket.IO
│   │   ├── yield/
│   │   │   ├── anchorProvider.ts  # Singleton Anchor + MXE key
│   │   │   ├── constant.ts        # Program IDs, PDAs, helpers
│   │   │   ├── balance.ts         # Query balance via MPC
│   │   │   ├── deposit.ts         # Enregistrement dépôt MPC
│   │   │   ├── withdraw.ts        # Retrait MPC + unstake
│   │   │   ├── staking.ts         # SOL → JitoSOL (Jito Stake Pool)
│   │   │   ├── unstaking.ts       # JitoSOL → SOL (Jupiter swap)
│   │   │   └── scanner.ts         # Webhook vault → deposit pipeline
│   │   ├── pricing/
│   │   │   ├── solPrice.ts        # SOL/USD (CoinGecko, cache 5min)
│   │   │   └── jitoRate.ts        # JitoSOL/SOL rate + APY (Jito API)
│   │   ├── helius/
│   │   │   └── webhookManager.ts  # CRUD webhooks Helius
│   │   ├── swapper/
│   │   │   └── jupiterSwapService.ts # Jupiter Ultra API
│   │   ├── socket/
│   │   │   └── socketService.ts   # Socket.IO init + events
│   │   ├── cache/
│   │   │   └── cacheService.ts    # Wrapper Redis get/set/del
│   │   └── token/
│   │       └── tokenResolver.ts   # Métadonnées tokens SPL
│   ├── types/
│   │   └── index.ts               # Types TypeScript partagés
│   ├── utils/
│   │   └── validations.ts         # Schémas Zod (auth, swap, yield...)
│   └── idl/
│       └── private_yield.json     # IDL Anchor du programme MPC
├── scripts/
│   └── check-user-state.ts        # Utilitaire debug PDA
├── package.json
├── tsconfig.json
└── .env.example
```

## Programmes Solana

### stealf_vault (`4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA`)

Programme de custody pour les SOL déposés. Le vault PDA reçoit les SOL
des utilisateurs. Le backend surveille les dépôts via webhook Helius.

```
PDAs:
  vault_state  = seeds["vault", vault_id_le(2)]
  sol_vault    = seeds["sol_vault", vault_state]
```

### private_yield (`BgjfDZSU1vqJJgxPGGuDAYBUieutknKHQVafwQnyMRrb`)

Programme Arcium MPC pour la comptabilité chiffrée. Gère les soldes
utilisateurs sous forme de ciphertexts. Le MXE (Multi-party eXecution
Environment) déchiffre, calcule, et re-chiffre.

```
Instructions:
  process_deposit          → Enregistrer un dépôt
  process_deposit_callback → Callback MPC après dépôt
  process_withdrawal       → Enregistrer un retrait
  process_withdrawal_callback → Callback MPC après retrait
  get_balance              → Requête de solde chiffré
  get_balance_callback     → Callback MPC avec résultat
  init_*_comp_def          → Initialisation des computation definitions

PDA:
  user_state = seeds["user_state", sha256(u128_to_le(uuid_to_u128(userId)))]
```

## Patterns architecturaux

| Pattern | Utilisation |
|---------|-------------|
| Singleton | AnchorProvider, SocketService, WebhookManager |
| Cache-aside | Redis 5min pour prix SOL, taux JitoSOL, sessions |
| Fire-and-forget | Webhook vault → réponse 200 immédiate, traitement background |
| Serialization queue | Scanner vault → promise chain pour éviter les race conditions staking |
| Dedup in-memory | Set de signatures (max 5000) pour éviter doublons webhook |
| Zod at boundary | Validation de tous les inputs API et webhooks |
