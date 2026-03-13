import { BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
  getComputationAccAddress,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { getUserIdHash, getUserStatePDA, getArciumAccounts, CLUSTER_OFFSET } from "./constant";
import { getProgram, getProvider, getMxeKey, awaitFinalization } from "./anchorProvider";
import logger from "../../config/logger";

/**
 * Query encrypted balance via MPC, decrypt server-side, return plaintext.
 *
 * Flow:
 * 1. Generate ephemeral X25519 keypair
 * 2. Send get_balance TX on-chain with ephPub
 * 3. MPC decrypts shares, re-encrypts with shared secret (ephPub + MXE)
 * 4. Read computation_account output
 * 5. Decrypt with ephPriv → plaintext balance (JitoSOL lamports)
 */
export async function queryBalance(userId: bigint): Promise<bigint> {
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);

  const mxePubKey = getMxeKey();
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const sharedSecret = x25519.getSharedSecret(ephPriv, mxePubKey);
  const cipher = new RescueCipher(sharedSecret);

  // Encrypt a dummy value — the circuit ignores it but needs a valid ciphertext
  const nonce = randomBytes(16);
  const requesterCt = cipher.encrypt([BigInt(0)], nonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const accounts = getArciumAccounts(computationOffset, "get_balance");
  const program = getProgram();

  const sig = await program.methods
    .getBalance(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(ephPub) as any,
      new BN(deserializeLE(nonce).toString()),
      Array.from(requesterCt[0]) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      ...accounts,
    })
    .rpc({ commitment: "confirmed" });

  logger.info({ sig: sig.slice(0, 12) }, "getBalance TX sent");

  await awaitFinalization(computationOffset);

  logger.info({ sig: sig.slice(0, 12) }, "getBalance finalized by MPC");

  // Read the computation account output
  const provider = getProvider();
  const compAddress = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const accountInfo = await provider.connection.getAccountInfo(compAddress);

  if (!accountInfo) {
    throw new Error("Computation account not found after finalization");
  }

  // Parse GetBalanceOutput from computation account
  // Layout: Arcium header + output ciphertext (32 bytes)
  // The output is an Enc<Shared, u128> re-encrypted with our ephPub
  const data = accountInfo.data;

  // Skip Arcium computation account header to reach the output section
  // Output is at the end of the account: 32 bytes ciphertext + 16 bytes nonce
  // The exact offset depends on Arcium's layout — extract from the tail
  const outputCt = Array.from(data.subarray(data.length - 48, data.length - 16));
  const outputNonce = Buffer.from(data.subarray(data.length - 16));

  const decrypted = cipher.decrypt([outputCt as any], outputNonce);
  const balance = decrypted[0];

  logger.info({ balance: balance.toString() }, "Balance decrypted");

  return balance;
}
