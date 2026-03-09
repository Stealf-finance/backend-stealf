/**
 * Exchange rates, APY, user balance, dashboard, and on-chain consistency checks.
 * Jito only — Marinade and USDC/Kamino removed.
 */
import axios from "axios";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getStakePoolAccount } from "@solana/spl-stake-pool";
import { VaultShare, VaultType } from "../../models/VaultShare";
import redisClient from "../../config/redis";
import {
  JITO_STAKE_POOL,
  JITOSOL_MINT,
  RATE_CACHE_TTL,
  getConnection,
  getVaultStatePda,
  isDevnet,
} from "./yield.config";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

// Public APY endpoint — uses mainnet data regardless of deployment network.
const JITO_STATS_URL = "https://kobe.mainnet.jito.network/api/v1/stake_pool_stats";
const APY_FETCH_TIMEOUT_MS = 8000;

/**
 * Fetches Jito APY via the official Jito Foundation stake pool stats API.
 */
async function fetchJitoAPY(): Promise<number> {
  const today = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await axios.post(
    JITO_STATS_URL,
    {
      bucket_type: "Daily",
      range_filter: { start: thirtyDaysAgo, end: today },
      sort_by: { field: "BlockTime", order: "Desc" },
    },
    { timeout: APY_FETCH_TIMEOUT_MS }
  );

  const latestApy = data?.apy?.[0]?.data;
  if (typeof latestApy !== "number" || latestApy <= 0) {
    throw new Error("Jito APY data missing or invalid");
  }
  return latestApy * 100; // decimal → percent
}

/**
 * JitoSOL/SOL exchange rate, cached 5 min in Redis.
 * Returns 1.0 on devnet (no live pools).
 */
export async function getExchangeRate(_vaultType: VaultType): Promise<number> {
  if (isDevnet()) return 1.0;

  const cacheKey = "yield:rate:sol_jito";
  const cached = await redisClient.get(cacheKey);
  if (cached) return parseFloat(cached);

  const connection = getConnection();
  const poolAccount = await getStakePoolAccount(connection, JITO_STAKE_POOL);
  const pool = poolAccount.account.data;
  const totalLamports = (pool as any).totalLamports.toNumber();
  const poolTokenSupply = (pool as any).poolTokenSupply.toNumber();
  const rate = totalLamports / poolTokenSupply;

  await redisClient.setex(cacheKey, RATE_CACHE_TTL, rate.toString());
  return rate;
}

/**
 * APY rate for Jito, fetched from live public API and cached 5 min.
 *
 * `stale: true` → values come from the 24 h backup cache (API was unreachable).
 * Throws 'APY_SERVICE_UNAVAILABLE' when API is down AND no backup cache exists.
 */
export async function getAPYRates(): Promise<{
  jitoApy: number;
  lastUpdated: Date;
  stale: boolean;
}> {
  const cacheKey = "yield:apy";

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    return { ...parsed, lastUpdated: new Date(parsed.lastUpdated) };
  }

  try {
    const jitoApy = await fetchJitoAPY();
    const result = { jitoApy, lastUpdated: new Date(), stale: false };
    await Promise.all([
      redisClient.setex(cacheKey, RATE_CACHE_TTL, JSON.stringify(result)),
      redisClient.setex(cacheKey + ":backup", 86400, JSON.stringify(result)),
    ]);
    return result;
  } catch (err) {
    const backup = await redisClient.get(cacheKey + ":backup");
    if (backup) {
      const parsed = JSON.parse(backup);
      return { ...parsed, lastUpdated: new Date(parsed.lastUpdated), stale: true };
    }
    throw new Error("APY_SERVICE_UNAVAILABLE");
  }
}

/**
 * User's total yield position (Jito only).
 */
export async function getBalance(userId: string): Promise<{
  totalDeposited: number;
  currentValue: number;
  yieldEarned: number;
  yieldPercent: number;
}> {
  const activeShares = await VaultShare.find({ userId, status: "active" });

  if (activeShares.length === 0) {
    return { totalDeposited: 0, currentValue: 0, yieldEarned: 0, yieldPercent: 0 };
  }

  const jitoRate = await getExchangeRate("sol_jito");

  let totalDeposited = 0;
  let totalCurrentValue = 0;

  for (const share of activeShares) {
    const deposited = share.depositAmountLamports / LAMPORTS_PER_SOL;
    const currentValue = (share.sharesAmount * jitoRate) / LAMPORTS_PER_SOL;

    totalDeposited += deposited;
    totalCurrentValue += currentValue;
  }

  const yieldEarned = totalCurrentValue - totalDeposited;
  const yieldPercent = totalDeposited > 0 ? (yieldEarned / totalDeposited) * 100 : 0;

  return {
    totalDeposited,
    currentValue: totalCurrentValue,
    yieldEarned,
    yieldPercent,
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
 * Sum in lamports of all active VaultShares.
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
 * Compare off-chain share totals with on-chain vault token balances (Jito only).
 */
export async function verifyConsistency(): Promise<{
  jito: { offChain: number; onChain: number; discrepancyPercent: number; isConsistent: boolean };
  isConsistent: boolean;
}> {
  const connection = getConnection();
  const [vaultState] = getVaultStatePda();

  const vaultAta = await getAssociatedTokenAddress(JITOSOL_MINT, vaultState, true);

  let onChain = 0;
  try {
    const ataInfo = await connection.getTokenAccountBalance(vaultAta);
    onChain = parseInt(ataInfo.value.amount);
  } catch {
    onChain = 0;
  }

  const activeShares = await VaultShare.find({ status: "active", vaultType: "sol_jito" });
  const offChain = activeShares.reduce((sum, s) => sum + s.sharesAmount, 0);

  const discrepancyPercent =
    onChain > 0 ? Math.abs((offChain - onChain) / onChain) * 100
    : offChain > 0 ? 100
    : 0;

  const isConsistent = discrepancyPercent <= 0.1;

  if (!isConsistent) {
    console.warn(
      `[yieldRates] sol_jito Consistency FAILED: off-chain=${offChain}, on-chain=${onChain}, gap=${discrepancyPercent.toFixed(4)}%`
    );
  } else {
    console.log(`[yieldRates] sol_jito Consistency OK: ${offChain} / ${onChain}`);
  }

  const jito = { offChain, onChain, discrepancyPercent, isConsistent };
  return { jito, isConsistent };
}
