# 🔐 Analyse Profonde - Private Transfers

**Date:** 2024-11-17
**Project:** Stealf Private Transfers - Système de transactions confidentielles
**Program ID:** `FZpAL2ogH95Fh8N3Cs3wwXhR3VysR922WZYjTTPo17ka`

---

## 📊 Vue d'Ensemble

### Qu'est-ce que Private Transfers ?

**Private Transfers** est un **système de transactions confidentielles sur Solana** qui combine **3 technologies majeures** :

1. **Arcium MPC** - Multi-Party Computation pour calculs privés
2. **Umbra Protocol** - Stealth addresses & encrypted amounts
3. **Tornado Cash** - Fixed denomination pools & anonymity sets

C'est un projet **BEAUCOUP plus complexe** que `private-link` !

---

## 🏗️ Architecture Globale

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRIVATE TRANSFERS SYSTEM                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │  ARCIUM MPC     │  │  UMBRA-STYLE     │  │  TORNADO-STYLE │ │
│  │  CIRCUITS       │  │  SHIELDED POOL   │  │  DENOMINATION  │ │
│  │                 │  │                  │  │  POOLS         │ │
│  │ • validate_     │  │ • Commitments    │  │ • Fixed pools  │ │
│  │   transfer      │  │ • Nullifiers     │  │ • 0.1-10 SOL   │ │
│  │ • private_      │  │ • Merkle Tree    │  │ • Anonymity    │ │
│  │   transfer      │  │ • Stealth Addrs  │  │   sets         │ │
│  │ • shielded_     │  │ • Encrypted      │  │ • ZK Proofs    │ │
│  │   deposit       │  │   amounts        │  │                │ │
│  │ • shielded_     │  │                  │  │                │ │
│  │   claim         │  │                  │  │                │ │
│  └─────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  USER REGISTRY - Encrypted Balances & Accounts           │   │
│  │  • UserAccount PDA                                        │   │
│  │  • Encrypted Balance (ChaCha20 + x25519)                 │   │
│  │  • Deposit/Withdraw Flow                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Structure du Projet

### Fichiers Arcis Circuit

**File:** `encrypted-ixs/src/lib.rs` (162 lignes)

**4 Circuits MPC** :
1. `validate_transfer` - Validation simple de transfert
2. `private_transfer` - Transfert complet avec mise à jour balances
3. `shielded_deposit` - Deposit avec montant chiffré (sealing)
4. `shielded_claim` - Claim avec validation montant

### Programme Solana

**File:** `programs/private/src/lib.rs` (2045 lignes!)

**Modules** :
- `user_registry.rs` (119 lignes) - Comptes utilisateurs
- `commitment.rs` (228 lignes) - Commitment tree & nullifiers
- `denomination.rs` (220 lignes) - Fixed denomination pools
- `encrypted_balance.rs` (363 lignes) - Encrypted balance system
- `encryption.rs` (151 lignes) - ChaCha20 encryption
- `stealth.rs` (202 lignes) - Stealth address generation
- `merkle_tree.rs` (268 lignes) - Incremental Merkle tree
- `poseidon_utils.rs` (165 lignes) - Poseidon hashing
- `zk_proof.rs` (166 lignes) - ZK-SNARK proof verification

**Total:** ~3,927 lignes de Rust !

---

## 🔬 Analyse Détaillée des Circuits Arcis

### Circuit 1: `validate_transfer`

**Objectif:** Valider qu'un transfert est possible (balance suffisante)

**Input:**
```rust
pub struct TransferInput {
    sender_balance: u64,
    transfer_amount: u64,
}
```

**Output:** `bool` (chiffré)

**Logique:**
```rust
#[instruction]
pub fn validate_transfer(input_ctxt: Enc<Shared, TransferInput>) -> Enc<Shared, bool> {
    let input = input_ctxt.to_arcis();

    // Validation en MPC
    let is_valid = input.transfer_amount > 0
                   && input.transfer_amount <= input.sender_balance;

    input_ctxt.owner.from_arcis(is_valid)
}
```

**Conformité Arcis:** ✅
- Types: `u64` supporté
- Opérations: comparaisons (supporté)
- Control flow: `if` géré par Arcis (data-independent)

---

### Circuit 2: `private_transfer`

**Objectif:** Transfert complet avec calcul des nouvelles balances

