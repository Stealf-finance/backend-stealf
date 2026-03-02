/**
 * Tests d'intégration — StatsController + stats.routes.ts
 * Requirements: 1.1, 1.2, 1.5, 1.6
 */

// ---- Mocks avant imports ----
jest.mock('../../services/stats.service', () => ({
  StatsService: {
    getAppStats: jest.fn(),
  },
}));

// Mock minimal pour éviter les imports Solana/Mongoose dans server
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), on: jest.fn() },
}));

import request from 'supertest';
import express from 'express';
import statsRoutes from '../../routes/stats.routes';
import { StatsService } from '../../services/stats.service';

// App Express minimale pour les tests de route
const app = express();
app.use(express.json());
app.use('/api/stats', statsRoutes);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/stats', () => {
  it('retourne HTTP 200 avec totalUsers et totalTransactions sans token', async () => {
    (StatsService.getAppStats as jest.Mock).mockResolvedValue({
      totalUsers: 25,
      totalTransactions: 120,
    });

    const res = await request(app).get('/api/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalUsers: 25, totalTransactions: 120 });
  });

  it("retourne { totalUsers: 0, totalTransactions: 0 } quand MongoDB est indisponible (pas de 500)", async () => {
    (StatsService.getAppStats as jest.Mock).mockResolvedValue({
      totalUsers: 0,
      totalTransactions: 0,
    });

    const res = await request(app).get('/api/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalUsers: 0, totalTransactions: 0 });
  });

  it('ignore un token Bearer fourni dans les headers (pas de rejet 401)', async () => {
    (StatsService.getAppStats as jest.Mock).mockResolvedValue({
      totalUsers: 5,
      totalTransactions: 10,
    });

    const res = await request(app)
      .get('/api/stats')
      .set('Authorization', 'Bearer sometoken');

    expect(res.status).toBe(200);
  });

  it('retourne HTTP 500 avec message générique si getAppStats throw de façon inattendue', async () => {
    (StatsService.getAppStats as jest.Mock).mockRejectedValue(new Error('unexpected crash'));

    const res = await request(app).get('/api/stats');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch stats');
    // Pas de fuite du message d'erreur interne
    expect(JSON.stringify(res.body)).not.toContain('unexpected crash');
  });
});
