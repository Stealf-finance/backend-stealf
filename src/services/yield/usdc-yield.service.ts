import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  PROGRAM_ID,
} from "@kamino-finance/klend-sdk";
import { VaultShare } from "../../models/VaultShare";
import { getSocketService } from "../socket/socketService";
import redisClient from "../../config/redis";
import BN from "bn.js";

// --- Constants ---

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;

// Kamino market: mainnet vs staging (devnet)
const isDevnet = process.env.SOLANA_RPC_URL?.includes("devnet");
const KAMINO_MAIN_MARKET = new PublicKey(
  process.env.KAMINO_MARKET_ADDRESS ||
    (isDevnet
      ? // Kamino staging — no known public market on devnet yet, USDC operations will fail gracefully
        "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
      : "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF")
);
// Kamino program IDs per environment
const KAMINO_PROGRAM = isDevnet
  ? "SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh" // staging
  : "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"; // mainnet

const MIN_DEPOSIT_USDC = 1; // 1 USDC minimum
const RATE_CACHE_TTL = 300; // 5 minutes
const USDC_AVAILABLE_ON_DEVNET = false; // Set to true once Kamino staging market is found

// --- Helpers ---

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

function usdcToBaseUnits(amount: number): BN {
  return new BN(Math.floor(amount * 10 ** USDC_DECIMALS));
}

function baseUnitsToUsdc(amount: number): number {
  return amount / 10 ** USDC_DECIMALS;
}

/**
 * Create a minimal TransactionSigner for Kamino SDK.
 * We don't sign server-side — the tx is returned for user to sign.
 */
function toTransactionSigner(pubkey: PublicKey): any {
  return {
    address: pubkey.toBase58(),
    signTransactions: async (txs: any[]) => txs,
  };
}

// --- Service ---

class UsdcYieldService {
  private market: KaminoMarket | null = null;

  /**
   * Load or refresh Kamino market data.
   */
  private async getMarket(): Promise<KaminoMarket> {
    const devnet = isDevnet ?? process.env.SOLANA_RPC_URL?.includes("devnet");
    if (devnet && !USDC_AVAILABLE_ON_DEVNET) {
      throw new Error("Kamino market not available on devnet");
    }
    const connection = getConnection();
    if (!this.market) {
      this.market = await KaminoMarket.load(
        connection as any,
        KAMINO_MAIN_MARKET.toBase58() as any,
        400, // recentSlotDurationMs (~400ms on Solana)
      );
    } else {
      await this.market.loadReserves();
    }
    if (!this.market) {
      throw new Error("Failed to load Kamino market");
    }
    return this.market;
  }

  // ==================== DEPOSIT ====================