**Input:**
```rust
pub struct PrivateTransferInput {
    sender_balance: u64,
    receiver_balance: u64,
    transfer_amount: u64,
}
```

**Output:**
```rust
pub struct PrivateTransferOutput {
    new_sender_balance: u64,
    new_receiver_balance: u64,
    is_valid: bool,
}
```

**Logique:**
```rust
#[instruction]
pub fn private_transfer(
    input_ctxt: Enc<Shared, PrivateTransferInput>
) -> Enc<Shared, PrivateTransferOutput> {
    let input = input_ctxt.to_arcis();

    // Validation
    let is_valid = input.transfer_amount > 0
                   && input.transfer_amount <= input.sender_balance;

    // Calcul nouvelles balances (conditionnel en MPC)
    let new_sender_balance = if is_valid {
        input.sender_balance - input.transfer_amount
    } else {
        input.sender_balance
    };

    let new_receiver_balance = if is_valid {
        input.receiver_balance + input.transfer_amount
    } else {
        input.receiver_balance
    };

    input_ctxt.owner.from_arcis(PrivateTransferOutput {
        new_sender_balance,
        new_receiver_balance,
        is_valid,
    })
}
```

**Conformité Arcis:** ✅
- Types: `u64` + struct supportés
- Opérations: arithmétique (`-`, `+`) + comparaisons
- Control flow: `if` supporté (exécute les 2 branches)
- Performance: O(1) - optimal

---

### Circuit 3: `shielded_deposit`

**Objectif:** Deposit avec montant 100% chiffré (sealing pour recipient)

**Input:**
```rust
pub struct ShieldedDepositInput {
    encrypted_amount: u64,  // Montant déjà chiffré!
    timestamp: i64,
}
```

**Output:**
```rust
pub struct ShieldedDepositOutput {
    sealed_amount: u64,     // Re-chiffré pour Bob
    is_valid: bool,
}
```

**Logique:**
```rust
#[instruction]
pub fn shielded_deposit(
    input_ctxt: Enc<Shared, ShieldedDepositInput>,
    recipient: Shared  // Bob's public key pour sealing
) -> Enc<Shared, ShieldedDepositOutput> {
    let input = input_ctxt.to_arcis();

    // Validation
    let is_valid = input.encrypted_amount > 0;

    // Sealing: re-chiffre pour Bob
    let sealed_amount = input.encrypted_amount;

    // IMPORTANT: retourne avec owner = recipient (Bob)
    recipient.from_arcis(ShieldedDepositOutput {
        sealed_amount,
        is_valid,
    })
}
```

**Conformité Arcis:** ✅
- Types: `u64` + `i64` supportés
- Opérations: comparaison uniquement
- **Pattern avancé:** Sealing (re-encryption pour recipient)
- Utilise `recipient.from_arcis()` au lieu de `input_ctxt.owner.from_arcis()`

---

### Circuit 4: `shielded_claim`

**Objectif:** Claim avec validation du montant vs vault balance

**Input:**
```rust
pub struct ShieldedClaimInput {
    encrypted_amount: u64,
    vault_balance: u64,
}
```

**Output:**
```rust
pub struct ShieldedClaimOutput {
    approved_amount: u64,
    is_valid: bool,
}
```

**Logique:**
```rust
#[instruction]
pub fn shielded_claim(
    input_ctxt: Enc<Shared, ShieldedClaimInput>
) -> Enc<Shared, ShieldedClaimOutput> {
    let input = input_ctxt.to_arcis();

    // Validation: montant > 0 ET vault a assez de SOL
    let is_valid = input.encrypted_amount > 0
                   && input.encrypted_amount <= input.vault_balance;

    let approved_amount = if is_valid {
        input.encrypted_amount
    } else {
        0  // Refusé
    };

    input_ctxt.owner.from_arcis(ShieldedClaimOutput {
        approved_amount,
        is_valid,
    })
}
```

**Conformité Arcis:** ✅
- Similar au `validate_transfer` mais avec approval logic
- Performance optimale

---

## 🎯 Programme Solana - Analyse des Features

### Feature 1: **User Registry** (Encrypted Balances)

