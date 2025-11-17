# Scripts de Test et Initialisation

Ce dossier contient les scripts TypeScript pour tester et initialiser le programme Stealf sur Solana Devnet.

---

## 🌟 **NOUVEAU: Scripts Umbra-Style Shielded Pool** (2025-11-13)

Stealf a été transformé en un **vrai shielded pool Umbra-style** avec commitments, stealth addresses, et ZK proofs. Les nouveaux scripts permettent de tester cette architecture anonyme.

### `test-umbra-flow.ts` - Test Complet Flow Umbra
**Description:** Test end-to-end du shielded pool avec anonymity set

**Usage:**
```bash
npx ts-node scripts/test-umbra-flow.ts
```

**Ce que ça fait:**
1. Initialize CommitmentTree & NullifierRegistry
2. **Deposit with commitment** - Alice envoie à Bob de manière anonyme
3. **Scanning** - Bob scanne les commitments et détecte le sien
4. **Claim with ZK proof** - Bob reçoit les fonds (unlinkable)

**Résultat attendu:**
```
✅ Test Complete!
📊 Summary:
  - Alice deposited 0.5 SOL with commitment
  - Commitment added to tree (unlinkable)
  - Bob scanned and detected his commitment
  - Bob claimed 0.5 SOL to new address
  - Result: FULLY ANONYMOUS TRANSFER! 🎉
```

---

### `scan-commitments.ts` - Scanner de Commitments
**Description:** Scanne la blockchain pour détecter les commitments appartenant à l'utilisateur

**Usage:**
```bash
npx ts-node scripts/scan-commitments.ts
```

**Ce que ça fait:**
- Fetch tous les `DepositCommitmentEvent` de la blockchain
- Utilise la X25519 encryption key pour scanner
- Détecte quels commitments appartiennent au user
- Affiche les commitments claimables

---

### `utilities/umbra-crypto.ts` - Utilitaires Crypto Umbra
**Description:** Fonctions cryptographiques pour Umbra-style

**Fonctions principales:**
- `generateStealthAddress()` : Génère stealth address avec ECDH
- `scanCommitment()` : Détecte si commitment appartient au user
- `createCommitment()` : Crée commitment hash
- `createNullifierHash()` : Crée nullifier hash
- `generateUmbraKeypair()` : Génère dual keypair (Ed25519 + X25519)

**Usage (dans code):**
```typescript
import {
  generateStealthAddress,
  scanCommitment,
  createCommitment
} from "./utilities/umbra-crypto";

// Génère stealth address pour Bob
const { stealthAddress, ephemeralPublicKey } = generateStealthAddress(
  bobEncryptionPubkey,
  bobSpendingPubkey,
  ephemeralPrivateKey
);
```

---

## 📋 Scripts Existants (Architecture Originale)

Ces scripts testent l'architecture originale avec vault et MPC.

## 📋 Scripts Principaux

### `init-comp-def.ts`
**Description:** Initialise la Computation Definition pour `validate_transfer`

**Usage:**
```bash
npx ts-node scripts/init-comp-def.ts
```

**Quand l'utiliser:**
- Après le premier déploiement du programme
- Après avoir modifié le circuit MPC `validate_transfer`

**Note:** Nécessite que le MXE soit déjà initialisé (via `arcium deploy`)

---

### `test-validation-only.ts`
**Description:** Test de validation MPC simple (sans transfert SOL réel)

**Usage:**
```bash
npx ts-node scripts/test-validation-only.ts
```

**Ce que ça fait:**
- Chiffre `sender_balance` et `transfer_amount` avec x25519 + RescueCipher
- Queue une computation MPC pour validation
- Attends le callback avec résultat chiffré
- **NE TRANSFÈRE PAS** de SOL - juste validation

**Résultat attendu:**
```
✅ SUCCESS! Encrypted validation completed!
   ✅ Amount was ENCRYPTED end-to-end with Arcium MPC
   ✅ Validation happened on encrypted data
```

---

### `test-devnet-transfer-DEPRECATED.ts` ⚠️ DEPRECATED
**Description:** Version incohérente qui prépare un transfert mais ne l'exécute pas

**Pourquoi DEPRECATED:**
- Passe des comptes `transferState` et `recipient` qui ne sont pas utilisés
- Passe le montant en clair (`new anchor.BN(transferAmount.toString())`)
- Le callback ne fait rien avec ces paramètres

**À NE PAS UTILISER** - Gardé pour référence historique uniquement

