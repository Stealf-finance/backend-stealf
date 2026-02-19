/**
 * Tests for PrivacyYieldService
 *
 * Validates that privacy-wrapped deposit/withdraw flows
 * correctly route through the Privacy Pool before hitting yield vaults.
 */

// --- Mocks (must be before imports) ---

const mockDepositSOL = jest.fn();
const mockWithdrawSOL = jest.fn();
const mockDepositSPL = jest.fn();
const mockWithdrawSPL = jest.fn();

jest.mock("../../services/privacycash/PrivacyCashService", () => ({
  privacyCashService: {
    depositSOL: (...args: any[]) => mockDepositSOL(...args),
    withdrawSOL: (...args: any[]) => mockWithdrawSOL(...args),
    depositSPL: (...args: any[]) => mockDepositSPL(...args),
    withdrawSPL: (...args: any[]) => mockWithdrawSPL(...args),
  },
}));

const mockYieldConfirmDeposit = jest.fn();
const mockYieldConfirmWithdraw = jest.fn();
const mockYieldBuildWithdraw = jest.fn();

jest.mock("../../services/yield/yield.service", () => ({
  getYieldService: () => ({
    confirmDeposit: (...args: any[]) => mockYieldConfirmDeposit(...args),
    confirmWithdraw: (...args: any[]) => mockYieldConfirmWithdraw(...args),
    buildWithdrawTransaction: (...args: any[]) => mockYieldBuildWithdraw(...args),
  }),
}));

const mockUsdcBuildDeposit = jest.fn();
const mockUsdcBuildWithdraw = jest.fn();
const mockUsdcConfirmWithdraw = jest.fn();

jest.mock("../../services/yield/usdc-yield.service", () => ({
  getUsdcYieldService: () => ({
    buildDepositTransaction: (...args: any[]) => mockUsdcBuildDeposit(...args),
    buildWithdrawTransaction: (...args: any[]) => mockUsdcBuildWithdraw(...args),
    confirmWithdraw: (...args: any[]) => mockUsdcConfirmWithdraw(...args),
  }),
}));

jest.mock("../../config/privacyCash", () => ({
  SUPPORTED_TOKENS: {
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  calculateWithdrawalFee: (amount: number) => amount * 0.0035 + 0.006,
}));

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      sendRawTransaction: jest.fn().mockResolvedValue("mock-sig-123"),
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: "mock-blockhash",
        lastValidBlockHeight: 1000,
      }),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    })),
  };
});

process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
process.env.VAULT_PROGRAM_ID = "4ZxuCrdioJHhqp9sSF5vo9npUdDGRVVMMcq59BnMWqJA";

// Import after mocks
import { getPrivacyYieldService } from "../../services/yield/privacy-yield.service";

// --- Tests ---

