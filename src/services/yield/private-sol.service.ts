/**
 * Authority-indirection private SOL yield flows (Phase 1 privacy).
 *
 * Deposit: user → authority wallet (TX1) → vault PDA (TX2).
 *   No direct on-chain link between user and yield vault.
 *
 * Withdraw: vault PDA → authority wallet → user wallet (single TX).
 *   Breaks the vault-to-user on-chain link.
 */
import {
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { randomUUID } from "crypto";
import BN from "bn.js";
import { VaultShare, VaultType } from "../../models/VaultShare";
import { getSocketService } from "../socket/socketService";
import { devLog } from "../../utils/logger";
import {
  VAULT_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  MIN_DEPOSIT_LAMPORTS,
  getConnection,
  getVaultAuthority,
  getVaultStatePda,
  getSolVaultPda,
  getIdlDiscriminator,
  buildInstructionData,
  isDevnet,
} from "./yield.config";
import { executeJitoStaking, executeMarinadeStaking } from "./sol-staking.service";
import { getExchangeRate } from "./yield-rates.service";
import { decomposeToDenominations } from "./denomination.service";

/**
 * Build the first-leg private deposit transaction:
 * SystemProgram.transfer(user → authority) + Memo with reference UUID.
 * User signs and submits this. Backend listens for confirmation.
 */
export async function buildPrivateDepositTransaction(
  userPublicKey: string,
  amountSol: number
): Promise<{ transaction: string; reference: string; message: string }> {
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (amountLamports < MIN_DEPOSIT_LAMPORTS) {
    throw new Error(`Minimum deposit is 0.01 SOL (${MIN_DEPOSIT_LAMPORTS} lamports)`);
  }

  const authority = getVaultAuthority();
  const depositor = new PublicKey(userPublicKey);
  const reference = randomUUID();

  const tx = new Transaction();

  // SOL: user → authority wallet
  tx.add(
    SystemProgram.transfer({
      fromPubkey: depositor,
      toPubkey: authority.publicKey,
      lamports: amountLamports,
    })
  );

  // Memo for backend correlation
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(reference),
    })
  );

  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = depositor;

  const serialized = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  console.log(
    `[privateSol] Private deposit tx built: ${amountSol} SOL user→authority, ref=${reference}`
  );

  return {
    transaction: serialized,
    reference,
    message: `Private deposit: ${amountSol} SOL routed through intermediary wallet.`,
  };
}

/**
 * Confirm a private deposit after user submits TX1:
 * 1. Verify TX1 on-chain (user → authority)
 * 2. Authority deposits received SOL into vault PDA (TX2)
 * 3. Optionally stake (Jito/Marinade)
 * 4. Create VaultShare
 */
