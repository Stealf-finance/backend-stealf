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
import { queryAndEmitBalance } from "./balance";
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

  console.log("montant withdraw: ", amount);
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);
  const mxePubKey = getMxeKey();

  const userEphPriv = x25519.utils.randomSecretKey();
  const userEphPub = x25519.getPublicKey(userEphPriv);
  const userShared = x25519.getSharedSecret(userEphPriv, mxePubKey);
  const userCipher = new RescueCipher(userShared);

  const destBytes = new PublicKey(wallet).toBytes();

  const destHi = Buffer.from(destBytes.subarray(0, 16)).readBigUInt64LE(0)
    | (Buffer.from(destBytes.subarray(8, 16)).readBigUInt64LE(0) << BigInt(64));
  const destLo = Buffer.from(destBytes.subarray(16, 24)).readBigUInt64LE(0)
    | (Buffer.from(destBytes.subarray(24, 32)).readBigUInt64LE(0) << BigInt(64));

  const memoNonce = randomBytes(16);
  const memoCt = userCipher.encrypt([userId, BigInt(amount), destHi, destLo], memoNonce);

  const computationOffset = new BN(randomBytes(8), "le");
  const accounts = getArciumAccounts(computationOffset, "process_withdrawal");
  const program = getProgram();
 
  const eventPromise = new Promise<{ verified: bigint }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      program.removeEventListener(listenerId);
      reject(new Error("WithdrawalProcessed event timeout"));
    }, 60_000);

    const listenerId = program.addEventListener("withdrawalProcessed", (event: any) => {
      clearTimeout(timeout);
      program.removeEventListener(listenerId);
      resolve({
        verified: BigInt(event.verified.toString()),
      });
    });
  });

  const sig = await program.methods
    .processWithdrawal(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(userEphPub) as any,
      new BN(deserializeLE(memoNonce).toString()),
      Array.from(memoCt[0]) as any,
      Array.from(memoCt[1]) as any,
      Array.from(memoCt[2]) as any,
      Array.from(memoCt[3]) as any,
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

  const event = await eventPromise;
  logger.info({ verified: event.verified.toString() }, "Withdrawal verification result");

  if (event.verified !== BigInt(1)) {
    throw new Error("Withdraw: Insufficient balance");
  }

  const { signature: transferSig, estimatedSolOut } = await unstakeAndSend(amount, wallet);

  logger.info(
    { transferSig: transferSig.slice(0, 12), sol: estimatedSolOut },
    "Withdrawal SOL sent to user",
  );

  // Emit updated balance to frontend (fire-and-forget)
  queryAndEmitBalance(userIdHash).catch((err) =>
    logger.error({ err }, "Failed to emit yield balance after withdrawal"),
  );

  return {
    mpcSignature: sig,
    transferSignature: transferSig,
    estimatedSolOut,
  };
}
