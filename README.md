# Stealf Backend - GRID SDK

Backend pour l'application Stealf utilisant le SDK GRID pour la gestion des comptes et transactions Solana.

## 🚀 Installation

```bash
npm install
```

## ⚙️ Configuration

1. Copiez le fichier `.env.example` en `.env`:
```bash
cp .env.example .env
```

2. Configurez vos variables d'environnement dans `.env`:
```env
PORT=3001
NODE_ENV=development
GRID_API_KEY=votre_cle_api_grid
GRID_ENV=sandbox
```

## 🏃 Démarrage

### Mode développement (avec hot reload)
```bash
npm run dev
```

### Mode production
```bash
npm run build
npm start
```

## 📡 Endpoints API

### Authentification

#### Initier l'authentification (Étape 1)
```http
POST /grid/auth
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Réponse:**
```json
{
  "session_id": "string"
}
```

#### Vérifier l'OTP (Étape 2)
```http
POST /grid/auth/verify
Content-Type: application/json

{
  "session_id": "string",
  "otp_code": "123456"
}
```

### Création de compte

#### Créer un compte (Étape 1)
```http
POST /grid/accounts
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Vérifier l'OTP et finaliser la création (Étape 2)
```http
POST /grid/accounts/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "otp_code": "123456",
  "sessionSecrets": {},
  "user": {
    "email": "user@example.com"
  }
}
```

### Gestion des comptes

#### Créer un smart account
```http
POST /grid/smart-accounts
Content-Type: application/json

{
  "network": "solana-devnet"
}
```

#### Récupérer le solde
```http
POST /grid/balance
Content-Type: application/json

{
  "smartAccountAddress": "SolanaAddress..."
}
```

#### Récupérer les transferts
```http
GET /grid/transfers?smart_account_address=SolanaAddress...
```

### Transactions

#### Créer une intention de paiement
```http
POST /grid/payment-intent
Content-Type: application/json

{
  "smartAccountAddress": "SolanaAddress...",
  "payload": {
    "amount": "1000000",
    "destination": "DestinationAddress..."
  }
}
```

#### Confirmer et envoyer la transaction
```http
POST /grid/confirm
Content-Type: application/json

{
  "address": "SolanaAddress...",
  "signedTransactionPayload": "base64_encoded_transaction"
}
```

## 🏗️ Structure du projet

```
new-back/
├── src/
│   ├── config/
│   │   └── gridClient.ts       # Configuration du SDK GRID
│   ├── routes/
│   │   ├── auth.routes.ts      # Routes d'authentification
│   │   ├── account.routes.ts   # Routes de gestion des comptes
│   │   └── transaction.routes.ts # Routes de transactions
│   ├── types/
│   │   └── errors.ts           # Types d'erreurs
│   └── server.ts               # Serveur Express principal
├── .env.example                # Template de configuration
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Technologies utilisées

- **Express.js** - Framework web
- **TypeScript** - Langage typé
- **@sqds/grid** - SDK GRID pour Solana
- **dotenv** - Gestion des variables d'environnement
- **cors** - Gestion CORS

## 📝 Notes importantes

- Le backend utilise le SDK GRID en mode serveur (avec API Key)
- L'API Key GRID ne doit JAMAIS être exposée au frontend
- Utilisez `sandbox` pour le développement et les tests
- Le SDK détermine automatiquement l'endpoint GRID basé sur `GRID_ENV`

## 🛡️ Sécurité

- Ne commitez jamais le fichier `.env`
- Gardez votre `GRID_API_KEY` secrète
- Utilisez HTTPS en production
- Configurez CORS correctement avec `CORS_ORIGINS`

## 🚨 Health Check

Pour vérifier que le serveur fonctionne:

```bash
curl http://localhost:3001/health
```

Réponse:
```json
{
  "status": "ok",
  "timestamp": "2025-10-21T...",
  "environment": "sandbox"
}
```

## 📚 Documentation GRID

Pour plus d'informations sur le SDK GRID, consultez la documentation officielle.
