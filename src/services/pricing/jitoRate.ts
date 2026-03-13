import axios from "axios";
import redisClient from "../../config/redis";
import logger from "../../config/logger";

interface JitoStats {
  rate: number;
  apy: number;
}

const CACHE_KEY_RATE = "jitosol_rate";
const CACHE_KEY_APY = "jitosol_apy";
const CACHE_DURATION = 300; // 5 minutes

export class JitoRateService {
  private static pendingFetch: Promise<JitoStats> | null = null;
  private static lastKnown: JitoStats = { rate: 1.0, apy: 0 };

  /**
   * Get the current JitoSOL/SOL exchange rate and APY.
   * Cached in Redis for 5 minutes.
   */
  static async getStats(): Promise<JitoStats> {
    const [cachedRate, cachedApy] = await Promise.all([
      redisClient.get(CACHE_KEY_RATE),
      redisClient.get(CACHE_KEY_APY),
    ]);

    if (cachedRate && cachedApy) {
      return { rate: parseFloat(cachedRate), apy: parseFloat(cachedApy) };
    }

    if (this.pendingFetch) {
      return this.pendingFetch;
    }

    this.pendingFetch = this.fetchAndCache();

    try {
      return await this.pendingFetch;
    } finally {
      this.pendingFetch = null;
    }
  }

  /**
   * Get just the exchange rate (1 JitoSOL = X SOL).
   * Useful for converting JitoSOL balances to SOL.
   */
  static async getRate(): Promise<number> {
    const { rate } = await this.getStats();
    return rate;
  }

  private static async fetchAndCache(): Promise<JitoStats> {
    try {
      // Single endpoint returns TVL, supply, and APY as historical arrays
      const res = await axios.get(
        "https://kobe.mainnet.jito.network/api/v1/stake_pool_stats",
        { timeout: 5000 },
      );

      const data = res.data;

      // Rate: latest TVL (lamports) / latest supply (JitoSOL tokens)
      const tvlArr: { data: number }[] = data.tvl || [];
      const supplyArr: { data: number }[] = data.supply || [];
      const latestTvl = tvlArr[tvlArr.length - 1]?.data ?? 0;
      const latestSupply = supplyArr[supplyArr.length - 1]?.data ?? 1;
      const rate = latestTvl / 1e9 / latestSupply;

      // APY: latest entry, returned as decimal (e.g. 0.059 = 5.9%)
      const apyArr: { data: number }[] = data.apy || [];
      const apy = (apyArr[apyArr.length - 1]?.data ?? 0) * 100;

      const stats: JitoStats = { rate, apy };
      this.lastKnown = stats;

      await Promise.all([
        redisClient.set(CACHE_KEY_RATE, rate.toString(), "EX", CACHE_DURATION),
        redisClient.set(CACHE_KEY_APY, apy.toString(), "EX", CACHE_DURATION),
      ]);

      logger.debug({ rate: rate.toFixed(6), apy: apy.toFixed(2) }, "JitoSOL rate refreshed");

      return stats;
    } catch (error: any) {
      if (error?.response?.status !== 429) {
        logger.error({ err: error }, "Error fetching JitoSOL rate");
      }

      // Try Redis fallback
      const [fallbackRate, fallbackApy] = await Promise.all([
        redisClient.get(CACHE_KEY_RATE),
        redisClient.get(CACHE_KEY_APY),
      ]);
      if (fallbackRate && fallbackApy) {
        return { rate: parseFloat(fallbackRate), apy: parseFloat(fallbackApy) };
      }

      return this.lastKnown;
    }
  }
}
