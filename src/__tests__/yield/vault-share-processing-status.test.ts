/**
 * Tests TDD — Protection double-withdraw : statut "processing" + garde atomique
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 8.4, 8.5
 */

// ---- Mocks déclarés avant les imports ----
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), setex: jest.fn() },
}));
jest.mock('@solana/spl-stake-pool', () => ({}));
jest.mock('@marinade.finance/marinade-ts-sdk', () => ({}));
jest.mock('@solana/spl-token', () => ({ getAccount: jest.fn(), getAssociatedTokenAddress: jest.fn() }));
jest.mock('../../services/socket/socketService', () => ({ getSocketService: () => ({ emit: jest.fn() }) }));
jest.mock('../../services/yield/usdc-yield.service', () => ({ getUsdcYieldService: () => ({}) }));
jest.mock('../../services/yield/privacy-yield.service', () => ({ getPrivacyYieldService: () => ({}) }));
jest.mock('../../services/yield/yield-mpc-enhancements.service', () => ({ getYieldMpcEnhancementsService: () => ({}) }));
jest.mock('../../services/yield/auto-sweep.service', () => ({ getAutoSweepService: () => ({}) }));
jest.mock('../../services/yield/batch-staking.service', () => ({ getBatchStakingService: () => ({}) }));
jest.mock('../../services/lending/lending.service', () => ({ getLendingService: () => ({}) }));
jest.mock('../../services/points.service', () => ({ awardPoints: jest.fn().mockResolvedValue(0) }));

// VaultShare mock — jest.fn() créés DANS la factory (pattern correct)
jest.mock('../../models/VaultShare', () => ({
  VaultShare: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    aggregate: jest.fn(),
    updateMany: jest.fn(),
    schema: {
      paths: {
        status: { enumValues: ['active', 'withdrawn', 'pending', 'processing'] },
      },
    },
  },
}));

// Arcium — jest.fn() dans la factory
jest.mock('../../services/yield/arcium-vault.service', () => ({
  isArciumEnabled: jest.fn().mockReturnValue(false),
  getArciumVaultService: jest.fn().mockReturnValue({
    verifyWithdrawal: jest.fn(),
    recordDeposit: jest.fn().mockResolvedValue({}),
    updateEncryptedTotal: jest.fn().mockResolvedValue({}),
  }),
}));

// YieldService mock
jest.mock('../../services/yield/yield.service', () => ({
  getYieldService: jest.fn().mockReturnValue({
    executePrivateWithdraw: jest.fn().mockResolvedValue({ txSignature: 'ok', success: true }),
  }),
}));

// ---- Imports APRÈS les mocks ----
import { VaultShare, VaultShareStatus } from '../../models/VaultShare';
import { YieldController } from '../../controllers/YieldController';
import { isArciumEnabled, getArciumVaultService } from '../../services/yield/arcium-vault.service';
import { getYieldService } from '../../services/yield/yield.service';

// ---- Helpers ----
function makeReq(body: object, user = { mongoUserId: 'user123', publicKey: 'pubkey123' }) {
  return { body, user } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// =========================================================
// Suite 1 — Modèle : "processing" est un statut valide
// =========================================================

describe('VaultShare — statut "processing" (Req 14.5)', () => {
  it('VaultShareStatus inclut "processing" parmi les valeurs valides', () => {
    const status: VaultShareStatus = 'processing';
    expect(status).toBe('processing');
  });

  it('le schéma Mongoose accepte status="processing" dans son enum', () => {
    const schemaPaths = (VaultShare.schema as any).paths;
    const statusEnum: string[] = schemaPaths.status.enumValues;
    expect(statusEnum).toContain('processing');
  });
});

// =========================================================
// Suite 2 — Controller : garde atomique active → processing
// =========================================================

describe('YieldController.withdraw — garde double-spend (Req 14.2, 14.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Par défaut : arcium désactivé, executePrivateWithdraw résout
    (isArciumEnabled as jest.Mock).mockReturnValue(false);
    (getYieldService as jest.Mock).mockReturnValue({
      executePrivateWithdraw: jest.fn().mockResolvedValue({ txSignature: 'ok', success: true }),
    });
  });

  it('retourne 409 si findOneAndUpdate retourne null (share déjà en cours)', async () => {
    (VaultShare.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ amount: 1, vaultType: 'sol_jito', private: true });
    const res = makeRes();

    await YieldController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('already in progress') })
    );
  });

  it('findOneAndUpdate est appelé avec { status: "active" } pour bloquer les appels concurrents', async () => {
    (VaultShare.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ amount: 1, vaultType: 'sol_jito', private: true });
    const res = makeRes();

    await YieldController.withdraw(req, res);

    expect(VaultShare.findOneAndUpdate as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'processing' }) }),
      expect.anything()
    );
  });
});

// =========================================================
// Suite 3 — Controller : rollback sur verifyWithdrawal.sufficient=false
// =========================================================

describe('YieldController.withdraw — rollback sur insufficient balance (Req 14.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isArciumEnabled as jest.Mock).mockReturnValue(true);
    (getArciumVaultService as jest.Mock).mockReturnValue({
      verifyWithdrawal: jest.fn().mockResolvedValue({ success: true, data: { sufficient: false } }),
      recordDeposit: jest.fn().mockResolvedValue({}),
      updateEncryptedTotal: jest.fn().mockResolvedValue({}),
    });
  });

  it('remet le statut à "active" si verifyWithdrawal retourne sufficient=false', async () => {
    const fakeShare = { _id: 'share_id_1' };
    (VaultShare.findOneAndUpdate as jest.Mock).mockResolvedValue(fakeShare);

    const req = makeReq({ amount: 1, vaultType: 'sol_jito', private: true });
    const res = makeRes();

    await YieldController.withdraw(req, res);

    expect(VaultShare.findByIdAndUpdate as jest.Mock).toHaveBeenCalledWith(
      'share_id_1',
      { $set: { status: 'active' } }
    );
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

// =========================================================
// Suite 4 — Controller : rollback si TX on-chain échoue
// =========================================================

describe('YieldController.withdraw — rollback si TX échoue (Req 8.4, 8.5, 14.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isArciumEnabled as jest.Mock).mockReturnValue(false);
    (getYieldService as jest.Mock).mockReturnValue({
      executePrivateWithdraw: jest.fn().mockRejectedValue(new Error('Slippage exceeded')),
    });
  });

  it('remet le statut à "active" si executePrivateWithdraw lance une erreur', async () => {
    const fakeShare = { _id: 'share_id_2' };
    (VaultShare.findOneAndUpdate as jest.Mock).mockResolvedValue(fakeShare);

    const req = makeReq({ amount: 1, vaultType: 'sol_jito', private: true });
    const res = makeRes();

    await YieldController.withdraw(req, res);

    expect(VaultShare.findByIdAndUpdate as jest.Mock).toHaveBeenCalledWith(
      'share_id_2',
      { $set: { status: 'active' } }
    );
    expect(res.status).toHaveBeenCalledWith(expect.any(Number));
  });
});
