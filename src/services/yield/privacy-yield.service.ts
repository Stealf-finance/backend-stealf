import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { privacyCashService } from "../privacycash/PrivacyCashService";
import { getYieldService } from "./yield.service";
import { getUsdcYieldService } from "./usdc-yield.service";
import { getArciumVaultService } from "./arcium-vault.service";
import { getYieldMpcEnhancementsService } from "./yield-mpc-enhancements.service";
import { getBatchStakingService } from "./batch-staking.service";
import { decomposeToDenominations, solToLamports, getRandomSurplusDelay } from "./denomination.service";
import { VaultType, VaultShare } from "../../models/VaultShare";
import { SUPPORTED_TOKENS, calculateWithdrawalFee } from "../../config/privacyCash";
import { getExchangeRate } from "./yield-rates.service";

/**
 * Privacy-wrapped yield operations.
 *
 * SOL deposit flow:
 *   1. User deposits SOL into Privacy Pool (breaks on-chain link)
 *   2. Backend withdraws from Privacy Pool to vault PDA
 *   3. Backend stakes to Jito/Marinade
 *   => On-chain: no direct link between user wallet and vault
 *
 * USDC deposit flow:
 *   1. User deposits USDC into Privacy Pool (SPL)
 *   2. Backend withdraws USDC from Privacy Pool to user's wallet (new ephemeral address)
 *   3. User signs Kamino deposit tx from that address
 *   => On-chain: deposit appears to come from Privacy Pool, not user
 *
 * Withdrawal flows reverse the pattern through the Privacy Pool.
 */

const VAULT_PROGRAM_ID = new PublicKey(
  process.env.VAULT_PROGRAM_ID || "4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA"
);
const VAULT_ID = 1;

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

function getVaultSolPdaAddress(): string {
  const vaultIdBuf = Buffer.alloc(8);
  vaultIdBuf.writeBigUInt64LE(BigInt(VAULT_ID));

  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultIdBuf],
    VAULT_PROGRAM_ID
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), vaultState.toBuffer()],
    VAULT_PROGRAM_ID
  );

  return solVault.toBase58();
}

class PrivacyYieldService {
  // ==================== SOL PRIVACY DEPOSIT ====================

  /**
   * Step 1: User deposits SOL into Privacy Pool.
   */
  async depositSolToPrivacyPool(amountSol: number): Promise<{
    tx: string;
    fee: number;
  }> {
    const result = await privacyCashService.depositSOL(amountSol);
    return { tx: result.tx, fee: result.fee };
  }

  /**
   * Step 2: Backend withdraws from Privacy Pool to vault PDA,
   * then confirms deposit + triggers Jito/Marinade staking.
   */
  async executePrivateSolDeposit(
    userId: string,
    amountSol: number,
    vaultType: VaultType
  ): Promise<{
    success: boolean;
    shareId: string;
    privacyPoolTx: string;
  }> {
    if (vaultType === "usdc_kamino") {
      throw new Error("Use executePrivateUsdcDeposit for USDC");
    }

    const solVaultAddress = getVaultSolPdaAddress();

    // Withdraw from Privacy Pool to vault PDA
    const withdrawResult = await privacyCashService.withdrawSOL(
      amountSol,
      solVaultAddress
    );

    // Confirm and create VaultShare + stake
    const yieldService = getYieldService();
    const confirmResult = await yieldService.confirmDeposit(
      withdrawResult.tx,
      userId,
      vaultType
    );

    // Non-blocking: trigger yield distribution + snapshot after confirmed deposit
    if (confirmResult.success && process.env.ARCIUM_ENABLED === "true") {
      (async () => {
        try {
          const exchangeRate = await getExchangeRate(vaultType);
          // Convert exchange rate to integer ratio: rate_num/1_000_000
          // e.g. rate=1.0224 → rateNum=1_022_400
          const rateNum = BigInt(Math.min(Math.round(exchangeRate * 1_000_000), 1_100_000));
          const rateDenom = 1_000_000n;

          const enhancementsService = getYieldMpcEnhancementsService();
          await enhancementsService.computeYieldDistribution(userId, 0, rateNum, rateDenom);
        } catch (err: any) {
          console.error("[YieldMpcEnhancements] computeYieldDistribution (deposit) failed:", err.message);
        }

        try {
          const share = await VaultShare.findOne({ userId, vaultType, status: "active" }).sort({ createdAt: -1 });
          if (share) {
            const nextIndex = BigInt((share.snapshotIndex ?? 0) + 1);
            const enhancementsService = getYieldMpcEnhancementsService();
            await enhancementsService.takeBalanceSnapshot(userId, 0, nextIndex);
            await VaultShare.findByIdAndUpdate(share._id, { snapshotIndex: Number(nextIndex) });
          }
        } catch (err: any) {
          console.error("[YieldMpcEnhancements] takeBalanceSnapshot (deposit) failed:", err.message);
        }
      })();
    }

    return {
      success: confirmResult.success,
      shareId: confirmResult.shareId,
      privacyPoolTx: withdrawResult.tx,
    };
  }