export async function confirmPrivateDeposit(
  signature: string,
  userId: string,
  vaultType: VaultType,
  amountSol: number
): Promise<{
  success: boolean;
  shareId: string;
  amount: number;
  vaultType: VaultType;
}> {
  const connection = getConnection();
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  // Wait for TX1 confirmation
  try {
    await connection.confirmTransaction(signature, "confirmed");
  } catch (err: any) {
    console.warn(`[privateSol] confirmTransaction warning: ${err?.message}`);
  }

  let txInfo = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  if (!txInfo) throw new Error("Private deposit transaction not found or not confirmed");
  if (txInfo.meta?.err) {
    throw new Error(`Private deposit transaction failed: ${JSON.stringify(txInfo.meta.err)}`);
  }

  devLog(`[privateSol] ✅ TX1 confirmed (user→authority): ${signature}`);

  // TX2: authority deposits SOL into vault PDA
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);

  const depositTx = new Transaction();
  depositTx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: true },
      { pubkey: solVault, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData(getIdlDiscriminator("deposit_sol"), new BN(amountLamports)),
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  depositTx.recentBlockhash = blockhash;
  depositTx.lastValidBlockHeight = lastValidBlockHeight;
  depositTx.feePayer = authority.publicKey;
  depositTx.sign(authority);

  const vaultDepositSig = await connection.sendRawTransaction(depositTx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: vaultDepositSig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  devLog(`[privateSol] ✅ TX2 authority→vault confirmed: ${vaultDepositSig}`);

  // Stake (no-op on devnet)
  if (isDevnet()) {
    devLog(`[privateSol] DEVNET: skipping ${vaultType} staking`);
  } else if (vaultType === "sol_jito") {
    await executeJitoStaking(connection, amountLamports);
  } else {
    await executeMarinadeStaking(connection, amountLamports);
  }

  const rate = await getExchangeRate(vaultType);
  const sharesAmount = amountLamports / rate;

  const share = await VaultShare.create({
    userId,
    vaultType,
    sharesAmount,
    depositAmountLamports: amountLamports,
    depositRate: rate,
    depositTimestamp: new Date(),
    status: "active",
    txSignature: vaultDepositSig, // store authority→vault TX, not user's TX1
  });

  devLog(`[privateSol] 🔐 Private VaultShare created: ${share._id}`);

  getSocketService().emitPrivateTransferUpdate(userId, {
    transferId: share._id.toString(),
    status: "completed",
    amount: amountSol,
  });

  return {
    success: true,
    shareId: share._id.toString(),
    amount: amountLamports,
    vaultType,
  };
}

/**
 * Fully private withdrawal (backend-orchestrated, no user signature):
 * vault PDA → authority → user wallet in a single authority-signed TX.
 * Breaks the direct on-chain vault-to-user link.
 */
export async function executePrivateWithdraw(
  userId: string,
  amountSol: number,
  vaultType: VaultType,
  userWallet: string
): Promise<{
  success: boolean;
  shareId: string;
  estimatedSolOut: number;
  txSignature: string;
}> {
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  // Verify sufficient shares
  const userShares = await VaultShare.find({ userId, vaultType, status: "active" });
  const totalUserShares = userShares.reduce((sum, s) => sum + s.sharesAmount, 0);
  if (amountLamports > totalUserShares) {
    throw new Error(
      `Insufficient shares. Requested ${amountLamports} but only have ${totalUserShares}`
    );
  }

  const connection = getConnection();
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);
  const recipient = new PublicKey(userWallet);

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

  // Step 2: authority → user wallet
  tx.add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: recipient,
      lamports: amountLamports,
    })
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  const txSignature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: txSignature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  devLog(`[privateSol] ✅ Private withdraw vault→authority→${userWallet}: ${txSignature}`);

  // Update VaultShares (FIFO)
  const rate = await getExchangeRate(vaultType);
  const lstToWithdraw = amountLamports / rate;
  const activeShares = await VaultShare.find({
    userId, vaultType, status: "active",
  }).sort({ depositTimestamp: 1 });

  let remaining = lstToWithdraw;
  let lastShareId = "";

  for (const share of activeShares) {
    if (remaining <= 0) break;

    if (share.sharesAmount <= remaining) {
      share.status = "withdrawn" as any;
      share.withdrawAmountLamports = Math.floor(share.sharesAmount * rate);
      share.withdrawTimestamp = new Date();
      share.withdrawTxSignature = txSignature;
      await share.save();
      remaining -= share.sharesAmount;
      lastShareId = share._id.toString();
    } else {
      const withdrawnShares = remaining;
      share.sharesAmount = share.sharesAmount - withdrawnShares;
      await share.save();

      const partialShare = await VaultShare.create({
        userId,
        vaultType,
        sharesAmount: withdrawnShares,
        depositAmountLamports: Math.floor(
          (withdrawnShares / (withdrawnShares + share.sharesAmount)) *
            share.depositAmountLamports
        ),
        depositRate: share.depositRate,
        depositTimestamp: share.depositTimestamp,
        status: "withdrawn",
        txSignature: share.txSignature,
        withdrawAmountLamports: Math.floor(withdrawnShares * rate),
        withdrawTimestamp: new Date(),
        withdrawTxSignature: txSignature,
      });
      lastShareId = partialShare._id.toString();
      remaining = 0;
    }
  }

  getSocketService().emitPrivateTransferUpdate(userId, {
    transferId: lastShareId,
    status: "completed",
    amount: amountSol,
  });

  return { success: true, shareId: lastShareId, estimatedSolOut: amountSol, txSignature };
}

