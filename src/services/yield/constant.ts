import { PublicKey } from "@solana/web3.js";
import {
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
} from "@arcium-hq/client";
import { BN } from "@coral-xyz/anchor";
import { createHash } from "crypto";

export const PROGRAM_ID = new PublicKey(
  process.env.PRIVATE_YIELD_PROGRAM_ID || "F3ypFyPnffVd4sq3wDRZjHLz3F9GBnYoKw3gSHjN2Uts"
);

export const CLUSTER_OFFSET = 456;

export const MPC_TIMEOUT_MS = 60_000;

// --- Vault (stealf_vault programme) ---

export const VAULT_PROGRAM_ID = new PublicKey(
  process.env.VAULT_PROGRAM_ID || "4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA"
);

export const VAULT_ID = 2;

export const JITO_STAKE_POOL = new PublicKey(
  process.env.JITO_STAKE_POOL || "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb"
);

export const JITOSOL_MINT = new PublicKey(
  process.env.JITOSOL_MINT || "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"
);

export const JUPITER_API_BASE = "https://api.jup.ag/swap/v1";
export const MIN_DEPOSIT_LAMPORTS = 10_000_000;
export const MAX_SLIPPAGE_BPS = 50;
export const RATE_CACHE_TTL = 300;

// --- Vault PDA derivation ---

export function getVaultStatePda(): [PublicKey, number] {
  const vaultIdBuf = Buffer.alloc(8);
  vaultIdBuf.writeBigUInt64LE(BigInt(VAULT_ID));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultIdBuf],
    VAULT_PROGRAM_ID
  );
}

export function getSolVaultPda(): [PublicKey, number] {
  const [vaultState] = getVaultStatePda();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), vaultState.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

// --- Helpers ---

export function u128ToLE(value: bigint): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(value & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buf.writeBigUInt64LE(value >> BigInt(64), 8);
  return buf;
}

/**
 * Convert a UUID string to a u128 bigint.
 * Strips hyphens and parses the 32 hex chars as a big-endian u128.
 */
export function uuidToU128(uuid: string): bigint {
  return BigInt("0x" + uuid.replace(/-/g, ""));
}

export function getUserIdHash(userId: bigint): Buffer {
  return createHash("sha256").update(u128ToLE(userId)).digest();
}

export function getUserStatePDA(userIdHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_state"), userIdHash],
    PROGRAM_ID,
  )[0];
}

export const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);

export function getArciumAccounts(computationOffset: BN, compDefName: string) {
  const offset = getCompDefAccOffset(compDefName);
  const offsetU32 = Buffer.from(offset).readUInt32LE();

  return {
    computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
    compDefAccount: getCompDefAccAddress(PROGRAM_ID, offsetU32),
    clusterAccount,
    mxeAccount: getMXEAccAddress(PROGRAM_ID),
    mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
  };
}
