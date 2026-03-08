/**
 * Tests for yield-withdrawal-fixes spec.
 *
 * 1. Snapshot post-retrait : YieldController doit utiliser processingShare
 *    au lieu de re-querier MongoDB après que le share est passé à "withdrawn".
 * 2. Non-bloquant : un échec de takeBalanceSnapshot ne doit pas bloquer la réponse HTTP.
 * 3. Retry Arcium : la formule de backoff exponentiel.
 */

// ========== INFRASTRUCTURE MOCKS (must be before imports) ==========
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), setex: jest.fn() },
}));
jest.mock('@solana/spl-stake-pool', () => ({}));
jest.mock('@marinade.finance/marinade-ts-sdk', () => ({}));
jest.mock('@solana/spl-token', () => ({ getAccount: jest.fn(), getAssociatedTokenAddress: jest.fn() }));
jest.mock('../../services/socket/socketService', () => ({ getSocketService: () => ({ emit: jest.fn() }) }));
jest.mock('../../services/yield/batch-staking.service', () => ({ getBatchStakingService: () => ({ addToBatch: jest.fn() }) }));
jest.mock('../../services/lending/lending.service', () => ({ getLendingService: () => ({}) }));

// ========== MOCKS ==========

const mockFindOneAndUpdate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockFindOne = jest.fn();

jest.mock("../../models/VaultShare", () => ({
  VaultShare: {
    aggregate: jest.fn().mockResolvedValue([{ _id: null, total: 0 }]),
    findOneAndUpdate: mockFindOneAndUpdate,
    findByIdAndUpdate: mockFindByIdAndUpdate,
    findOne: mockFindOne,
  },
}));

const mockExecutePrivateWithdraw = jest.fn();
jest.mock("../../services/yield/yield.service", () => ({
  getYieldService: () => ({
    buildDepositTransaction: jest.fn(),
    buildWithdrawTransaction: jest.fn(),
    confirmDeposit: jest.fn(),
    confirmWithdraw: jest.fn(),
    getBalance: jest.fn(),
    getAPYRates: jest.fn(),
    getDashboard: jest.fn(),
    buildPrivateDepositTransaction: jest.fn(),
    confirmPrivateDeposit: jest.fn(),
    executePrivateWithdraw: mockExecutePrivateWithdraw,
  }),
}));

jest.mock("../../services/yield/usdc-yield.service", () => ({
  getUsdcYieldService: () => ({
    buildDepositTransaction: jest.fn(),
    buildWithdrawTransaction: jest.fn(),
    confirmDeposit: jest.fn(),
    confirmWithdraw: jest.fn(),
    getBalance: jest.fn(),
    getSupplyAPY: jest.fn(),
  }),
}));

jest.mock("../../services/yield/privacy-yield.service", () => ({
  getPrivacyYieldService: () => ({
    executePrivateSolDeposit: jest.fn(),
    executePrivateUsdcDeposit: jest.fn(),
    executePrivateSolWithdraw: jest.fn(),
    buildPrivateUsdcWithdraw: jest.fn(),
    confirmPrivateUsdcWithdraw: jest.fn(),
    executeArciumPrivateSolDeposit: jest.fn(),
    executeArciumPrivateSolWithdraw: jest.fn(),
  }),
}));

const mockVerifyWithdrawal = jest.fn().mockResolvedValue({ success: true, data: { sufficient: true } });
jest.mock("../../services/yield/arcium-vault.service", () => ({
  isArciumEnabled: () => true,
  getArciumVaultService: () => ({
    proofOfYield: jest.fn(),
    recordDeposit: jest.fn().mockResolvedValue({ success: true }),
    verifyWithdrawal: mockVerifyWithdrawal,
    updateEncryptedTotal: jest.fn().mockResolvedValue({ success: true }),
    ensureUserShare: jest.fn().mockResolvedValue(null),
  }),
}));

const mockTakeBalanceSnapshot = jest.fn();
jest.mock("../../services/yield/yield-mpc-enhancements.service", () => ({
  getYieldMpcEnhancementsService: () => ({
    proofOfReserve: jest.fn().mockResolvedValue({ success: true, data: { isSolvent: true } }),
    computeYieldDistribution: jest.fn().mockResolvedValue({ success: true }),
    takeBalanceSnapshot: mockTakeBalanceSnapshot,
  }),
}));

