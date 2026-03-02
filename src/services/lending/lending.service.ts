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
import axios from "axios";
import BN from "bn.js";
import { LoanPosition } from "../../models/LoanPosition";
import { getSocketService } from "../socket/socketService";
import redisClient from "../../config/redis";

// --- Constants ---

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

const MIN_COLLATERAL_SOL = 0.1;
const MAX_LTV = 0.75;
const LIQUIDATION_THRESHOLD = 0.85;

const COINGECKO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const SOL_PRICE_CACHE_KEY = "lending:sol:price:usd";
const SOL_PRICE_CACHE_TTL = 30; // seconds
const RATES_CACHE_KEY = "lending:rates";
const RATES_CACHE_TTL = 300; // 5 minutes

// Kamino market address (mainnet)
const KAMINO_MARKET_ADDRESS =
  process.env.KAMINO_MARKET_ADDRESS ||
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

// --- Types ---

export interface LendingPosition {
  collateralSol: number;
  borrowedUsdc: number;
  healthFactor: number;
  liquidationPrice: number;
  maxBorrowable: number;
  availableToWithdraw: number;
}

export interface LendingRates {
  usdcBorrowApr: number;
  maxLtv: number;
  liquidationThreshold: number;
  solPriceUsd: number;
  isDevnet: boolean;
}

// --- Helpers ---

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

function isDevnet(): boolean {
  return !!process.env.SOLANA_RPC_URL?.includes("devnet");
}

function guardDevnet(): void {
  if (isDevnet()) {
    throw new Error(
      "Kamino collateral lending is not available on devnet. Switch to mainnet to use this feature."
    );
  }
}

function toTransactionSigner(pubkey: PublicKey): any {
  return {
    address: pubkey.toBase58(),
    signTransactions: async (txs: any[]) => txs,
  };
}

function usdcToBaseUnits(amount: number): BN {
  return new BN(Math.floor(amount * 10 ** USDC_DECIMALS));
}

function baseUnitsToUsdc(amount: number): number {
  return amount / 10 ** USDC_DECIMALS;
}

function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

// --- Service ---

class LendingService {
  private market: KaminoMarket | null = null;

  // ==================== KAMINO MARKET ====================

  private async getMarket(): Promise<KaminoMarket> {
    const connection = getConnection();
    if (!this.market) {
      this.market = await KaminoMarket.load(
        connection as any,
        new PublicKey(KAMINO_MARKET_ADDRESS) as any,
        400
      );
    } else {
      await this.market.loadReserves();
    }
    if (!this.market) {
      throw new Error("Failed to load Kamino market");
    }
    return this.market;
  }

  // ==================== SOL PRICE ====================

  async getSolPriceUsd(): Promise<number> {
    const cached = await redisClient.get(SOL_PRICE_CACHE_KEY);
    if (cached) return parseFloat(cached);

    const response = await axios.get(COINGECKO_PRICE_URL);
    const price: number = response.data?.solana?.usd;
    if (!price || price <= 0) {
      throw new Error("Unable to fetch SOL price from Coingecko");
    }

    await redisClient.setex(SOL_PRICE_CACHE_KEY, SOL_PRICE_CACHE_TTL, price.toString());
    return price;
  }

  // ==================== HEALTH FACTOR CALCULATIONS ====================

  private calculateHealthFactor(collateralSol: number, borrowedUsdc: number, solPriceUsd: number): number {
    if (borrowedUsdc === 0) return -1; // -1 sentinel = "no borrow" (Infinity ne passe pas en JSON)
    return (collateralSol * solPriceUsd * LIQUIDATION_THRESHOLD) / borrowedUsdc;
  }

  private calculateLiquidationPrice(collateralSol: number, borrowedUsdc: number): number {
    if (collateralSol === 0) return 0;
    return borrowedUsdc / (collateralSol * LIQUIDATION_THRESHOLD);
  }

  private calculateMaxBorrowable(collateralSol: number, borrowedUsdc: number, solPriceUsd: number): number {
    return Math.max(0, collateralSol * solPriceUsd * MAX_LTV - borrowedUsdc);
  }