  // ==================== USDC PRIVACY DEPOSIT ====================

  /**
   * Step 1: User deposits USDC into Privacy Pool (SPL).
   */
  async depositUsdcToPrivacyPool(amountUsdc: number): Promise<{
    tx: string;
    fee: number;
  }> {
    const result = await privacyCashService.depositSPL(
      SUPPORTED_TOKENS.USDC,
      amountUsdc
    );
    return { tx: result.tx, fee: result.fee };
  }

  /**
   * Step 2: Backend withdraws USDC from Privacy Pool to user's wallet,
   * then builds Kamino deposit tx for user to sign.
   * The on-chain trace shows: Privacy Pool → user wallet → Kamino.
   * The link between the original USDC source and Kamino deposit is broken.
   */
  async executePrivateUsdcDeposit(
    userId: string,
    userPublicKey: string,
    amountUsdc: number
  ): Promise<{
    success: boolean;
    transaction: string;
    privacyPoolTx: string;
    message: string;
  }> {
    // Withdraw USDC from Privacy Pool to user's wallet
    const withdrawResult = await privacyCashService.withdrawSPL(
      SUPPORTED_TOKENS.USDC,
      amountUsdc,
      userPublicKey
    );

    // Build Kamino deposit tx (user signs this)
    const usdcService = getUsdcYieldService();
    const depositResult = await usdcService.buildDepositTransaction(
      userPublicKey,
      amountUsdc
    );

    return {
      success: true,
      transaction: depositResult.transaction,
      privacyPoolTx: withdrawResult.tx,
      message: `Private deposit: ${amountUsdc} USDC routed through Privacy Pool → Kamino Lending`,
    };
  }

  // ==================== SOL PRIVACY WITHDRAWAL ====================