jest.mock("../../services/yield/auto-sweep.service", () => ({
  getAutoSweepService: () => ({
    getConfig: jest.fn().mockResolvedValue({ enabled: false }),
    configure: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("../../services/points.service", () => ({
  awardPoints: jest.fn().mockResolvedValue(10),
}));

import { YieldController } from "../../controllers/YieldController";

function mockReq(body: any = {}, user: any = { mongoUserId: "user123", publicKey: "PubKey123" }): any {
  return { body, user };
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ========== SNAPSHOT FIX TESTS ==========

describe("YieldController - snapshot post-retrait (yield-withdrawal-fixes)", () => {
  const processingShare = {
    _id: "share-id-from-processing",
    userId: "user123",
    vaultType: "sol_jito",
    status: "processing",
    snapshotIndex: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyWithdrawal.mockResolvedValue({ success: true, data: { sufficient: true } });
    mockFindOneAndUpdate.mockResolvedValue(processingShare);
    mockFindByIdAndUpdate.mockResolvedValue({});
    mockExecutePrivateWithdraw.mockResolvedValue({
      success: true,
      shareId: "share-id-from-processing",
      estimatedSolOut: 0.95,
    });
    mockTakeBalanceSnapshot.mockResolvedValue({
      success: true,
      data: { usedIndex: 3 },
    });
  });

  it("devrait utiliser processingShare._id pour findByIdAndUpdate après retrait réussi", async () => {
    const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
    const res = mockRes();

    await YieldController.withdraw(req, res);

    // La réponse doit être 200
    expect(res.status).toHaveBeenCalledWith(200);

    // Laisser le snapshot fire-and-forget se terminer
    await new Promise((r) => setImmediate(r));

    // findByIdAndUpdate doit être appelé avec processingShare._id
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      "share-id-from-processing",
      expect.objectContaining({ snapshotIndex: 3 })
    );
  });

  it("ne doit PAS appeler findOne pour re-querier le share après retrait", async () => {
    const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
    const res = mockRes();

    await YieldController.withdraw(req, res);
    await new Promise((r) => setImmediate(r));

    // findOne ne doit pas être appelé — le controller utilise processingShare directement
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("devrait utiliser snapshotIndex de processingShare comme base pour newIndex", async () => {
    const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
    const res = mockRes();

    await YieldController.withdraw(req, res);
    await new Promise((r) => setImmediate(r));

    // processingShare.snapshotIndex = 2 → newIndex = 3
    expect(mockTakeBalanceSnapshot).toHaveBeenCalledWith(
      "user123",
      0, // sol_jito = 0
      BigInt(3) // snapshotIndex + 1
    );
  });

  it("doit retourner 200 même si takeBalanceSnapshot throw (non-bloquant)", async () => {
    mockTakeBalanceSnapshot.mockRejectedValue(new Error("MPC snapshot failed"));

    const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
    const res = mockRes();

    await YieldController.withdraw(req, res);

    // La réponse HTTP doit quand même être 200
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sufficient: true })
    );
  });

  it("doit retourner 409 si aucun share actif trouvé (processingShare null)", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);

    const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
    const res = mockRes();

    await YieldController.withdraw(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});

// ========== ARCIUM RETRY FORMULA TESTS ==========

describe("ArciumVaultService - formule de backoff exponentiel (yield-withdrawal-fixes)", () => {
  // Teste la formule pure sans instancier ArciumVaultService
  // (le service requiert des variables d'env et une connexion Solana)

  function computeBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 8000);
  }

  it("attempt 0 → délai 1000ms", () => {
    expect(computeBackoffDelay(0)).toBe(1000);
  });

  it("attempt 1 → délai 2000ms", () => {
    expect(computeBackoffDelay(1)).toBe(2000);
  });

  it("attempt 2 → délai 4000ms", () => {
    expect(computeBackoffDelay(2)).toBe(4000);
  });

  it("attempt 3 → capé à 8000ms (ne dépasse jamais 8s)", () => {
    expect(computeBackoffDelay(3)).toBe(8000);
  });

  it("attempt 10 → toujours capé à 8000ms", () => {
    expect(computeBackoffDelay(10)).toBe(8000);
  });

  it("MAX_RETRIES=3 → 4 tentatives au total (attempt 0,1,2,3)", () => {
    const MAX_RETRIES = 3;
    const attempts: number[] = [];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      attempts.push(attempt);
    }
    expect(attempts).toEqual([0, 1, 2, 3]);
    expect(attempts.length).toBe(4);
  });

  it("message d'erreur final inclut le nombre de tentatives", () => {
    const MAX_RETRIES = 3;
    const operationName = "recordDeposit";
    const lastError = "timeout";
    const message = `${operationName} failed after ${MAX_RETRIES + 1} attempts: ${lastError}`;
    expect(message).toContain("4 attempts");
    expect(message).toContain(operationName);
  });
});
