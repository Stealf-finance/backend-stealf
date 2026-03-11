# Backend Integration Guide — Private Yield

## Installation

```bash
npm install @coral-xyz/anchor @solana/web3.js @arcium-hq/client
```

## Constantes

```typescript
import { PublicKey, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { createHash, randomBytes } from "crypto";

const PROGRAM_ID = new PublicKey("BgjfDZSU1vqJJgxPGGuDAYBUieutknKHQVafwQnyMRrb");
const CLUSTER_OFFSET = 456;
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=YOUR_KEY";
```

## 1. Setup Anchor Provider

Le backend a besoin d'un wallet (keypair) pour signer les transactions.

```typescript
import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { PrivateYield } from "../target/types/private_yield";

const connection = new Connection(RPC_URL, "confirmed");
const backendKeypair = Keypair.fromSecretKey(/* load from env */);
const wallet = new Wallet(backendKeypair);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

// Charger le programme via l'IDL
const idl = require("../target/idl/private_yield.json");
const program = new Program<PrivateYield>(idl, provider);
```

## 2. Helpers

```typescript
function u128ToLE(value: bigint): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(value & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buf.writeBigUInt64LE(value >> BigInt(64), 8);
  return buf;
}

function getUserIdHash(userId: bigint): Buffer {
  return createHash("sha256").update(u128ToLE(userId)).digest();
}

function getUserStatePDA(userIdHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_state"), userIdHash],
    PROGRAM_ID,
  )[0];
}

const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
```

## 3. Récupérer la clé MXE

À cacher au démarrage du serveur (elle ne change pas).

```typescript
let mxePublicKey: Uint8Array;

async function initMXEKey() {
  for (let i = 0; i < 10; i++) {
    try {
      const key = await getMXEPublicKey(provider, PROGRAM_ID);
      if (key) {
        mxePublicKey = key;
        return;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Failed to fetch MXE public key");
}
```

## 4. Process Deposit

Appelé par le backend quand un dépôt est détecté via le webhook Helius.

Le webhook Helius détecte le transfert SOL vers le vault. Le backend extrait :
- Le **memo chiffré** (ephPub + nonce + ciphertext du user_id) depuis les données de la transaction
- Le **montant** depuis le transfert SOL

```typescript
/**
 * Envoie la transaction processDeposit au programme Solana
 *
 * @param userId - user_id du déposant (connu du backend)
 * @param amount - montant en lamports (lu depuis la tx on-chain)
 * @param memoEphPub - clé publique éphémère du client (depuis le memo)
 * @param memoNonce - nonce du memo (depuis le memo)
 * @param memoCt - ciphertext du user_id (depuis le memo)
 */
async function processDeposit(
  userId: bigint,
  amount: bigint,
  memoEphPub: Uint8Array,
  memoNonce: Buffer,
  memoCt: Uint8Array,
) {
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);

  // Chiffrer le montant (le backend le fait, pas le client)
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const sharedSecret = x25519.getSharedSecret(ephPriv, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const amountNonce = randomBytes(16);
  const amountCt = cipher.encrypt([amount], amountNonce);

  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  const sig = await program.methods
    .processDeposit(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(memoEphPub) as any,
      new anchor.BN(deserializeLE(memoNonce).toString()),
      Array.from(memoCt) as any,
      Array.from(ephPub) as any,
      new anchor.BN(deserializeLE(amountNonce).toString()),
      Array.from(amountCt[0]) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      computationAccount: getComputationAccAddress(
        CLUSTER_OFFSET,
        computationOffset,
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(PROGRAM_ID),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      compDefAccount: getCompDefAccAddress(
        PROGRAM_ID,
        Buffer.from(getCompDefAccOffset("process_deposit")).readUInt32LE(),
      ),
    })
    .rpc({ commitment: "confirmed" });

  // Attendre la finalisation MPC
  await awaitComputationFinalization(
    provider,
    computationOffset,
    PROGRAM_ID,
    "confirmed",
  );

  return sig;
}
```

## 5. Process Withdrawal

Appelé quand le client envoie une requête de retrait. Le client fournit le memo chiffré (user_id + amount + dest).