---

## 🛠️ Utilities

Le dossier `utilities/` contient des scripts d'initialisation et de diagnostic:

### MXE Initialization
- `init-mxe.ts` - Init MXE simple
- `init-mxe-simple.ts` - Init MXE basique
- `manual-init-mxe.ts` - Init MXE manuel
- `manual-init-mxe-raw.ts` - Init MXE raw (debug)

### CompDef Initialization
- `init-comp-def-manual.ts` - Init CompDef manuel (alternative à `init-comp-def.ts`)

### Diagnostics
- `check-mxe-current.ts` - Vérifier l'état du MXE
- `find-mxe-program.ts` - Trouver l'adresse MXE du programme

---

## 🚀 Workflow de Test Standard

### 1. Premier Déploiement
```bash
# 1. Build
arcium build

# 2. Deploy programme
solana program deploy target/deploy/private.so \
  --program-id target/deploy/private-keypair.json \
  --url devnet

# 3. Init MXE
arcium deploy --skip-deploy --cluster-offset 1078779259 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com

# 4. Init CompDef
npx ts-node scripts/init-comp-def.ts

# 5. Test validation
npx ts-node scripts/test-validation-only.ts
```

### 2. Tests Après Modification Circuit
```bash
# 1. Rebuild
arcium build

# 2. Upgrade programme
solana program deploy target/deploy/private.so \
  --program-id target/deploy/private-keypair.json \
  --url devnet \
  --upgrade-authority ~/.config/solana/id.json

# 3. Réinit CompDef (si circuit modifié)
npx ts-node scripts/init-comp-def.ts

# 4. Test
npx ts-node scripts/test-validation-only.ts
```

---

## ⚠️ Prérequis

### Solana CLI
```bash
solana --version  # >= 1.18
solana config get  # Doit pointer vers devnet
solana balance  # Au moins 2 SOL pour les tests
```

### Node.js & TypeScript
```bash
node --version  # >= 20.x
npm install  # Installer les dépendances
```

### Variables d'Environnement
Le wallet utilisé est: `~/.config/solana/id.json`

---

## 📊 Structure des Transactions

### Validation Simple (test-validation-only.ts)
```
Client
  │
  ▼ 1. Encrypt values (x25519)
┌──────────────────────────┐
│ senderBalance: Enc(...)  │
│ transferAmount: Enc(...) │
└────────────┬─────────────┘
             │
             ▼ 2. validate_transfer()
┌──────────────────────────┐
│ Queue Computation        │
└────────────┬─────────────┘
             │
             ▼ 3. MPC Computation
┌──────────────────────────┐
│ Arcium Cluster Devnet    │
│ Validate: amt <= balance │
└────────────┬─────────────┘
             │
             ▼ 4. Callback
┌──────────────────────────┐
│ validate_transfer_       │
│ callback()               │
│ → Emit ValidationEvent   │
└──────────────────────────┘
```

**Résultat:** Event avec `is_valid` chiffré, **aucun transfert SOL**

---

## 🐛 Troubleshooting

### Error: "AccountNotInitialized" sur mxe_account
**Solution:** Lancer `arcium deploy --skip-deploy` ou vérifier le MXE avec `npx ts-node scripts/utilities/check-mxe-current.ts`

### Error: "InvalidCallbackInstructions" (Error 6209)
**Cause:** Circuit retourne `Enc<Shared, T>` mais pas de callback
**Solution:** Vérifier que `callback_ix(&[])` est bien passé dans `queue_computation`

### CompDef Already Initialized
**Solution:** Soit:
- Créer une nouvelle instruction avec un nom différent
- OU redéployer le programme avec un nouveau Program ID

### Timeout MPC
**Symptôme:** `awaitComputationFinalization` bloque > 2 minutes
**Solution:**
- Vérifier la charge du cluster public Arcium
- Réessayer plus tard
- Vérifier les logs Solana avec `solana logs --url devnet`

---

## 📚 Ressources

- [Arcium Documentation](https://docs.arcium.com)
- [Hello World Guide](https://docs.arcium.com/developers/hello-world)
- [Programme Solana Explorer](https://explorer.solana.com/address/2utpgDyZ4jUpCWtJVzE9HYUAngzz8pDchKgEviWPf4Q5?cluster=devnet)

---

**Dernière mise à jour:** 2025-11-10
**Version Programme:** `2utpgDyZ4jUpCWtJVzE9HYUAngzz8pDchKgEviWPf4Q5`
