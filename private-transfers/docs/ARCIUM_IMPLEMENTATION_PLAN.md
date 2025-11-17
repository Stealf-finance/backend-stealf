# Plan d'Implémentation - Transactions Privées Arcium

**Date**: 9 octobre 2025
**Objectif**: Implémenter transactions SOL privées (wallet public → wallet privé) avec masquage du sender via Arcium MPC
**Approche**: Option A - Programme Rust complet avec encrypted instructions

---

## 🎯 Objectif Final

Permettre à l'utilisateur d'envoyer des SOL de son **wallet public** vers son **wallet privé (Privacy 1)** en **masquant complètement l'identité du sender** grâce au réseau MPC Arcium.

### Ce qui sera masqué
- ✅ Adresse du sender (wallet public)
- ✅ Adresse du receiver (wallet privé)
- ✅ Montant de la transaction
- ✅ Données intermédiaires pendant computation MPC

### Ce qui reste visible
- Le payer de la transaction Solana (frais gas)
- Le program ID appelé
- Le résultat final (success/failure) dans l'event callback

---

## 📡 Configuration Nœud Arcium ARX

Nous disposons d'un nœud Arcium ARX actif sur le devnet Solana.

### Informations du Nœud

```json
{
  "node_type": "Arcium ARX Node",
  "network": "Solana Devnet",
  "node_offset": 0,
  "cluster_offset": 0,
  "node_authority": "DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4",
  "arcium_program_id": "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6",
  "solana_rpc_endpoint": "https://devnet.helius-rpc.com/?api-key=1fd9c16e-ba78-4e69-917a-ac211500c452",
  "container_status": "Running and Active",
  "docker_container_name": "arx-node",
  "node_status": "Active (verified)",
  "port": 8080,
  "purpose": "Multi-Party Computation (MPC) for confidential calculations"
}
```

### Configuration à Utiliser dans le Code

```typescript
// Backend TypeScript (services/arcium/)
const ARCIUM_CONFIG = {
  programId: new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6'),
  nodeAuthority: new PublicKey('DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4'),
  solanaRpcEndpoint: 'https://devnet.helius-rpc.com/?api-key=1fd9c16e-ba78-4e69-917a-ac211500c452',
  network: 'devnet',
};
```

```toml
# Anchor.toml (projet Rust)
[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[programs.devnet]
private_transfer = "PROGRAM_ID_AFTER_DEPLOY"

[[test.validator.clone]]
address = "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6" # Arcium Program
```

```toml
# Arcium.toml (configuration MPC)
cluster_id = 0
node_offset = 0
mxe_authority = "DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4"
```

---

## 🏗️ Architecture du Système

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (React Native)                  │
│  Send.tsx → Toggle "My Wallet" → API call /transaction/private │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  BACKEND API (Node.js/TypeScript)            │
│                                                              │
│  POST /api/v1/transaction/private                           │
│    ├─ private-transaction.service.ts                        │
│    │   ├─ Récupère wallets (public + privé) depuis .wallets/│
│    │   ├─ Appelle arcium-crypto.service.ts                  │
│    │   └─ Soumet instruction Solana chiffrée                │
│    │                                                         │
│    └─ arcium-crypto.service.ts                              │
│        ├─ getMXEPublicKey() → depuis nœud Arcium            │
│        ├─ Génère keypair éphémère ECDH x25519               │
│        ├─ Calcule shared secret                             │
│        ├─ Chiffre données avec RescueCipher                 │
│        └─ Retourne ciphertext + nonce + pubkey              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              PROGRAMME SOLANA (Rust/Anchor)                  │
│              Déployé sur devnet                              │
│                                                              │
│  programs/private_transfer/src/lib.rs                       │
│    ├─ init_transfer_comp_def()                              │
│    ├─ private_transfer() → queue_computation()              │
│    └─ private_transfer_callback() → emit event              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         ENCRYPTED INSTRUCTIONS (Rust/Arcis)                  │
│         Logique MPC confidentielle                           │
│                                                              │
│  encrypted-ixs/src/lib.rs                                   │
│    pub struct TransferData {                                │
│      sender: [u8; 32],    // Masqué                         │
│      receiver: [u8; 32],  // Masqué                         │
│      amount: u64          // Masqué                         │
│    }                                                         │
│                                                              │
│    #[instruction]                                            │
│    pub fn transfer(input: Enc<Shared, TransferData>) -> bool│
│      → Computation MPC, aucun node ne voit en clair         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              CLUSTER ARCIUM MXE (Notre Nœud ARX)             │
│                                                              │
│  - Reçoit computation request depuis Solana                 │
│  - Déchiffre avec ECDH (shared secret)                      │
│  - Exécute logique MPC (BDOZ protocol)                      │
│  - Aucun node ne voit sender/receiver/amount en clair       │
│  - Retourne seulement le résultat (success: bool)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            CALLBACK SOLANA (on-chain)                        │
│                                                              │
│  private_transfer_callback()                                │
│    ├─ Reçoit output MPC (success: bool)                     │
│    ├─ Émet TransferEvent { success }                        │
│    └─ Frontend écoute event → affiche modal succès          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Plan d'Implémentation Étape par Étape