  private calculateAvailableToWithdraw(collateralSol: number, borrowedUsdc: number, solPriceUsd: number): number {
    if (borrowedUsdc === 0) return collateralSol;
    // Keep enough collateral to maintain LTV ≥ MAX_LTV after withdrawal
    const minCollateralNeeded = borrowedUsdc / (solPriceUsd * MAX_LTV);
    return Math.max(0, collateralSol - minCollateralNeeded);
  }

  // ==================== BUILD TRANSACTIONS ====================

  async buildDepositCollateralTx(
    userPublicKey: string,
    amountSol: number
  ): Promise<{ transaction: string; obligationAddress: string }> {
    guardDevnet();

    if (amountSol <= 0 || amountSol < MIN_COLLATERAL_SOL) {
      throw new Error(`Minimum collateral deposit is ${MIN_COLLATERAL_SOL} SOL`);
    }

    const connection = getConnection();
    const depositor = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountLamports = new BN(solToLamports(amountSol));

    const solMintPubkey = new PublicKey(SOL_MINT);
    const kaminoAction = await KaminoAction.buildDepositTxns(
      market,
      amountLamports.toString(),
      solMintPubkey.toBase58() as any,
      toTransactionSigner(depositor),
      new VanillaObligation(PROGRAM_ID),
      false,
      undefined
    );

    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) tx.add(ix as any);
    for (const ix of kaminoAction.lendingIxs) tx.add(ix as any);
    for (const ix of kaminoAction.cleanupIxs) tx.add(ix as any);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = depositor;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    // L'obligation PDA est dérivée par le SDK depuis (marketAddress, userPublicKey)
    const obligationAddress = depositor.toBase58();

