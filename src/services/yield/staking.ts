import {
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { depositSol as jitoDepositSol } from "@solana/spl-stake-pool";
import BN from "bn.js";
import {
  JITO_STAKE_POOL,
  JITOSOL_MINT,
  VAULT_PROGRAM_ID,
  getVaultStatePda,
  getSolVaultPda,
} from "./constant";
import idl from "../../idl/stealf_vault.json";
import logger from "../../config/logger";

// --- Helpers ---

function getVaultAuthority(): Keypair {
  const key = process.env.VAULT_AUTHORITY_PRIVATE_KEY;
  if (!key) throw new Error("VAULT_AUTHORITY_PRIVATE_KEY not configured");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key)));
}

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

function isDevnet(): boolean {
  return (process.env.SOLANA_RPC_URL || "").includes("devnet");
}

function getIdlDiscriminator(instructionName: string): Buffer {
  const ix = idl.instructions.find((i) => i.name === instructionName);
  if (!ix) throw new Error(`IDL instruction ${instructionName} not found`);
  return Buffer.from(ix.discriminator);
}

async function getJitosolBalance(connection: Connection, owner: Keypair): Promise<bigint> {
  const ata = await getAssociatedTokenAddress(JITOSOL_MINT, owner.publicKey);
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return BigInt(info.value.amount);
  } catch {
    return BigInt(0);
  }
}

// --- Staking ---

export interface StakeResult {
  signature: string;
  jitosolReceived: bigint;
}

/**
 * Withdraw SOL from vault PDA and stake to Jito.
 * Returns the amount of JitoSOL received.
 */
export async function executeJitoStaking(
  amountLamports: number
): Promise<StakeResult> {
  const connection = getConnection();
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda();

  // JitoSOL balance before staking
  const balanceBefore = await getJitosolBalance(connection, authority);

  const jitoStakeIxs = await jitoDepositSol(
    connection,
    JITO_STAKE_POOL,
    authority.publicKey,
    amountLamports
  );

  const tx = new Transaction();

  const discriminator = getIdlDiscriminator("withdraw_sol");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  new BN(amountLamports).toBuffer("le", 8).copy(data, 8);

  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  tx.add(...jitoStakeIxs.instructions);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;

  tx.sign(authority);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  // JitoSOL balance after staking
  const balanceAfter = await getJitosolBalance(connection, authority);
  const jitosolReceived = balanceAfter - balanceBefore;

  logger.info(
    { sig: sig.slice(0, 12), solIn: amountLamports, jitosolOut: jitosolReceived.toString() },
    "Staked SOL → JitoSOL",
  );

  return { signature: sig, jitosolReceived };
}

/**
 * Stake SOL to Jito. Returns JitoSOL lamports received.
 * On devnet: no staking, returns SOL amount as-is (1:1 ratio).
 */
export async function stakeToJito(
  amountLamports: number
): Promise<bigint> {
  if (isDevnet()) {
    logger.info({ amount: amountLamports }, "DEVNET: skipping Jito staking (1:1 ratio)");
    return BigInt(amountLamports);
  }

  const result = await executeJitoStaking(amountLamports);
  return result.jitosolReceived;
}
