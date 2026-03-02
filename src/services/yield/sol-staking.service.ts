/**
 * Low-level staking operations: SOL → JitoSOL and SOL → mSOL.
 * Each function withdraws from the vault PDA and stakes to the LST protocol.
 */
import {
  Connection,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";
import { depositSol as jitoDepositSol } from "@solana/spl-stake-pool";
import BN from "bn.js";
import {
  JITO_STAKE_POOL,
  VAULT_PROGRAM_ID,
  getConnection,
  getVaultAuthority,
  getVaultStatePda,
  getSolVaultPda,
  getIdlDiscriminator,
  buildInstructionData,
  isDevnet,
} from "./yield.config";
import { VaultType } from "../../models/VaultShare";

/**
 * Withdraw SOL from vault PDA and stake to Jito (jitoSOL).
 * Authority-signed — no user interaction required.
 */
export async function executeJitoStaking(
  connection: Connection,
  amountLamports: number
): Promise<string> {
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);

  const jitoStakeIxs = await jitoDepositSol(
    connection,
    JITO_STAKE_POOL,
    authority.publicKey,
    amountLamports
  );

  const tx = new Transaction();

  // Step 1: vault PDA → authority
  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData(
      getIdlDiscriminator("withdraw_sol"),
      new BN(amountLamports)
    ),
  });

  // Step 2: authority → Jito stake pool
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

  return sig;
}

/**
 * Withdraw SOL from vault PDA and stake to Marinade (mSOL).
 * Authority-signed — no user interaction required.
 */
export async function executeMarinadeStaking(
  connection: Connection,
  amountLamports: number
): Promise<string> {
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);

  const config = new MarinadeConfig({
    connection,
    publicKey: authority.publicKey,
  });
  const marinade = new Marinade(config);
  const { transaction: marinadeDepositTx } = await marinade.deposit(
    new BN(amountLamports)
  );

  const tx = new Transaction();

  // Step 1: vault PDA → authority
  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData(
      getIdlDiscriminator("withdraw_sol"),
      new BN(amountLamports)
    ),
  });

  // Step 2: authority → Marinade
  tx.add(...marinadeDepositTx.instructions);

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

  return sig;
}

/**
 * Public entry point for batch-staking service.
 * On devnet, this is a no-op (SOL stays in vault PDA).
 */
export async function executeStaking(
  amountLamports: number,
  vaultType: VaultType
): Promise<{ signature: string | null }> {
  if (isDevnet()) {
    console.log(
      `[solStaking] DEVNET mode: skipping batch staking for ${amountLamports} lamports`
    );
    return { signature: null };
  }

  const connection = getConnection();

  const signature =
    vaultType === "sol_jito"
      ? await executeJitoStaking(connection, amountLamports)
      : await executeMarinadeStaking(connection, amountLamports);

  return { signature };
}