describe("PrivacyYieldService", () => {
  const service = getPrivacyYieldService();
  const testUserId = "507f1f77bcf86cd799439011";
  const testWallet = "DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== SOL Privacy Deposit ====================

  describe("SOL Privacy Deposit", () => {
    it("should deposit SOL to privacy pool first", async () => {
      mockDepositSOL.mockResolvedValue({ tx: "privacy-tx-1", fee: 0.006 });

      const result = await service.depositSolToPrivacyPool(1.0);

      expect(mockDepositSOL).toHaveBeenCalledWith(1.0);
      expect(result.tx).toBe("privacy-tx-1");
      expect(result.fee).toBe(0.006);
    });

    it("should execute full private SOL deposit flow", async () => {
      mockWithdrawSOL.mockResolvedValue({ tx: "withdraw-from-pool-tx" });
      mockYieldConfirmDeposit.mockResolvedValue({
        success: true,
        shareId: "share-123",
      });

      const result = await service.executePrivateSolDeposit(
        testUserId,
        1.0,
        "sol_jito"
      );

      // Step 1: Should withdraw from pool to vault PDA
      expect(mockWithdrawSOL).toHaveBeenCalledWith(1.0, expect.any(String));
      // Step 2: Should confirm deposit in yield service
      expect(mockYieldConfirmDeposit).toHaveBeenCalledWith(
        "withdraw-from-pool-tx",
        testUserId,
        "sol_jito"
      );
      expect(result.success).toBe(true);
      expect(result.shareId).toBe("share-123");
      expect(result.privacyPoolTx).toBe("withdraw-from-pool-tx");
    });

    it("should reject USDC vault type for SOL deposit", async () => {
      await expect(
        service.executePrivateSolDeposit(testUserId, 1.0, "usdc_kamino")
      ).rejects.toThrow("Use executePrivateUsdcDeposit for USDC");
    });
  });

  // ==================== USDC Privacy Deposit ====================

  describe("USDC Privacy Deposit", () => {
    it("should deposit USDC to privacy pool", async () => {
      mockDepositSPL.mockResolvedValue({ tx: "spl-deposit-tx", fee: 0.01 });

      const result = await service.depositUsdcToPrivacyPool(100);

      expect(mockDepositSPL).toHaveBeenCalledWith(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        100
      );
      expect(result.tx).toBe("spl-deposit-tx");
    });

    it("should execute full private USDC deposit flow", async () => {
      mockWithdrawSPL.mockResolvedValue({ tx: "spl-withdraw-tx" });
      mockUsdcBuildDeposit.mockResolvedValue({
        transaction: "kamino-deposit-tx-base64",
        message: "Deposit 100 USDC",
      });

      const result = await service.executePrivateUsdcDeposit(
        testUserId,
        testWallet,
        100
      );

      // Step 1: Withdraw USDC from pool to user wallet
      expect(mockWithdrawSPL).toHaveBeenCalledWith(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        100,
        testWallet
      );
      // Step 2: Build Kamino deposit tx
      expect(mockUsdcBuildDeposit).toHaveBeenCalledWith(testWallet, 100);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe("kamino-deposit-tx-base64");
      expect(result.privacyPoolTx).toBe("spl-withdraw-tx");
    });
  });

  // ==================== SOL Privacy Withdrawal ====================

  describe("SOL Privacy Withdrawal", () => {
    it("should reject USDC vault type for SOL withdrawal", async () => {
      await expect(
        service.executePrivateSolWithdraw(testUserId, 1.0, "usdc_kamino", testWallet)
      ).rejects.toThrow("Use executePrivateUsdcWithdraw for USDC");
    });

    it("should execute full private SOL withdrawal flow", async () => {
      // Mock: build withdraw tx
      mockYieldBuildWithdraw.mockResolvedValue({
        transaction: Buffer.alloc(100).toString("base64"),
        estimatedSolOut: 0.99,
      });
      // Mock: deposit SOL to pool
      mockDepositSOL.mockResolvedValue({ tx: "deposit-to-pool-tx" });
      // Mock: withdraw from pool to user (net of fee)
      mockWithdrawSOL.mockResolvedValue({ tx: "pool-to-user-tx" });
      // Mock: confirm withdrawal
      mockYieldConfirmWithdraw.mockResolvedValue({
        success: true,
        shareId: "share-456",
      });

      const result = await service.executePrivateSolWithdraw(
        testUserId,
        0.5,
        "sol_jito",
        testWallet
      );

      // Step 1: Build and send withdraw tx (LST → SOL)
      expect(mockYieldBuildWithdraw).toHaveBeenCalledWith(testUserId, 0.5, "sol_jito");
      // Step 2: Deposit received SOL into Privacy Pool
      expect(mockDepositSOL).toHaveBeenCalledWith(0.99);
      // Step 3: Withdraw from pool to user wallet (minus fee)
      expect(mockWithdrawSOL).toHaveBeenCalled();
      const withdrawArgs = mockWithdrawSOL.mock.calls[0];
      expect(withdrawArgs[0]).toBeLessThan(0.99); // net of fee
      expect(withdrawArgs[1]).toBe(testWallet);
      // Step 4: Confirm
      expect(result.success).toBe(true);
      expect(result.privacyPoolTx).toBe("pool-to-user-tx");
    });
  });

  // ==================== USDC Privacy Withdrawal ====================

  describe("USDC Privacy Withdrawal", () => {
    it("should build private USDC withdraw tx (step 1)", async () => {
      mockUsdcBuildWithdraw.mockResolvedValue({
        transaction: "kamino-withdraw-base64",
        estimatedUsdcOut: 99.5,
      });

      const result = await service.buildPrivateUsdcWithdraw(testWallet, 100);

      expect(mockUsdcBuildWithdraw).toHaveBeenCalledWith(testWallet, 100);
      expect(result.transaction).toBe("kamino-withdraw-base64");
    });

    it("should confirm private USDC withdrawal with pool routing", async () => {
      mockUsdcConfirmWithdraw.mockResolvedValue({
        success: true,
        shareId: "share-789",
      });
      mockDepositSPL.mockResolvedValue({ tx: "usdc-to-pool-tx" });
      mockWithdrawSPL.mockResolvedValue({ tx: "pool-to-user-usdc-tx" });

      const result = await service.confirmPrivateUsdcWithdraw(
        "tx-signature-abc",
        testUserId,
        100,
        testWallet
      );

      // Step 1: Confirm Kamino withdrawal
      expect(mockUsdcConfirmWithdraw).toHaveBeenCalledWith(
        "tx-signature-abc",
        testUserId,
        100
      );
      // Step 2: Deposit USDC into pool
      expect(mockDepositSPL).toHaveBeenCalledWith(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        100
      );
      // Step 3: Withdraw from pool to user (minus fee)
      expect(mockWithdrawSPL).toHaveBeenCalled();
      const withdrawArgs = mockWithdrawSPL.mock.calls[0];
      expect(withdrawArgs[1]).toBeLessThan(100); // net of fee
      expect(withdrawArgs[2]).toBe(testWallet);

      expect(result.success).toBe(true);
      expect(result.shareId).toBe("share-789");
      expect(result.privacyPoolTx).toBe("pool-to-user-usdc-tx");
    });
  });
});
