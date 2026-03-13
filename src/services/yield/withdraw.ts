import { BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
} from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";
import { randomBytes } from "crypto";
import { getUserIdHash, getUserStatePDA, getArciumAccounts, u128ToLE } from "./constant";
import { getProgram, getMxeKey, awaitFinalization } from "./anchorProvider";
import { unstakeAndSend } from "./unstaking";
import logger from "../../config/logger";

/**
 * Full withdrawal flow:
 * 1. Encrypt params for MPC (userId, amount, destination)
 * 2. Submit processWithdrawal on-chain → MPC verifies balance
 * 3. After MPC finalization, unstake JitoSOL → SOL and send to wallet
 *
 * @param userId  - user identifier (u128)
 * @param amount  - withdrawal amount in lamports
 * @param wallet  - destination Solana address
 */
export async function withdraw(
  userId: bigint,
  amount: number,
  wallet: string,
): Promise<{ mpcSignature: string; transferSignature: string; estimatedSolOut: number }> {
  // --- 1. Encrypt for MPC ---
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);
  const mxePubKey = getMxeKey();

  // Encrypt userId
  const userEphPriv = x25519.utils.randomSecretKey();
  const userEphPub = x25519.getPublicKey(userEphPriv);
  const userShared = x25519.getSharedSecret(userEphPriv, mxePubKey);
  const userCipher = new RescueCipher(userShared);
  const userNonce = randomBytes(16);
  const ctUserId = userCipher.encrypt([userId], userNonce);

  // Encrypt amount
  const amountCipher = userCipher;
  const amountNonce = randomBytes(16);
  const ctAmount = amountCipher.encrypt([BigInt(amount)], amountNonce);

  // Encrypt destination pubkey (split into hi/lo 128 bits)
  const destBytes = new PublicKey(wallet).toBytes();
  const destHi = Buffer.from(destBytes.subarray(0, 16)).readBigUInt64LE(0)
    | (Buffer.from(destBytes.subarray(8, 16)).readBigUInt64LE(0) << BigInt(64));
  const destLo = Buffer.from(destBytes.subarray(16, 24)).readBigUInt64LE(0)
    | (Buffer.from(destBytes.subarray(24, 32)).readBigUInt64LE(0) << BigInt(64));

  const destHiNonce = randomBytes(16);
  const ctDestHi = amountCipher.encrypt([destHi], destHiNonce);
  const destLoNonce = randomBytes(16);
  const ctDestLo = amountCipher.encrypt([destLo], destLoNonce);

  // --- 2. MPC bookkeeping ---
  const computationOffset = new BN(randomBytes(8), "hex");
  const accounts = getArciumAccounts(computationOffset, "process_withdrawal");
  const program = getProgram();

  const sig = await program.methods
    .processWithdrawal(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(userEphPub) as any,
      new BN(deserializeLE(userNonce).toString()),
      Array.from(ctUserId[0]) as any,
      Array.from(ctAmount[0]) as any,
      Array.from(ctDestHi[0]) as any,
      Array.from(ctDestLo[0]) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      ...accounts,
    })
    .rpc({ commitment: "confirmed" });

  logger.info({ sig: sig.slice(0, 12) }, "processWithdrawal TX sent");

  const finalizeSig = await awaitFinalization(computationOffset);

  logger.info(
    { sig: sig.slice(0, 12), finalizeSig: finalizeSig.slice(0, 12) },
    "Withdrawal finalized by MPC",
  );

  // --- 3. Unstake + send SOL ---
  const { signature: transferSig, estimatedSolOut } = await unstakeAndSend(amount, wallet);

  logger.info(
    { transferSig: transferSig.slice(0, 12), sol: estimatedSolOut },
    "Withdrawal SOL sent to user",
  );

  return {
    mpcSignature: sig,
    transferSignature: transferSig,
    estimatedSolOut,
  };
}