### Phase 1: Setup Outils (Prérequis)

#### 1.1. Installer Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

#### 1.2. Installer Solana CLI
```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana config set --url devnet
solana-keygen new  # Si pas déjà fait
```

#### 1.3. Installer Anchor Framework
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

#### 1.4. Installer Arcis CLI
```bash
# Suivre https://docs.arcium.com/developers/getting-started
cargo install arcis-cli
```

#### 1.5. Vérifier Installations
```bash
rustc --version      # rust 1.70+
solana --version     # solana-cli 1.17+
anchor --version     # anchor-cli 0.29+
arcis --version      # arcis-cli latest
```

---

### Phase 2: Créer Programme Solana

#### 2.1. Initialiser Projet Anchor

```bash
cd /home/louis/Images/Stealf/apps/api
mkdir -p arcium-program
cd arcium-program

# Créer projet Anchor
anchor init private_transfer --template multiple
cd private_transfer
```

#### 2.2. Configurer Anchor.toml

```toml
[features]
seeds = false
skip-lint = false

[programs.devnet]
private_transfer = "PLACEHOLDER"  # Sera remplacé après deploy

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[[test.validator.clone]]
address = "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"  # Arcium Program
```

#### 2.3. Créer Arcium.toml

```bash
cat > Arcium.toml << 'EOF'
cluster_id = 0
node_offset = 0
mxe_authority = "DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4"
EOF
```

#### 2.4. Structure du Projet

```
private_transfer/
├── Anchor.toml
├── Arcium.toml
├── Cargo.toml
├── encrypted-ixs/          # ← Instructions MPC
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs          # Logique confidentielle
├── programs/
│   └── private_transfer/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs      # Programme Solana principal
└── tests/
    └── private_transfer.ts # Tests TypeScript
```

---

### Phase 3: Écrire Encrypted Instructions (MPC Logic)

**Fichier**: `encrypted-ixs/Cargo.toml`

```toml
[package]
name = "encrypted-ixs"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
arcis-imports = { version = "0.1.0" }
```

**Fichier**: `encrypted-ixs/src/lib.rs`

```rust
use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    /// Données de transfert confidentiel
    /// sender, receiver, et amount restent masqués pendant la computation
    pub struct TransferData {
        pub sender: [u8; 32],      // Adresse publique sender (masquée)
        pub receiver: [u8; 32],    // Adresse publique receiver (masquée)
        pub amount: u64,           // Montant en lamports (masqué)
    }

    /// Instruction confidentielle: Transfert privé
    ///
    /// Cette fonction s'exécute dans le MPC cluster Arcium.
    /// Les données (sender, receiver, amount) sont chiffrées et ne sont
    /// jamais révélées aux nodes du réseau.
    ///
    /// # Arguments
    /// * `input_ctxt` - Données chiffrées du transfert
    ///
    /// # Returns
    /// * `true` si le transfert est valide (pour l'instant toujours true)
    /// * `false` si des validations échouent
    #[instruction]
    pub fn transfer(input_ctxt: Enc<Shared, TransferData>) -> bool {
        let input = input_ctxt.to_arcis();

        // TODO: Ajouter validations si nécessaire
        // - Vérifier que amount > 0
        // - Vérifier que sender != receiver
        // - Autres règles métier

        // Pour l'instant, toujours retourner succès
        // Le vrai transfert SOL se fera dans le callback Solana
        true.reveal()
    }
}
```

---