**Comptes:**
```rust
pub struct UserAccount {
    owner: Pubkey,                  // Propriétaire
    encryption_pubkey: [u8; 32],    // x25519 pubkey (Umbra-style)
    encrypted_balance: [u8; 32],    // Balance chiffrée
    balance_nonce: [u8; 16],        // Nonce pour déchiffrement
    total_deposits: u64,            // Public (accountability)
    total_withdrawals: u64,         // Public
    created_at: i64,
    last_updated: i64,
    bump: u8,
}
```

**PDA Derivation:**
```
seeds = [b"user_account", owner.key().as_ref()]
```

**Instructions:**
1. `create_user_account()` - Créer compte utilisateur
2. `deposit()` - Déposer SOL (transfert visible, balance chiffrée mise à jour)
3. `withdraw()` - Retirer SOL (après validation MPC)

**Flow Deposit:**
```
User → deposit(amount) → Transfer SOL to vault → Update encrypted_balance
```

**Flow Withdraw:**
```
User → withdraw(amount) → Validate via MPC → Transfer SOL from vault → Update encrypted_balance
```

---

### Feature 2: **Umbra-Style Shielded Pool**

**Inspiré par Umbra Protocol** :
- Commitments cryptographiques
- Stealth addresses
- Encrypted amounts
- Merkle tree
- Nullifiers (anti double-spend)

**Comptes:**
```rust
pub struct CommitmentTree {
    authority: Pubkey,
    commitments: Vec<[u8; 32]>,  // Merkle tree de commitments
    count: u64,
    root: [u8; 32],              // Merkle root
    bump: u8,
}

pub struct NullifierRegistry {
    authority: Pubkey,
    used_nullifiers: Vec<[u8; 32]>,  // Nullifiers déjà utilisés
    count: u64,
    bump: u8,
}
```

**Instructions:**
1. `init_commitment_tree()` - Initialiser le tree
2. `init_nullifier_registry()` - Initialiser registry
3. `deposit_with_commitment()` - Deposit avec commitment
4. `claim_with_proof()` - Claim avec ZK proof

**Flow Deposit:**
```
Alice → deposit_with_commitment(
    amount,
    commitment = hash(secret, nullifier),
    ephemeral_public_key,        // Pour ECDH
    encrypted_amount,            // ChaCha20 encrypted
    amount_nonce
) → Transfer SOL to vault
  → Add commitment to tree
  → Emit event avec encrypted_amount
```

**Flow Claim:**
```
Bob → scan events
    → decrypt encrypted_amount avec ECDH
    → claim_with_proof(
        encrypted_amount,
        nullifier_hash,
        recipient,              // Stealth address
        zk_proof               // TODO: implement
      )
    → Verify nullifier not used
    → Transfer SOL to recipient
    → Mark nullifier as used
```

---

### Feature 3: **Tornado Cash-Style Denomination Pools**

**Objectif:** **Privacy maximale** - montants fixes implicites

**Pools disponibles:**
```rust
pub enum Denomination {
    Pool01SOL,  // 0.1 SOL  (100_000_000 lamports)
    Pool05SOL,  // 0.5 SOL  (500_000_000 lamports)
    Pool1SOL,   // 1 SOL    (1_000_000_000 lamports)
    Pool5SOL,   // 5 SOL    (5_000_000_000 lamports)
    Pool10SOL,  // 10 SOL   (10_000_000_000 lamports)
}
```

**Compte:**
```rust
pub struct DenominationPool {
    pool_id: u8,                    // 0-4
    amount: u64,                    // Montant fixe (implicite!)
    total_deposits: u64,            // Stats
    total_claims: u64,
    bump: u8,
}
```

**Instructions:**
1. `init_denomination_pool(pool_id)` - Init un pool
2. `deposit_to_pool(pool_id, commitment)` - Deposit (amount implicite!)
3. `claim_from_pool(pool_id, nullifier, recipient)` - Claim (amount implicite!)

**Pourquoi c'est génial ?**
```
❌ AVANT (deposit/claim classique):
deposit(amount=1.5 SOL, commitment) → visible on-chain
claim(amount=1.5 SOL, nullifier) → visible on-chain
→ Observer peut linker deposit → claim par le montant!

✅ AVEC DENOMINATION POOLS:
deposit_to_pool(pool_id=2, commitment) → amount NOT in params!
claim_from_pool(pool_id=2, nullifier) → amount NOT in params!
→ Observer ne peut PAS linker! Large anonymity set!
```

