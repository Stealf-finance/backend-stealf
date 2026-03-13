import { BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  deserializeLE,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { getUserStatePDA, getArciumAccounts } from "./constant";
import { getProgram, getMxeKey, awaitFinalization } from "./anchorProvider";
import logger from "../../config/logger";

/**
 * Register a deposit in the MPC encrypted ledger.
 *
 * @param userIdHash  - SHA256 hash of u128ToLE(userId), 32 bytes
 * @param amount      - deposit amount in lamports
 * @param memoEphPub  - ephemeral x25519 public key from client memo
 * @param memoNonce   - nonce from client memo (16 bytes)
 * @param memoCt      - encrypted userId ciphertext from client memo
 */
export async function processDeposit(
  userIdHash: Buffer,
  amount: bigint,
  memoEphPub: Uint8Array,
  memoNonce: Buffer,
  memoCt: Uint8Array,
): Promise<string> {
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