  /**
   * Build a USDC deposit transaction into Kamino Lending.
   * User deposits USDC → receives cUSDC (interest-bearing).
   * Returns serialized transaction for user to sign.
   */
  async buildDepositTransaction(
    userPublicKey: string,
    amountUsdc: number
  ): Promise<{ transaction: string; message: string }> {
    if (isDevnet && !USDC_AVAILABLE_ON_DEVNET) {
      throw new Error("USDC Kamino lending is not available on devnet yet. Use SOL vaults (Jito/Marinade) for testing.");
    }
    if (amountUsdc < MIN_DEPOSIT_USDC) {
      throw new Error(`Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`);
    }

    const connection = getConnection();
    const depositor = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountBase = usdcToBaseUnits(amountUsdc);

    const kaminoAction = await KaminoAction.buildDepositTxns(
      market,
      amountBase.toString(),
      USDC_MINT.toBase58() as any,
      toTransactionSigner(depositor),
      new VanillaObligation(PROGRAM_ID),
      false, // useV2Ixs - use legacy TransactionInstruction format
      undefined,
    );

    // Combine all instructions into a single v1 transaction
    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) {
      tx.add(ix as any);
    }
    for (const ix of kaminoAction.lendingIxs) {
      tx.add(ix as any);
    }
    for (const ix of kaminoAction.cleanupIxs) {
      tx.add(ix as any);
    }

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = depositor;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return {
      transaction: serialized,
      message: `Deposit ${amountUsdc} USDC into Kamino Lending. You'll earn supply APY automatically.`,
    };
  }

  /**
   * After user signs and submits the deposit tx:
   * 1. Verify on-chain confirmation
   * 2. Create VaultShare record
   * 3. Emit socket event
   */
  async confirmDeposit(
    signature: string,
    userId: string,
    amountUsdc: number
  ): Promise<{
    success: boolean;
    shareId: string;
    amount: number;
  }> {
    const connection = getConnection();

    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      throw new Error("Transaction not found or not confirmed");
    }
    if (txInfo.meta?.err) {
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(txInfo.meta.err)}`
      );
    }

    const amountBaseUnits = Math.floor(amountUsdc * 10 ** USDC_DECIMALS);

    // Create VaultShare — for USDC, sharesAmount = deposit amount in base units
    // (cUSDC appreciates over time, so the same cUSDC = more USDC later)
    const share = await VaultShare.create({
      userId,
      vaultType: "usdc_kamino",
      sharesAmount: amountBaseUnits,
      depositAmountLamports: amountBaseUnits, // reuse field for base units
      depositRate: 1.0, // 1:1 at deposit time
      depositTimestamp: new Date(),
      status: "active",
      txSignature: signature,
    });

    getSocketService().emitPrivateTransferUpdate(userId, {
      transferId: share._id.toString(),
      status: "completed",
      amount: amountUsdc,
    });

    return {
      success: true,
      shareId: share._id.toString(),
      amount: amountBaseUnits,
    };
  }

  // ==================== WITHDRAW ====================

  /**
   * Build a USDC withdrawal transaction from Kamino Lending.
   * Burns cUSDC → receives USDC + accumulated interest.
   */
  async buildWithdrawTransaction(
    userPublicKey: string,
    amountUsdc: number
  ): Promise<{ transaction: string; estimatedUsdcOut: number }> {
    if (isDevnet && !USDC_AVAILABLE_ON_DEVNET) {
      throw new Error("USDC Kamino lending is not available on devnet yet. Use SOL vaults (Jito/Marinade) for testing.");
    }
    const connection = getConnection();
    const user = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountBase = usdcToBaseUnits(amountUsdc);

    const kaminoAction = await KaminoAction.buildWithdrawTxns(
      market,
      amountBase.toString(),
      USDC_MINT.toBase58() as any,
      toTransactionSigner(user),
      new VanillaObligation(PROGRAM_ID),
      false, // useV2Ixs - use legacy TransactionInstruction format
      undefined,
    );

    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) {
      tx.add(ix as any);
    }
    for (const ix of kaminoAction.lendingIxs) {
      tx.add(ix as any);
    }
    for (const ix of kaminoAction.cleanupIxs) {
      tx.add(ix as any);
    }

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = user;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return {
      transaction: serialized,
      estimatedUsdcOut: amountUsdc,
    };
  }

  /**
   * Confirm withdrawal: verify on-chain, update VaultShare records.
   */
  async confirmWithdraw(
    signature: string,
    userId: string,
    amountUsdc: number
  ): Promise<{ success: boolean; shareId: string; amount: number }> {
    const connection = getConnection();

    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      throw new Error("Withdrawal transaction not found or not confirmed");
    }
    if (txInfo.meta?.err) {
      throw new Error(
        `Withdrawal failed on-chain: ${JSON.stringify(txInfo.meta.err)}`
      );
    }

    const amountBaseUnits = Math.floor(amountUsdc * 10 ** USDC_DECIMALS);

    // FIFO withdrawal of shares
    const activeShares = await VaultShare.find({
      userId,
      vaultType: "usdc_kamino",
      status: "active",
    }).sort({ depositTimestamp: 1 });

    let remaining = amountBaseUnits;
    let lastShareId = "";

    for (const share of activeShares) {
      if (remaining <= 0) break;

      if (share.sharesAmount <= remaining) {
        share.status = "withdrawn" as any;
        share.withdrawAmountLamports = share.sharesAmount;
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
          vaultType: "usdc_kamino",
          sharesAmount: withdrawnShares,
          depositAmountLamports: withdrawnShares,
          depositRate: share.depositRate,
          depositTimestamp: share.depositTimestamp,
          status: "withdrawn",
          txSignature: share.txSignature,
          withdrawAmountLamports: withdrawnShares,
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
      amount: amountUsdc,
    });

    return {
      success: true,
      shareId: lastShareId,
      amount: amountBaseUnits,
    };
  }

  // ==================== RATES & BALANCE ====================

  /**
   * Get current Kamino USDC supply APY.
   */
  async getSupplyAPY(): Promise<number> {
    // On devnet, return a placeholder APY since Kamino market isn't available
    // Check env var at runtime (isDevnet const may be undefined if dotenv loads after module init)
    const devnet = isDevnet ?? process.env.SOLANA_RPC_URL?.includes("devnet");
    if (devnet && !USDC_AVAILABLE_ON_DEVNET) {
      return 6.5; // Placeholder: ~6.5% is typical Kamino USDC supply APY
    }

    const cacheKey = "yield:apy:usdc_kamino";
    const cached = await redisClient.get(cacheKey);
    if (cached) return parseFloat(cached);

    const market = await this.getMarket();
    const reserves = market.getReserves();
    const usdcMintStr = USDC_MINT.toBase58();
    const usdcReserve = reserves.find(
      (r) => String(r.getLiquidityMint()) === usdcMintStr
    );

    if (!usdcReserve) {
      throw new Error("USDC reserve not found on Kamino");
    }

    // Get supply APY from reserve stats
    const stats = usdcReserve.stats;
    const supplyApy = (stats as any)?.supplyInterestAPY
      ?? (stats as any)?.supplyApy
      ?? 5.0; // fallback

    const apyPercent = typeof supplyApy === "number"
      ? supplyApy * 100
      : parseFloat(supplyApy) || 5.0;

    await redisClient.setex(cacheKey, RATE_CACHE_TTL, apyPercent.toString());
    return apyPercent;
  }

  /**
   * Get USDC balance for a user.
   */
  async getBalance(userId: string): Promise<{
    totalDeposited: number;
    currentValue: number;
    yieldEarned: number;
    yieldPercent: number;
  }> {
    const activeShares = await VaultShare.find({
      userId,
      vaultType: "usdc_kamino",
      status: "active",
    });

    if (activeShares.length === 0) {
      return { totalDeposited: 0, currentValue: 0, yieldEarned: 0, yieldPercent: 0 };
    }

    let totalDeposited = 0;
    let totalShares = 0;

    for (const share of activeShares) {
      totalDeposited += baseUnitsToUsdc(share.depositAmountLamports);
      totalShares += share.sharesAmount;
    }

    // For Kamino, the yield is embedded in cUSDC price appreciation.
    // We approximate current value by checking on-chain obligation,
    // but for simplicity we use the APY-based estimation.
    const apy = await this.getSupplyAPY();
    const avgAge = this.getAverageShareAge(activeShares);
    const estimatedYieldMultiplier = 1 + (apy / 100) * (avgAge / 365);
    const currentValue = totalDeposited * estimatedYieldMultiplier;
    const yieldEarned = currentValue - totalDeposited;
    const yieldPercent = totalDeposited > 0 ? (yieldEarned / totalDeposited) * 100 : 0;

    return { totalDeposited, currentValue, yieldEarned, yieldPercent };
  }

  private getAverageShareAge(shares: any[]): number {
    if (shares.length === 0) return 0;
    const now = Date.now();
    const totalDays = shares.reduce((sum: number, share: any) => {
      const age = (now - new Date(share.depositTimestamp).getTime()) / (1000 * 60 * 60 * 24);
      return sum + age;
    }, 0);
    return totalDays / shares.length;
  }
}

// Singleton
let instance: UsdcYieldService | null = null;

export function getUsdcYieldService(): UsdcYieldService {
  if (!instance) {
    instance = new UsdcYieldService();
  }
  return instance;
}

export { UsdcYieldService };
