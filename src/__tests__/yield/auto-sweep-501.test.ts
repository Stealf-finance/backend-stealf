/**
 * Tests — Auto-sweep routes return 501 (Task 3.1)
 * Requirements: 7.1, 7.2
 *
 * Vérifie que les routes auto-sweep retournent 501 Not Implemented
 * (fonctionnalité stub non encore exécutée).
 */

// Mocks must come before imports to avoid transitive load of verifyAuth
// (which throws if WALLET_JWT_SECRET is missing)
jest.mock('../../services/yield/yield.service', () => ({ getYieldService: () => ({}) }));
jest.mock('../../services/yield/usdc-yield.service', () => ({ getUsdcYieldService: () => ({}) }));
jest.mock('../../services/yield/privacy-yield.service', () => ({ getPrivacyYieldService: () => ({}) }));
jest.mock('../../services/yield/arcium-vault.service', () => ({
  isArciumEnabled: () => false,
  getArciumVaultService: () => ({}),
}));
jest.mock('../../services/yield/auto-sweep.service', () => ({ getAutoSweepService: () => ({}) }));
jest.mock('../../services/yield/sol-deposit.service', () => ({}));
jest.mock('../../services/socket/socketService', () => ({ getSocketService: () => ({}) }));
jest.mock('../../middleware/verifyAuth', () => ({ verifyAuth: jest.fn() }));

import { YieldController } from '../../controllers/YieldController';
import { Request, Response } from 'express';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { mongoUserId: 'user123', sessionType: 'wallet', userId: 'u1', organizationId: 'o1', expiry: 0, publicKey: 'pk' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

describe('Auto-sweep routes — 501 Not Implemented (Req 7.1, 7.2)', () => {
  it('getAutoSweepConfig retourne 501', async () => {
    const req = mockReq();
    const res = mockRes();
    await YieldController.getAutoSweepConfig(req, res);
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('not yet implemented') })
    );
  });

  it('updateAutoSweepConfig retourne 501', async () => {
    const req = mockReq({ body: { enabled: true, threshold: 0.5 } });
    const res = mockRes();
    await YieldController.updateAutoSweepConfig(req, res);
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('not yet implemented') })
    );
  });
});