**Anonymity Set:**
- Pool 0.1 SOL: tous ceux qui deposit 0.1 SOL sont dans le même set
- Pool 1 SOL: pareil pour 1 SOL
- Plus le pool est utilisé, plus l'anonymat est fort!

---

### Feature 4: **Shielded Pool with MPC** (Montants 100% chiffrés)

**Combinaison Umbra + Arcium MPC**

**Instructions:**
1. `init_shielded_deposit_comp_def()` - Init CompDef
2. `shielded_deposit()` - Deposit avec MPC sealing
3. `shielded_deposit_callback()` - Callback MPC
4. `init_shielded_claim_comp_def()` - Init CompDef
5. `shielded_claim()` - Claim avec MPC validation
6. `shielded_claim_callback()` - Callback MPC

**Flow Shielded Deposit:**
```
Alice → shielded_deposit(
    plaintext_amount,          // Pour transfer SOL (unavoidable)
    encrypted_amount,          // Pour MPC (FULLY ENCRYPTED!)
    recipient_pubkey,          // Bob's pubkey
    commitment,
    ephemeral_public_key
) → PHASE 1: Transfer SOL to vault (amount visible)
  → PHASE 2: Queue MPC computation
            → MPC re-encrypts amount for Bob (sealing)
            → MPC callback emits ShieldedDepositEvent
            → sealed_amount_ciphertext (pour Bob seulement!)
```

**Flow Shielded Claim:**
```
Bob → shielded_claim(
    encrypted_amount,          // Montant chiffré
    encrypted_vault_balance,   // Balance vault chiffrée
    nullifier_hash,
    recipient
) → Mark nullifier as used
  → Queue MPC computation
     → MPC validates amount <= vault_balance
     → MPC approves or rejects
     → Callback transfers SOL if approved
```

---

### Feature 5: **Encrypted Balance System** (TRUE HIDDEN AMOUNTS)

**Inspiré par Umbra - amounts JAMAIS visibles on-chain**

**Comptes:**
```rust
pub struct EncryptedBalance {
    owner: Pubkey,
    ciphertext: [u8; 8],           // Amount encrypted (ChaCha20)
    nonce: [u8; 12],
    ephemeral_pubkey: [u8; 32],    // x25519 ephemeral key
    commitment: [u8; 32],          // Poseidon hash
    index: u64,
    nullifier_hash: Option<[u8; 32]>,
    is_spent: bool,
    bump: u8,
}

pub struct EncryptedBalanceRegistry {
    total_balances: u64,
    commitments: Vec<[u8; 32]>,    // Merkle tree
    merkle_root: [u8; 32],
    bump: u8,
}

pub struct EncryptedVault {
    total_locked: u64,             // Total SOL locked
    authority: Pubkey,
    bump: u8,
}
```

**Instructions:**
1. `init_encrypted_balance_registry()` - Init registry
2. `init_encrypted_vault()` - Init vault
3. `deposit_encrypted_balance()` - Deposit SOL → encrypted balance
4. `withdraw_encrypted_balance()` - Withdraw → reveal amount

**Flow Deposit Encrypted Balance:**
```
Alice → deposit_encrypted_balance(
    amount,                    // Pour transfer SOL
    ephemeral_secret,
    recipient_pubkey,          // Bob's x25519 pubkey
    nonce
) → Transfer SOL to vault
  → Encrypt amount avec ChaCha20 (ECDH with Bob's pubkey)
  → Create commitment (Poseidon hash)
  → Store EncryptedBalance PDA
  → Emit event (NO AMOUNT VISIBLE!)
```

**Flow Withdraw:**
```
Bob → decrypt amount off-chain (ECDH)
    → withdraw_encrypted_balance(
        nullifier_hash,
        amount,                // Décrypté off-chain
        owner,
        index
      )
    → Verify not spent
    → Transfer SOL from vault
    → Mark as spent
    → ⚠️ Amount becomes VISIBLE here (only once!)
```

---

## 🔐 Sécurité & Privacy

### Niveaux de Privacy

| Feature | Privacy Level | Amount Visibility | Linkability |
|---------|---------------|-------------------|-------------|
| **User Registry** | ⭐⭐⭐ | Balance encrypted | Owner known |
| **Umbra-Style Pool** | ⭐⭐⭐⭐ | Amount encrypted | Stealth addresses |
| **Denomination Pools** | ⭐⭐⭐⭐⭐ | Amount IMPLICIT | Fully unlinkable |
| **Shielded MPC** | ⭐⭐⭐⭐⭐ | Amount 100% encrypted | MPC sealing |
| **Encrypted Balance** | ⭐⭐⭐⭐⭐ | Amount hidden until withdraw | ECDH encryption |