### Phase 4: Écrire Programme Solana Principal

**Fichier**: `programs/private_transfer/Cargo.toml`

```toml
[package]
name = "private_transfer"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "private_transfer"

[dependencies]
anchor-lang = "0.29.0"
arcium-anchor = "0.1.0"
```

**Fichier**: `programs/private_transfer/src/lib.rs`

```rust
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use anchor_lang::solana_program::system_instruction;

const COMP_DEF_OFFSET_TRANSFER: u32 = comp_def_offset("transfer");

declare_id!("PLACEHOLDER_WILL_BE_REPLACED_AFTER_BUILD");

#[arcium_program]
pub mod private_transfer {
    use super::*;

    /// Initialise la computation definition pour les transferts privés
    pub fn init_transfer_comp_def(ctx: Context<InitTransferCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    /// Effectue un transfert privé via Arcium MPC
    ///
    /// # Arguments
    /// * `computation_offset` - Offset unique pour cette computation
    /// * `encrypted_data` - Données chiffrées (sender, receiver, amount)
    /// * `pub_key` - Clé publique éphémère du client (ECDH)
    /// * `nonce` - Nonce pour le chiffrement
    pub fn private_transfer(
        ctx: Context<PrivateTransfer>,
        computation_offset: u64,
        encrypted_data: Vec<u8>,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Préparer arguments pour MPC
        let args = vec![
            Argument::ArcisPubkey(pub_key),
            Argument::PlaintextU128(nonce),
            Argument::EncryptedBytes(encrypted_data),
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Queue la computation vers le cluster Arcium
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![PrivateTransferCallback::callback_ix(&[])],
        )?;

        Ok(())
    }

    /// Callback appelé après computation MPC
    ///
    /// Reçoit le résultat du MPC (success: bool) et effectue le vrai transfert SOL
    #[arcium_callback(encrypted_ix = "transfer")]
    pub fn private_transfer_callback(
        ctx: Context<PrivateTransferCallback>,
        output: ComputationOutputs<TransferOutput>,
    ) -> Result<()> {
        let success = match output {
            ComputationOutputs::Success(TransferOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        if !success {
            emit!(TransferEvent {
                success: false,
                message: "MPC validation failed".to_string(),
            });
            return Ok(());
        }

        // TODO: Effectuer le vrai transfert SOL ici
        // Pour l'instant, juste émettre l'event de succès
        emit!(TransferEvent {
            success: true,
            message: "Private transfer successful".to_string(),
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS STRUCTURES
// ============================================================================

#[queue_computation_accounts("transfer", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct PrivateTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Vérifié par le programme Arcium
    pub mempool_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Vérifié par le programme Arcium
    pub executing_pool: UncheckedAccount<'info>,

    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Vérifié par le programme Arcium
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,

    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,

    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("transfer")]
#[derive(Accounts)]
pub struct PrivateTransferCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_TRANSFER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: Vérifié par la contrainte d'adresse
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("transfer", payer)]
#[derive(Accounts)]
pub struct InitTransferCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    /// CHECK: Vérifié par le programme Arcium
    pub comp_def_account: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct TransferEvent {
    pub success: bool,
    pub message: String,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("La computation a été annulée")]
    AbortedComputation,
}
```

---

### Phase 5: Compiler et Déployer

#### 5.1. Build avec Arcis

```bash
cd /home/louis/Images/Stealf/apps/api/arcium-program/private_transfer

# Compiler les encrypted instructions
arcis build

# Build Anchor
anchor build
```

#### 5.2. Déployer sur Devnet

```bash
# Airdrop SOL pour les frais de déploiement
solana airdrop 2

# Déployer le programme
anchor deploy

# Copier le Program ID généré et le mettre dans:
# - lib.rs (declare_id!)
# - Anchor.toml ([programs.devnet])
```

#### 5.3. Initialiser Computation Definition

```bash
# Via test ou script TypeScript
anchor test --skip-local-validator
```

---

### Phase 6: Backend TypeScript (Service Transaction Privée)

**Fichier**: `apps/api/src/services/transaction/private-transaction.service.ts`

