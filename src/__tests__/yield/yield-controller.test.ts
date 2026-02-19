/**
 * Integration tests for YieldController
 *
 * Tests the full request → controller → service → response cycle.
 * Validates that the frontend will receive correct data shapes.
 */

// --- Mock services ---

const mockBuildDepositTx = jest.fn();
const mockBuildWithdrawTx = jest.fn();
const mockConfirmDeposit = jest.fn();
const mockConfirmWithdraw = jest.fn();
const mockGetBalance = jest.fn();
const mockGetAPYRates = jest.fn();
const mockGetDashboard = jest.fn();
const mockBuildPrivateDepositTx = jest.fn();
const mockConfirmPrivateDeposit = jest.fn();
const mockExecutePrivateWithdraw = jest.fn();

jest.mock("../../services/yield/yield.service", () => ({
  getYieldService: () => ({
    buildDepositTransaction: mockBuildDepositTx,
    buildWithdrawTransaction: mockBuildWithdrawTx,
    confirmDeposit: mockConfirmDeposit,
    confirmWithdraw: mockConfirmWithdraw,
    getBalance: mockGetBalance,
    getAPYRates: mockGetAPYRates,
    getDashboard: mockGetDashboard,
    buildPrivateDepositTransaction: mockBuildPrivateDepositTx,
    confirmPrivateDeposit: mockConfirmPrivateDeposit,
    executePrivateWithdraw: mockExecutePrivateWithdraw,
  }),
}));

const mockUsdcBuildDeposit = jest.fn();
const mockUsdcBuildWithdraw = jest.fn();
const mockUsdcConfirmDeposit = jest.fn();
const mockUsdcConfirmWithdraw = jest.fn();
const mockUsdcGetBalance = jest.fn();
const mockUsdcGetSupplyAPY = jest.fn();

jest.mock("../../services/yield/usdc-yield.service", () => ({
  getUsdcYieldService: () => ({
    buildDepositTransaction: mockUsdcBuildDeposit,
    buildWithdrawTransaction: mockUsdcBuildWithdraw,
    confirmDeposit: mockUsdcConfirmDeposit,
    confirmWithdraw: mockUsdcConfirmWithdraw,
    getBalance: mockUsdcGetBalance,
    getSupplyAPY: mockUsdcGetSupplyAPY,
  }),
}));

const mockPrivateSolDeposit = jest.fn();
const mockPrivateUsdcDeposit = jest.fn();
const mockPrivateSolWithdraw = jest.fn();
const mockPrivateUsdcWithdrawBuild = jest.fn();
const mockPrivateUsdcWithdrawConfirm = jest.fn();
const mockArciumPrivateSolDeposit = jest.fn();
const mockArciumPrivateSolWithdraw = jest.fn();

jest.mock("../../services/yield/privacy-yield.service", () => ({
  getPrivacyYieldService: () => ({
    executePrivateSolDeposit: mockPrivateSolDeposit,
    executePrivateUsdcDeposit: mockPrivateUsdcDeposit,
    executePrivateSolWithdraw: mockPrivateSolWithdraw,
    buildPrivateUsdcWithdraw: mockPrivateUsdcWithdrawBuild,
    confirmPrivateUsdcWithdraw: mockPrivateUsdcWithdrawConfirm,
    executeArciumPrivateSolDeposit: mockArciumPrivateSolDeposit,
    executeArciumPrivateSolWithdraw: mockArciumPrivateSolWithdraw,
  }),
}));

const mockProofOfYield = jest.fn();

jest.mock("../../services/yield/arcium-vault.service", () => ({
  getArciumVaultService: () => ({
    proofOfYield: mockProofOfYield,
    recordDeposit: jest.fn().mockResolvedValue({ success: true }),
    verifyWithdrawal: jest.fn().mockResolvedValue({ success: true, data: { sufficient: true } }),
    updateEncryptedTotal: jest.fn().mockResolvedValue({ success: true }),
    ensureUserShare: jest.fn().mockResolvedValue(null),
  }),
}));

