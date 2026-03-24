import { User } from '../models/User';
import { DailyMetric } from '../models/DailyMetric';
import logger from '../config/logger';

function today(): string {
  return new Date().toISOString().slice(0, 10); // "2026-03-24"
}

export class StatsService {
  /**
   * Increment daily login counter (fire-and-forget).
   */
  static async incrementDailyLogins(): Promise<void> {
    try {
      await DailyMetric.findOneAndUpdate(
        { date: today() },
        { $inc: { logins: 1 } },
        { upsert: true },
      );
    } catch (err) {
      logger.error({ err }, "Failed to increment daily logins");
    }
  }

  /**
   * Increment daily inscription counter (fire-and-forget).
   */
  static async incrementDailyInscriptions(): Promise<void> {
    try {
      await DailyMetric.findOneAndUpdate(
        { date: today() },
        { $inc: { inscriptions: 1 } },
        { upsert: true },
      );
    } catch (err) {
      logger.error({ err }, "Failed to increment daily inscriptions");
    }
  }

  /**
   * Get app-wide stats.
   */
  static async getAppStats() {
    const [totalUsers, todayMetric] = await Promise.all([
      User.countDocuments(),
      DailyMetric.findOne({ date: today() }).lean(),
    ]);

    return {
      totalUsers,
      dailyLogins: todayMetric?.logins ?? 0,
      dailyInscriptions: todayMetric?.inscriptions ?? 0,
    };
  }
}