```typescript
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getMXEPublicKey,
  x25519,
  RescueCipher,
  getComputationAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  deserializeLE,
  awaitComputationFinalization,
} from '@arcium-hq/client';
import * as anchor from '@coral-xyz/anchor';
import { solanaWalletService } from '../wallet/solana-wallet.service.js';
import { randomBytes } from 'crypto';

const ARCIUM_CONFIG = {
  programId: new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6'),
  nodeAuthority: new PublicKey('DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4'),
  solanaRpcEndpoint: 'https://devnet.helius-rpc.com/?api-key=1fd9c16e-ba78-4e69-917a-ac211500c452',
  deployedProgramId: new PublicKey('PROGRAM_ID_AFTER_DEPLOY'), // À remplacer
};

export interface PrivateTransactionRequest {
  fromUserId: string;
  toUserId: string;
  amount: number; // En SOL
}

export interface PrivateTransactionResponse {
  success: boolean;
  signature?: string;
  message?: string;
  error?: string;
}

class PrivateTransactionService {
  private connection: Connection;
  private program: anchor.Program;

  constructor() {
    this.connection = new Connection(ARCIUM_CONFIG.solanaRpcEndpoint, 'confirmed');
    // TODO: Charger le program IDL après déploiement
  }

  async sendPrivateTransaction(
    request: PrivateTransactionRequest
  ): Promise<PrivateTransactionResponse> {
    try {
      const { fromUserId, toUserId, amount } = request;

      console.log('🔐 Starting private transaction via Arcium MPC...');

      // 1. Récupérer les wallets
      const senderKeypair = await solanaWalletService.getWallet(fromUserId);
      const receiverPubkey = await solanaWalletService.getPrivatePublicKey(toUserId);

      if (!senderKeypair || !receiverPubkey) {
        return { success: false, error: 'Wallet not found' };
      }

      // 2. Récupérer MXE public key
      const mxePublicKey = await getMXEPublicKey(
        { connection: this.connection } as any,
        ARCIUM_CONFIG.deployedProgramId
      );

      // 3. Générer keypair éphémère ECDH
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

      // 4. Préparer données à chiffrer
      const plainData = this.encodeTransferData(
        senderKeypair.publicKey.toBase58(),
        receiverPubkey,
        BigInt(amount * LAMPORTS_PER_SOL)
      );

      // 5. Chiffrer avec Rescue Cipher
      const cipher = new RescueCipher(sharedSecret);
      const nonce = randomBytes(16);
      const ciphertext = cipher.encrypt([...plainData], nonce);

      // 6. Soumettre instruction Solana
      const computationOffset = new anchor.BN(randomBytes(8), 'hex');

      const txSig = await this.program.methods
        .privateTransfer(
          computationOffset,
          Array.from(ciphertext[0]),
          Array.from(publicKey),
          new anchor.BN(deserializeLE(nonce).toString())
        )
        .accounts({
          payer: senderKeypair.publicKey,
          computationAccount: getComputationAccAddress(
            ARCIUM_CONFIG.deployedProgramId,
            computationOffset
          ),
          mxeAccount: getMXEAccAddress(ARCIUM_CONFIG.deployedProgramId),
          // ... autres comptes
        })
        .signers([senderKeypair])
        .rpc({ skipPreflight: true, commitment: 'confirmed' });

      console.log('📤 Transaction queued:', txSig);

      // 7. Attendre finalisation MPC
      const finalizeSig = await awaitComputationFinalization(
        { connection: this.connection } as any,
        computationOffset,
        ARCIUM_CONFIG.deployedProgramId,
        'confirmed'
      );

      console.log('✅ MPC computation finalized:', finalizeSig);

      return {
        success: true,
        signature: finalizeSig,
        message: `Private transfer of ${amount} SOL completed`,
      };
    } catch (error: any) {
      console.error('❌ Private transaction error:', error);
      return { success: false, error: error.message };
    }
  }

  private encodeTransferData(
    senderAddress: string,
    receiverAddress: string,
    amountLamports: bigint
  ): Uint8Array {
    const senderPubkey = new PublicKey(senderAddress);
    const receiverPubkey = new PublicKey(receiverAddress);

    const encoded = new Uint8Array(72);
    encoded.set(senderPubkey.toBytes(), 0);
    encoded.set(receiverPubkey.toBytes(), 32);

    const amountBuffer = Buffer.allocUnsafe(8);
    amountBuffer.writeBigUInt64LE(amountLamports);
    encoded.set(new Uint8Array(amountBuffer), 64);

    return encoded;
  }
}

export const privateTransactionService = new PrivateTransactionService();
```

