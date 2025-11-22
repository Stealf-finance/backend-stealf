# 🎯 Configuration Umbra - Informations Trouvées

## 📍 Program ID (Solana)

**Adresse du programme Umbra :**
```
A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4
```

**Source :** `src/lib/umbra-sdk/src/idl/idl.json` (ligne 2)

---

## 🌐 URLs des Services

### Relayer
```
https://relayer.umbraprivacy.com/
```
**Usage :** Pour soumettre des transactions gasless et casser le lien wallet

### Indexer
```
https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/
```
**Usage :** Pour récupérer les Merkle siblings nécessaires au claim

**Source :** `src/lib/umbra-sdk/src/constants/anchor.ts`

---

## 🔐 Arcium MXE Configuration

### MXE X25519 Public Key
```typescript
[27, 146, 220, 227, 8, 51, 189, 69, 119, 116, 110, 176, 137, 108, 212, 154,
 185, 95, 149, 7, 4, 186, 213, 240, 72, 99, 178, 235, 183, 45, 153, 36]
```

### Cluster Offset
```
768109697
```

### Comptes Arcium (dérivés automatiquement)
- **ARCIUM_CLUSTER_ACCOUNT** : Dérivé de CLUSTER_OFFSET
- **ARCIUM_MXE_ACCOUNT** : Dérivé du program ID
- **ARCIUM_MEMPOOL_ACCOUNT** : Dérivé du program ID
- **ARCIUM_EXECUTING_POOL_ACCOUNT** : Dérivé du program ID

**Source :** `src/lib/umbra-sdk/src/constants/arcium.ts`

---

## 🪙 Tokens Supportés

### WSOL (Wrapped SOL)
```
So11111111111111111111111111111111111111112
```

### Autres tokens SPL
Le protocole supporte tout token SPL via le mint address.

---

## 🌳 Merkle Tree

### Profondeur
```
48 levels
```
**Impact :** Peut gérer jusqu'à 2^48 deposits dans l'anonymity set

---

## ⚙️ Configuration .env Complète

```env
# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
SOLANA_PROGRAM_ID=A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4

# Umbra Services
UMBRA_RELAYER_URL=https://relayer.umbraprivacy.com/
UMBRA_INDEXER_URL=https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/

# Arcium MXE
ARCIUM_CLUSTER_OFFSET=768109697

# Security (Production)
ENCRYPTION_KEY=<generate-strong-key-here>

# MongoDB
MONGODB_URI=mongodb://localhost:27017/stealf_backend
```

---

## 🔄 Message de Signature (Pour Wallet Derivation)

```
Umbra Privacy - do NOT sign this message unless you are using an application
or integration with Umbra Privacy! Proceed cautiously as this signature will
be used to derive sensitive information that can be used to control/transact/
decrypt balances and funds from your Umbra Accounts.
```

**Source :** `src/lib/umbra-sdk/src/constants/arcium.ts` (DEFAULT_SIGNING_MESSAGE)

---

## 📡 Test de Connectivité

### 1. Test Program ID
```bash
# Vérifier si le programme existe sur Devnet
solana account A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4 \
  --url https://api.devnet.solana.com
```

### 2. Test Relayer
```bash
# Tester l'accès au relayer
curl https://relayer.umbraprivacy.com/health

# Ou
curl https://relayer.umbraprivacy.com/status
```

### 3. Test Indexer
```bash
# Tester l'accès à l'indexer
curl https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/

# Ou tester un endpoint spécifique
curl https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/siblings/0
```

---

## 🎯 Instructions de Déploiement

### Option A : Utiliser Programme Existant (Recommandé)

1. **Vérifier que le programme est déployé :**
   ```bash
   solana account A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4 \
     --url https://api.devnet.solana.com
   ```

2. **Si le programme existe :**
   - ✅ Utiliser le program ID directement
   - ✅ Utiliser le relayer Umbra
   - ✅ Utiliser l'indexer Umbra

3. **Tester les endpoints :**
   ```bash
   npm run test:connectivity  # À créer
   ```

### Option B : Déployer Notre Programme

Si le programme n'existe pas sur Devnet :

1. **Build le programme :**
   ```bash
   cd umbra-program  # Si source disponible
   anchor build
   ```

2. **Deploy sur Devnet :**
   ```bash
   anchor deploy --provider.cluster devnet
   ```

3. **Update le program ID dans .env**

4. **Setup notre propre indexer :**
   - Écouter les events on-chain
   - Construire le Merkle tree
   - Exposer API pour siblings

---

## 📊 Prochains Tests

### Test 1 : Vérifier Accès Programme
```bash
# Script à créer : test-program-access.ts
npx tsx test-program-access.ts
```

### Test 2 : Test Relayer
```bash
# Script à créer : test-relayer.ts
npx tsx test-relayer.ts
```

### Test 3 : Test Indexer
```bash
# Script à créer : test-indexer.ts
npx tsx test-indexer.ts
```

### Test 4 : Flow Complet
```bash
# Une fois tout vérifié
npm run test:umbra
```

---

## 🔑 Points Clés Découverts

1. ✅ **Program ID trouvé** : `A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4`
2. ✅ **Relayer URL disponible** : `https://relayer.umbraprivacy.com/`
3. ✅ **Indexer URL disponible** : `https://5nqw12m1pa.execute-api.eu-central-1.amazonaws.com/proof/`
4. ✅ **Arcium MXE configuré** dans le SDK
5. ✅ **Message de signature** défini
6. ✅ **Merkle tree depth** : 48 levels

---

## 🚀 Action Items

### Immédiat
- [ ] Tester si program ID existe sur Devnet
- [ ] Tester connectivité relayer
- [ ] Tester connectivité indexer
- [ ] Ajouter SOLANA_PROGRAM_ID dans .env

### Court Terme
- [ ] Implémenter IndexerService (fetch Merkle siblings)
- [ ] Implémenter SolanaWalletService.getKeypairForUser()
- [ ] Créer tests de connectivité

### Moyen Terme
- [ ] Tester deposit public
- [ ] Tester claim avec ZK proof
- [ ] Tester deposit confidentiel (si Arcium accessible)

---

## 💡 Notes Importantes

1. **Le SDK est complet** : Toutes les fonctions sont implémentées
2. **Services externes requis** :
   - Programme Solana déployé ✓ (ID trouvé)
   - Relayer accessible ✓ (URL trouvée)
   - Indexer accessible ✓ (URL trouvée)
3. **Arcium MXE** : Configuration trouvée, à tester
4. **ZK Circuits** : Inclus dans le SDK (WASM)

**Verdict** : Tout est là ! Il faut juste vérifier que les services externes (programme, relayer, indexer) sont accessibles.