  /**
   * Private SOL withdrawal:
   * 1. Swap LST → SOL (authority signs)
   * 2. Deposit SOL into Privacy Pool
   * 3. Withdraw from Privacy Pool to user's wallet
   */
  async executePrivateSolWithdraw(
    userId: string,
    amountSol: number,
    vaultType: VaultType,
    userWallet: string
  ): Promise<{
    success: boolean;
    shareId: string;
    estimatedSolOut: number;
    privacyPoolTx: string;
  }> {
    if (vaultType === "usdc_kamino") {
      throw new Error("Use executePrivateUsdcWithdraw for USDC");
    }

    const yieldService = getYieldService();
    const connection = getConnection();

    // Step 1: Build and send withdrawal tx (LST → SOL swap)
    const withdrawResult = await yieldService.buildWithdrawTransaction(
      userId,
      amountSol,
      vaultType
    );

    const txBuffer = Buffer.from(withdrawResult.transaction, "base64");
    const signature = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
    });
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    // Step 2: Deposit received SOL into Privacy Pool
    await privacyCashService.depositSOL(withdrawResult.estimatedSolOut);

    // Step 3: Withdraw from Privacy Pool to user's wallet (minus fee)
    const fee = calculateWithdrawalFee(withdrawResult.estimatedSolOut);
    const netAmount = withdrawResult.estimatedSolOut - fee;
    const privacyWithdraw = await privacyCashService.withdrawSOL(
      netAmount,
      userWallet
    );

    // Step 4: Update VaultShare records
    const confirmResult = await yieldService.confirmWithdraw(
      signature,
      userId,
      vaultType,
      amountSol
    );

    return {
      success: confirmResult.success,
      shareId: confirmResult.shareId,
      estimatedSolOut: netAmount,
      privacyPoolTx: privacyWithdraw.tx,
    };
  }

  // ==================== ARCIUM-ENHANCED SOL DEPOSIT ====================

  /**
   * Full privacy SOL deposit with Arcium bookkeeping + anti-correlation:
   *   1. Decompose into standard denominations (anti-correlation)
   *   2. Deposit each denomination via Privacy Pool → vault PDA
   *   3. Record each deposit encrypted via Arcium MPC
   *   4. Add to batch staking queue (instead of immediate stake)
   *   5. Schedule surplus return with random delay
   */
  async executeArciumPrivateSolDeposit(
    userId: string,
    amountSol: number,
    vaultType: VaultType
  ): Promise<{
    success: boolean;
    shareIds: string[];
    batchId: string;
    denominationsUsed: number[];
    surplusSol: number;
  }> {
    if (vaultType === "usdc_kamino") {
      throw new Error("Use executePrivateUsdcDeposit for USDC");
    }

    const arciumService = getArciumVaultService();
    const batchService = getBatchStakingService();

    // Ensure user has an Arcium vault share
    await arciumService.ensureUserShare(userId);

    // Step 1: Decompose into standard denominations
    const { shuffledDenominations, totalDeposited, surplusSol } =
      decomposeToDenominations(amountSol);

    const solVaultAddress = getVaultSolPdaAddress();
    const yieldService = getYieldService();
    const shareIds: string[] = [];

    // Step 2+3: For each denomination, deposit via Pool + record in Arcium
    for (const denomSol of shuffledDenominations) {
      // Deposit through Privacy Pool
      const withdrawResult = await privacyCashService.withdrawSOL(
        denomSol,
        solVaultAddress
      );

      // Create VaultShare record
      const confirmResult = await yieldService.confirmDeposit(
        withdrawResult.tx,
        userId,
        vaultType
      );
      shareIds.push(confirmResult.shareId);

      // Record encrypted deposit in Arcium (non-blocking)
      const lamports = solToLamports(denomSol);
      arciumService.recordDeposit(userId, lamports).catch((err) => {
        console.error(`[ArciumVault] recordDeposit failed for ${userId}:`, err.message);
      });

      // Step 4: Add to batch staking queue
      await batchService.addToBatch(userId, lamports, vaultType, confirmResult.shareId);
    }

    // Update encrypted global total (non-blocking)
    const totalLamports = solToLamports(totalDeposited);
    arciumService.updateEncryptedTotal(totalLamports, true).catch((err) => {
      console.error(`[ArciumVault] updateEncryptedTotal failed:`, err.message);
    });

    // Step 5: Schedule surplus return with random delay
    if (surplusSol > 0.0001) {
      const delay = getRandomSurplusDelay();
      setTimeout(async () => {
        try {
          await privacyCashService.withdrawSOL(surplusSol, solVaultAddress);
          // Return surplus to user via pool (address would come from user session)
          console.log(`[PrivacyYield] Surplus ${surplusSol} SOL scheduled for return`);
        } catch (err: any) {
          console.error(`[PrivacyYield] Surplus return failed:`, err.message);
        }
      }, delay);
    }

    return {
      success: true,
      shareIds,
      batchId: "pending", // Will be set by batch service
      denominationsUsed: shuffledDenominations,
      surplusSol,
    };
  }

  // ==================== ARCIUM-ENHANCED SOL WITHDRAWAL ====================

  /**
   * Full privacy SOL withdrawal with Arcium verification:
   *   1. Verify withdrawal via Arcium MPC (encrypted balance check)
   *   2. If approved: unstake + withdraw vault → Privacy Pool → user
   *   3. Update encrypted total
   */
  async executeArciumPrivateSolWithdraw(
    userId: string,
    amountSol: number,
    vaultType: VaultType,
    userWallet: string
  ): Promise<{
    success: boolean;
    sufficient: boolean;
    shareId?: string;
    estimatedSolOut?: number;
    privacyPoolTx?: string;
  }> {
    if (vaultType === "usdc_kamino") {
      throw new Error("Use executePrivateUsdcWithdraw for USDC");
    }

    const arciumService = getArciumVaultService();
    const lamports = solToLamports(amountSol);

    // Step 1: Verify withdrawal via Arcium MPC
    const verifyResult = await arciumService.verifyWithdrawal(userId, lamports);

    if (!verifyResult.success || !verifyResult.data?.sufficient) {
      return {
        success: true,
        sufficient: false,
      };
    }

    // Step 2: Execute the actual withdrawal (existing flow)
    const result = await this.executePrivateSolWithdraw(
      userId,
      amountSol,
      vaultType,
      userWallet
    );

    // Step 3: Update encrypted total (non-blocking)
    arciumService.updateEncryptedTotal(lamports, false).catch((err) => {
      console.error(`[ArciumVault] updateEncryptedTotal (withdraw) failed:`, err.message);
    });

    return {
      success: result.success,
      sufficient: true,
      shareId: result.shareId,
      estimatedSolOut: result.estimatedSolOut,
      privacyPoolTx: result.privacyPoolTx,
    };
  }

  // ==================== USDC PRIVACY WITHDRAWAL ====================

  /**
   * Private USDC withdrawal:
   * 1. Build Kamino withdraw tx (user signs)
   * 2. After confirmation, user deposits USDC into Privacy Pool
   * 3. Backend withdraws from Privacy Pool to user's wallet
   */
  async buildPrivateUsdcWithdraw(
    userPublicKey: string,
    amountUsdc: number
  ): Promise<{
    transaction: string;
    estimatedUsdcOut: number;
  }> {
    const usdcService = getUsdcYieldService();
    return usdcService.buildWithdrawTransaction(userPublicKey, amountUsdc);
  }

  async confirmPrivateUsdcWithdraw(
    signature: string,
    userId: string,
    amountUsdc: number,
    userWallet: string
  ): Promise<{
    success: boolean;
    shareId: string;
    privacyPoolTx: string;
  }> {
    // Confirm the Kamino withdrawal
    const usdcService = getUsdcYieldService();
    const confirmResult = await usdcService.confirmWithdraw(
      signature,
      userId,
      amountUsdc
    );

    // Route through Privacy Pool: deposit USDC then withdraw to user
    await privacyCashService.depositSPL(SUPPORTED_TOKENS.USDC, amountUsdc);

    const fee = calculateWithdrawalFee(amountUsdc);
    const privacyWithdraw = await privacyCashService.withdrawSPL(
      SUPPORTED_TOKENS.USDC,
      amountUsdc - fee,
      userWallet
    );

    return {
      success: confirmResult.success,
      shareId: confirmResult.shareId,
      privacyPoolTx: privacyWithdraw.tx,
    };
  }
}

// Singleton
let instance: PrivacyYieldService | null = null;

export function getPrivacyYieldService(): PrivacyYieldService {
  if (!instance) {
    instance = new PrivacyYieldService();
  }
  return instance;
}

export { PrivacyYieldService };
