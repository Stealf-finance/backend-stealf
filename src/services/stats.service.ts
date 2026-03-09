import redisClient from '../config/redis';
import { User } from '../models/User';
import { VaultShare } from '../models/VaultShare';

export interface AppStats {
  totalUsers: number;
  totalTransactions: number;
  dailyLogins: number;
}

const CACHE_KEY = 'app_stats';
const CACHE_TTL_SECONDS = 60;
const DAILY_LOGINS_TTL_SECONDS = 48 * 60 * 60; // 48h — nettoyage auto

function dailyLoginsKey(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `daily_logins:${today}`;
}

export class StatsService {
  /**
   * Incrémente le compteur de connexions du jour (fire-and-forget).
   * Aucune donnée personnelle stockée — simple entier Redis.
   */
  static async incrementDailyLogins(): Promise<void> {
    const key = dailyLoginsKey();
    await redisClient.incr(key);
    await redisClient.expire(key, DAILY_LOGINS_TTL_SECONDS);
  }

  /**
   * Retourne les statistiques globales de l'app avec cache Redis TTL 60s.
   * Ne lève jamais d'exception : dégradation silencieuse vers { 0, 0, 0 }.
   */
  static async getAppStats(): Promise<AppStats> {
    // 1. Tenter la lecture depuis le cache Redis
    try {
      const cached = await redisClient.get(CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as AppStats;
      }
    } catch {
      console.warn('[Stats][WARN] Redis unavailable, skipping cache read');
    }

    // 2. Cache miss (ou Redis down) → compter depuis MongoDB + lire dailyLogins Redis
    try {
      const [totalUsers, totalTransactions, dailyLoginsRaw] = await Promise.all([
        User.countDocuments(),
        VaultShare.countDocuments(),
        redisClient.get(dailyLoginsKey()).catch(() => null),
      ]);

      const stats: AppStats = {
        totalUsers,
        totalTransactions,
        dailyLogins: dailyLoginsRaw ? parseInt(dailyLoginsRaw, 10) : 0,
      };

      // 3. Stocker dans Redis (best-effort)
      try {
        await redisClient.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL_SECONDS);
      } catch {
        console.warn('[Stats][WARN] Redis unavailable, skipping cache write');
      }

      return stats;
    } catch {
      console.warn('[Stats][WARN] MongoDB unavailable, returning zero stats');
      return { totalUsers: 0, totalTransactions: 0, dailyLogins: 0 };
    }
  }
}