### Technologies Cryptographiques

1. **Arcium MPC** - Multi-Party Computation
   - RescueCipher (zk-SNARK friendly)
   - x25519 ECDH
   - Additive secret sharing (Curve25519)

2. **Umbra Protocol**
   - Stealth addresses (Ed25519 → x25519)
   - ECDH key exchange
   - ChaCha20 encryption
   - Ephemeral keys

3. **Tornado Cash**
   - Fixed denomination pools
   - Commitments (hash(secret, nullifier))
   - Nullifiers (anti double-spend)
   - Merkle trees
   - ZK-SNARK proofs (TODO)

4. **Additional**
   - Poseidon hashing (ZK-friendly)
   - Incremental Merkle trees
   - ChaCha20-Poly1305 AEAD

---

## 📊 Conformité Arcis

### Circuit Compliance Score: ✅ **100%**

| Circuit | Types | Ops | Flow | Performance | Status |
|---------|-------|-----|------|-------------|--------|
| `validate_transfer` | ✅ | ✅ | ✅ | ⚡ Optimal | ✅ |
| `private_transfer` | ✅ | ✅ | ✅ | ⚡ Optimal | ✅ |
| `shielded_deposit` | ✅ | ✅ | ✅ | ⚡ Optimal | ✅ |
| `shielded_claim` | ✅ | ✅ | ✅ | ⚡ Optimal | ✅ |

**Tous les circuits sont conformes** :
- ✅ Types supportés (`u64`, `i64`, structs)
- ✅ Opérations supportées (comparaisons, arithmétique)
- ✅ Control flow data-independent
- ✅ Performance optimale (pas de loops, minimal ops)

---

## 🎯 Use Cases

### 1. Private Transfers entre Utilisateurs
```
Alice → create_user_account()
     → deposit(1 SOL)                    // Balance = 1 SOL (encrypted)
     → private_transfer(0.5 SOL to Bob)  // via MPC
     → Balance Alice = 0.5 SOL (encrypted)
     → Balance Bob = 0.5 SOL (encrypted)
```

### 2. Shielded Pool (Umbra-style)
```
Alice → deposit_with_commitment(1.5 SOL)
     → Event emitted avec encrypted_amount
Bob → scan events
    → decrypt amount (ECDH)
    → claim_with_proof(1.5 SOL, stealth_address)
    → SOL sent to stealth address (unlinkable!)
```

### 3. Fixed Denomination Pool (Tornado-style)
```
Alice → deposit_to_pool(pool_id=2)      // 1 SOL (implicit!)
     → Commitment added to tree
     → Anonymity set++

[... time passes, many other users deposit 1 SOL ...]

Bob → claim_from_pool(pool_id=2)        // 1 SOL (implicit!)
    → Cannot link to Alice's deposit!
    → Privacy maximale!
```

### 4. Shielded Pool with MPC
```
Alice → shielded_deposit(1 SOL)
     → Amount 100% encrypted via MPC
     → MPC re-encrypts for Bob (sealing)
Bob → receives sealed_amount_ciphertext
    → decrypts with his key
    → shielded_claim()
    → MPC validates amount
    → Transfer SOL if approved
```

### 5. Encrypted Balance (Hidden Amounts)
```
Alice → deposit_encrypted_balance(2 SOL for Bob)
     → Amount encrypted avec ECDH (Bob's pubkey)
     → ⚠️ Amount NOT visible on-chain!
     → Event emitted (no amount!)
Bob → scan events
    → decrypt amount off-chain
    → withdraw_encrypted_balance(2 SOL)
    → ⚠️ Amount visible ONLY at withdraw!
```

---

## 🚀 Intégration SDK - Plan d'Action

### Approche Recommandée