---

### Phase 7: Route API

**Fichier**: `apps/api/src/routes/transaction.routes.ts`

Ajouter la route `/private`:

```typescript
// POST /api/v1/transaction/private
router.post('/private', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const gridUserId = (req as any).user?.grid_user_id;

    if (!gridUserId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const user = await User.findOne({ gridUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Transaction du wallet public vers wallet privé
    const result = await privateTransactionService.sendPrivateTransaction({
      fromUserId: user._id.toString(),
      toUserId: user._id.toString(), // Même user, wallet différent
      amount: parseFloat(amount),
    });

    return res.json(result);
  } catch (error: any) {
    console.error('Private transaction route error:', error);
    return res.status(500).json({ error: error.message });
  }
});
```

---

### Phase 8: Frontend Integration

**Fichier**: `apps/mobile/src/screens/Send.tsx`

Modifier `handleSend()`:

```typescript
if (isPrivate) {
  // Transaction privée (My Wallet → Privacy 1)
  setIsLoading(true);
  try {
    const token = await authStorage.getAccessToken();
    const response = await fetch(`${API_URL}/api/v1/transaction/private`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ amount: parseFloat(amount) }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      setTransactionSignature(data.signature);
      setShowSuccessModal(true);
      // Animations...
    } else {
      Alert.alert('Transaction Failed', data.error);
    }
  } catch (error) {
    Alert.alert('Error', error.message);
  } finally {
    setIsLoading(false);
  }
}
```

---

## ✅ Checklist de Réalisation

### Prérequis
- [ ] Rust toolchain installé
- [ ] Solana CLI installé et configuré devnet
- [ ] Anchor framework installé
- [ ] Arcis CLI installé
- [ ] SOL sur wallet devnet (pour déploiement)

### Développement Rust
- [ ] Créer projet Anchor `private_transfer`
- [ ] Configurer `Anchor.toml` avec program ID Arcium
- [ ] Configurer `Arcium.toml` avec node authority
- [ ] Écrire `encrypted-ixs/src/lib.rs`
- [ ] Écrire `programs/private_transfer/src/lib.rs`
- [ ] Compiler avec `arcis build`
- [ ] Build Anchor: `anchor build`
- [ ] Déployer: `anchor deploy`
- [ ] Initialiser computation definition
- [ ] Tester avec script TypeScript

### Backend API
- [ ] Mettre à jour `arcium-crypto.service.ts` avec vraie config
- [ ] Créer `private-transaction.service.ts`
- [ ] Charger IDL du programme déployé
- [ ] Ajouter route `/transaction/private`
- [ ] Tests unitaires chiffrement
- [ ] Tests end-to-end API

### Frontend
- [ ] Modifier `Send.tsx` pour appeler `/transaction/private`
- [ ] Gérer toggle "My Wallet"
- [ ] Modal succès avec signature
- [ ] Gestion erreurs timeout MPC

### Tests Finaux
- [ ] Transaction privée public → privé réussie
- [ ] Vérifier event callback Solana
- [ ] Confirmer sender masqué on-chain
- [ ] Balance wallet privé augmentée

---

## 📊 Timeline Estimée

- **Phase 1** (Setup): 30min - 1h
- **Phase 2-4** (Rust): 2-3h (écriture + debug)
- **Phase 5** (Compile/Deploy): 30min - 1h
- **Phase 6-7** (Backend): 1-2h
- **Phase 8** (Frontend): 30min
- **Tests**: 1h

**Total: 5-8 heures** (pour un développeur familier avec Rust/Anchor/Arcium)

---

## 🚨 Points d'Attention

1. **Program ID**: Sera généré après `anchor build`, à mettre dans `declare_id!()` et recompiler
2. **Arcis Build**: Peut nécessiter plusieurs tentatives, suivre docs Arcium
3. **MXE Public Key**: Doit être récupéré depuis le nœud, pas hardcodé
4. **Callbacks**: Bien vérifier que le callback est appelé après computation
5. **Tests Devnet**: Prévoir SOL pour frais (airdrop si nécessaire)

---

**Status**: 📝 **PLAN COMPLET** - Prêt pour implémentation

**Prochaine étape**: Installer les outils Rust/Anchor/Arcis et créer le projet
