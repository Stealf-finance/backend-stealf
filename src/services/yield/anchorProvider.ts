import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { getMXEPublicKey, awaitComputationFinalization } from "@arcium-hq/client";
import { BN } from "@coral-xyz/anchor";
import { PROGRAM_ID, MPC_TIMEOUT_MS } from "./constant";
import logger from "../../config/logger";

// --- Singleton state ---

let provider: AnchorProvider | null = null;
let program: Program | null = null;
let mxePublicKey: Uint8Array | null = null;

// --- Provider ---

function getAuthority(): Keypair {
  const key = process.env.VAULT_AUTHORITY_PRIVATE_KEY;
  if (!key) throw new Error("VAULT_AUTHORITY_PRIVATE_KEY not configured");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(key)));
}

export function getProvider(): AnchorProvider {
  if (provider) return provider;

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");

  const connection = new Connection(rpcUrl, "confirmed");
  const authority = getAuthority();

  provider = new AnchorProvider(
    connection,
    {
      publicKey: authority.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(authority);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach((tx) => tx.partialSign(authority));
        return txs;
      },
    } as any,
    { commitment: "confirmed" }
  );

  return provider;
}

// --- Program ---

export function getProgram(): Program {
  if (program) return program;

  let idl: any;
  try {
    idl = require("../../program/private_yield.json");
  } catch {
    throw new Error(
      "Missing IDL: src/idl/private_yield.json not found. " +
      "Copy it from private_yield/target/idl/private_yield.json after building the programme."
    );
  }
  program = new Program(idl, getProvider());
  return program;
}

// --- MXE Public Key ---

export async function initMxeKey(): Promise<Uint8Array> {
  if (mxePublicKey) return mxePublicKey;

  const prov = getProvider();
  for (let i = 0; i < 10; i++) {
    try {
      const key = await getMXEPublicKey(prov, PROGRAM_ID);
      if (key) {
        mxePublicKey = key;
        logger.info("MXE public key fetched successfully");
        return key;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Failed to fetch MXE public key after 10 attempts");
}

export function getMxeKey(): Uint8Array {
  if (!mxePublicKey) throw new Error("MXE key not initialized. Call initMxeKey() first.");
  return mxePublicKey;
}

// --- MPC Circuit Breaker ---

const CIRCUIT_BREAKER = {
  failures: 0,
  threshold: 3,          // Open after 3 consecutive failures
  cooldownMs: 60_000,    // Try again after 1 minute
  openedAt: 0,
};

function circuitBreakerCheck(): void {
  if (CIRCUIT_BREAKER.failures >= CIRCUIT_BREAKER.threshold) {
    const elapsed = Date.now() - CIRCUIT_BREAKER.openedAt;
    if (elapsed < CIRCUIT_BREAKER.cooldownMs) {
      throw new Error("MPC circuit breaker open — service temporarily unavailable");
    }
    // Half-open: allow one attempt through
    logger.info("MPC circuit breaker half-open, allowing probe request");
  }
}

function circuitBreakerSuccess(): void {
  if (CIRCUIT_BREAKER.failures > 0) {
    logger.info({ previousFailures: CIRCUIT_BREAKER.failures }, "MPC circuit breaker closed");
  }
  CIRCUIT_BREAKER.failures = 0;
}

function circuitBreakerFailure(): void {
  CIRCUIT_BREAKER.failures++;
  CIRCUIT_BREAKER.openedAt = Date.now();
  logger.warn(
    { failures: CIRCUIT_BREAKER.failures, threshold: CIRCUIT_BREAKER.threshold },
    "MPC failure recorded",
  );
}

export function isMpcAvailable(): boolean {
  if (CIRCUIT_BREAKER.failures < CIRCUIT_BREAKER.threshold) return true;
  return Date.now() - CIRCUIT_BREAKER.openedAt >= CIRCUIT_BREAKER.cooldownMs;
}

// --- Finalization ---

export async function awaitFinalization(computationOffset: BN): Promise<string> {
  circuitBreakerCheck();

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      circuitBreakerFailure();
      reject(new Error("MPC finalization timeout"));
    }, MPC_TIMEOUT_MS);

    awaitComputationFinalization(
      getProvider(),
      computationOffset,
      PROGRAM_ID,
      "confirmed"
    )
      .then((sig) => {
        clearTimeout(timeout);
        circuitBreakerSuccess();
        resolve(sig);
      })
      .catch((err) => {
        clearTimeout(timeout);
        circuitBreakerFailure();
        reject(err);
      });
  });
}
