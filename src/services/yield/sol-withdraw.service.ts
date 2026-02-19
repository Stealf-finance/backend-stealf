/**
 * Public SOL withdrawal flow.
 * buildWithdrawTransaction: authority builds LST→SOL swap via Jupiter (or simple devnet transfer).
 * confirmWithdraw: marks VaultShares as withdrawn (FIFO).
 */
import {
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import axios from "axios";
import BN from "bn.js";
import { VaultShare, VaultType } from "../../models/VaultShare";
import { getSocketService } from "../socket/socketService";
import {
  VAULT_PROGRAM_ID,
  MAX_SLIPPAGE_BPS,
  JUPITER_API_BASE,
  getConnection,
  getVaultAuthority,
  getVaultStatePda,
  getSolVaultPda,
  getLstMint,
  getIdlDiscriminator,
  buildInstructionData,
  getJupiterApiKey,
  isDevnet,
} from "./yield.config";
import { getExchangeRate } from "./yield-rates.service";

export async function buildWithdrawTransaction(
  userId: string,
  amountSol: number,
  vaultType: VaultType,
  userPublicKey?: string
): Promise<{
  transaction: string;
  estimatedSolOut: number;
  slippagePercent: number;
}> {
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  // --- Devnet: simple vault PDA → user transfer ---
  if (isDevnet()) {
    if (!userPublicKey) throw new Error("userPublicKey required for devnet withdrawal");

    const userShares = await VaultShare.find({ userId, vaultType, status: "active" });
    const totalUserShares = userShares.reduce((sum, s) => sum + s.sharesAmount, 0);
    if (amountLamports > totalUserShares) {
      throw new Error(
        `Insufficient shares. Requested ${amountLamports} but only have ${totalUserShares}`
      );
    }

    const authority = getVaultAuthority();
    const [vaultState] = getVaultStatePda();
    const [solVault] = getSolVaultPda(vaultState);
    const recipient = new PublicKey(userPublicKey);

    const tx = new Transaction();
    tx.add({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: vaultState, isSigner: false, isWritable: false },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInstructionData(
        getIdlDiscriminator("withdraw_sol"),
        new BN(amountLamports)
      ),
    });

    const connection = getConnection();
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    console.log(`[solWithdraw] DEVNET: ${amountSol} SOL vault → ${userPublicKey}`);
    return {
      transaction: tx.serialize().toString("base64"),
      estimatedSolOut: amountSol,
      slippagePercent: 0,
    };
  }

  // --- Mainnet: LST → SOL via Jupiter ---
  const rate = await getExchangeRate(vaultType);
  const lstAmount = Math.ceil(amountLamports / rate);
  const lstMint = getLstMint(vaultType);

  const userShares = await VaultShare.find({ userId, vaultType, status: "active" });
  const totalUserLst = userShares.reduce((sum, s) => sum + s.sharesAmount, 0);
  if (lstAmount > totalUserLst) {
    throw new Error(
      `Insufficient shares. Requested ${lstAmount} but only have ${totalUserLst} ${
        vaultType === "sol_jito" ? "JitoSOL" : "mSOL"
      }`
    );
  }

  // Jupiter quote: LST → SOL
  const quoteResponse = await axios.get(`${JUPITER_API_BASE}/quote`, {
    params: {
      inputMint: lstMint.toBase58(),
      outputMint: "So11111111111111111111111111111111111111112",
      amount: lstAmount.toString(),
      slippageBps: MAX_SLIPPAGE_BPS,
    },
    headers: { "x-api-key": getJupiterApiKey() },
  });

  const quote = quoteResponse.data;
  const estimatedSolOut = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
  const slippagePercent = ((amountSol - estimatedSolOut) / amountSol) * 100;

  if (slippagePercent > 0.5) {
    throw new Error(
      `Slippage too high: ${slippagePercent.toFixed(2)}% (max 0.5%). Try again later.`
    );
  }

  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const lstVaultAta = await getAssociatedTokenAddress(lstMint, vaultState, true);
  const authorityLstAta = await getAssociatedTokenAddress(lstMint, authority.publicKey);

  const swapInstructionsResponse = await axios.post(
    `${JUPITER_API_BASE}/swap-instructions`,
    { quoteResponse: quote, userPublicKey: authority.publicKey.toBase58() },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getJupiterApiKey(),
      },
    }
  );

  const swapIxs = swapInstructionsResponse.data;

  const deserializeIx = (ix: any) => ({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((acc: any) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });

  const tx = new Transaction();

  // Withdraw LST from vault ATA → authority ATA
  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: lstVaultAta, isSigner: false, isWritable: true },
      { pubkey: authorityLstAta, isSigner: false, isWritable: true },
      { pubkey: lstMint, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: buildInstructionData(getIdlDiscriminator("withdraw_token"), new BN(lstAmount)),
  });

  if (swapIxs.setupInstructions?.length) {
    for (const ix of swapIxs.setupInstructions) tx.add(deserializeIx(ix));
  }
  tx.add(deserializeIx(swapIxs.swapInstruction));
  if (swapIxs.cleanupInstruction) tx.add(deserializeIx(swapIxs.cleanupInstruction));

  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  return {
    transaction: tx.serialize().toString("base64"),
    estimatedSolOut,
    slippagePercent,
  };
}

export async function confirmWithdraw(
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

  try {
    await connection.confirmTransaction(signature, "confirmed");
  } catch (confirmErr: any) {
    console.warn(`[solWithdraw] confirmWithdraw warning: ${confirmErr?.message}`);
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

  if (!txInfo) throw new Error("Withdrawal transaction not found or not confirmed");
  if (txInfo.meta?.err) {
    throw new Error(`Withdrawal failed on-chain: ${JSON.stringify(txInfo.meta.err)}`);
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const rate = await getExchangeRate(vaultType);
  const lstToWithdraw = amountLamports / rate;

  // FIFO: mark oldest shares as withdrawn first
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
      share.withdrawTxSignature = signature;
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
        withdrawTxSignature: signature,
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

  return { success: true, shareId: lastShareId, amount: amountLamports, vaultType };
}
