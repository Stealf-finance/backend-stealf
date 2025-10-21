# Solana Wallet Service

Service de génération et gestion sécurisée des wallets Solana pour chaque utilisateur.

## 🔑 Fonctionnement

### Création de wallet
Lors de la création d'un compte (`POST /grid/accounts/verify`), un wallet Solana est **automatiquement généré** pour l'utilisateur.

### Stockage sécurisé
- **Clé publique** : Stockée dans MongoDB (`User.solanaWallet`)
- **Clé privée** : Chiffrée avec AES-256-GCM et stockée dans `.wallets/{userId}.json`
- **Clé de chiffrement** : Stockée dans `.keys/wallet-encryption.key` (32 bytes)

### Structure de fichiers

```
apps/api/
├── .keys/
│   └── wallet-encryption.key        # Clé maître AES-256 (⚠️ SENSIBLE)
├── .wallets/
│   ├── 507f1f77bcf86cd799439011.json  # Wallet user 1
│   ├── 507f191e810c19729de860ea.json  # Wallet user 2
│   └── ...
└── src/services/wallet/
    ├── solana-wallet.service.ts     # Service principal
    └── README.md                    # Ce fichier
```

### Format d'un fichier wallet

```json
{
  "userId": "507f1f77bcf86cd799439011",
  "email": "user@example.com",
  "publicKey": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "encryptedSecretKey": "iv:authTag:encrypted (base64)",
  "createdAt": "2025-10-08T12:00:00.000Z"
}
```

## 📡 API Usage

### Générer un wallet (automatique)
```typescript
import { solanaWalletService } from './services/wallet';

// Lors de la création d'un compte
const publicKey = await solanaWalletService.generateWallet(
  user._id.toString(),
  user.email
);
```

### Récupérer un wallet
```typescript
// Récupérer le Keypair complet (clé privée déchiffrée)
const keypair = await solanaWalletService.getWallet(userId);

// Récupérer uniquement la clé publique
const publicKey = await solanaWalletService.getPublicKey(userId);

// Vérifier si un wallet existe
const hasWallet = await solanaWalletService.hasWallet(userId);
```

## 🔐 Sécurité

### Chiffrement
- **Algorithme** : AES-256-GCM
- **IV** : 16 bytes aléatoires par wallet
- **Auth Tag** : Vérifie l'intégrité des données

### Permissions fichiers
- `.keys/` : `0o700` (lecture/écriture propriétaire uniquement)
- `wallet-encryption.key` : `0o600` (lecture propriétaire uniquement)
- `.wallets/{userId}.json` : `0o600` (lecture propriétaire uniquement)

### ⚠️ Important
- **JAMAIS** commiter les dossiers `.keys/` et `.wallets/` dans Git
- Ces dossiers sont dans `.gitignore`
- En production, utiliser un KMS (AWS KMS, Azure Key Vault, HashiCorp Vault)

## 🔄 Flux complet

```
1. User crée un compte
   └─→ POST /grid/accounts { email }
   └─→ POST /grid/accounts/verify { email, otp_code }

2. Backend vérifie OTP avec Grid
   └─→ Grid retourne { address, grid_user_id }

3. Backend crée User MongoDB
   └─→ User.create({ email, gridAddress, gridUserId })

4. 🔑 Backend génère wallet Solana
   └─→ solanaWalletService.generateWallet(user._id, email)
       ├─ Keypair.generate()
       ├─ Chiffrement clé privée (AES-256-GCM)
       └─ Sauvegarde .wallets/{userId}.json

5. Backend met à jour User
   └─→ user.solanaWallet = publicKey
   └─→ user.save()

6. Réponse au frontend
   └─→ { tokens, user: { ..., solana_wallet: "7xKXtg..." } }
```

## 🧪 Testing

```typescript
// Test de génération
const publicKey = await solanaWalletService.generateWallet('test-user-id', 'test@example.com');
console.log('Generated wallet:', publicKey);

// Test de récupération
const keypair = await solanaWalletService.getWallet('test-user-id');
console.log('Public key:', keypair.publicKey.toBase58());
```

## 📝 Notes

- Un wallet est généré **une seule fois** lors de la création du compte
- Si un user se reconnecte, son wallet existant est retourné
- Les wallets sont liés à `user._id` (MongoDB ObjectId)
- Le système est compatible avec les transactions Solana futures

## 🚀 Production Checklist

- [ ] Migrer vers un KMS cloud (AWS KMS, Azure Key Vault)
- [ ] Ajouter backup automatique des wallets
- [ ] Implémenter rotation des clés de chiffrement
- [ ] Ajouter monitoring des accès aux wallets
- [ ] Mettre en place audit trail
- [ ] Tester recovery en cas de perte de clé maître