    return { transaction: serialized, obligationAddress };
  }

  async buildBorrowTx(
    userPublicKey: string,
    userId: string,
    amountUsdc: number
  ): Promise<{ transaction: string; maxBorrowable: number; estimatedHealthFactor: number }> {
    guardDevnet();

    const position = await LoanPosition.findOne({ userId, status: "active" });
    const collateralLamports = position?.collateralLamports ?? 0;
    const borrowedUsdcBaseUnits = position?.borrowedUsdcBaseUnits ?? 0;

    const collateralSol = lamportsToSol(collateralLamports);
    const borrowedUsdc = baseUnitsToUsdc(borrowedUsdcBaseUnits);
    const solPrice = await this.getSolPriceUsd();

    const maxBorrowable = this.calculateMaxBorrowable(collateralSol, borrowedUsdc, solPrice);

    if (amountUsdc > maxBorrowable) {
      throw new Error(
        `Montant demandé (${amountUsdc} USDC) dépasse le maxBorrowable (${maxBorrowable.toFixed(2)} USDC) selon le LTV de ${MAX_LTV * 100}%`
      );
    }

    const connection = getConnection();
    const borrower = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountBase = usdcToBaseUnits(amountUsdc);

    const kaminoAction = await KaminoAction.buildBorrowTxns(
      market,
      amountBase.toString(),
      USDC_MINT.toBase58() as any,
      toTransactionSigner(borrower),
      new VanillaObligation(PROGRAM_ID),
      false,
      undefined
    );

    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) tx.add(ix as any);
    for (const ix of kaminoAction.lendingIxs) tx.add(ix as any);
    for (const ix of kaminoAction.cleanupIxs) tx.add(ix as any);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = borrower;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    const newBorrowedUsdc = borrowedUsdc + amountUsdc;
    const estimatedHealthFactor = this.calculateHealthFactor(collateralSol, newBorrowedUsdc, solPrice);

    return { transaction: serialized, maxBorrowable, estimatedHealthFactor };
  }

  async buildRepayTx(
    userPublicKey: string,
    userId: string,
    amountUsdc: number
  ): Promise<{ transaction: string; amountUsdc: number }> {
    guardDevnet();

    const position = await LoanPosition.findOne({ userId, status: "active" });
    const borrowedUsdcBaseUnits = position?.borrowedUsdcBaseUnits ?? 0;
    const borrowedUsdc = baseUnitsToUsdc(borrowedUsdcBaseUnits);

    // Plafonner au montant réellement emprunté
    const repayAmountUsdc = Math.min(amountUsdc, borrowedUsdc);

    const connection = getConnection();
    const repayer = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountBase = usdcToBaseUnits(repayAmountUsdc);

    const currentSlot = BigInt(await connection.getSlot());

    const kaminoAction = await KaminoAction.buildRepayTxns(
      market,
      amountBase.toString(),
      USDC_MINT.toBase58() as any,
      toTransactionSigner(repayer),
      new VanillaObligation(PROGRAM_ID),
      false,
      undefined,
      currentSlot
    );

    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) tx.add(ix as any);
    for (const ix of kaminoAction.lendingIxs) tx.add(ix as any);
    for (const ix of kaminoAction.cleanupIxs) tx.add(ix as any);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = repayer;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return { transaction: serialized, amountUsdc: repayAmountUsdc };
  }

  async buildWithdrawCollateralTx(
    userPublicKey: string,
    userId: string,
    amountSol: number
  ): Promise<{ transaction: string; availableToWithdraw: number }> {
    guardDevnet();

    const position = await LoanPosition.findOne({ userId, status: "active" });
    const collateralLamports = position?.collateralLamports ?? 0;
    const borrowedUsdcBaseUnits = position?.borrowedUsdcBaseUnits ?? 0;

    // Bloquer si un emprunt est encore actif
    if (borrowedUsdcBaseUnits > 0) {
      throw new Error(
        "Impossible de retirer le collateral : un emprunt USDC est encore actif. Remboursez d'abord votre borrow."
      );
    }

    const collateralSol = lamportsToSol(collateralLamports);
    const solPrice = await this.getSolPriceUsd();
    const availableToWithdraw = this.calculateAvailableToWithdraw(
      collateralSol,
      0, // aucun emprunt actif
      solPrice
    );

    const connection = getConnection();
    const withdrawer = new PublicKey(userPublicKey);
    const market = await this.getMarket();
    const amountLamports = new BN(solToLamports(amountSol));
    const solMintPubkey = new PublicKey(SOL_MINT);

    const kaminoAction = await KaminoAction.buildWithdrawTxns(
      market,
      amountLamports.toString(),
      solMintPubkey.toBase58() as any,
      toTransactionSigner(withdrawer),
      new VanillaObligation(PROGRAM_ID),
      false,
      undefined
    );

    const tx = new Transaction();
    for (const ix of kaminoAction.setupIxs) tx.add(ix as any);
    for (const ix of kaminoAction.lendingIxs) tx.add(ix as any);
    for (const ix of kaminoAction.cleanupIxs) tx.add(ix as any);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = withdrawer;

    const serialized = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return { transaction: serialized, availableToWithdraw };
  }

  // ==================== CONFIRM ACTION ====================

  async confirmLendingAction(
    signature: string,
    userId: string,
    action: "collateral" | "borrow" | "repay" | "withdraw",
    amount: number
  ): Promise<{ success: boolean; positionId: string }> {
    const connection = getConnection();

    // Vérification on-chain obligatoire avant toute modification MongoDB
    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      throw new Error(`Transaction introuvable ou non confirmée : ${signature}`);
    }
    if (txInfo.meta?.err) {
      throw new Error(
        `Transaction on-chain échouée : ${JSON.stringify(txInfo.meta.err)}`
      );
    }

    let positionId: string;

    switch (action) {
      case "collateral": {
        // Dériver l'obligationAddress depuis la signature (placeholder — sera enrichi plus tard)
        const position = await LoanPosition.create({
          userId,
          obligationAddress: signature.slice(0, 44), // placeholder
          collateralLamports: amount,
          borrowedUsdcBaseUnits: 0,
          status: "active",
          openTimestamp: new Date(),
          depositTxSignature: signature,
        });
        positionId = (position as any)._id.toString();
        break;
      }

      case "borrow": {
        const pos = await LoanPosition.findOne({ userId, status: "active" });
        if (!pos) throw new Error("Aucune position active trouvée");
        pos.borrowedUsdcBaseUnits = (pos.borrowedUsdcBaseUnits ?? 0) + amount;
        (pos as any).borrowTxSignature = signature;
        await (pos as any).save();
        positionId = (pos as any)._id.toString();
        break;
      }

      case "repay": {
        const pos = await LoanPosition.findOne({ userId, status: "active" });
        if (!pos) throw new Error("Aucune position active trouvée");
        pos.borrowedUsdcBaseUnits = Math.max(
          0,
          (pos.borrowedUsdcBaseUnits ?? 0) - amount
        );
        (pos as any).repayTxSignature = signature;
        await (pos as any).save();
        positionId = (pos as any)._id.toString();
        break;
      }

      case "withdraw": {
        const pos = await LoanPosition.findOne({ userId, status: "active" });
        if (!pos) throw new Error("Aucune position active trouvée");
        pos.collateralLamports = Math.max(0, (pos.collateralLamports ?? 0) - amount);
        if (pos.collateralLamports === 0) {
          pos.status = "repaid";
          pos.closeTimestamp = new Date();
        }
        (pos as any).withdrawTxSignature = signature;
        await (pos as any).save();
        positionId = (pos as any)._id.toString();
        break;
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }

    // Émettre un événement Socket.io
    getSocketService().emitPrivateTransferUpdate(userId, {
      transferId: positionId,
      status: "completed",
      amount,
    });

    return { success: true, positionId };
  }

  // ==================== READ POSITION ====================

  async getPosition(userId: string): Promise<LendingPosition> {
    const position = await LoanPosition.findOne({ userId, status: "active" });

    if (!position) {
      return {
        collateralSol: 0,
        borrowedUsdc: 0,
        healthFactor: -1, // -1 = pas d'emprunt (Infinity n'est pas sérialisable en JSON)
        liquidationPrice: 0,
        maxBorrowable: 0,
        availableToWithdraw: 0,
      };
    }

    const collateralSol = lamportsToSol(position.collateralLamports);
    const borrowedUsdc = baseUnitsToUsdc(position.borrowedUsdcBaseUnits);
    const solPrice = await this.getSolPriceUsd();

    return {
      collateralSol,
      borrowedUsdc,
      healthFactor: this.calculateHealthFactor(collateralSol, borrowedUsdc, solPrice),
      liquidationPrice: this.calculateLiquidationPrice(collateralSol, borrowedUsdc),
      maxBorrowable: this.calculateMaxBorrowable(collateralSol, borrowedUsdc, solPrice),
      availableToWithdraw: this.calculateAvailableToWithdraw(collateralSol, borrowedUsdc, solPrice),
    };
  }

  // ==================== RATES ====================

  async getRates(): Promise<LendingRates> {
    // Cache Redis 5 minutes
    const cached = await redisClient.get(RATES_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    let usdcBorrowApr = 8.0; // fallback

    try {
      const market = await this.getMarket();
      const reserves = market.getReserves();
      const usdcMintStr = USDC_MINT.toBase58();
      const usdcReserve = reserves.find(
        (r: any) => String(r.getLiquidityMint()) === usdcMintStr
      );

      if (usdcReserve) {
        const stats = (usdcReserve as any).stats;
        const rawApr =
          stats?.borrowInterestAPY ??
          stats?.borrowApr ??
          stats?.borrowInterestApr;

        if (rawApr !== undefined) {
          usdcBorrowApr =
            typeof rawApr === "number" && rawApr < 1
              ? rawApr * 100   // 0.08 → 8.0%
              : parseFloat(rawApr) || 8.0;
        }
      }
    } catch {
      // Marché indisponible — utiliser le fallback
    }

    const solPriceUsd = await this.getSolPriceUsd().catch(() => 0);

    const rates: LendingRates = {
      usdcBorrowApr,
      maxLtv: MAX_LTV,
      liquidationThreshold: LIQUIDATION_THRESHOLD,
      solPriceUsd,
      isDevnet: isDevnet(),
    };

    await redisClient.setex(RATES_CACHE_KEY, RATES_CACHE_TTL, JSON.stringify(rates));
    return rates;
  }
}

// --- Singleton ---

let instance: LendingService | null = null;

export function getLendingService(): LendingService {
  if (!instance) {
    instance = new LendingService();
  }
  return instance;
}

export { LendingService };
