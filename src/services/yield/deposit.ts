import { BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { getUserIdHash, getUserStatePDA, getArciumAccounts } from "./constant";
import { getProgram, getMxeKey, awaitFinalization } from "./anchorProvider";
import logger from "../../config/logger";

export async function processDeposit(
  userId: bigint,
  amount: bigint,
  memoEphPub: Uint8Array,
  memoNonce: Buffer,
  memoCt: Uint8Array,
): Promise<string> {
  const userIdHash = getUserIdHash(userId);
  const userStatePDA = getUserStatePDA(userIdHash);

  const mxePubKey = getMxeKey();
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const sharedSecret = x25519.getSharedSecret(ephPriv, mxePubKey);
  const cipher = new RescueCipher(sharedSecret);

  const amountNonce = randomBytes(16);
  const amountCt = cipher.encrypt([amount], amountNonce);

  const computationOffset = new BN(randomBytes(8), "hex");
  const accounts = getArciumAccounts(computationOffset, "process_deposit");
  const program = getProgram();

  const sig = await program.methods
    .processDeposit(
      computationOffset,
      Array.from(userIdHash) as any,
      Array.from(memoEphPub) as any,
      new BN(deserializeLE(memoNonce).toString()),
      Array.from(memoCt) as any,
      Array.from(ephPub) as any,
      new BN(deserializeLE(amountNonce).toString()),
      Array.from(amountCt[0]) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      ...accounts,
    })
    .rpc({ commitment: "confirmed" });

  logger.info({ sig: sig.slice(0, 12) }, "processDeposit TX sent");

  const finalizeSig = await awaitFinalization(computationOffset);

  logger.info({ sig: sig.slice(0, 12), finalizeSig: finalizeSig.slice(0, 12) }, "Deposit finalized by MPC");

  return sig;
}