/**
 * Full Arcium private deposit confirmation.
 *
 * Verifies TX1 (user→authority), then splits the total amount into standard
 * denominations (0.1 / 0.5 / 1 / 5 / 10 SOL) and processes each as an
 * independent authority→vault TX. Returns shareIds per denomination so the
 * caller can record each via Arcium MPC and add to batch staking.
 *
 * Surplus (rounding up to next denomination) is returned to the user wallet
 * via a direct authority→user transfer.
 *
 * NOTE: staking is intentionally skipped here — caller is expected to
 * add each shareId to BatchStakingService for deferred anti-correlation staking.
 */
export async function confirmPrivateDepositArcium(
  signature: string,
  userId: string,
  vaultType: VaultType,
  amountSol: number,
  userWallet: string
): Promise<{
  success: boolean;
  shareIds: string[];
  totalDeposited: number;
  denominationsUsed: number[];
  surplusSol: number;
}> {
  const connection = getConnection();
  const authority = getVaultAuthority();

  // Verify TX1 (user→authority)
  try {
    await connection.confirmTransaction(signature, "confirmed");
  } catch (err: any) {
    console.warn(`[privateSol/arcium] confirmTransaction warning: ${err?.message}`);
  }

  let txInfo = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txInfo) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!txInfo) throw new Error("Private deposit transaction not found or not confirmed");
  if (txInfo.meta?.err) {
    throw new Error(`Private deposit TX1 failed: ${JSON.stringify(txInfo.meta.err)}`);
  }

  console.log(`[privateSol/arcium] ✅ TX1 confirmed (user→authority): ${signature}`);

  // Decompose into standard denominations for anti-correlation
  const { shuffledDenominations, totalDeposited, surplusSol } =
    decomposeToDenominations(amountSol);

  const [vaultState] = getVaultStatePda();
  const [solVault] = getSolVaultPda(vaultState);
  const rate = await getExchangeRate(vaultType); // fetch once, reuse across denominations
  const shareIds: string[] = [];

  for (const denomSol of shuffledDenominations) {
    const denomLamports = Math.floor(denomSol * LAMPORTS_PER_SOL);

    // TX2-n: authority → vault PDA (one TX per denomination)
    const depositTx = new Transaction();
    depositTx.add({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: vaultState, isSigner: false, isWritable: true },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInstructionData(getIdlDiscriminator("deposit_sol"), new BN(denomLamports)),
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    depositTx.recentBlockhash = blockhash;
    depositTx.lastValidBlockHeight = lastValidBlockHeight;
    depositTx.feePayer = authority.publicKey;
    depositTx.sign(authority);

    const vaultDepositSig = await connection.sendRawTransaction(
      depositTx.serialize(),
      { skipPreflight: false }
    );
    await connection.confirmTransaction(
      { signature: vaultDepositSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    console.log(
      `[privateSol/arcium] ✅ authority→vault ${denomSol} SOL: ${vaultDepositSig}`
    );

    // VaultShare — staking deferred to BatchStakingService (no executeJitoStaking here)
    const sharesAmount = denomLamports / rate;
    const share = await VaultShare.create({
      userId,
      vaultType,
      sharesAmount,
      depositAmountLamports: denomLamports,
      depositRate: rate,
      depositTimestamp: new Date(),
      status: "active",
      txSignature: vaultDepositSig,
    });
    shareIds.push(share._id.toString());
  }

  // Return surplus to user (authority → user wallet)
  if (surplusSol > 0.0001) {
    const surplusLamports = Math.floor(surplusSol * LAMPORTS_PER_SOL);
    const surplusTx = new Transaction();
    surplusTx.add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: new PublicKey(userWallet),
        lamports: surplusLamports,
      })
    );
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    surplusTx.recentBlockhash = blockhash;
    surplusTx.lastValidBlockHeight = lastValidBlockHeight;
    surplusTx.feePayer = authority.publicKey;
    surplusTx.sign(authority);

    const surplusSig = await connection.sendRawTransaction(
      surplusTx.serialize(),
      { skipPreflight: false }
    );
    await connection.confirmTransaction(
      { signature: surplusSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    console.log(
      `[privateSol/arcium] ✅ Surplus ${surplusSol} SOL returned to user: ${surplusSig}`
    );
  }

  getSocketService().emitPrivateTransferUpdate(userId, {
    transferId: shareIds[shareIds.length - 1] ?? "",
    status: "completed",
    amount: totalDeposited,
  });

  return {
    success: true,
    shareIds,
    totalDeposited,
    denominationsUsed: shuffledDenominations,
    surplusSol,
  };
}
