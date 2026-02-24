/**
 * Exchange rates, APY, user balance, dashboard, and on-chain consistency checks.
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getStakePoolAccount } from "@solana/spl-stake-pool";
import { Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";
import { VaultShare, VaultType } from "../../models/VaultShare";
import redisClient from "../../config/redis";
import {
  JITO_STAKE_POOL,
  JITOSOL_MINT,
  MSOL_MINT,
  RATE_CACHE_TTL,
  getConnection,
  getVaultStatePda,
  isDevnet,
} from "./yield.config";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * JitoSOL/SOL or mSOL/SOL exchange rate, cached 5 min in Redis.
 * Returns 1.0 on devnet (no live pools).
 */
export async function getExchangeRate(vaultType: VaultType): Promise<number> {
  if (isDevnet()) return 1.0;

  const cacheKey = `yield:rate:${vaultType}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return parseFloat(cached);

  const connection = getConnection();
  let rate: number;

  if (vaultType === "sol_jito") {
    const poolAccount = await getStakePoolAccount(connection, JITO_STAKE_POOL);
    const pool = poolAccount.account.data;
    const totalLamports = (pool as any).totalLamports.toNumber();
    const poolTokenSupply = (pool as any).poolTokenSupply.toNumber();
    rate = totalLamports / poolTokenSupply;
  } else {
    const config = new MarinadeConfig({ connection });
    const marinade = new Marinade(config);
    const state = await marinade.getMarinadeState();
    rate = state.mSolPrice;
  }

  await redisClient.setex(cacheKey, RATE_CACHE_TTL, rate.toString());
  return rate;
}

/**
 * APY rates for Jito and Marinade, cached 5 min.
 * TODO: calculate from historical rate changes or Jito API.
 */
export async function getAPYRates(): Promise<{
  jitoApy: number;
  marinadeApy: number;
  lastUpdated: Date;
}> {
  const cacheKey = "yield:apy";
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    return { ...parsed, lastUpdated: new Date(parsed.lastUpdated) };
  }

  const result = { jitoApy: 7.5, marinadeApy: 6.8, lastUpdated: new Date() };
  await redisClient.setex(cacheKey, RATE_CACHE_TTL, JSON.stringify(result));
  return result;
}

/**
 * User's total yield position across all vault types.
 */
export async function getBalance(userId: string): Promise<{
  totalDeposited: number;
  currentValue: number;
  yieldEarned: number;
  yieldPercent: number;
  shares: Array<{
    vaultType: VaultType;
    deposited: number;
    currentValue: number;
    yield: number;
  }>;
}> {
  const activeShares = await VaultShare.find({ userId, status: "active" });

  if (activeShares.length === 0) {
    return { totalDeposited: 0, currentValue: 0, yieldEarned: 0, yieldPercent: 0, shares: [] };
  }

  const [jitoRate, marinadeRate] = await Promise.all([
    getExchangeRate("sol_jito"),
    getExchangeRate("sol_marinade"),
  ]);

  let totalDeposited = 0;
  let totalCurrentValue = 0;
  const sharesByType: Record<string, { deposited: number; currentValue: number }> = {};

  for (const share of activeShares) {
    const deposited = share.depositAmountLamports / LAMPORTS_PER_SOL;
    const currentRate = share.vaultType === "sol_jito" ? jitoRate : marinadeRate;
    const currentValue = (share.sharesAmount * currentRate) / LAMPORTS_PER_SOL;

    totalDeposited += deposited;
    totalCurrentValue += currentValue;

    if (!sharesByType[share.vaultType]) {
      sharesByType[share.vaultType] = { deposited: 0, currentValue: 0 };
    }
    sharesByType[share.vaultType].deposited += deposited;
    sharesByType[share.vaultType].currentValue += currentValue;
  }

  const yieldEarned = totalCurrentValue - totalDeposited;
  const yieldPercent = totalDeposited > 0 ? (yieldEarned / totalDeposited) * 100 : 0;

  return {
    totalDeposited,
    currentValue: totalCurrentValue,
    yieldEarned,
    yieldPercent,
    shares: Object.entries(sharesByType).map(([vt, data]) => ({
      vaultType: vt as VaultType,
      deposited: data.deposited,
      currentValue: data.currentValue,
      yield: data.currentValue - data.deposited,
    })),
  };
}

/**
 * Full dashboard: balance + APY + last 50 transactions.
 */
export async function getDashboard(userId: string): Promise<{
  balance: Awaited<ReturnType<typeof getBalance>>;
  apy: Awaited<ReturnType<typeof getAPYRates>>;
  history: Array<{
    type: "deposit" | "withdraw";
    amount: number;
    vaultType: VaultType;
    timestamp: Date;
    txSignature: string;
  }>;
}> {
  const [balance, apy, allShares] = await Promise.all([
    getBalance(userId),
    getAPYRates(),
    VaultShare.find({ userId }).sort({ depositTimestamp: -1 }).limit(50),
  ]);

  const history = allShares.map((share) => ({
    type: (share.status === "withdrawn" ? "withdraw" : "deposit") as "deposit" | "withdraw",
    amount: share.depositAmountLamports / LAMPORTS_PER_SOL,
    vaultType: share.vaultType,
    timestamp: share.depositTimestamp,
    txSignature: share.txSignature,
  }));

  return { balance, apy, history };
}

/**
 * Retourne la somme en lamports de tous les VaultShares avec status="active".
 *
 * Utilise VaultShare.find() pour bénéficier des hooks Mongoose post("find")
 * qui décryptent automatiquement depositAmountLamports (AES-256-GCM).
 * Remplace VaultShare.aggregate([{ $sum: "$depositAmountLamports" }]) qui opère
 * sur des chaînes hexadécimales chiffrées et retourne toujours 0.
 *
 * Retourne 0n si aucun share actif ou en cas d'erreur — ne propage jamais d'exception.
 */
export async function getTotalActiveDepositLamports(): Promise<bigint> {
  try {
    const activeShares = await VaultShare.find({ status: "active" });
    if (activeShares.length === 0) return 0n;

    let total = 0n;
    for (const share of activeShares) {
      const amount = share.depositAmountLamports;
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        total += BigInt(Math.round(amount));
      }
    }
    return total;
  } catch {
    return 0n;
  }
}

/**
 * Compare off-chain share totals with on-chain vault token balances.
 * Logs a warning if discrepancy exceeds 0.1%.
 */
export async function verifyConsistency(): Promise<{
  jito: { offChain: number; onChain: number; discrepancyPercent: number; isConsistent: boolean };
  marinade: { offChain: number; onChain: number; discrepancyPercent: number; isConsistent: boolean };
  isConsistent: boolean;
}> {
  const connection = getConnection();
  const [vaultState] = getVaultStatePda();

  const checkVault = async (mint: typeof JITOSOL_MINT, vaultType: VaultType) => {
    const vaultAta = await getAssociatedTokenAddress(mint, vaultState, true);

    let onChain = 0;
    try {
      const ataInfo = await connection.getTokenAccountBalance(vaultAta);
      onChain = parseInt(ataInfo.value.amount);
    } catch {
      onChain = 0;
    }

    const activeShares = await VaultShare.find({ status: "active", vaultType });
    const offChain = activeShares.reduce((sum, s) => sum + s.sharesAmount, 0);

    const discrepancyPercent =
      onChain > 0 ? Math.abs((offChain - onChain) / onChain) * 100
      : offChain > 0 ? 100
      : 0;

    const isConsistent = discrepancyPercent <= 0.1;

    if (!isConsistent) {
      console.warn(
        `[yieldRates] ${vaultType} Consistency FAILED: off-chain=${offChain}, on-chain=${onChain}, gap=${discrepancyPercent.toFixed(4)}%`
      );
    } else {
      console.log(`[yieldRates] ${vaultType} Consistency OK: ${offChain} / ${onChain}`);
    }

    return { offChain, onChain, discrepancyPercent, isConsistent };
  };

  const [jito, marinade] = await Promise.all([
    checkVault(JITOSOL_MINT, "sol_jito"),
    checkVault(MSOL_MINT, "sol_marinade"),
  ]);

  return { jito, marinade, isConsistent: jito.isConsistent && marinade.isConsistent };
}
