import { BN } from "@coral-xyz/anchor";
import { randomBytes } from "crypto";
import { getUserStatePDA, getArciumAccounts } from "./constant";
import { getProgram, getProvider, awaitFinalization } from "./anchorProvider";
import logger from "../../config/logger";

/**
 * Initialize a user's MPC state account with encrypted {user_id: 0, shares: 0}.
 * Must be called once before the first processDeposit.
 *
 * Without proper MXE initialization, CTR-mode decryption of zero-bytes produces
 * garbage instead of {0, 0}, causing deposits to be silently ignored.
 *
 * @param userIdHash - SHA256 hash of u128ToLE(userId), 32 bytes
 * @returns transaction signature, or null if already initialized
 */
export async function initUserState(userIdHash: Buffer): Promise<string | null> {
  const userStatePDA = getUserStatePDA(userIdHash);

  // Check if the account already exists
  const provider = getProvider();
  const existing = await provider.connection.getAccountInfo(userStatePDA);
  if (existing) {
    logger.debug({ pda: userStatePDA.toBase58().slice(0, 12) }, "User state already initialized");
    return null;
  }

  const computationOffset = new BN(randomBytes(8), "le");
  const accounts = getArciumAccounts(computationOffset, "init_user_state");
  const program = getProgram();

  const sig = await program.methods
    .initUserState(
      computationOffset,
      Array.from(userIdHash) as any,
    )
    .accountsPartial({
      userState: userStatePDA,
      ...accounts,
    })
    .rpc({ commitment: "confirmed" });

  logger.info({ sig: sig.slice(0, 12) }, "initUserState TX sent");

  await awaitFinalization(computationOffset);

  logger.info({ sig: sig.slice(0, 12) }, "User state initialized by MPC");

  return sig;
}
