# 🚀 Quick Start - Arcium MPC

Guide ultra-rapide pour utiliser Arcium MPC dans ton projet Stealf.

---

## ✅ Ton code est DÉJÀ PRÊT!

**Bonne nouvelle**: Ton implémentation Arcium était **déjà correcte** ! J'ai juste:
1. ✅ Supprimé le faux service `arcium-mpc.service.ts`
2. ✅ Créé un vrai service clean `wallet-link.service.ts`
3. ✅ Ajouté des API routes
4. ✅ Écrit la documentation

---

## 📁 Fichiers importants

| Fichier | Description |
|---------|-------------|
| `programs/anonyme_transfer/src/lib.rs` | ✅ Programme Solana (CORRECT) |
| `encrypted-ixs/src/lib.rs` | ✅ Circuit MPC (CORRECT) |
| `tests/anonyme_transfer.ts` | ✅ Tests (FONCTIONNELS) |
| `src/services/arcium/wallet-link.service.ts` | ✅ Service TypeScript (NOUVEAU) |
| `src/routes/wallet-link.routes.ts` | ✅ API REST (NOUVEAU) |

---

## 🎯 Comment utiliser

### Option 1: Via TypeScript Service

```typescript
import WalletLinkService from './services/arcium/wallet-link.service';

// Setup
const service = new WalletLinkService(program, provider, config);

// Link new wallet
const result = await service.linkNewWallet(gridWallet, owner);

// Retrieve (login)
const wallets = await service.retrieveLinkedWallets(ownerPublicKey);
```

### Option 2: Via API REST

```bash
# Créer lien
curl -X POST http://localhost:3000/api/wallet-link/create \
  -H "Content-Type: application/json" \
  -d '{
    "gridWallet": "YourGridWalletAddress",
    "ownerPrivateKey": "YourBase58PrivateKey"
  }'

# Récupérer
curl -X POST http://localhost:3000/api/wallet-link/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "ownerPublicKey": "YourPublicKey"
  }'
```

---

## 🧪 Tester

```bash
# Tests sur devnet
npm test

# Ou avec Arcium localnet
arcium test
```

Tes tests **fonctionnent déjà** sur devnet! ✅

---

## 🔐 Comment ça marche (en 30 secondes)

1. **CLIENT** chiffre wallets avec `RescueCipher`
2. **SOLANA** stocke dans PDA on-chain
3. **ARCIUM MPC** re-chiffre sans voir le plaintext (distribué sur plusieurs nœuds!)
4. **SOLANA** émet event avec résultat
5. **CLIENT** déchiffre localement

**Privacy garantie**: Aucun nœud MPC ne voit le plaintext complet!

---

## 📚 Documentation complète

- **[ARCIUM_IMPLEMENTATION_STATUS.md](./ARCIUM_IMPLEMENTATION_STATUS.md)** - Status détaillé
- **[ARCIUM_MPC_GUIDE.md](./ARCIUM_MPC_GUIDE.md)** - Guide complet avec exemples

---

## ✅ Checklist

- [x] Circuit MPC fonctionne
- [x] Programme Solana fonctionne
- [x] Tests passent sur devnet
- [x] Service TypeScript créé
- [x] API routes créées
- [x] Documentation complète

**🎉 READY TO USE!**

---

## 💡 Next Steps

1. **Intégrer dans ton app React Native**
   - Utilise le service `wallet-link.service.ts`
   - Connecte avec Grid SDK

2. **Utiliser pour transactions privacy**
   - Le Private Wallet peut envoyer des transactions
   - Aucun lien on-chain avec le Grid Wallet

3. **Déployer en production**
   - Change `cluster` en `mainnet-beta` dans `Anchor.toml`
   - Deploy: `arcium deploy --network mainnet-beta`

---

**Questions?** Lis `ARCIUM_MPC_GUIDE.md` ou ping moi! 🚀
