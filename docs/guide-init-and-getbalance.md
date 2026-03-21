# Guide d'intégration — `init_user_state` & `get_balance`

## Contexte

Deux nouvelles instructions ont été ajoutées au programme Private Yield :

| Instruction | Rôle |
|---|---|
| `initUserState` | Crée le compte utilisateur avec un état MXE chiffré `{user_id: 0, shares: 0}`. **Doit être appelé avant le premier dépôt.** |
| `getBalance` | Requête le solde chiffré, le MPC le re-chiffre sous la clé du requester. Le client déchiffre localement. |

### Pourquoi `initUserState` est nécessaire

En mode CTR (Rescue cipher), déchiffrer des bytes à zéro ne donne **pas** `{0, 0}` mais du garbage (`-keystream mod p`). Sans initialisation MXE propre, le circuit `process_deposit` ne peut pas détecter un compte vierge (`if state.user_id == 0` échoue) et le dépôt est silencieusement ignoré.

`initUserState` appelle un circuit MPC qui **crée** un état `{0, 0}` proprement chiffré sous la clé MXE, sans lire de données MXE en input.

---

## Prérequis

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
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

const PROGRAM_ID = new PublicKey("F3ypFyPnffVd4sq3wDRZjHLz3F9GBnYoKw3gSHjN2Uts");
const CLUSTER_OFFSET = 456;
```

Les helpers `getUserIdHash`, `getUserStatePDA`, et le setup du provider Anchor sont identiques au guide backend existant (`docs/backend-integration.md`).

---

## 1. `initUserState` — Initialisation du compte utilisateur

### Quand l'appeler

- **Une seule fois par utilisateur**, avant le premier `processDeposit`.
- Le backend doit vérifier si le compte existe déjà avant d'appeler.

### Implémentation backend

```typescript
async function initUserState(userId: bigint): Promise<string | null> {
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);

  // Vérifier si le compte existe déjà
  const existing = await connection.getAccountInfo(userStatePDA);
  if (existing) {
    console.log(`User state already exists for userId=${userId}`);
    return null; // Déjà initialisé
  }

  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  const sig = await program.methods
    .initUserState(
      computationOffset,
      Array.from(userIdHash) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      computationAccount: getComputationAccAddress(
        CLUSTER_OFFSET,
        computationOffset,
      ),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mxeAccount: getMXEAccAddress(PROGRAM_ID),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      compDefAccount: getCompDefAccAddress(
        PROGRAM_ID,
        Buffer.from(
          getCompDefAccOffset("init_user_state"),
        ).readUInt32LE(),
      ),
    })
    .rpc({ commitment: "confirmed" });

  // Attendre que le MPC finalise (écrit le state chiffré dans le compte)
  await awaitComputationFinalization(
    provider,
    computationOffset,
    PROGRAM_ID,
    "confirmed",
  );

  console.log(`User state initialized for userId=${userId}, sig=${sig}`);
  return sig;
}
```

### Flow d'appel

```
Client → POST /api/register (ou premier dépôt)
       → Backend vérifie si le PDA existe
       → Si non : appelle initUserState()
       → Attend la finalisation MPC (~5s sur devnet)
       → Le compte contient maintenant {user_id: 0, shares: 0} chiffré MXE
       → Le backend peut ensuite appeler processDeposit()