```typescript
/**
 * Envoie la transaction processWithdrawal au programme Solana
 *
 * @param userIdHash - hash du user_id (calculé par le client ou le backend)
 * @param memoEphPub - clé publique éphémère (du client)
 * @param memoNonce - nonce du memo (du client)
 * @param ctUserId - ciphertext user_id
 * @param ctAmount - ciphertext amount
 * @param ctDestHi - ciphertext dest pubkey hi
 * @param ctDestLo - ciphertext dest pubkey lo
 */
async function processWithdrawal(
  userIdHash: Buffer,
  memoEphPub: Uint8Array,
  memoNonce: Buffer,
  ctUserId: Uint8Array,
  ctAmount: Uint8Array,
  ctDestHi: Uint8Array,
  ctDestLo: Uint8Array,
) {
  const userStatePDA = getUserStatePDA(userIdHash);
  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  const sig = await program.methods
    .processWithdrawal(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(memoEphPub) as any,
      new anchor.BN(deserializeLE(memoNonce).toString()),
      Array.from(ctUserId) as any,
      Array.from(ctAmount) as any,
      Array.from(ctDestHi) as any,
      Array.from(ctDestLo) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      computationAccount: getComputationAccAddress(
        CLUSTER_OFFSET,
        computationOffset,
      ),
      clusterAccount,
      mxeAccount: getMXEAccAddress(PROGRAM_ID),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      compDefAccount: getCompDefAccAddress(
        PROGRAM_ID,
        Buffer.from(getCompDefAccOffset("process_withdrawal")).readUInt32LE(),
      ),
    })
    .rpc({ commitment: "confirmed" });

  // Attendre la finalisation MPC
  await awaitComputationFinalization(
    provider,
    computationOffset,
    PROGRAM_ID,
    "confirmed",
  );

  return sig;
}
```

## 6. API Endpoints

### GET /api/mxe-pubkey

Retourne la clé publique MXE pour le client (pas secret).

```typescript
app.get("/api/mxe-pubkey", (req, res) => {
  res.json({ mxePublicKey: Array.from(mxePublicKey) });
});
```

### POST /api/webhook/deposit

Webhook Helius — détecte les dépôts vers le vault.

```typescript
app.post("/api/webhook/deposit", async (req, res) => {
  const { userId, amount, memoEphPub, memoNonce, memoCt } = parseWebhookPayload(req.body);

  try {
    const sig = await processDeposit(userId, amount, memoEphPub, memoNonce, memoCt);
    res.json({ success: true, signature: sig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

### POST /api/withdraw

Reçoit le memo chiffré du client et lance le retrait.

```typescript
app.post("/api/withdraw", async (req, res) => {
  const {
    userIdHash,   // [u8; 32] — depuis le client
    ephPub,       // [u8; 32]
    nonce,        // [u8; 16]
    ctUserId,     // [u8; 32]
    ctAmount,     // [u8; 32]
    ctDestHi,     // [u8; 32]
    ctDestLo,     // [u8; 32]
  } = req.body;

  try {
    const sig = await processWithdrawal(
      Buffer.from(userIdHash),
      new Uint8Array(ephPub),
      Buffer.from(nonce),
      new Uint8Array(ctUserId),
      new Uint8Array(ctAmount),
      new Uint8Array(ctDestHi),
      new Uint8Array(ctDestLo),
    );
    res.json({ success: true, signature: sig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

## 7. Flow complet

```
DÉPÔT:
Client → shielded pool tx (memo chiffré avec user_id)
       → Helius webhook détecte le transfert
       → Backend extrait memo + montant
       → Backend appelle processDeposit()
       → MPC déchiffre, met à jour l'état chiffré on-chain
       → Callback émet DepositProcessed event

RETRAIT:
Client → POST /api/withdraw (memo chiffré: user_id + amount + dest)
       → Backend appelle processWithdrawal()
       → MPC vérifie identité + solde
       → Si verified=1: callback transfert wSOL vers dest
       → Si verified=0: rien ne se passe
       → Callback émet WithdrawalProcessed event
```
