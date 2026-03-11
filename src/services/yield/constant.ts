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
  process.env.PRIVATE_YIELD_PROGRAM_ID || ""
);

export const CLUSTER_OFFSET = 456;

export const MPC_TIMEOUT_MS = 60_000;

// --- Vault / Jito ---

export const JITO_STAKE_POOL = new PublicKey(
  process.env.JITO_STAKE_POOL || "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb"
);

export const JITOSOL_MINT = new PublicKey(
  process.env.JITOSOL_MINT || "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"
);

export const JUPITER_API_BASE = "https://api.jup.ag/swap/v1";
export const MIN_DEPOSIT_LAMPORTS = 10_000_000; // 0.01 SOL
export const MAX_SLIPPAGE_BPS = 50;             // 0.5%
export const RATE_CACHE_TTL = 300;              // 5 minutes

// --- Helpers ---

export function u128ToLE(value: bigint): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(value & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buf.writeBigUInt64LE(value >> BigInt(64), 8);
  return buf;
}

export function getUserIdHash(userId: bigint): Buffer {
  return createHash("sha256").update(u128ToLE(userId)).digest();
}

// --- PDA derivation ---

export function getUserStatePDA(userIdHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_state"), userIdHash],
    PROGRAM_ID,
  )[0];
}

// --- Arcium accounts ---

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
