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
const RPC_URL = "https://api-devnet.helius-rpc.com";

// helpers

const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);

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
