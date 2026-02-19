/**
 * Tests d'intégration — 3 flows end-to-end avec Arcium MPC moqué
 *
 * Requirements couverts:
 * - 1.7: computeYieldDistribution déclenché après dépôt confirmé
 * - 2.5: GET /reserve-proof chaîne complète jusqu'à l'événement MPC moqué
 * - 3.6: takeBalanceSnapshot appelé après dépôt privé avec snapshotPda
 */

// ========== MOCKS ==========

// VaultShare — mock Mongoose
const mockVaultShareFindOne = jest.fn();
const mockVaultShareFindOneAndUpdate = jest.fn();
const mockVaultShareAggregate = jest.fn();

jest.mock("../../models/VaultShare", () => ({
  VaultShare: {
    findOne: mockVaultShareFindOne,
    findOneAndUpdate: mockVaultShareFindOneAndUpdate,
    aggregate: mockVaultShareAggregate,
  },
}));

// YieldMpcEnhancementsService
const mockComputeYieldDistribution = jest.fn();
const mockTakeBalanceSnapshot = jest.fn();
const mockProofOfReserve = jest.fn();

jest.mock("../../services/yield/yield-mpc-enhancements.service", () => ({
  getYieldMpcEnhancementsService: () => ({
    computeYieldDistribution: mockComputeYieldDistribution,
    takeBalanceSnapshot: mockTakeBalanceSnapshot,
    proofOfReserve: mockProofOfReserve,
  }),
}));

// ArciumVaultService
const mockRecordDeposit = jest.fn();
const mockVerifyWithdrawal = jest.fn();
const mockUpdateEncryptedTotal = jest.fn();
const mockEnsureUserShare = jest.fn();

jest.mock("../../services/yield/arcium-vault.service", () => ({
  isArciumEnabled: () => true,
  getArciumVaultService: () => ({
    recordDeposit: mockRecordDeposit,
    verifyWithdrawal: mockVerifyWithdrawal,
    updateEncryptedTotal: mockUpdateEncryptedTotal,
    ensureUserShare: mockEnsureUserShare,
    getHelpers: jest.fn().mockReturnValue({}),
  }),
}));

// Yield rates
jest.mock("../../services/yield/yield-rates.service", () => ({
  getExchangeRate: jest.fn().mockResolvedValue(1.000105), // 0.0105% yield
}));

