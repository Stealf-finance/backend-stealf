# Stealf Privacy System - Documentation Technique

## Vue d'ensemble

Stealf utilise un **Privacy Pool** pour casser le lien on-chain entre l'expéditeur et le destinataire. **Arcium MPC n'est PAS utilisé** (les noeuds MXE du devnet ne sont pas configurés).

---

## Architecture Actuelle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React Native)                        │
│                                                                          │
│  useSendTransaction.ts ──► arciumApiClient.ts ──► POST /api/arcium/pool/transfer
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Node.js/Express)                      │
│                                                                          │
│  arcium.routes.ts ──► privacy-pool.service.ts                           │
│                              │                                           │
│                              ├── buildDepositInstruction()               │
│                              ├── executeWithdrawal()                     │
│                              └── createPrivateTransfer()                 │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SOLANA BLOCKCHAIN (Devnet)                        │
│                                                                          │
│  Programme: 55RNcHf6ktm89ko4vraLGHhdkAvpuykzKP2Kosyci62E                │
│  Pool PDA:  25MjNuRJiMhRgnGobfndBQQqehu5GhdZ1Ts4xyPYfTWj                │
│                                                                          │
│  Instructions:                                                           │
│    - deposit(amount)   → Sender envoie au Pool                          │
│    - withdraw(amount)  → Pool envoie au Recipient                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fichiers UTILISES (A GARDER)

### Frontend (`front-stealf/`)

| Fichier | Description |
|---------|-------------|
| `src/hooks/useSendTransaction.ts` | Hook principal pour les transactions. Appelle le Privacy Pool. |
| `src/services/arciumApiClient.ts` | Client API. Seule `encryptedTransfer()` est utilisée (appelle `/api/arcium/pool/transfer`). |
| `src/services/solanaWalletService.ts` | Gestion du wallet Solana (clés, signatures). |
| `src/services/stealfService.ts` | Gestion du wallet privé. |
| `src/app/(send)/SendPrivate.tsx` | Page d'envoi privé. |
| `src/app/(send)/SendPrivateConfirmation.tsx` | Confirmation de transaction privée. |

### Backend (`backend-stealf/`)

| Fichier | Description |
|---------|-------------|
| `src/routes/arcium.routes.ts` | Routes API. **Seuls les endpoints `/pool/*` sont utilisés** (lignes 350-526). |
| `src/services/privacy-pool.service.ts` | Service principal du Privacy Pool. Exécute les 2 transactions. |
| `src/config/arcium.config.ts` | Configuration (RPC URL, etc.). |

### Programme Solana (`stealf_pool/`)

| Fichier | Description |
|---------|-------------|
| `programs/stealf_pool/src/lib.rs` | Programme Anchor. Instructions: `initialize`, `deposit`, `withdraw`. |

---

## Fichiers NON UTILISES (A SUPPRIMER)

### Frontend (`front-stealf/`)

| Fichier | Raison |
|---------|--------|
| `src/services/arciumService.ts` | Service mock client-side. Jamais importé. |
| `src/hooks/usePrivateTransfer.ts` | Hook jamais importé par aucun composant. |

### Backend (`backend-stealf/`)

| Fichier | Raison |
|---------|--------|
| `src/routes/arcium-init.routes.ts` | Pas importé dans server.ts. |
| `src/routes/arcium-circuit.routes.ts` | Sert les circuits Arcium (non utilisés). |
| `src/routes/mixer.routes.ts` | Mixer alternatif non utilisé par le frontend. |
| `src/routes/umbra.routes.ts` | Protocol Umbra ZK non utilisé. |
| `src/services/arcium/encrypted-transfer.service.ts` | Service Arcium MPC complet mais jamais appelé. |
| `src/models/arcium-transfer.model.ts` | Schema MongoDB pour Arcium (aucune donnée). |
| `src/models/mixer-deposit.model.ts` | Schema pour le mixer (non utilisé). |
| `src/models/DepositArtifacts.ts` | Schema pour Umbra (non utilisé). |
| `arcium-private-transfer/` | **Dossier entier** - Tentative Arcium abandonnée. |
| `src/lib/umbra-sdk/` | SDK Umbra non utilisé. |

### Dans `arcium.routes.ts` (lignes a supprimer)

