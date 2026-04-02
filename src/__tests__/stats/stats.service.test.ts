/**
 * Tests TDD — StatsService : cache Redis + comptage MongoDB + compteur connexions
 * Requirements: 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5
 */

// ---- Mocks déclarés avant les imports ----

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    get: mockRedisGet,
    set: mockRedisSet,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
  },
}));

const mockUserCount = jest.fn();
const mockPointsLogCount = jest.fn();

jest.mock('../../models/User', () => ({
  User: { countDocuments: mockUserCount },
}));

jest.mock('../../models/PointsLog', () => ({
  PointsLog: { countDocuments: mockPointsLogCount },
}));

import { StatsService } from '../../services/stats.service';

const CACHE_KEY = 'app_stats';
const cached = (data: object) => JSON.stringify(data);

beforeEach(() => {
  jest.clearAllMocks();
});

// -----------------------------------------------------------------------
describe('StatsService.incrementDailyLogins()', () => {
  it('incrémente la clé daily_logins du jour dans Redis et pose un TTL 48h', async () => {
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);

    await StatsService.incrementDailyLogins();

    expect(mockRedisIncr).toHaveBeenCalledTimes(1);
    // La clé doit contenir la date du jour au format YYYY-MM-DD
    const calledKey = mockRedisIncr.mock.calls[0][0] as string;
    expect(calledKey).toMatch(/^daily_logins:\d{4}-\d{2}-\d{2}$/);
    expect(mockRedisExpire).toHaveBeenCalledWith(calledKey, 48 * 60 * 60);
  });

  it('ne lève pas d\'exception si Redis échoue', async () => {
    mockRedisIncr.mockRejectedValue(new Error('Redis down'));
    await expect(StatsService.incrementDailyLogins()).rejects.toThrow();
    // Note : la gestion de l'erreur est dans l'appelant (fire-and-forget .catch(() => {}))
  });
});

// -----------------------------------------------------------------------
describe('StatsService.getAppStats()', () => {
  describe('Cache hit', () => {
    it('retourne les valeurs Redis sans interroger MongoDB', async () => {
      mockRedisGet.mockResolvedValue(
        cached({ totalUsers: 42, totalTransactions: 100, dailyLogins: 5 }),
      );

      const result = await StatsService.getAppStats();

      expect(result).toEqual({ totalUsers: 42, totalTransactions: 100, dailyLogins: 5 });
      expect(mockRedisGet).toHaveBeenCalledWith(CACHE_KEY);
      expect(mockUserCount).not.toHaveBeenCalled();
      expect(mockPointsLogCount).not.toHaveBeenCalled();
    });
  });

  describe('Cache miss', () => {
    it('interroge MongoDB + dailyLogins Redis, stocke en cache TTL 60s', async () => {
      // Premier get = cache miss, second get = daily_logins
      mockRedisGet
        .mockResolvedValueOnce(null)      // cache miss pour app_stats
        .mockResolvedValueOnce('12');     // daily_logins du jour
      mockUserCount.mockResolvedValue(10);
      mockPointsLogCount.mockResolvedValue(55);
      mockRedisSet.mockResolvedValue('OK');

      const result = await StatsService.getAppStats();

      expect(result).toEqual({ totalUsers: 10, totalTransactions: 55, dailyLogins: 12 });
      expect(mockPointsLogCount).toHaveBeenCalledWith({ action: { $ne: 'daily bonus' } });
      expect(mockRedisSet).toHaveBeenCalledWith(
        CACHE_KEY,
        JSON.stringify({ totalUsers: 10, totalTransactions: 55, dailyLogins: 12 }),
        'EX',
        60,
      );
    });

    it('retourne dailyLogins: 0 si la clé daily_logins n\'existe pas encore', async () => {
      mockRedisGet
        .mockResolvedValueOnce(null)  // cache miss
        .mockResolvedValueOnce(null); // daily_logins absent
      mockUserCount.mockResolvedValue(3);
      mockPointsLogCount.mockResolvedValue(8);
      mockRedisSet.mockResolvedValue('OK');

      const result = await StatsService.getAppStats();

      expect(result.dailyLogins).toBe(0);
    });

    it('exclut les daily_bonus du comptage des transactions', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockUserCount.mockResolvedValue(5);
      mockPointsLogCount.mockResolvedValue(20);
      mockRedisSet.mockResolvedValue('OK');

      await StatsService.getAppStats();

      expect(mockPointsLogCount).toHaveBeenCalledWith({ action: { $ne: 'daily bonus' } });
    });
  });

  describe('Dégradation silencieuse', () => {
    it('retourne { 0, 0, 0 } sans throw quand Redis ET MongoDB sont indisponibles', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis connection refused'));
      mockUserCount.mockRejectedValue(new Error('MongoDB timeout'));
      mockPointsLogCount.mockRejectedValue(new Error('MongoDB timeout'));

      const result = await StatsService.getAppStats();

      expect(result).toEqual({ totalUsers: 0, totalTransactions: 0, dailyLogins: 0 });
    });

    it('recalcule depuis MongoDB sans crash quand Redis est down mais MongoDB est accessible', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis unavailable'));
      mockUserCount.mockResolvedValue(7);
      mockPointsLogCount.mockResolvedValue(30);
      mockRedisSet.mockRejectedValue(new Error('Redis unavailable'));

      const result = await StatsService.getAppStats();

      expect(result.totalUsers).toBe(7);
      expect(result.totalTransactions).toBe(30);
    });

    it('retourne { 0, 0, 0 } sans throw quand Redis est OK mais MongoDB échoue', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockUserCount.mockRejectedValue(new Error('MongoDB connection lost'));
      mockPointsLogCount.mockRejectedValue(new Error('MongoDB connection lost'));

      const result = await StatsService.getAppStats();

      expect(result).toEqual({ totalUsers: 0, totalTransactions: 0, dailyLogins: 0 });
    });
  });
});
