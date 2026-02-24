/**
 * Tests pour YieldController.proofOfReserve
 *
 * Requirements couverts:
 * - 3.1: Calcul du seuil via getTotalActiveDepositLamports() (Mongoose hooks, pas $sum)
 * - 3.2: Conserver la priorité du threshold custom via req.query.threshold
 * - 3.3: Réponse { isSolvent, threshold, timestamp } sans montants individuels
 * - 3.4: HTTP 503 si MPC indisponible
 */

// ========== MOCKS ==========

let mockIsArciumEnabled = true;
const mockProofOfReserveFn = jest.fn();
const mockGetTotalActiveDepositLamports = jest.fn();

jest.mock("../../services/yield/arcium-vault.service", () => ({
  isArciumEnabled: () => mockIsArciumEnabled,
  getArciumVaultService: () => ({
    proofOfYield: jest.fn(),
    recordDeposit: jest.fn(),
    verifyWithdrawal: jest.fn(),
    updateEncryptedTotal: jest.fn(),
    ensureUserShare: jest.fn(),
  }),
}));

jest.mock("../../services/yield/yield-mpc-enhancements.service", () => ({
  getYieldMpcEnhancementsService: () => ({
    proofOfReserve: mockProofOfReserveFn,
  }),
}));

jest.mock("../../services/yield/yield-rates.service", () => ({
  getTotalActiveDepositLamports: (...args: any[]) =>
    mockGetTotalActiveDepositLamports(...args),
}));

jest.mock("../../models/VaultShare", () => ({
  VaultShare: {
    find: jest.fn(),
    aggregate: jest.fn(),
  },
}));

// Mocks des autres services pour que le controller compile
jest.mock("../../services/yield/yield.service", () => ({
  getYieldService: () => ({
    buildDepositTransaction: jest.fn(),
    buildWithdrawTransaction: jest.fn(),
    confirmDeposit: jest.fn(),
    confirmWithdraw: jest.fn(),
    getBalance: jest.fn().mockResolvedValue({ currentValue: 0, deposited: 0 }),
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

jest.mock("../../services/yield/private-sol.service", () => ({
  confirmPrivateDepositArcium: jest.fn(),
}));

jest.mock("../../services/yield/batch-staking.service", () => ({
  getBatchStakingService: () => ({
    addToQueue: jest.fn(),
    getStatus: jest.fn(),
  }),
}));

import { YieldController } from "../../controllers/YieldController";

// ========== HELPERS ==========

function mockReq(query: any = {}): any {
  return { query, user: undefined }; // permissionless — pas d'auth
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ========== TESTS ==========

describe("YieldController.proofOfReserve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsArciumEnabled = true;
  });

  it("retourne 503 si Arcium est désactivé", async () => {
    mockIsArciumEnabled = false;
    const req = mockReq();
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Arcium MPC") })
    );
  });

  it("retourne 400 si threshold est négatif", async () => {
    const req = mockReq({ threshold: "-100" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid threshold parameter" })
    );
  });

  it("utilise le threshold fourni en query param", async () => {
    mockProofOfReserveFn.mockResolvedValue({
      success: true,
      data: { isSolvent: true },
      txSignature: "sig-abc",
    });

    const req = mockReq({ threshold: "5000000000" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(mockProofOfReserveFn).toHaveBeenCalledWith(5_000_000_000n);
    expect(mockGetTotalActiveDepositLamports).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.isSolvent).toBe(true);
    expect(body.threshold).toBe("5000000000");
    expect(body.timestamp).toBeDefined();
  });

  it("appelle getTotalActiveDepositLamports() si threshold absent", async () => {
    mockGetTotalActiveDepositLamports.mockResolvedValue(3_000_000_000n);
    mockProofOfReserveFn.mockResolvedValue({
      success: true,
      data: { isSolvent: true },
      txSignature: "sig-agg",
    });

    const req = mockReq({}); // pas de threshold
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(mockGetTotalActiveDepositLamports).toHaveBeenCalled();
    expect(mockProofOfReserveFn).toHaveBeenCalledWith(3_000_000_000n);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("utilise threshold=0n si aucun dépôt actif (getTotalActiveDepositLamports retourne 0n)", async () => {
    mockGetTotalActiveDepositLamports.mockResolvedValue(0n);
    mockProofOfReserveFn.mockResolvedValue({
      success: true,
      data: { isSolvent: true },
    });

    const req = mockReq({});
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(mockProofOfReserveFn).toHaveBeenCalledWith(0n);
  });

  it("retourne isSolvent:false dans le body si le vault est insolvable", async () => {
    mockProofOfReserveFn.mockResolvedValue({
      success: true,
      data: { isSolvent: false },
    });

    const req = mockReq({ threshold: "1000" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ isSolvent: false })
    );
  });

  it("retourne 503 si le MPC échoue", async () => {
    mockProofOfReserveFn.mockResolvedValue({
      success: false,
      error: "MPC timeout after 60s",
    });

    const req = mockReq({ threshold: "1000" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "MPC computation unavailable" })
    );
  });

  it("retourne 500 si une exception est levée", async () => {
    mockProofOfReserveFn.mockRejectedValue(new Error("Unexpected crash"));

    const req = mockReq({ threshold: "1000" });
    const res = mockRes();

    await YieldController.proofOfReserve(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
