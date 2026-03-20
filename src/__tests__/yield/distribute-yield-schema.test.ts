/**
 * Tests TDD — distributeYieldSchema
 * Requirements: 2.6
 *
 * Vérifie la validation Zod des inputs optionnels de POST /api/yield/distribute-yield.
 * Les champs sont optionnels (l'endpoint auto-calcule si absent) mais validés si présents.
 */

// Mocks nécessaires pour importer YieldController sans démarrer les services
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), setex: jest.fn() },
}));
jest.mock('@solana/spl-stake-pool', () => ({}));
jest.mock('@marinade.finance/marinade-ts-sdk', () => ({}));
jest.mock('@solana/spl-token', () => ({ getAccount: jest.fn(), getAssociatedTokenAddress: jest.fn() }));
jest.mock('../../models/VaultShare', () => ({
  VaultShare: { find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), aggregate: jest.fn() },
}));
jest.mock('../../services/socket/socketService', () => ({ getSocketService: () => ({ emit: jest.fn() }) }));
jest.mock('../../services/yield/yield.service', () => ({ getYieldService: () => ({}) }));
jest.mock('../../services/yield/usdc-yield.service', () => ({ getUsdcYieldService: () => ({}) }));
jest.mock('../../services/yield/privacy-yield.service', () => ({ getPrivacyYieldService: () => ({}) }));
jest.mock('../../services/yield/arcium-vault.service', () => ({ getArciumVaultService: () => ({}) }));
jest.mock('../../services/yield/yield-mpc-enhancements.service', () => ({ getYieldMpcEnhancementsService: () => ({}) }));
jest.mock('../../services/yield/auto-sweep.service', () => ({ getAutoSweepService: () => ({}) }));
jest.mock('../../services/yield/batch-staking.service', () => ({ getBatchStakingService: () => ({}) }));
jest.mock('../../services/lending/lending.service', () => ({ getLendingService: () => ({}) }));

import { distributeYieldSchema } from '../../controllers/YieldController';

describe('distributeYieldSchema — Req 2.6', () => {
  describe('Inputs valides', () => {
    it('accepte un body vide (auto-compute mode)', () => {
      const result = distributeYieldSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepte rateNum=1_000_000, rateDenom=1_000_000', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1_000_000, rateDenom: 1_000_000 });
      expect(result.success).toBe(true);
    });

    it('accepte la valeur maximale rateNum=1_100_000', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1_100_000, rateDenom: 1_000_000 });
      expect(result.success).toBe(true);
    });

    it('accepte vaultType sol_jito', () => {
      const result = distributeYieldSchema.safeParse({ vaultType: 'sol_jito' });
      expect(result.success).toBe(true);
    });

    it('accepte vaultType sol_marinade', () => {
      const result = distributeYieldSchema.safeParse({ vaultType: 'sol_marinade' });
      expect(result.success).toBe(true);
    });
  });

  describe('Inputs invalides — rateNum', () => {
    it('rejette rateNum > 1_100_000 (overflow guard)', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1_100_001, rateDenom: 1_000_000 });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain('rateNum');
    });

    it('rejette rateNum = 0', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 0, rateDenom: 1_000_000 });
      expect(result.success).toBe(false);
    });

    it('rejette rateNum négatif', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: -1, rateDenom: 1_000_000 });
      expect(result.success).toBe(false);
    });

    it('rejette rateNum décimal (doit être entier)', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1.5, rateDenom: 1_000_000 });
      expect(result.success).toBe(false);
    });
  });

  describe('Inputs invalides — rateDenom', () => {
    it('rejette rateDenom = 0', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1_000_000, rateDenom: 0 });
      expect(result.success).toBe(false);
    });

    it('rejette rateDenom négatif', () => {
      const result = distributeYieldSchema.safeParse({ rateNum: 1_000_000, rateDenom: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('Inputs invalides — vaultType', () => {
    it('rejette un vaultType inconnu', () => {
      const result = distributeYieldSchema.safeParse({ vaultType: 'invalid_vault' });
      expect(result.success).toBe(false);
    });
  });
});