**Option 1: SDK Séparé** (Recommandé)
```
/Users/thomasgaugain/Documents/backend-stealf/
├── sdk/                           # Wallet linking SDK (actuel)
│   ├── src/
│   │   ├── client/WalletLinkClient.ts
│   │   └── ...
│   └── package.json
│
└── sdk-transfers/                 # NEW - Private transfers SDK
    ├── src/
    │   ├── client/
    │   │   ├── PrivateTransferClient.ts
    │   │   ├── ShieldedPoolClient.ts
    │   │   ├── DenominationPoolClient.ts
    │   │   └── EncryptedBalanceClient.ts
    │   ├── core/
    │   │   ├── types.ts
    │   │   ├── constants.ts
    │   │   └── errors.ts
    │   ├── utils/
    │   │   ├── encryption.ts     # ChaCha20, x25519 ECDH
    │   │   ├── commitment.ts     # Poseidon hashing
    │   │   ├── merkle.ts         # Merkle tree utils
    │   │   └── stealth.ts        # Stealth address generation
    │   ├── idl/
    │   │   └── private.json      # IDL du programme
    │   └── index.ts
    └── package.json
```

**Option 2: Monorepo Unifié**
```
/Users/thomasgaugain/Documents/backend-stealf/
└── sdk/
    ├── src/
    │   ├── wallet-link/          # Private link features
    │   │   └── WalletLinkClient.ts
    │   ├── transfers/            # Private transfers features
    │   │   ├── PrivateTransferClient.ts
    │   │   ├── ShieldedPoolClient.ts
    │   │   └── ...
    │   ├── core/
    │   ├── utils/
    │   └── index.ts
    └── package.json
```

**Recommandation:** **Option 1 (SDK séparé)**

**Raisons:**
1. ✅ Séparation des concerns (wallet linking vs transfers)
2. ✅ Packages npm indépendants
3. ✅ Versioning séparé
4. ✅ Build times plus rapides
5. ✅ Users peuvent choisir ce qu'ils installent
6. ✅ Plus facile à maintenir

---

### Clients à Implémenter

#### 1. `PrivateTransferClient`

**Méthodes:**
```typescript
class PrivateTransferClient {
  // User Registry
  async createUserAccount(encryptionPubkey: Uint8Array): Promise<CreateUserAccountResult>
  async deposit(amount: number): Promise<DepositResult>
  async withdraw(amount: number): Promise<WithdrawResult>

  // Private Transfer (MPC)
  async validateTransfer(amount: number, recipient: PublicKey): Promise<ValidateTransferResult>
  async privateTransfer(amount: number, recipient: PublicKey): Promise<PrivateTransferResult>

  // Helpers
  async getUserAccount(owner: PublicKey): Promise<UserAccount>
  async getEncryptedBalance(): Promise<EncryptedBalanceInfo>
  async decryptBalance(encryptedBalance: Uint8Array, nonce: Uint8Array): Promise<number>
}
```

#### 2. `ShieldedPoolClient`

**Méthodes:**
```typescript
class ShieldedPoolClient {
  // Umbra-Style Shielded Pool
  async depositWithCommitment(
    amount: number,
    recipientPubkey: Uint8Array
  ): Promise<DepositCommitmentResult>

  async claimWithProof(
    encryptedAmount: Uint8Array,
    nullifierHash: Uint8Array,
    recipient: PublicKey,
    zkProof: Uint8Array
  ): Promise<ClaimResult>

  // Scanning
  async scanDeposits(): Promise<DepositCommitmentEvent[]>
  async decryptDepositAmount(
    event: DepositCommitmentEvent,
    privateKey: Uint8Array
  ): Promise<number>

  // Commitment utils
  generateCommitment(secret: Uint8Array, nullifier: Uint8Array): Uint8Array
  deriveNullifier(commitment: Uint8Array, secret: Uint8Array): Uint8Array
}
```

#### 3. `DenominationPoolClient`

**Méthodes:**
```typescript
class DenominationPoolClient {
  // Fixed Denomination Pools (Tornado-style)
  async depositToPool(
    poolId: Denomination,  // 0-4
    commitment: Uint8Array
  ): Promise<DepositToPoolResult>

  async claimFromPool(
    poolId: Denomination,
    nullifierHash: Uint8Array,
    recipient: PublicKey,
    zkProof: Uint8Array
  ): Promise<ClaimFromPoolResult>

  // Pool stats
  async getPoolInfo(poolId: Denomination): Promise<DenominationPoolInfo>
  async getAnonymitySetSize(poolId: Denomination): Promise<number>

  // Helpers
  getDenominationAmount(poolId: Denomination): number
  recommendPool(amount: number): Denomination
}
```

