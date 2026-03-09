/**
 * Shared constants and low-level helpers for all yield services.
 * No business logic — only infrastructure primitives.
 */
import {
  Connection,
  PublicKey,
  Keypair,
} from "@solana/web3.js";
import BN from "bn.js";
import idl from "../../idl/stealf_vault.json";
import { VaultType } from "../../models/VaultShare";

// --- Program addresses ---

export const VAULT_PROGRAM_ID = new PublicKey(
  process.env.VAULT_PROGRAM_ID || "4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA"
);

export const JITO_STAKE_POOL = new PublicKey(
  process.env.JITO_STAKE_POOL || "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb"
);
export const JITOSOL_MINT = new PublicKey(
  process.env.JITOSOL_MINT || "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"
);

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// --- Configuration ---

export const JUPITER_API_BASE = "https://api.jup.ag/swap/v1";
export const MIN_DEPOSIT_LAMPORTS = 10_000_000; // 0.01 SOL
export const MAX_SLIPPAGE_BPS = 50;             // 0.5%
export const RATE_CACHE_TTL = 300;              // 5 minutes
export const VAULT_ID = 1;

// --- Environment helpers ---

export function isDevnet(): boolean {
  const rpcUrl = process.env.SOLANA_RPC_URL || "";
  return rpcUrl.includes("devnet");
}

export function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

export function getVaultAuthority(): Keypair {
  const key = process.env.VAULT_AUTHORITY_PRIVATE_KEY;
  if (!key) throw new Error("VAULT_AUTHORITY_PRIVATE_KEY not configured");
  const secretKey = JSON.parse(key) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export function getJupiterApiKey(): string {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("JUPITER_API_KEY not configured");
  return key;
}

// --- PDA derivation ---

export function getVaultStatePda(): [PublicKey, number] {
  const vaultIdBuf = Buffer.alloc(8);
  vaultIdBuf.writeBigUInt64LE(BigInt(VAULT_ID));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultIdBuf],
    VAULT_PROGRAM_ID
  );
}

export function getSolVaultPda(vaultState: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), vaultState.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

export function getLstMint(_vaultType: VaultType): PublicKey {
  return JITOSOL_MINT;
}

// --- Instruction building ---

export function getIdlDiscriminator(instructionName: string): Buffer {
  const ix = idl.instructions.find((i) => i.name === instructionName);
  if (!ix) throw new Error(`IDL instruction ${instructionName} not found`);
  return Buffer.from(ix.discriminator);
}

export function buildInstructionData(discriminator: Buffer, amount: BN): Buffer {
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  amount.toBuffer("le", 8).copy(data, 8);
  return data;
}