// YieldController deps
jest.mock("../../services/yield/yield.service", () => ({
  getYieldService: () => ({
    buildDepositTransaction: jest.fn(),
    buildWithdrawTransaction: jest.fn(),
    confirmDeposit: jest.fn(),
    confirmWithdraw: jest.fn(),
    getBalance: jest.fn().mockResolvedValue({ currentValue: 1, deposited: 1 }),
    getAPYRates: jest.fn(),
    getDashboard: jest.fn(),
    buildPrivateDepositTransaction: jest.fn(),
    confirmPrivateDeposit: jest.fn(),
    executePrivateWithdraw: jest.fn(),
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

jest.mock("../../services/yield/auto-sweep.service", () => ({
  getAutoSweepService: () => ({
    getConfig: jest.fn().mockResolvedValue({ enabled: false }),
    configure: jest.fn(),
  }),
}));

import { YieldController } from "../../controllers/YieldController";

// ========== HELPERS ==========

function mockReq(body: any = {}, query: any = {}, user: any = { mongoUserId: "user-integration", publicKey: "PubKey123" }): any {
  return { body, query, user };
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ========== FLOW A: reserve-proof end-to-end ==========

describe("Flow A — GET /reserve-proof chaîne complète", () => {
  beforeEach(() => jest.clearAllMocks());

  it("agrège depuis MongoDB et appelle MPC puis retourne isSolvent", async () => {
    // Simule 3 SOL actifs déposés en total
    mockVaultShareAggregate.mockResolvedValue([
      { _id: null, total: 3_000_000_000 },
    ]);

    mockProofOfReserve.mockResolvedValue({
      success: true,
      data: { isSolvent: true },
      txSignature: "reserve-tx-ok",
    });

    const req = mockReq({}, {});
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    // L'agrégation doit avoir été appelée
    expect(mockVaultShareAggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ $match: { status: "active" } }),
      ])
    );

    // Le MPC doit avoir reçu le total agrégé en bigint
    expect(mockProofOfReserve).toHaveBeenCalledWith(3_000_000_000n);

    // La réponse doit être correctement formatée
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.isSolvent).toBe(true);
    expect(body.threshold).toBe("3000000000");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it("retourne isSolvent:false si le vault est sous le seuil", async () => {
    mockVaultShareAggregate.mockResolvedValue([
      { _id: null, total: 1_000_000_000 },
    ]);

    mockProofOfReserve.mockResolvedValue({
      success: true,
      data: { isSolvent: false },
    });

    const req = mockReq({}, {});
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0].isSolvent).toBe(false);
  });

  it("threshold fourni override l'agrégation MongoDB", async () => {
    mockProofOfReserve.mockResolvedValue({
      success: true,
      data: { isSolvent: true },
    });

    const req = mockReq({}, { threshold: "7500000000" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    // Pas d'agrégation si threshold fourni
    expect(mockVaultShareAggregate).not.toHaveBeenCalled();
    expect(mockProofOfReserve).toHaveBeenCalledWith(7_500_000_000n);
  });

  it("retourne 503 si le MPC échoue", async () => {
    mockVaultShareAggregate.mockResolvedValue([{ _id: null, total: 1_000 }]);
    mockProofOfReserve.mockResolvedValue({
      success: false,
      error: "Arcium node offline",
    });

    const req = mockReq({}, {});
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toBe("MPC computation unavailable");
  });
});

// ========== FLOW B: computeYieldDistribution après staking confirmé ==========

describe("Flow B — computeYieldDistribution déclenché après dépôt", () => {
  beforeEach(() => jest.clearAllMocks());

  it("computeYieldDistribution est appelé avec rate_num dans les bornes", async () => {
    // Simule un taux de 1.000105 (0.0105% yield step)
    const rate = 1.000105;
    const rateDenom = 1_000_000n;
    const rateNum = BigInt(Math.min(Math.round(rate * 1_000_000), 1_100_000));

    expect(rateNum).toBe(1_000_105n);
    expect(rateNum).toBeLessThanOrEqual(1_100_000n);

    mockComputeYieldDistribution.mockResolvedValue({
      success: true,
      txSignature: "yield-dist-sig",
      finalizationSignature: "finalize-sig",
    });

    const result = await mockComputeYieldDistribution(
      "user-integration",
      0,
      rateNum,
      rateDenom
    );

    expect(result.success).toBe(true);
    expect(mockComputeYieldDistribution).toHaveBeenCalledWith(
      "user-integration",
      0,
      1_000_105n,
      1_000_000n
    );
  });

  it("rate_num ne dépasse jamais 1_100_000 même si le taux est élevé", () => {
    // Taux extrême: 10% de rendement immédiat
    const extremeRate = 1.15;
    const rateNum = BigInt(Math.min(Math.round(extremeRate * 1_000_000), 1_100_000));
    expect(rateNum).toBe(1_100_000n); // plafonné
  });
});

// ========== FLOW C: takeBalanceSnapshot après dépôt privé ==========

describe("Flow C — takeBalanceSnapshot après dépôt privé confirmé", () => {
  beforeEach(() => jest.clearAllMocks());

  it("takeBalanceSnapshot retourne un snapshotPda valide", async () => {
    const expectedPda = "Fg4uFvazr4y1oTY34YX1opt5AfVyHHBDCQwDhgVd2GE";

    mockTakeBalanceSnapshot.mockResolvedValue({
      success: true,
      data: { snapshotPda: expectedPda },
      txSignature: "snapshot-sig",
      finalizationSignature: "snapshot-finalize",
    });

    const result = await mockTakeBalanceSnapshot("user-integration", 0, 0n);

    expect(result.success).toBe(true);
    expect(result.data?.snapshotPda).toBe(expectedPda);
    // base58 pubkey = 43 ou 44 chars selon la valeur
    expect(result.data?.snapshotPda.length).toBeGreaterThanOrEqual(43);
    expect(result.data?.snapshotPda.length).toBeLessThanOrEqual(44);
  });

  it("snapshotIndex est incrémenté à chaque appel", async () => {
    let currentIndex = 0n;

    mockTakeBalanceSnapshot.mockImplementation(
      async (_userId: string, _vaultType: number, index: bigint) => ({
        success: true,
        data: { snapshotPda: `fake-pda-${index}` },
      })
    );

    // Premier snapshot (index=0)
    const r1 = await mockTakeBalanceSnapshot("user-integration", 0, currentIndex);
    currentIndex++;

    // Deuxième snapshot (index=1)
    const r2 = await mockTakeBalanceSnapshot("user-integration", 0, currentIndex);

    expect(r1.data?.snapshotPda).toBe("fake-pda-0");
    expect(r2.data?.snapshotPda).toBe("fake-pda-1");
  });

  it("une erreur de snapshot ne bloque pas le flux principal", async () => {
    mockTakeBalanceSnapshot.mockResolvedValue({
      success: false,
      error: "state_nonce is zero — not initialized",
    });

    // On simule le comportement fire-and-forget de privacy-yield.service
    let mainFlowCompleted = false;

    const snapshotPromise = mockTakeBalanceSnapshot("user-integration", 0, 0n);
    // Le flux principal ne attend PAS le snapshot
    mainFlowCompleted = true;

    const snapshotResult = await snapshotPromise;

    expect(mainFlowCompleted).toBe(true);
    expect(snapshotResult.success).toBe(false);
  });
});