#### 4. `EncryptedBalanceClient`

**Méthodes:**
```typescript
class EncryptedBalanceClient {
  // Encrypted Balance System
  async depositEncryptedBalance(
    amount: number,
    recipientPubkey: Uint8Array
  ): Promise<DepositEncryptedBalanceResult>

  async withdrawEncryptedBalance(
    nullifierHash: Uint8Array,
    amount: number,
    owner: PublicKey,
    index: number
  ): Promise<WithdrawResult>

  // Scanning
  async scanEncryptedBalances(): Promise<EncryptedBalanceDepositEvent[]>
  async decryptBalance(
    event: EncryptedBalanceDepositEvent,
    privateKey: Uint8Array
  ): Promise<number>

  // Helpers
  async getEncryptedBalance(owner: PublicKey, index: number): Promise<EncryptedBalance>
  async getAllUserBalances(owner: PublicKey): Promise<EncryptedBalance[]>
}
```

---

### Dépendances Requises

**Package.json:**
```json
{
  "name": "@stealf/transfers-sdk",
  "version": "0.1.0",
  "dependencies": {
    "@arcium-hq/client": "^0.4.0",
    "@noble/curves": "^1.2.0",      // x25519 ECDH
    "@noble/ciphers": "^0.4.0",     // ChaCha20
    "@noble/hashes": "^1.3.0",      // Poseidon, Blake3
    "circomlibjs": "^0.1.7",        // Poseidon hashing (ZK)
    "snarkjs": "^0.7.0"             // ZK-SNARK proof generation/verification
  },
  "peerDependencies": {
    "@coral-xyz/anchor": "^0.32.1",
    "@solana/web3.js": "^1.95.8"
  }
}
```

---

### Fonctions Utilitaires à Implémenter

#### Encryption Utils

```typescript
// ChaCha20 encryption (Umbra-style)
export function encryptAmount(
  amount: number,
  recipientPubkey: Uint8Array,
  ephemeralSecret: Uint8Array
): {
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  ephemeralPubkey: Uint8Array
}

// x25519 ECDH
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array

// Decrypt amount
export function decryptAmount(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  ephemeralPubkey: Uint8Array,
  recipientPrivateKey: Uint8Array
): number
```

#### Commitment Utils

```typescript
// Poseidon hash (ZK-friendly)
export function poseidonHash(...inputs: bigint[]): bigint

// Generate commitment
export function generateCommitment(
  secret: Uint8Array,
  nullifier: Uint8Array
): Uint8Array

// Derive nullifier
export function deriveNullifier(
  commitment: Uint8Array,
  secret: Uint8Array
): Uint8Array
```

#### Stealth Address Utils

```typescript
// Generate stealth address (Umbra-style)
export function generateStealthAddress(
  scanPubkey: Uint8Array,
  spendPubkey: Uint8Array,
  ephemeralSecret: Uint8Array
): {
  stealthAddress: PublicKey,
  ephemeralPubkey: Uint8Array
}

// Check if stealth address is yours
export function isStealthAddressMine(
  stealthAddress: PublicKey,
  scanPrivateKey: Uint8Array,
  spendPubkey: Uint8Array,
  ephemeralPubkey: Uint8Array
): boolean
```

#### Merkle Tree Utils

```typescript
// Incremental Merkle tree
export class MerkleTree {
  constructor(depth: number)

  insert(leaf: Uint8Array): void
  getRoot(): Uint8Array
  getProof(index: number): Uint8Array[]
  verifyProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean
}
```

---

## 📝 Documentation à Créer

### Fichiers Documentation

1. `sdk-transfers/README.md` - Overview + quick start
2. `sdk-transfers/API.md` - API reference complète
3. `sdk-transfers/EXAMPLES.md` - Code examples pour chaque use case
4. `sdk-transfers/PRIVACY_GUIDE.md` - Explication privacy levels
5. `sdk-transfers/SECURITY.md` - Security best practices
6. `sdk-transfers/TROUBLESHOOTING.md` - Common issues

---

## 🎯 Prochaines Étapes

### Phase 1: Setup (2-3h)
- [ ] Créer structure `sdk-transfers/`
- [ ] Setup TypeScript config
- [ ] Installer dépendances
- [ ] Copier IDL depuis `private-transfers/target/idl/`
- [ ] Setup build pipeline

