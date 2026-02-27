/**
 * Tests — getAPYRates() dynamique avec stale flag (Task 3.2)
 * Requirements: 11.1, 11.2, 11.3, 11.4
 *
 * APY is fetched from real APIs regardless of devnet/mainnet:
 *   - Jito: POST kobe.mainnet.jito.network/api/v1/stake_pool_stats
 *     Response: { apy: [{ data: 0.0718, date: "..." }] } (decimal, sorted Desc)
 *   - Marinade: GET api.marinade.finance/msol/apy/1y
 *     Response: { value: 0.0623 } (decimal)
 */

// ========== MOCKS ==========

const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockRedisGet(...args),
    setex: (...args: any[]) => mockRedisSetex(...args),
  },
}));

// Jito uses POST, Marinade uses GET
const mockAxiosPost = jest.fn();
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({
  post: (...args: any[]) => mockAxiosPost(...args),
  get: (...args: any[]) => mockAxiosGet(...args),
}));

jest.mock('@solana/spl-stake-pool', () => ({}));
jest.mock('@marinade.finance/marinade-ts-sdk', () => ({}));
jest.mock('@solana/spl-token', () => ({ getAssociatedTokenAddress: jest.fn() }));
jest.mock('../../models/VaultShare', () => ({
  VaultShare: { find: jest.fn().mockResolvedValue([]) },
}));

// ========== HELPERS ==========

// Jito API response shape (sorted Desc — most recent first)
function jitoApiResponse(apyDecimal: number) {
  return { data: { apy: [{ data: apyDecimal, date: new Date().toISOString() }] } };
}

// Marinade API response shape
function marinadeApiResponse(apyDecimal: number) {
  return { data: { value: apyDecimal } };
}

// ========== TESTS ==========

describe('getAPYRates() — live APIs, stale flag, cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');
  });

  describe('Cache chaud disponible', () => {
    it('retourne le cache sans appeler les APIs', async () => {
      const cached = { jitoApy: 8.1, marinadeApy: 7.2, lastUpdated: new Date().toISOString(), stale: false };
      mockRedisGet.mockResolvedValue(JSON.stringify(cached));

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      const result = await getAPYRates();

      expect(result.jitoApy).toBe(8.1);
      expect(result.marinadeApy).toBe(7.2);
      expect(result.stale).toBe(false);
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });
  });

  describe('Cache froid — APIs disponibles', () => {
    it('appelle Jito (POST) et Marinade (GET), retourne stale=false et met en cache', async () => {
      mockAxiosPost.mockResolvedValueOnce(jitoApiResponse(0.0782));   // 7.82%
      mockAxiosGet.mockResolvedValueOnce(marinadeApiResponse(0.0623)); // 6.23%

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      const result = await getAPYRates();

      expect(result.jitoApy).toBeCloseTo(7.82, 1);
      expect(result.marinadeApy).toBeCloseTo(6.23, 1);
      expect(result.stale).toBe(false);
      // Both hot cache and 24 h backup written
      expect(mockRedisSetex).toHaveBeenCalledWith('yield:apy', expect.any(Number), expect.any(String));
      expect(mockRedisSetex).toHaveBeenCalledWith('yield:apy:backup', expect.any(Number), expect.any(String));
    });

    it('utilise la réponse de Jito correctement (prend apy[0].data)', async () => {
      // Sorted Desc: first item is most recent
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          apy: [
            { data: 0.0780, date: new Date().toISOString() },       // most recent
            { data: 0.0751, date: new Date(Date.now() - 86400000).toISOString() },
          ],
        },
      });
      mockAxiosGet.mockResolvedValueOnce(marinadeApiResponse(0.065));

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      const result = await getAPYRates();

      expect(result.jitoApy).toBeCloseTo(7.80, 1); // took index 0, not index 1
    });
  });

  describe('APIs en panne — backup cache disponible', () => {
    it('retourne le backup cache avec stale=true', async () => {
      const backupData = { jitoApy: 7.9, marinadeApy: 6.5, lastUpdated: new Date(Date.now() - 600_000).toISOString(), stale: false };
      mockRedisGet
        .mockResolvedValueOnce(null)                         // yield:apy → miss
        .mockResolvedValueOnce(JSON.stringify(backupData));  // yield:apy:backup → hit
      mockAxiosPost.mockRejectedValue(new Error('Network Error'));
      mockAxiosGet.mockRejectedValue(new Error('Network Error'));

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      const result = await getAPYRates();

      expect(result.jitoApy).toBe(7.9);
      expect(result.marinadeApy).toBe(6.5);
      expect(result.stale).toBe(true);
    });
  });

  describe('APIs en panne — aucun cache', () => {
    it('throw APY_SERVICE_UNAVAILABLE', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockAxiosPost.mockRejectedValue(new Error('Network Error'));
      mockAxiosGet.mockRejectedValue(new Error('Network Error'));

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      await expect(getAPYRates()).rejects.toThrow('APY_SERVICE_UNAVAILABLE');
    });
  });

  describe('Données API invalides', () => {
    it('throw si Jito retourne un APY nul ou absent', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { apy: [] } }); // no data points
      mockAxiosGet.mockResolvedValueOnce(marinadeApiResponse(0.065));
      // Both will fail → falls through to backup/503
      mockRedisGet.mockResolvedValue(null);

      const { getAPYRates } = await import('../../services/yield/yield-rates.service');
      await expect(getAPYRates()).rejects.toThrow('APY_SERVICE_UNAVAILABLE');
    });
  });
});
