/**
 * Public SOL deposit flow.
 * Step 1 (buildDepositTransaction): user signs deposit_sol → vault PDA.
 * Step 2 (confirmDeposit): backend verifies on-chain, stakes to Jito/Marinade, creates VaultShare.
 */
import {
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import { VaultShare, VaultType } from "../../models/VaultShare";
import { getSocketService } from "../socket/socketService";
import { devLog } from "../../utils/logger";
import {
  VAULT_PROGRAM_ID,
  MIN_DEPOSIT_LAMPORTS,
  getConnection,
  getVaultStatePda,
  getSolVaultPda,
  getIdlDiscriminator,
  buildInstructionData,
  isDevnet,
} from "./yield.config";
import { executeJitoStaking, executeMarinadeStaking } from "./sol-staking.service";
import { getExchangeRate } from "./yield-rates.service";
import { getArciumVaultService, isArciumEnabled } from "./arcium-vault.service";

export async function buildDepositTransaction(
  userPublicKey: string,
  amountSol: number,
  vaultType: VaultType
): Promise<{ transaction: string; message: string }> {
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (amountLamports < MIN_DEPOSIT_LAMPORTS) {
    throw new Error(`Minimum deposit is 0.01 SOL (${MIN_DEPOSIT_LAMPORTS} lamports)`);
  }

  const connection = getConnection();
  const depositor = new PublicKey(userPublicKey);
  const amount = new BN(amountLamports);
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);

  const tx = new Transaction();
  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData(getIdlDiscriminator("deposit_sol"), amount),
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = depositor;

  const serialized = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  const protocol = vaultType === "sol_jito" ? "Jito" : "Marinade";
  return {
    transaction: serialized,
    message: `Deposit ${amountSol} SOL into vault. After confirmation, backend will stake to ${protocol}.`,
  };
}

export async function confirmDeposit(
  signature: string,
  userId: string,
  vaultType: VaultType
): Promise<{
  success: boolean;
  shareId: string;
  amount: number;
  vaultType: VaultType;
}> {
  const connection = getConnection();

  try {
    await connection.confirmTransaction(signature, "confirmed");
  } catch (confirmErr: any) {
    console.warn(`[solDeposit] confirmTransaction warning: ${confirmErr?.message}`);
  }

  // Verify on-chain with retries
  let txInfo = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  if (!txInfo) throw new Error("Transaction not found or not confirmed");
  if (txInfo.meta?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`);
  }

  const feePayer =
    (txInfo.transaction.message as any).accountKeys?.[0]?.toString() ||
    txInfo.transaction.message.getAccountKeys().get(0)?.toString();
  devLog(`[solDeposit] ✅ Transaction confirmed: ${signature}`);
  devLog(`[solDeposit] Fee payer: ${feePayer} | User: ${userId}`);

  const depositAmount = extractDepositAmount(txInfo);
  if (!depositAmount) throw new Error("Could not extract deposit amount from transaction");
  devLog(`[solDeposit] Amount: ${depositAmount} lamports (${depositAmount / LAMPORTS_PER_SOL} SOL)`);

  // Stake (no-op on devnet)
  if (isDevnet()) {
    devLog(`[solDeposit] DEVNET: skipping ${vaultType} staking`);
  } else if (vaultType === "sol_jito") {
    await executeJitoStaking(connection, depositAmount);
  } else {
    await executeMarinadeStaking(connection, depositAmount);
  }

  const rate = await getExchangeRate(vaultType);
  const sharesAmount = depositAmount / rate;
  devLog(`[solDeposit] Rate: ${rate} | Shares: ${sharesAmount}`);

  const share = await VaultShare.create({
    userId,
    vaultType,
    sharesAmount,
    depositAmountLamports: depositAmount,
    depositRate: rate,
    depositTimestamp: new Date(),
    status: "active",
    txSignature: signature,
  });

  // Log encryption sanity check
  const rawDoc = await VaultShare.findById(share._id).lean();
  devLog(`[solDeposit] 🔐 VaultShare created: ${share._id}`);
  devLog(`[solDeposit] 🔐 Encrypted in DB:`, {
    sharesAmount: typeof (rawDoc as any)?.sharesAmount === "string"
      ? (rawDoc as any).sharesAmount.substring(0, 30) + "..." : (rawDoc as any)?.sharesAmount,
    depositAmountLamports: typeof (rawDoc as any)?.depositAmountLamports === "string"
      ? (rawDoc as any).depositAmountLamports.substring(0, 30) + "..." : (rawDoc as any)?.depositAmountLamports,
  });

  getSocketService().emitPrivateTransferUpdate(userId, {
    transferId: share._id.toString(),
    status: "completed",
    amount: depositAmount / LAMPORTS_PER_SOL,
  });

  // Arcium: fire-and-forget encrypted bookkeeping for standard deposits
  if (isArciumEnabled()) {
    const lamports = BigInt(depositAmount);
    const arciumService = getArciumVaultService();
    (async () => {
      try {
        await arciumService.ensureUserShare(userId);
      } catch (err: any) {
        console.error("[Arcium] ensureUserShare failed (standard deposit):", err.message);
        return;
      }
      try {
        await arciumService.recordDeposit(userId, lamports);
        await VaultShare.findByIdAndUpdate(share._id, { encryptedOnChain: true });
      } catch (err: any) {
        console.error("[Arcium] recordDeposit failed (standard deposit):", err.message);
        return;
      }
      arciumService.updateEncryptedTotal(lamports, true).catch((err: any) => {
        console.error("[Arcium] updateEncryptedTotal failed (standard deposit):", err.message);
      });
    })();
  }

  return {
    success: true,
    shareId: share._id.toString(),
    amount: depositAmount,
    vaultType,
  };
}

function extractDepositAmount(txInfo: any): number | null {
  if (!txInfo.meta) return null;

  const preBalances: number[] = txInfo.meta.preBalances;
  const postBalances: number[] = txInfo.meta.postBalances;
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);

  const accountKeys =
    txInfo.transaction.message.accountKeys ||
    txInfo.transaction.message.staticAccountKeys;

  for (let i = 0; i < accountKeys.length; i++) {
    const key =
      typeof accountKeys[i] === "string"
        ? accountKeys[i]
        : accountKeys[i].toBase58();
    if (key === solVault.toBase58()) {
      const diff = postBalances[i] - preBalances[i];
      if (diff > 0) return diff;
    }
  }
  return null;
}