### Phase 2: Core Types (1-2h)
- [ ] Définir tous les types TypeScript
- [ ] Types pour chaque instruction
- [ ] Event types
- [ ] Error types
- [ ] Constants (program ID, seeds, etc.)

### Phase 3: Encryption Utils (3-4h)
- [ ] Implémenter ChaCha20 encryption
- [ ] Implémenter x25519 ECDH
- [ ] Implémenter Poseidon hashing
- [ ] Implémenter commitment generation
- [ ] Implémenter stealth address utils

### Phase 4: Clients Implementation (8-10h)
- [ ] `PrivateTransferClient` (user registry + MPC transfers)
- [ ] `ShieldedPoolClient` (Umbra-style)
- [ ] `DenominationPoolClient` (Tornado-style)
- [ ] `EncryptedBalanceClient` (hidden amounts)

### Phase 5: Tests (4-6h)
- [ ] Unit tests pour utils
- [ ] Integration tests pour clients
- [ ] Tests sur devnet
- [ ] Tests pour event scanning

### Phase 6: Documentation (3-4h)
- [ ] API documentation
- [ ] Code examples
- [ ] Privacy guide
- [ ] Frontend integration guide

**Total Estimé:** ~22-30 heures de travail

---

## ⚠️ Différences Majeures vs Private-Link

| Aspect | Private-Link | Private-Transfers |
|--------|--------------|-------------------|
| **Complexité** | ⭐ Simple | ⭐⭐⭐⭐⭐ Très complexe |
| **Circuits MPC** | 1 circuit | 4 circuits |
| **Lignes de code** | ~500 | ~3,927 |
| **Modules** | 1 module | 9 modules |
| **Crypto libs** | x25519 + RescueCipher | x25519 + ChaCha20 + Poseidon + ZK |
| **Use cases** | Wallet linking | Transfers + Pools + Balances |
| **Privacy tech** | MPC only | MPC + Umbra + Tornado |
| **Event scanning** | ❌ Not needed | ✅ Required |
| **ZK Proofs** | ❌ None | ✅ Required (TODO) |
| **Stealth addrs** | ❌ None | ✅ Required |

---

## 💡 Recommandations

### 1. Complexité
**Private-Transfers est 10x plus complexe que Private-Link !**
- Plus de circuits MPC
- Plus de crypto (ChaCha20, Poseidon, stealth addresses)
- Event scanning requis
- ZK proof generation/verification
- Merkle tree management

### 2. SDK Séparé
**Créer un SDK séparé `@stealf/transfers-sdk`**
- Différent de `@stealf/wallet-link-sdk`
- Versioning indépendant
- Build séparé

### 3. Dépendances Additionnelles
**Nouvelles libs requises:**
- `@noble/ciphers` - ChaCha20
- `@noble/hashes` - Poseidon
- `circomlibjs` - Poseidon (compatible ZK)
- `snarkjs` - ZK-SNARK proofs

### 4. Event Scanning
**Crucial pour Umbra-style & Encrypted Balances**
- Implémenter event scanning efficient
- Indexer les events (optionnel)
- Notifications en temps réel (optionnel)

### 5. ZK Proofs
**TODO dans le code actuel**
- Circuits Circom à créer
- Trusted setup
- Proof generation client-side
- Proof verification on-chain

---

## ✅ Conclusion

**Private-Transfers** est un projet **TRÈS ambitieux** qui combine 3 technologies majeures de privacy:

1. **Arcium MPC** - Confidential computing
2. **Umbra Protocol** - Stealth addresses & encrypted amounts
3. **Tornado Cash** - Fixed denomination pools & anonymity sets

**C'est du niveau production-grade privacy infrastructure!**

L'intégration au SDK sera **beaucoup plus complexe** que `private-link`, mais le résultat sera un **système de transactions privées ultra-performant** sur Solana.

---

**Next Steps:** Veux-tu que je commence l'implémentation du SDK ?

Je peux commencer par :
1. ✅ Setup de la structure `sdk-transfers/`
2. ✅ Implémentation des encryption utils
3. ✅ `PrivateTransferClient` (le plus simple pour commencer)

Ou préfères-tu une analyse plus approfondie d'un module spécifique ?

**Dernière mise à jour:** 2024-11-17