Les endpoints suivants (lignes 24-348) ne sont **JAMAIS appelés** :
- `POST /arcium/init`
- `POST /arcium/transfer/encrypted`
- `POST /arcium/transfer/decrypt`
- `GET /arcium/transfers/:userId`
- `GET /arcium/received/:address`
- `GET /arcium/stats`
- `POST /arcium/keypair/generate`

---

## Flux d'une Transaction Privee

### 1. Frontend (useSendTransaction.ts)

```typescript
// Ligne 110-115
const poolResult = await arciumApi.encryptedTransfer({
  fromPrivateKey: solanaPrivateKeyBase58,  // Clé privée du wallet public
  toAddress: privateWalletAddress,          // Adresse du wallet privé
  amount: amountInSOL,
  userId: userWalletAddress,
});
```

### 2. API Call (arciumApiClient.ts)

```typescript
// Ligne 201-208
export async function encryptedTransfer(request) {
  return fetchArcium('/api/arcium/pool/transfer', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
```

### 3. Backend Route (arcium.routes.ts)

```typescript
// Ligne 369-456
router.post('/pool/transfer', async (req, res) => {
  const { fromPrivateKey, toAddress, amount } = req.body;

  // Exécute le transfert privé
  const result = await privacyPoolService.createPrivateTransfer({
    senderKeypair,
    recipientPubkey,
    amount: amountLamports,
  });

  res.json({
    success: true,
    transactions: {
      deposit: { signature: result.depositSignature },
      withdraw: { signature: result.withdrawSignature },
    }
  });
});
```

### 4. Privacy Pool Service (privacy-pool.service.ts)

```typescript
// Ligne 131-186
async createPrivateTransfer({ senderKeypair, recipientPubkey, amount }) {
  // ETAPE 1: Deposit (Sender → Pool)
  const depositIx = this.buildDepositInstruction(senderKeypair.publicKey, amount);
  const depositSig = await this.connection.sendTransaction(depositTx, [senderKeypair]);

  // ETAPE 2: Withdraw (Pool → Recipient)
  const withdrawSig = await this.executeWithdrawal(recipientPubkey, amount);

  return { depositSignature: depositSig, withdrawSignature: withdrawSig };
}
```

### 5. Programme Solana (lib.rs)

```rust
// Deposit: Sender → Pool PDA
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let transfer_ix = system_instruction::transfer(
        &ctx.accounts.sender.key(),
        &ctx.accounts.pool.key(),
        amount,
    );
    invoke(&transfer_ix, ...)?;
    ctx.accounts.pool.total_deposits += amount;
    Ok(())
}

// Withdraw: Pool PDA → Recipient (signe par l'authority backend)
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    **ctx.accounts.pool.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;
    ctx.accounts.pool.total_withdrawals += amount;
    Ok(())
}
```

---

## Adresses Deployees (Devnet)

| Composant | Adresse |
|-----------|---------|
| Programme Pool | `55RNcHf6ktm89ko4vraLGHhdkAvpuykzKP2Kosyci62E` |
| Pool PDA | `25MjNuRJiMhRgnGobfndBQQqehu5GhdZ1Ts4xyPYfTWj` |
| Authority (Backend) | `DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU` |

---

## Pourquoi Arcium n'est pas utilise ?

```
Erreur: MxeKeysNotSet
```

Les noeuds MXE (Multi-Party Execution) du cluster devnet Arcium ne sont pas configures. Arcium necessiterait:
- Un cluster MXE actif avec des noeuds configures
- Des cles d'encryption initialisees sur chaque noeud
- Un CompDef (Computation Definition) deploye

Le **Privacy Pool** est la solution de contournement qui fonctionne sans ces dependances externes.

---

## Limitations Actuelles

1. **Correlation temporelle**: Les 2 transactions (deposit + withdraw) sont executees a quelques secondes d'intervalle
2. **Montants identiques**: Le meme montant apparait dans les 2 transactions
3. **Faible anonymat**: Peu d'utilisateurs = facile a correler

### Ameliorations Futures Possibles
- Delai aleatoire entre deposit et withdraw
- Montants standardises (0.1, 0.5, 1 SOL)
- Plus d'utilisateurs pour augmenter l'ensemble d'anonymat

---

## Resume des Endpoints API Actifs

| Methode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/arcium/pool/transfer` | Execute un transfert prive complet |
| `GET` | `/api/arcium/pool/info` | Info sur le pool (balance, adresses) |
| `POST` | `/api/arcium/pool/deposit/build` | Construit l'instruction de deposit |

**Tous les autres endpoints `/api/arcium/*` sont inutilises.**