```

### Endpoint API suggéré

```typescript
app.post("/api/register", async (req, res) => {
  const { userId } = req.body; // bigint as string
  try {
    const sig = await initUserState(BigInt(userId));
    res.json({ success: true, signature: sig, alreadyExists: sig === null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

### Intégration avec le dépôt

Si le backend gère l'init automatiquement lors du premier dépôt :

```typescript
async function processDepositWithAutoInit(
  userId: bigint,
  amount: bigint,
  memoEphPub: Uint8Array,
  memoNonce: Buffer,
  memoCt: Uint8Array,
) {
  // Auto-init si nécessaire
  await initUserState(userId);

  // Puis dépôt normal
  return processDeposit(userId, amount, memoEphPub, memoNonce, memoCt);
}
```

---

## 2. `getBalance` — Requête du solde chiffré

### Comment ça fonctionne

1. Le client génère une paire X25519 éphémère
2. Le client envoie sa clé publique éphémère + un nonce au programme
3. Le MPC déchiffre le solde (sous clé MXE), puis le **re-chiffre** sous la clé partagée client-MXE
4. Le callback émet un event `BalanceQueried` avec le ciphertext + le nonce
5. Le client déchiffre localement avec sa clé privée éphémère

### Implémentation backend

Le backend envoie la transaction et retourne les données de l'event au client.

```typescript
async function getBalance(
  userId: bigint,
  requesterEphPub: Uint8Array,
  requesterNonce: Uint8Array,
): Promise<string> {
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);

  const computationOffset = new anchor.BN(randomBytes(8));

  // Écouter l'event avant d'envoyer la tx
  const eventPromise = new Promise<any>((resolve) => {
    const listenerId = program.addEventListener("balanceQueried", (event) => {
      program.removeEventListener(listenerId);
      resolve(event);
    });
  });

  await program.methods
    .getBalance(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(requesterEphPub) as any,
      new anchor.BN(deserializeLE(requesterNonce).toString()),
    )
    .accountsPartial({
      userState: userStatePDA,
      computationAccount: getComputationAccAddress(
        CLUSTER_OFFSET,
        computationOffset,
      ),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mxeAccount: getMXEAccAddress(PROGRAM_ID),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      compDefAccount: getCompDefAccAddress(
        PROGRAM_ID,
        Buffer.from(
          getCompDefAccOffset("get_balance"),
        ).readUInt32LE(),
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

  // Récupérer les données de l'event
  const event = await eventPromise;

  return {
    encryptionKey: Array.from(event.encryptionKey), // [u8; 32]
    clientNonce: Array.from(event.clientNonce),       // [u8; 16]
    shares: Array.from(event.shares),                 // [u8; 32]
  };
}
```

### Endpoint API

```typescript
app.post("/api/balance", async (req, res) => {
  const { userId, ephPub, nonce } = req.body;

  try {
    const result = await getBalance(
      BigInt(userId),
      new Uint8Array(ephPub),
      new Uint8Array(nonce),
    );
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

### Déchiffrement côté client

Le client reçoit `{ encryptionKey, clientNonce, shares }` du backend et déchiffre localement :

```typescript
import { RescueCipher, x25519 } from "@arcium-hq/client";

async function decryptBalance(
  ephemeralPrivateKey: Uint8Array,  // la clé privée éphémère générée avant la requête
  mxePublicKey: Uint8Array,         // clé publique MXE (depuis GET /api/mxe-pubkey)
  eventData: { clientNonce: number[]; shares: number[] },
): Promise<bigint> {
  // Recréer le shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // Déchiffrer avec le nonce de l'event (pas le nonce d'input)
  const clientNonce = new Uint8Array(eventData.clientNonce);
  const decrypted = cipher.decrypt([eventData.shares], clientNonce);

  return decrypted[0]; // solde en lamports
}
```

### Flow complet côté client

```typescript
// 1. Récupérer la clé MXE (une seule fois, au démarrage)
const mxeRes = await fetch("/api/mxe-pubkey");
const { mxePublicKey } = await mxeRes.json();

// 2. Générer une paire éphémère
const ephPriv = x25519.utils.randomSecretKey();
const ephPub = x25519.getPublicKey(ephPriv);
const nonce = crypto.getRandomValues(new Uint8Array(16));

// 3. Demander le solde au backend
const balanceRes = await fetch("/api/balance", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "12345",
    ephPub: Array.from(ephPub),
    nonce: Array.from(nonce),
  }),
});
const eventData = await balanceRes.json();

// 4. Déchiffrer localement
const balance = await decryptBalance(
  ephPriv,
  new Uint8Array(mxePublicKey),
  eventData,
);
console.log(`Balance: ${balance} lamports (${Number(balance) / 1e9} SOL)`);
```

---

## 3. Résumé des flows

```
INITIALISATION (une fois par user):
Client → POST /api/register { userId }
       → Backend appelle initUserState()
       → MPC crée {0, 0} chiffré MXE
       → Callback écrit nonce + ciphertexts dans le PDA
       → Réponse: { success: true }

DÉPÔT (après init):
Client → Transfert SOL vers vault (memo chiffré)
       → Backend appelle processDeposit()
       → MPC déchiffre état + memo, ajoute shares
       → Callback écrit nouveau nonce + ciphertexts
       → Event: DepositProcessed

REQUÊTE DE SOLDE:
Client → POST /api/balance { userId, ephPub, nonce }
       → Backend appelle getBalance()
       → MPC déchiffre état MXE, re-chiffre sous clé client
       → Event: BalanceQueried { encryptionKey, clientNonce, shares }
       → Backend retourne l'event au client
       → Client déchiffre localement avec sa clé privée éphémère
```

---

## 4. Points importants

- **`initUserState` doit être appelé AVANT le premier dépôt** — sinon le dépôt est silencieusement ignoré (le MPC ne peut pas déchiffrer des zéros bruts).
- **Le nonce de l'event** (`clientNonce`) est utilisé pour le déchiffrement, **pas** le nonce d'input. Le MPC incrémente le counter après chiffrement.
- **Le nonce est `[u8; 16]`** dans l'event, pas `u128`. Côté client: `new Uint8Array(event.clientNonce)`.
- **La clé privée éphémère ne quitte jamais le client** — le backend ne voit que la clé publique. Seul le client peut déchiffrer son solde.
- **`getBalance` ne modifie pas l'état** — c'est une lecture seule (le state MXE n'est pas écrit dans le callback).