jest.mock("../../services/yield/auto-sweep.service", () => ({
  getAutoSweepService: () => ({
    getConfig: jest.fn().mockResolvedValue({ enabled: false }),
    configure: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { YieldController } from "../../controllers/YieldController";

// --- Helper: create mock req/res ---

function mockReq(body: any = {}, user: any = { mongoUserId: "user123", publicKey: "PubKey123" }): any {
  return { body, user };
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// --- Tests ---

describe("YieldController - Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== DEPOSIT ====================

  describe("POST /deposit", () => {
    it("should route SOL deposit to yield service", async () => {
      mockBuildDepositTx.mockResolvedValue({
        transaction: "base64-tx-data",
        message: "Deposit 1 SOL via Jito",
      });

      const req = mockReq({ amount: 1, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(mockBuildDepositTx).toHaveBeenCalledWith("PubKey123", 1, "sol_jito");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        transaction: "base64-tx-data",
        message: "Deposit 1 SOL via Jito",
      });
    });

    it("should route USDC deposit to usdc service", async () => {
      mockUsdcBuildDeposit.mockResolvedValue({
        transaction: "kamino-tx-base64",
        message: "Deposit 100 USDC into Kamino",
      });

      const req = mockReq({ amount: 100, vaultType: "usdc_kamino" });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(mockUsdcBuildDeposit).toHaveBeenCalledWith("PubKey123", 100);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ transaction: "kamino-tx-base64" })
      );
    });

    it("should route private SOL deposit to Arcium-enhanced privacy service", async () => {
      mockArciumPrivateSolDeposit.mockResolvedValue({
        success: true,
        shareIds: ["share-1", "share-2"],
        batchId: "batch-abc",
        denominationsUsed: [1, 0.5],
        surplusSol: 0,
      });

      const req = mockReq({ amount: 1.5, vaultType: "sol_jito", private: true });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(mockArciumPrivateSolDeposit).toHaveBeenCalledWith("user123", 1.5, "sol_jito");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, shareIds: ["share-1", "share-2"] })
      );
    });

    it("should route private USDC deposit to privacy service", async () => {
      mockPrivateUsdcDeposit.mockResolvedValue({
        success: true,
        transaction: "kamino-after-pool-tx",
        privacyPoolTx: "spl-pool-tx",
        message: "Private deposit: 50 USDC",
      });

      const req = mockReq({ amount: 50, vaultType: "usdc_kamino", private: true });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(mockPrivateUsdcDeposit).toHaveBeenCalledWith("user123", "PubKey123", 50);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 400 for invalid input", async () => {
      const req = mockReq({ amount: -1, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid input" })
      );
    });

    it("should return 401 for unauthenticated request", async () => {
      const req = mockReq({ amount: 1, vaultType: "sol_jito" }, {});
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should return 400 when publicKey is missing", async () => {
      const req = mockReq({ amount: 1, vaultType: "sol_jito" }, { mongoUserId: "user123" });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "User public key not found" });
    });

    it("should return 422 for minimum amount error", async () => {
      mockBuildDepositTx.mockRejectedValue(new Error("Minimum deposit is 0.01 SOL"));

      const req = mockReq({ amount: 0.001, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.deposit(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  // ==================== WITHDRAW ====================

  describe("POST /withdraw", () => {
    it("should route SOL withdraw to yield service", async () => {
      mockBuildWithdrawTx.mockResolvedValue({
        transaction: "withdraw-tx-base64",
        estimatedSolOut: 0.99,
        slippagePercent: 0.1,
      });

      const req = mockReq({ amount: 1, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(mockBuildWithdrawTx).toHaveBeenCalledWith("user123", 1, "sol_jito", "PubKey123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedSolOut: 0.99 })
      );
    });

    it("should route USDC withdraw to usdc service", async () => {
      mockUsdcBuildWithdraw.mockResolvedValue({
        transaction: "kamino-withdraw-base64",
        estimatedUsdcOut: 99.5,
      });

      const req = mockReq({ amount: 100, vaultType: "usdc_kamino" });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(mockUsdcBuildWithdraw).toHaveBeenCalledWith("PubKey123", 100);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should route private SOL withdraw to Arcium-verified privacy service", async () => {
      mockArciumPrivateSolWithdraw.mockResolvedValue({
        success: true,
        sufficient: true,
        shareId: "share-w-1",
        estimatedSolOut: 0.95,
        privacyPoolTx: "pool-withdraw-sig",
      });

      const req = mockReq({ amount: 1, vaultType: "sol_jito", private: true });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(mockArciumPrivateSolWithdraw).toHaveBeenCalledWith("user123", 1, "sol_jito", "PubKey123");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 422 when Arcium verification says insufficient balance", async () => {
      mockArciumPrivateSolWithdraw.mockResolvedValue({
        success: true,
        sufficient: false,
      });

      const req = mockReq({ amount: 100, vaultType: "sol_jito", private: true });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(mockArciumPrivateSolWithdraw).toHaveBeenCalledWith("user123", 100, "sol_jito", "PubKey123");
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ sufficient: false })
      );
    });

    it("should route private USDC withdraw to privacy service", async () => {
      mockPrivateUsdcWithdrawBuild.mockResolvedValue({
        transaction: "private-usdc-withdraw-tx",
        estimatedUsdcOut: 99,
      });

      const req = mockReq({ amount: 100, vaultType: "usdc_kamino", private: true });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(mockPrivateUsdcWithdrawBuild).toHaveBeenCalledWith("PubKey123", 100);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 422 for insufficient shares", async () => {
      mockBuildWithdrawTx.mockRejectedValue(new Error("Insufficient shares"));

      const req = mockReq({ amount: 100, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
    });

    it("should return 422 for slippage too high", async () => {
      mockBuildWithdrawTx.mockRejectedValue(new Error("Slippage too high"));

      const req = mockReq({ amount: 1, vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  // ==================== CONFIRM ====================

  describe("POST /confirm", () => {
    const validSig = "a".repeat(88);

    it("should confirm SOL deposit", async () => {
      mockConfirmDeposit.mockResolvedValue({ success: true, shareId: "s1" });

      const req = mockReq({ signature: validSig, type: "deposit", vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(mockConfirmDeposit).toHaveBeenCalledWith(validSig, "user123", "sol_jito");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should confirm SOL withdrawal with amount", async () => {
      mockConfirmWithdraw.mockResolvedValue({ success: true, shareId: "s2" });

      const req = mockReq({ signature: validSig, type: "withdraw", vaultType: "sol_jito", amount: 0.5 });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(mockConfirmWithdraw).toHaveBeenCalledWith(validSig, "user123", "sol_jito", 0.5);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should confirm USDC deposit", async () => {
      mockUsdcConfirmDeposit.mockResolvedValue({ success: true, shareId: "usdc-s1", amount: 100000000 });

      const req = mockReq({ signature: validSig, type: "deposit", vaultType: "usdc_kamino", amount: 100 });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(mockUsdcConfirmDeposit).toHaveBeenCalledWith(validSig, "user123", 100);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should confirm USDC withdrawal", async () => {
      mockUsdcConfirmWithdraw.mockResolvedValue({ success: true, shareId: "usdc-s2", amount: 50000000 });

      const req = mockReq({ signature: validSig, type: "withdraw", vaultType: "usdc_kamino", amount: 50 });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(mockUsdcConfirmWithdraw).toHaveBeenCalledWith(validSig, "user123", 50);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should route private USDC withdraw confirm to privacy service", async () => {
      mockPrivateUsdcWithdrawConfirm.mockResolvedValue({
        success: true,
        shareId: "priv-usdc-1",
        privacyPoolTx: "pool-tx-confirm",
      });

      const req = mockReq({
        signature: validSig,
        type: "withdraw",
        vaultType: "usdc_kamino",
        amount: 100,
        private: true,
      });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(mockPrivateUsdcWithdrawConfirm).toHaveBeenCalledWith(
        validSig, "user123", 100, "PubKey123"
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 400 when USDC confirm missing amount", async () => {
      const req = mockReq({ signature: validSig, type: "deposit", vaultType: "usdc_kamino" });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("amount") })
      );
    });

    it("should return 400 when SOL withdraw confirm missing amount", async () => {
      const req = mockReq({ signature: validSig, type: "withdraw", vaultType: "sol_jito" });
      const res = mockRes();

      await YieldController.confirm(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ==================== DASHBOARD ====================

  describe("GET /dashboard", () => {
    it("should return combined SOL + USDC dashboard data", async () => {
      mockGetDashboard.mockResolvedValue({
        balance: {
          totalDeposited: 2.0,
          currentValue: 2.16,
          yieldEarned: 0.16,
          yieldPercent: 8.0,
          shares: [],
        },
        apy: { jitoApy: 7.5, marinadeApy: 6.8, lastUpdated: "2026-02-16" },
        history: [],
      });
      mockUsdcGetBalance.mockResolvedValue({
        totalDeposited: 100,
        currentValue: 103,
        yieldEarned: 3,
        yieldPercent: 3.0,
      });
      mockUsdcGetSupplyAPY.mockResolvedValue(6.5);

      const req = mockReq();
      const res = mockRes();

      await YieldController.getDashboard(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];

      // Verify the response shape matches what the frontend expects
      expect(data).toHaveProperty("balance");
      expect(data).toHaveProperty("apy");
      expect(data).toHaveProperty("usdc");
      expect(data).toHaveProperty("history");

      // APY should merge SOL + USDC
      expect(data.apy.jitoApy).toBe(7.5);
      expect(data.apy.marinadeApy).toBe(6.8);
      expect(data.apy.usdcKaminoApy).toBe(6.5);

      // USDC balance
      expect(data.usdc.totalDeposited).toBe(100);
      expect(data.usdc.currentValue).toBe(103);
    });
  });

  // ==================== BALANCE ====================

  describe("GET /balance", () => {
    it("should return SOL + USDC balances", async () => {
      mockGetBalance.mockResolvedValue({
        totalDeposited: 1,
        currentValue: 1.08,
        yieldEarned: 0.08,
        yieldPercent: 8,
        shares: [],
      });
      mockUsdcGetBalance.mockResolvedValue({
        totalDeposited: 50,
        currentValue: 51.5,
        yieldEarned: 1.5,
        yieldPercent: 3,
      });

      const req = mockReq();
      const res = mockRes();

      await YieldController.getBalance(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];
      expect(data).toHaveProperty("sol");
      expect(data).toHaveProperty("usdc");
      expect(data.sol.currentValue).toBe(1.08);
      expect(data.usdc.currentValue).toBe(51.5);
    });
  });

  // ==================== PROOF OF YIELD ====================

  describe("GET /proof", () => {
    it("should return proof of yield result from Arcium MPC", async () => {
      mockGetBalance.mockResolvedValue({
        totalDeposited: 2.0,
        currentValue: 2.16,
        yieldEarned: 0.16,
        yieldPercent: 8.0,
        shares: [],
      });
      mockProofOfYield.mockResolvedValue({
        success: true,
        data: { exceedsThreshold: true },
      });

      const req = {
        query: { vaultType: "sol_jito", thresholdBps: "500" },
        user: { mongoUserId: "user123", publicKey: "PubKey123" },
      } as any;
      const res = mockRes();

      await YieldController.proofOfYield(req, res);

      expect(mockProofOfYield).toHaveBeenCalledWith(
        "user123",
        BigInt(2_160_000_000),
        BigInt(2_000_000_000),
        500
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          exceedsThreshold: true,
          thresholdBps: 500,
          vaultType: "sol_jito",
        })
      );
    });

    it("should return 503 when MPC is unavailable", async () => {
      mockGetBalance.mockResolvedValue({
        totalDeposited: 1.0,
        currentValue: 1.05,
        yieldEarned: 0.05,
        yieldPercent: 5.0,
        shares: [],
      });
      mockProofOfYield.mockResolvedValue({
        success: false,
        error: "MPC finalization timeout",
      });

      const req = {
        query: { vaultType: "sol_jito", thresholdBps: "500" },
        user: { mongoUserId: "user123", publicKey: "PubKey123" },
      } as any;
      const res = mockRes();

      await YieldController.proofOfYield(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  // ==================== APY ====================

  describe("GET /apy", () => {
    it("should return combined APY rates", async () => {
      mockGetAPYRates.mockResolvedValue({
        jitoApy: 7.5,
        marinadeApy: 6.8,
        lastUpdated: "2026-02-16",
      });
      mockUsdcGetSupplyAPY.mockResolvedValue(6.5);

      const req = mockReq();
      const res = mockRes();

      await YieldController.getAPY(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];
      expect(data.jitoApy).toBe(7.5);
      expect(data.marinadeApy).toBe(6.8);
      expect(data.usdcKaminoApy).toBe(6.5);
      expect(data.lastUpdated).toBe("2026-02-16");
    });
  });
});
