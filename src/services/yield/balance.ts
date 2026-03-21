import { BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { getUserIdHash, getUserStatePDA, getArciumAccounts } from "./constant";
import { getProgram, getProvider, getMxeKey, awaitFinalization } from "./anchorProvider";
import { initUserState } from "./initUserState";
import { getSocketService } from "../socket/socketService";
import { JitoRateService } from "../pricing/jitoRate";
import logger from "../../config/logger";

/**
 * Query encrypted balance via MPC, decrypt server-side, return plaintext.
 *
 * Flow:
 * 1. Generate ephemeral X25519 keypair
 * 2. Send get_balance TX on-chain with ephPub + nonce (no dummy ciphertext)
 * 3. MPC decrypts shares, re-encrypts with shared secret (ephPub + MXE)
 * 4. Callback emits BalanceQueried event { encryption_key, client_nonce, shares }
 * 5. Decrypt with ephPriv + client_nonce from event → plaintext balance (JitoSOL lamports)
 */
/**
 * Query balance by userId (UUID converted to u128).
 */
export async function queryBalance(userId: bigint): Promise<bigint> {
  const userIdHash = getUserIdHash(userId);
  return queryBalanceByHash(userIdHash);
}

/**
 * Query balance by pre-computed userIdHash.
 * Used by the scanner which only has the hash from the memo.
 */
export async function queryBalanceByHash(userIdHash: Buffer): Promise<bigint> {
  const userStatePDA = getUserStatePDA(userIdHash);

  // Auto-init if user state doesn't exist yet (returns 0 balance without MPC call)
  const provider = getProvider();
  const existing = await provider.connection.getAccountInfo(userStatePDA);
  if (!existing) {
    logger.info("User state not initialized, initializing before balance query");
    await initUserState(userIdHash);
  }

  const mxePubKey = getMxeKey();
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const sharedSecret = x25519.getSharedSecret(ephPriv, mxePubKey);
  const cipher = new RescueCipher(sharedSecret);

  const nonce = randomBytes(16);

  const computationOffset = new BN(randomBytes(8), "le");
  const accounts = getArciumAccounts(computationOffset, "get_balance");
  const program = getProgram();

  // Listen for the BalanceQueried event before sending the TX
  const eventPromise = new Promise<{
    encryptionKey: number[];
    clientNonce: number[];
    shares: number[];
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      program.removeEventListener(listenerId);
      reject(new Error("BalanceQueried event timeout"));
    }, 60_000);

    const listenerId = program.addEventListener("balanceQueried", (event: any) => {
      clearTimeout(timeout);
      program.removeEventListener(listenerId);
      resolve({
        encryptionKey: Array.from(event.encryptionKey),
        clientNonce: Array.from(event.clientNonce),
        shares: Array.from(event.shares),
      });
    });
  });

  const sig = await program.methods
    .getBalance(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(ephPub) as any,
      new BN(deserializeLE(nonce).toString()),
    )
    .accountsPartial({
      userState: userStatePDA,
      ...accounts,
    })
    .rpc({ commitment: "confirmed" });

  logger.info({ sig: sig.slice(0, 12) }, "getBalance TX sent");

  await awaitFinalization(computationOffset);

  logger.info({ sig: sig.slice(0, 12) }, "getBalance finalized by MPC");

  // Get the event data emitted by the callback
  const event = await eventPromise;

  // Decrypt server-side using client_nonce from the event (not the input nonce)
  const clientNonce = new Uint8Array(event.clientNonce);
  const decrypted = cipher.decrypt([event.shares as any], clientNonce);
  const balance = decrypted[0];

  logger.info({ balance: balance.toString() }, "Balance decrypted");

  return balance;
}

/**
 * Query balance via MPC then emit the result on Socket.IO.
 * Used after deposit/withdraw to push real-time updates.
 *
 * @param userIdHash - SHA256 hash (32 bytes), used both for MPC query and as socket room key
 */
export async function queryAndEmitBalance(userIdHash: Buffer): Promise<void> {
  try {
    const balance = await queryBalanceByHash(userIdHash);
    const { rate, apy } = await JitoRateService.getStats();

    const balanceJitosol = Number(balance) / 1e9;
    const balanceSol = balanceJitosol * rate;

    getSocketService().emitYieldBalanceUpdate(userIdHash.toString("hex"), {
      balanceLamports: balance.toString(),
      balanceJitosol,
      balanceSol,
      rate,
      apy,
    });
  } catch (err) {
    logger.error({ err }, "Failed to query and emit yield balance");
  }
}
