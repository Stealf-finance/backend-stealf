# API Backend - Documentation Technique

> **Kero Auth Bridge** - Bridge d'authentification TypeScript pour Grid Protocol (Squads)

## 📋 Table des Matières

- [Vue d'ensemble](#vue-densemble)
- [Architecture](#architecture)
- [Structure du projet](#structure-du-projet)
- [Flux d'authentification](#flux-dauthentification)
- [API Endpoints](#api-endpoints)
- [Services](#services)
- [Base de données](#base-de-données)
- [Sécurité](#sécurité)
- [Problèmes identifiés](#problèmes-identifiés)
- [Améliorations recommandées](#améliorations-recommandées)

---

## Vue d'ensemble

### Objectif
API backend Express agissant comme **bridge sécurisé** entre l'application mobile React Native et le Grid Protocol (Squads) pour :
- Créer des wallets Solana via authentification OTP email
- Gérer l'authentification utilisateur
- Stocker les sessions et clés de cryptage
- Interroger les soldes et transactions

### Stack Technique
- **Runtime** : Node.js v18+ avec TypeScript (ES2022)
- **Framework** : Express 5.1.0
- **Base de données** : MongoDB (Mongoose 8.18.1)
- **Cryptographie** :
  - `hpke-js` - HPKE (Hybrid Public Key Encryption)
  - `@noble/curves` - Courbes elliptiques P-256
  - `crypto` (Node.js native) - AES-256-GCM
- **HTTP Client** : Axios 1.12.2
- **Build** : TSC → dist/, Dev : tsx watch

### Ports
- **Production** : `3001`
- **Écoute sur** : `0.0.0.0` (toutes interfaces réseau)

---

## Architecture

### Pattern Architectural
```
┌─────────────────┐
│  Mobile App     │
│  (React Native) │
└────────┬────────┘
         │ HTTP (OTP + Auth)
         ▼
┌─────────────────────────────┐
│   API Bridge (Express)      │
│  - Routes handlers          │
│  - Session management       │
│  - JWT generation           │
└────────┬──────────┬─────────┘
         │          │
         │          └──────────────┐
         │                         │
         ▼                         ▼
┌────────────────┐      ┌──────────────────┐
│  MongoDB       │      │  Grid Protocol   │
│  - Users       │      │  (Squads API)    │
│  - Sessions    │      │  - Wallets       │
└────────────────┘      │  - Transactions  │
                        └──────────────────┘
         │
         └─────────────────────────┐
                                   ▼
                        ┌──────────────────┐
                        │  Key Manager     │
                        │  - HPKE keys     │
                        │  - Master key    │
                        │  (.keys/*)       │
                        └──────────────────┘
```

### Flux de Données
1. **Mobile → API** : Requête OTP/Auth avec email
2. **API → Grid** : Forward vers Grid Protocol
3. **Grid → Email** : Envoi OTP à l'utilisateur
4. **User → Mobile** : Saisie OTP
5. **Mobile → API** : Vérification OTP + génération clés HPKE
6. **API → Grid** : Vérification avec clé publique HPKE
7. **Grid → API** : Retour wallet address + clé d'autorisation chiffrée
8. **API → MongoDB** : Stockage user + session
9. **API → Key Manager** : Stockage clés privées (AES-256-GCM)

---

## Structure du Projet

### 📁 Structure Actuelle

```
apps/api/
├── src/
│   ├── config/
│   │   └── app.ts                       # Configuration Express centralisée (72 lignes)
│   ├── middleware/
│   │   ├── auth.ts                      # JWT authentication + authorization
│   │   └── errorHandler.ts              # Gestion d'erreurs + asyncHandler
│   ├── routes/
│   │   ├── grid.routes.ts               # ⚠️ TOUTES routes Grid (350 lignes)
│   │   │                                #    Auth + Accounts + logique métier
│   │   └── internal.ts                  # Routes internes (/internal/*)
│   ├── models/
│   │   ├── User.ts                      # Schéma utilisateur MongoDB
│   │   └── Session.ts                   # Schéma sessions OTP (TTL auto-cleanup)
│   ├── services/
│   │   ├── grid/
│   │   │   ├── grid-base.service.ts     # Config Axios + interceptors
│   │   │   ├── grid-auth.service.ts     # Appels Grid API /auth
│   │   │   ├── grid-account.service.ts  # Appels Grid API /accounts
│   │   │   └── grid-types.ts            # Types TypeScript (660 lignes)
│   │   ├── key-manager.service.ts       # Gestion clés HPKE + AES-256-GCM
│   │   └── privy-crypto.service.ts      # HPKE + ECDSA signatures
│   ├── database/
│   │   └── mongodb.ts                   # Connexion MongoDB
│   ├── scripts/
│   │   └── createIndexes.ts             # Script création indexes DB
│   └── server.ts                        # Point d'entrée (120 lignes)
├── .keys/
│   ├── master.key                       # Clé maître AES-256 (⚠️ plaintext)
│   └── user-keys.json                   # Clés utilisateurs chiffrées
├── API_DOCUMENTATION.md                 # Ce fichier
├── JWT_AUTHENTICATION.md                # Documentation JWT
└── package.json
```

### ⚠️ Problème Architectural Actuel

**grid.routes.ts** (350 lignes) contient :
- ✅ Définition des routes Express
- ❌ Logique métier complète (Session MongoDB, JWT, User CRUD)
- ❌ Appels directs aux services Grid
- ❌ Génération clés HPKE inline

**Ce qui devrait être fait** :
```
Routes → Controllers → Services → Grid API
(HTTP)   (Logique)    (API calls)
```

**Ce qui est fait actuellement** :
```
Routes → { Logique + Services + Grid API }
(Tout mélangé dans grid.routes.ts)
```

---

## Flux d'Authentification

### 1️⃣ Création de Compte (Nouveau Utilisateur)

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant A as API Bridge
    participant G as Grid Protocol
    participant E as Email Service
    participant K as Key Manager
    participant DB as MongoDB

    M->>A: POST /grid/accounts { email }
    A->>G: POST /accounts { email, type: "email" }
    G->>E: Send OTP email
    G-->>A: { status: "pending_verification", expires_at }
    A-->>M: { success: true }

    Note over M: User enters OTP

    M->>A: POST /grid/accounts/verify { email, otp_code }
    A->>K: generateHPKEKeys(email)
    K-->>A: { publicKey, privateKey }
    A->>G: POST /accounts/verify { email, otp, kms_provider_config }
    G-->>A: { address, grid_user_id, authentication }
    A->>DB: User.create({ email, gridAddress, gridUserId })
    A->>K: storeKeys(email, privateKey)
    A-->>M: { address, grid_user_id }
```

**Détails** :
- **Étape 1** : Envoi email → Grid génère session OTP (expire 10min)
- **Étape 2** : Génération paire HPKE (P-256) → clé publique envoyée à Grid
- **Grid retourne** :
  - Adresse wallet Solana
  - Clé d'autorisation chiffrée (HPKE encrypted)
  - Grid user ID
- **Stockage** :
  - MongoDB : `{ email, gridAddress, gridUserId, isActive: true }`
  - Key Manager : `{ publicKey, privateKey (encrypted AES-256) }`

### 2️⃣ Authentification (Utilisateur Existant)

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant A as API Bridge
    participant G as Grid Protocol
    participant DB as MongoDB

    M->>A: POST /grid/auth { email }
    A->>G: POST /auth { email }
    G-->>A: { session_id, otp_sent: true }
    A->>DB: Session.create({ sessionId, email, expiresAt })
    A-->>M: { session_id, expires_at }

    Note over M: User enters OTP

    M->>A: POST /grid/auth/verify { session_id, otp_code }
    A->>DB: Session.findOne({ sessionId })
    DB-->>A: { email }
    A->>A: generateHPKEKeys(email)
    A->>G: POST /auth/verify { email, otp, kms_provider_config }
    G-->>A: { address, policies, authentication }
    A->>DB: User.updateOne({ email }, { lastLogin: now })
    A->>A: JWT.sign({ email, address })
    A-->>M: { jwt_token, address, grid_user_id }
```

**Différences avec création** :
- Utilise `POST /auth` au lieu de `/accounts`
- Stockage session MongoDB avec `session_id`
- Retour JWT token pour authentification future
- Mise à jour `lastLogin` dans User

---

## API Endpoints

### 🔐 Authentification

#### `POST /grid/accounts`
Création de compte - Envoie OTP par email

**Request**
```json
{
  "email": "user@example.com"
}
```

**Response** (202 Accepted)
```json
{
  "data": {
    "type": "email",
    "email": "user@example.com",
    "status": "pending_verification",
    "otp_sent": true,
    "expires_at": "2025-10-08T17:20:00Z"
  }
}
```

#### `POST /grid/accounts/verify`
Vérification OTP + Création wallet

**Request**
```json
{
  "email": "user@example.com",
  "otp_code": "123456",
  "kms_provider_config": {
    "encryption_public_key": "base64_encoded_hpke_public_key"
  }
}
```

**Response** (200 OK)
```json
{
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "grid_user_id": "uuid-v4",
    "policies": {
      "signers": [
        {
          "address": "...",
          "role": "primary",
          "permissions": ["CAN_INITIATE", "CAN_VOTE", "CAN_EXECUTE"],
          "provider": "privy"
        }
      ],
      "threshold": 1
    }
  }
}
```

#### `POST /grid/auth`
Initier authentification (utilisateur existant)

**Request**
```json
{
  "email": "user@example.com"
}
```

**Response**
```json
{
  "session_id": "hex_string_64_chars",
  "message": "OTP sent to user@example.com",
  "expires_at": "2025-10-08T17:30:00Z"
}
```

#### `POST /grid/auth/verify`
Vérifier OTP et obtenir JWT

**Request**
```json
{
  "session_id": "hex_string_64_chars",
  "otp_code": "123456"
}
```

**Response**
```json
{
  "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "grid_user_id": "uuid-v4"
  }
}
```

### 👤 Gestion de Compte

#### `GET /grid/accounts/:address`
Détails du compte

**Response**
```json
{
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "type": "email",
    "status": "active",
    "policies": { ... },
    "email": "user@example.com",
    "created_at": "2025-10-08T15:00:00Z"
  }
}
```

#### `GET /grid/accounts/:address/balances`
Soldes SOL + tokens

**Query Parameters**
- `limit` (optional, default: 10, max: 100)
- `page` (optional, default: 1)

**Response**
```json
{
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "lamports": 1000000000,
    "sol": 1.0,
    "tokens": [
      {
        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "amount": "100000000",
        "decimals": 6,
        "symbol": "USDC",
        "name": "USD Coin"
      }
    ]
  }
}
```

#### `GET /grid/accounts/:address/transactions`
Historique des transactions

**Query Parameters**
- `limit` (optional, default: 10, max: 100)

**Response**
```json
{
  "data": {
    "transactions": [
      {
        "signature": "5J8...",
        "timestamp": "2025-10-08T16:00:00Z",
        "status": "confirmed",
        "amount": 0.5,
        "from": "...",
        "to": "..."
      }
    ]
  }
}
```

### ⚙️ Utilitaires

#### `GET /health`
Healthcheck du service

**Response**
```json
{
  "status": "ok",
  "timestamp": "2025-10-08T17:00:00Z",
  "service": "kero-auth-bridge",
  "mongodb": "connected"
}
```

#### `POST /internal/generate-hpke-keys`
⚠️ **Endpoint interne** - Générer clés HPKE

**Request**
```json
{
  "email": "user@example.com"
}
```

**Response**
```json
{
  "publicKey": "base64_spki_der",
  "privateKey": "base64_pkcs8_der"
}
```

---

## Services

### GridBaseService
**Fichier** : `src/services/grid/grid-base.service.ts`

Classe abstraite fournissant :
- Configuration Axios centralisée (`baseURL`, `timeout`, `headers`)
- Intercepteurs de requêtes (ajout `Authorization`, `x-grid-environment`, `x-idempotency-key`)
- Intercepteurs de réponses (logging succès/erreurs)

**Configuration** :
```typescript
baseURL: 'https://grid.squads.xyz/api/grid/v1'
timeout: 30000ms
headers: {
  'Authorization': `Bearer ${GRID_API_KEY}`,
  'x-grid-environment': 'production' | 'sandbox',
  'x-idempotency-key': uuidv4()
}
```

### GridAuthService
**Fichier** : `src/services/grid/grid-auth.service.ts`

Méthodes :
- `initiateAuthentication(email)` → `POST /auth`
- `verifyAuthentication(email, otp, kms_config)` → `POST /auth/verify`

### GridAccountService
**Fichier** : `src/services/grid/grid-account.service.ts`

Méthodes :
- `createAccount(request)` → `POST /accounts`
- `verifyOTP(email, otp, kms_config)` → `POST /accounts/verify`
- `getAccountDetails(address)` → `GET /accounts/{address}`
- `updateAccount(address, request)` → `PATCH /accounts/{address}`
- `getBalance(address, limit, page)` → `GET /accounts/{address}/balances`
- `getTransactions(address, limit)` → `GET /accounts/{address}/transactions`

### KeyManagerService
**Fichier** : `src/services/key-manager.service.ts`

**Responsabilités** :
- Génération/stockage des clés HPKE (P-256)
- Encryption des clés privées avec AES-256-GCM
- Gestion du master key (`.keys/master.key`)
- Persistence en JSON (`.keys/user-keys.json`)

**Méthodes principales** :
- `generateAndStoreHPKEKeys(email)` → Génère paire HPKE, chiffre private key, stocke
- `getHPKEKeys(email)` → Récupère et déchiffre les clés
- `storeAuthorizationKey(email, encryptedAuthKey)` → Déchiffre clé d'autorisation Grid et stocke
- `signPayload(email, kmsPayload)` → Signe un payload KMS avec la clé d'autorisation

**Format de stockage** :
```json
[
  {
    "email": "user@example.com",
    "hpkeKeys": {
      "publicKey": "base64_spki_der",
      "privateKey": "encrypted_with_aes256gcm"
    },
    "authorizationKey": "encrypted_with_aes256gcm",
    "gridAddress": "7xKXtg...",
    "createdAt": "2025-10-08T15:00:00Z",
    "updatedAt": "2025-10-08T17:00:00Z"
  }
]
```

### PrivyCryptoService
**Fichier** : `src/services/privy-crypto.service.ts`

**Cryptographie** :
- **HPKE** : DhkemP256HkdfSha256 + HkdfSha256 + Aes128Gcm
- **Courbe elliptique** : P-256 (prime256v1)
- **Formats** : SPKI DER (public), PKCS#8 DER (private)

**Méthodes** :
- `generateHPKEKeyPair()` → Génère paire P-256 en format DER
- `decryptAuthorizationKey(encryptedData, privateKey)` → Déchiffre avec HPKE
- `signPayload(kmsPayload, authKey)` → Signature ECDSA SHA-256
- `canonicalizeJson(obj)` → Tri récursif des clés (requis pour signature)

**Flux HPKE** :
1. Grid envoie `{ encapsulated_key, ciphertext }`
2. HPKE déchiffre avec clé privée utilisateur
3. Récupération de la clé d'autorisation en clair
4. Stockage chiffré avec AES-256-GCM

---

## Base de Données

### MongoDB Connection
**URI** : `mongodb+srv://`
**Database** : `kero-grid-bridge`

### Schéma User
```typescript
{
  email: String (required, unique, lowercase),
  username: String (default: ''),
  firstName: String (default: ''),
  lastName: String (default: ''),
  gridAddress: String,          // Adresse wallet Solana
  gridUserId: String,            // UUID Grid Protocol
  kycStatus: String (default: 'pending'),
  isActive: Boolean (default: true),
  createdAt: Date (default: now),
  lastLogin: Date,
  updatedAt: Date (default: now)
}
```

**Indexes** :
- `email` : unique
- ⚠️ **Manquant** : index sur `gridUserId`, `gridAddress`

### Schéma Session
```typescript
{
  sessionId: String (required, unique),  // Hex string 64 chars
  userId: String,
  email: String (required),
  otpAttempts: Number (default: 0),
  expiresAt: Date (required),            // TTL cleanup
  createdAt: Date (default: now),
  gridResponse: Object,                  // Réponse Grid brute
  isLogin: Boolean (default: false),
  fallbackOtp: String,                   // ⚠️ Non utilisé
  useFallback: Boolean (default: false)  // ⚠️ Non utilisé
}
```

**Indexes** :
- `sessionId` : unique
- `expiresAt` : TTL index (auto-delete après expiration)

---

## Sécurité

### ✅ Bonnes Pratiques Implémentées
1. **AES-256-GCM** pour chiffrement clés privées
2. **HPKE** (RFC 9180) pour échange clés avec Grid
3. **Permissions fichiers** : `0o600` sur master key et user keys
4. **TTL sessions** : Auto-cleanup MongoDB après expiration
5. **Idempotency keys** : UUID v4 pour requêtes Grid
6. **CORS** : Configuré (⚠️ trop permissif : `cors()`)

### ❌ Problèmes de Sécurité Critiques

#### 🔴 P0 - URGENT

1. **Secrets exposés dans `.env`** :
   ```bash
   MONGODB_PASSWORD=elsocor842b.
   GRID_API_KEY=48b93dff-b385-4fcf-b62b-fe859fe381bd
   ```
   ➜ **Action** : Ajouter `.env` à `.gitignore`, utiliser secrets manager

2. **Master key en plaintext** (`.keys/master.key`) :
   ```typescript
   const key = crypto.randomBytes(32);
   fs.writeFileSync(keyPath, key, { mode: 0o600 });
   ```
   ➜ **Action** : Intégrer AWS KMS / Azure Key Vault / HashiCorp Vault

3. **JWT Secret faible** :
   ```typescript
   const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
   ```
   ➜ **Action** : Fail fast si `JWT_SECRET` manquant

4. **Aucune authentification sur endpoints** :
   - `/grid/accounts/:address/balances` accessible sans auth
   - `/internal/generate-hpke-keys` exposé publiquement
   ➜ **Action** : Middleware JWT sur toutes routes sauf `/health`

5. **Aucune validation d'entrées** :
   - Format email non vérifié
   - Adresses Solana non validées
   - Pas de sanitization
   ➜ **Action** : Utiliser `zod` ou `joi` pour validation

6. **CORS permissif** :
   ```typescript
   app.use(cors());  // Accepte tous les origins
   ```
   ➜ **Action** : Whitelist origins en production

#### 🟠 P1 - Important

7. **Pas de rate limiting** :
   - OTP endpoint vulnérable au spam
   - Brute force possible sur vérification OTP
   ➜ **Action** : `express-rate-limit` sur endpoints sensibles

8. **Erreurs exposées au client** :
   ```typescript
   res.status(500).json({
     error: error.response?.data  // Peut contenir stack trace
   });
   ```
   ➜ **Action** : Sanitizer erreurs avant envoi

9. **Hardcoded Grid API key** :
   ```typescript
   this.apiKey = process.env.GRID_API_KEY || '48b93dff-b385-4fcf-b62b-fe859fe381bd';
   ```
   ➜ **Action** : Supprimer fallback

---

## Problèmes Identifiés

### 🔧 Code Quality

#### 1. **Logique métier dans les routes** ⚠️ CRITIQUE
**Localisation** : `grid.routes.ts:27-226`
```typescript
router.post('/auth/verify', async (req, res) => {
  // ❌ 150 lignes de logique métier :
  // - Gestion Session MongoDB
  // - Génération clés HPKE
  // - Appels Grid API
  // - Création/Update User
  // - Génération JWT
  // - Cleanup Session
});
```
➜ **Action** : Déplacer vers `services/auth.service.ts` avec méthodes high-level

#### 2. **Duplication logique Auth/Accounts**
```typescript
// grid.routes.ts:67-226 - Auth login (150 lignes)
// grid.routes.ts:245-295 - Account verify (50 lignes)
// ➜ Logique presque identique (Session + JWT + User)
```
➜ **Action** : Extraire logique commune dans service partagé

#### 3. **Error handling partiellement centralisé**
- ✅ Middleware `errorHandler` existe
- ❌ Mais route `/auth/verify` a son propre try/catch (lines 67-226)
- ❌ Ne utilise pas `asyncHandler` partout
➜ **Action** : Utiliser `asyncHandler` sur toutes les routes

#### 4. **Types `any` dans routes critiques**
```typescript
catch (error: any) {                    // grid.routes.ts:210
const { email, otp_code } = req.body;  // Pas de validation types
```
➜ **Action** : Ajouter validation Zod/Joi + types stricts

#### 5. **Services Grid sous-utilisés**
- `grid-auth.service.ts` : Appelle juste Grid API (bon)
- `grid-account.service.ts` : Appelle juste Grid API (bon)
- ❌ Routes appellent services + font toute la logique métier
➜ **Action** : Créer couche service pour logique métier (Session, JWT, User)

### 🗄️ Base de Données

1. **Indexes manquants** :
   ```typescript
   gridUserId: String,    // Requêté souvent, pas d'index
   gridAddress: String,   // Requêté souvent, pas d'index
   ```

2. **Validation email manquante** :
   ```typescript
   email: { type: String, required: true, unique: true }
   // Devrait avoir : match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
   ```

3. **Timestamps manuels** :
   ```typescript
   createdAt: { type: Date, default: Date.now },
   updatedAt: { type: Date, default: Date.now }
   // Devrait utiliser : timestamps: true
   ```

4. **Code inutilisé** :
   ```typescript
   // mongodb.ts - Schéma jamais utilisé
   const PrivatePDASchema = new mongoose.Schema({ ... });
   ```

### 🏗️ Architecture

1. **Séparation des responsabilités manquante** :
   - ✅ Routes séparées (`grid.routes.ts`)
   - ❌ Logique métier dans routes au lieu de services
   - ❌ Pas de couche Controller
   - ❌ Pas de pattern Repository pour MongoDB
   ➜ **Action** : Implémenter architecture en couches propre

2. **Middleware partiellement implémentés** :
   - ✅ `authenticateJWT` - Protection JWT
   - ✅ `requireOwnResource` - Authorization
   - ✅ `errorHandler` - Error handling centralisé
   - ✅ `asyncHandler` - Wrapper async
   - ❌ Rate limiting (spam OTP possible)
   - ❌ Validation requests (Zod/Joi)
   - ⚠️ Request logging (seulement en dev, basique)

3. **Services Grid bien structurés** :
   - ✅ `grid-base.service.ts` - Config Axios commune
   - ✅ `grid-auth.service.ts` - Endpoints /auth
   - ✅ `grid-account.service.ts` - Endpoints /accounts
   - ✅ Séparation claire des responsabilités
   - ❌ Manque couche service métier au-dessus

### 🐛 Bugs Potentiels

1. **Signature ECDSA cassée** :
   ```typescript
   // privy-crypto.service.ts:213
   const privateKey = keyPair.privateKey;  // Utilise clé générée, pas celle de l'user
   ```
   ➜ La signature n'utilise pas la vraie clé privée

2. **Erreurs DB silencieuses** :
   ```typescript
   } catch (dbError) {
     console.error('MongoDB error:', dbError);
     // Don't fail the request  ← Utilisateur croit que ça a réussi
   }
   ```

3. **Pas de gestion shutdown** :
   ```typescript
   process.on('SIGTERM', () => {
     mongoose.connection.close();
     process.exit(0);  // Force exit, pas de drain des connexions
   });
   ```

---

## Améliorations Recommandées

### Phase 1 - Architecture (URGENT - Bloque maintenabilité)
**Durée estimée** : 2-3 jours

- [ ] **Extraire logique métier de grid.routes.ts** vers services
  - Créer `services/auth.service.ts` avec méthodes `initiateLogin()`, `verifyLoginOTP()`
  - Créer `services/account.service.ts` pour logique comptes
  - Routes deviennent de simples wrappers HTTP
- [ ] **Supprimer duplication Auth/Accounts**
  - Logique Session + JWT + User quasi-identique
  - Extraire dans service commun
- [ ] **Utiliser asyncHandler partout**
  - Route `/auth/verify` a son propre try/catch
  - Uniformiser error handling

### Phase 2 - Sécurité (Critique)
**Durée estimée** : 2-3 jours

- [ ] Déplacer secrets vers AWS Secrets Manager / Vault
- [ ] Intégrer KMS pour master key (AWS KMS / Azure Key Vault)
- [x] ✅ Middleware authentication JWT (déjà fait)
- [ ] Ajouter validation entrées avec Zod
- [ ] Configurer CORS strict (whitelist origins)
- [ ] Ajouter rate limiting (express-rate-limit)
- [ ] Fail fast si JWT_SECRET manquant
- [x] ✅ Protéger `/internal/*` avec API key (déjà fait)

### Phase 3 - Code Quality (Important)
**Durée estimée** : 2-3 jours

- [x] ✅ Créer middleware error handler centralisé (déjà fait)
- [x] ✅ Séparer routes dans modules (déjà fait)
- [ ] Typer toutes les fonctions (supprimer `any`)
- [ ] Créer custom error classes
- [ ] Ajouter JSDoc sur fonctions publiques
- [ ] Fixer implémentation signature ECDSA
- [ ] Ajouter indexes MongoDB (gridUserId, gridAddress)
- [ ] Ajouter validation Mongoose (email regex, etc.)

### Phase 3 - Features (Nice to have)
**Durée estimée** : 5-7 jours

- [ ] Ajouter tests unitaires (Jest)
- [ ] Ajouter tests intégration (Supertest)
- [ ] Générer documentation Swagger/OpenAPI
- [ ] Ajouter logging structuré (Winston/Pino)
- [ ] Ajouter monitoring (Prometheus metrics)
- [ ] Ajouter tracing (OpenTelemetry)
- [ ] Améliorer healthcheck (check Grid API, MongoDB)
- [ ] Graceful shutdown complet
- [ ] Ajouter CI/CD (tests + linting)

### Exemple de Refactoring Recommandé

#### ❌ Avant (grid.routes.ts - Actuel)
```typescript
router.post('/auth/verify', async (req, res) => {
  try {
    const { session_id, otp_code } = req.body;

    // ❌ 150 lignes de logique métier ici :
    const session = await Session.findOne({ sessionId: session_id });
    if (!session) return res.status(404).json({ error: '...' });

    const keypair = privyCryptoService.generateHPKEKeyPair();
    const gridResponse = await gridAuthService.verifyAuthentication({...});

    let user = await User.findOne({ email: session.email });
    if (!user) {
      user = await User.create({...});
    } else {
      user.lastLogin = new Date();
      await user.save();
    }

    const access_token = jwt.sign({...}, jwtSecret, { expiresIn: '7d' });
    const refresh_token = jwt.sign({...}, jwtSecret, { expiresIn: '30d' });

    await Session.deleteOne({ sessionId: session_id });

    res.json({ tokens: {...}, user: {...} });
  } catch (error: any) {
    // ... error handling manuel
  }
});
```

#### ✅ Après (Recommandé)
```typescript
// routes/grid.routes.ts (simple wrapper HTTP)
import { authService } from '../services/auth.service';

router.post('/auth/verify', asyncHandler(async (req: Request, res: Response) => {
  const { session_id, otp_code } = req.body;

  // ✅ Toute la logique dans le service
  const result = await authService.verifyLoginOTP(session_id, otp_code);

  res.json(result);
}));

// services/auth.service.ts (logique métier)
export class AuthService {
  async verifyLoginOTP(session_id: string, otp_code: string) {
    // Validation session
    const session = await this.sessionRepository.findBySessionId(session_id);
    if (!session) throw new SessionNotFoundError();
    if (session.isExpired()) throw new SessionExpiredError();
    if (session.otpAttempts >= 3) throw new TooManyAttemptsError();

    // Génération clés HPKE
    const keypair = this.cryptoService.generateHPKEKeyPair();

    // Vérification OTP avec Grid
    const gridResponse = await this.gridAuthService.verifyAuthentication({
      email: session.email,
      otp_code,
      kms_provider: 'privy',
      kms_provider_config: { encryption_public_key: keypair.publicKey }
    });

    // Gestion User
    const user = await this.userRepository.findOrCreateByEmail(
      session.email,
      gridResponse.data
    );

    // Génération JWT
    const tokens = this.jwtService.generateTokens(user, gridResponse.data);

    // Cleanup
    await this.sessionRepository.delete(session_id);

    return {
      tokens,
      user: this.userMapper.toDTO(user)
    };
  }
}
```

**Avantages** :
- ✅ Routes = thin wrappers HTTP (5-10 lignes)
- ✅ Logique métier testable indépendamment
- ✅ Réutilisable (ex: CLI, workers)
- ✅ Error handling centralisé via `asyncHandler`
- ✅ Types stricts partout
- ✅ Injection de dépendances claire

---

## Configuration

### Variables d'Environnement

```bash
# Server
PORT=3001
NODE_ENV=production

# MongoDB
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/kero-grid-bridge

# Grid Protocol
GRID_API_KEY=your_api_key_here
GRID_ENVIRONMENT=production  # or sandbox

# Security
JWT_SECRET=your_strong_jwt_secret_min_32_chars
MASTER_ENCRYPTION_KEY=base64_encoded_key  # Si on utilise KMS

# Logging
LOG_LEVEL=info
```

### Démarrage

```bash
# Development
npm run dev

# Production (build first)
npm run build
npm start
```

---

## Monitoring

### Logs à Surveiller

```bash
# Succès authentification
✅ MongoDB connected
✅ Auth session created: <session_id> for <email>
✅ User <email> stored/updated in MongoDB

# Erreurs critiques
❌ MongoDB connection error
❌ Grid API Error: { method, url, status, data }
❌ Failed to verify authentication
❌ Failed to store session
```

### Métriques à Tracker

- **Taux de succès OTP** : `otp_success_rate`
- **Latence Grid API** : `grid_api_latency_ms`
- **Erreurs MongoDB** : `mongodb_errors_total`
- **Sessions actives** : `active_sessions_count`
- **Taux d'utilisation master key** : `key_operations_total`

---

## Références

- [Grid Protocol Documentation](https://docs.grid.squads.xyz)
- [HPKE RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)
- [Express Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [OWASP API Security](https://owasp.org/www-project-api-security/)

---

**Version** : 1.0
**Dernière mise à jour** : 2025-10-08
**Statut** : ⚠️ Functional but requires security hardening before production
