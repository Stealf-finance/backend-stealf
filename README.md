# Stealf Backend

Backend API pour **Stealf**, un wallet mobile Solana axé sur la **confidentialité financière**.
Stealf permet aux utilisateurs de détenir, échanger et faire fructifier leurs actifs Solana
tout en gardant leurs soldes privés grâce au chiffrement MPC (Multi-Party Computation) via Arcium.

## Fonctionnalités principales

- **Authentification passwordless** — Magic links + Turnkey embedded wallets
- **Wallet Solana** — Soldes, historique, transferts en temps réel via WebSocket
- **Swap** — Échange de tokens via Jupiter Ultra API
- **Yield privé** — Staking JitoSOL avec soldes chiffrés par MPC (Arcium)
- **Webhooks Helius** — Détection en temps réel des transactions on-chain
- **Prix en temps réel** — SOL/USD (CoinGecko), JitoSOL/SOL (Jito API)

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Base de données | MongoDB (Mongoose) |
| Cache | Redis (ioredis) |
| Blockchain | Solana (@solana/web3.js, Anchor) |
| MPC / Chiffrement | Arcium (@arcium-hq/client, x25519, RescueCipher) |
| Staking | Jito Stake Pool |
| Swap | Jupiter Ultra API |
| Webhooks | Helius Enhanced Transactions |
| Auth | Turnkey SDK + JWT |
| Email | Resend |
| WebSocket | Socket.IO |
| Logging | Pino (structured) |
| Monitoring | Sentry |
| Sécurité | Helmet, express-rate-limit, Zod validation |

## Prérequis

- Node.js >= 18
- MongoDB
- Redis
- Compte Helius (API key + webhooks)
- Compte Turnkey (auth embedded wallets)
- Compte Resend (emails transactionnels)
- Programme Solana `private_yield` déployé (Arcium MPC)
- Programme Solana `stealf_vault` déployé

## Installation

```bash
git clone <repo-url>
cd backend-stealf
npm install
cp .env.example .env   # Remplir les variables
npm run dev
```

## Variables d'environnement

Voir `.env.example` pour la liste complète. Les principales :

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | Connexion MongoDB |
| `REDIS_URL` | Connexion Redis |
| `SOLANA_RPC_URL` | RPC Solana (Helius recommandé) |
| `HELIUS_API_KEY` | API Helius pour webhooks + données on-chain |
| `HELIUS_WEBHOOK_SECRET` | Secret d'authentification des webhooks |
| `VAULT_AUTHORITY_PRIVATE_KEY` | Clé du payer pour les transactions MPC |
| `PRIVATE_YIELD_PROGRAM_ID` | Program ID du smart contract Arcium |
| `FRONTEND_URL` | URL du front (CORS) |

## Endpoints API

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/users/auth` | Inscription/connexion utilisateur |
| POST | `/api/users/check-availability` | Vérifier email/pseudo |
| GET | `/api/users/check-verification` | Statut pré-auth |
| GET | `/api/users/verify-magic-link` | Vérifier magic link |
| GET | `/api/users/sol-price` | Prix SOL/USD |
| DELETE | `/api/users/account` | Supprimer compte |
| POST | `/api/wallet/privacy-wallet` | Enregistrer wallet Stealf |
| GET | `/api/wallet/history/:address` | Historique transactions |
| GET | `/api/wallet/balance/:address` | Solde wallet |
| POST | `/api/swap/order` | Demander un swap (quote) |
| POST | `/api/swap/execute` | Exécuter un swap signé |
| POST | `/api/helius/helius` | Webhook transactions wallet |
| POST | `/api/helius/vault` | Webhook dépôts vault |
| GET | `/api/yield/mxe-pubkey` | Clé publique MXE |
| GET | `/api/yield/balance/:userId` | Balance chiffrée via MPC |
| GET | `/api/yield/stats` | Taux JitoSOL + APY |
| POST | `/api/yield/withdraw` | Retrait via MPC |
| GET | `/api/stats` | Statistiques publiques |

## Scripts

```bash
npm run dev          # Développement (ts-node-dev)
npm run build        # Compilation TypeScript
npm run start        # Production
npm run check-state  # Vérifier un UserState PDA on-chain
```

## Licence

Propriétaire — Stealf © 2026
