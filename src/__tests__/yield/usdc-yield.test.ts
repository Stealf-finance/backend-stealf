/**
 * Tests for UsdcYieldService (Kamino Lending)
 *
 * Validates: balance tracking, FIFO withdrawal, APY caching, VaultShare CRUD.
 */

// --- Mocks ---

jest.mock("../../config/redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue("OK"),
  },
}));

jest.mock("../../services/socket/socketService", () => ({
  getSocketService: () => ({
    emitPrivateTransferUpdate: jest.fn(),
  }),
}));

const mockVaultShareCreate = jest.fn();
const mockVaultShareFind = jest.fn();

jest.mock("../../models/VaultShare", () => ({
  VaultShare: {
    create: (...args: any[]) => mockVaultShareCreate(...args),
    find: (...args: any[]) => {
      const result = mockVaultShareFind(...args);
      return {
        ...result,
        sort: jest.fn().mockReturnValue(result),
        then: (resolve: any) => Promise.resolve(result).then(resolve),
      };
    },
  },
}));

// Mock Kamino SDK — we don't test the SDK itself, just our logic around it
jest.mock("@kamino-finance/klend-sdk", () => ({
  KaminoMarket: {
    load: jest.fn().mockResolvedValue({
      loadReserves: jest.fn(),
      getReserves: jest.fn().mockReturnValue([
        {
          getLiquidityMint: () => "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          stats: { supplyInterestAPY: 0.065 },
        },
      ]),
    }),
  },
  KaminoAction: {
    buildDepositTxns: jest.fn().mockResolvedValue({
      setupIxs: [],
      lendingIxs: [],
      cleanupIxs: [],
    }),
    buildWithdrawTxns: jest.fn().mockResolvedValue({
      setupIxs: [],
      lendingIxs: [],
      cleanupIxs: [],
    }),
  },
  VanillaObligation: jest.fn(),
  PROGRAM_ID: "KLend2g3cP87ber8bPNXJaNKEBpV2Mj6YEExFMqNx8F",
}));

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: "mock-blockhash",
        lastValidBlockHeight: 1000,
      }),
      getTransaction: jest.fn().mockResolvedValue({
        meta: { err: null },
      }),
    })),
  };
});

// Use a non-devnet URL so the devnet guard doesn't activate in unit tests
process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
process.env.VAULT_SHARES_ENCRYPTION_KEY = "a".repeat(64);

// Import after mocks
import { getUsdcYieldService } from "../../services/yield/usdc-yield.service";

// --- Tests ---

describe("UsdcYieldService", () => {
  const service = getUsdcYieldService();
  const testUserId = "507f1f77bcf86cd799439011";
  const testWallet = "DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Balance ====================

  describe("Balance", () => {
    it("should return zero balance for user with no shares", async () => {
      mockVaultShareFind.mockResolvedValue([]);

      const balance = await service.getBalance(testUserId);
      expect(balance.totalDeposited).toBe(0);
      expect(balance.currentValue).toBe(0);
      expect(balance.yieldEarned).toBe(0);
      expect(balance.yieldPercent).toBe(0);
    });

    it("should calculate balance with yield for active shares", async () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      mockVaultShareFind.mockResolvedValue([
        {
          depositAmountLamports: 100_000_000, // 100 USDC in base units
          sharesAmount: 100_000_000,
          depositTimestamp: oneWeekAgo,
          status: "active",
        },
      ]);

      const balance = await service.getBalance(testUserId);
      expect(balance.totalDeposited).toBeCloseTo(100, 0);
      // With ~6.5% APY over 1 week, yield should be small but positive
      expect(balance.currentValue).toBeGreaterThan(100);
      expect(balance.yieldEarned).toBeGreaterThan(0);
      expect(balance.yieldPercent).toBeGreaterThan(0);
    });

    it("should aggregate multiple shares", async () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      mockVaultShareFind.mockResolvedValue([
        {
          depositAmountLamports: 50_000_000,
          sharesAmount: 50_000_000,
          depositTimestamp: twoWeeksAgo,
          status: "active",
        },
        {
          depositAmountLamports: 50_000_000,
          sharesAmount: 50_000_000,
          depositTimestamp: twoWeeksAgo,
          status: "active",
        },
      ]);

      const balance = await service.getBalance(testUserId);
      expect(balance.totalDeposited).toBeCloseTo(100, 0);
      expect(balance.currentValue).toBeGreaterThan(100);
    });
  });

  // ==================== Confirm Deposit ====================

  describe("Confirm Deposit", () => {
    it("should create VaultShare on confirmed deposit", async () => {
      mockVaultShareCreate.mockResolvedValue({
        _id: { toString: () => "share-usdc-1" },
      });

      const result = await service.confirmDeposit("tx-sig-1", testUserId, 100);

      expect(mockVaultShareCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          vaultType: "usdc_kamino",
          sharesAmount: 100_000_000,
          depositAmountLamports: 100_000_000,
          depositRate: 1.0,
          status: "active",
          txSignature: "tx-sig-1",
        })
      );
      expect(result.success).toBe(true);
      expect(result.shareId).toBe("share-usdc-1");
    });
  });

  // ==================== Confirm Withdraw (FIFO) ====================

  describe("Confirm Withdraw - FIFO", () => {
    it("should fully withdraw a single share", async () => {
      const mockShare: Record<string, any> = {
        _id: { toString: () => "share-1" },
        sharesAmount: 100_000_000,
        depositAmountLamports: 100_000_000,
        depositRate: 1.0,
        depositTimestamp: new Date(),
        txSignature: "orig-tx",
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockVaultShareFind.mockResolvedValue([mockShare]);

      const result = await service.confirmWithdraw("withdraw-sig", testUserId, 100);

      expect(mockShare.status).toBe("withdrawn");
      expect(mockShare.withdrawTxSignature).toBe("withdraw-sig");
      expect(mockShare.save).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should partially withdraw using FIFO", async () => {
      const mockShare = {
        _id: { toString: () => "share-big" },
        sharesAmount: 200_000_000, // 200 USDC
        depositAmountLamports: 200_000_000,
        depositRate: 1.0,
        depositTimestamp: new Date(),
        txSignature: "orig-tx",
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockVaultShareFind.mockResolvedValue([mockShare]);
      mockVaultShareCreate.mockResolvedValue({
        _id: { toString: () => "partial-share" },
      });

      const result = await service.confirmWithdraw("withdraw-sig", testUserId, 50);

      // Original share should have reduced amount
      expect(mockShare.sharesAmount).toBe(150_000_000);
      expect(mockShare.save).toHaveBeenCalled();
      // Partial withdrawn share should be created
      expect(mockVaultShareCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sharesAmount: 50_000_000,
          status: "withdrawn",
          withdrawTxSignature: "withdraw-sig",
        })
      );
      expect(result.success).toBe(true);
    });

    it("should handle FIFO across multiple shares", async () => {
      const share1 = {
        _id: { toString: () => "share-a" },
        sharesAmount: 30_000_000,
        depositAmountLamports: 30_000_000,
        depositRate: 1.0,
        depositTimestamp: new Date(Date.now() - 86400000),
        txSignature: "tx-a",
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };
      const share2 = {
        _id: { toString: () => "share-b" },
        sharesAmount: 70_000_000,
        depositAmountLamports: 70_000_000,
        depositRate: 1.0,
        depositTimestamp: new Date(),
        txSignature: "tx-b",
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockVaultShareFind.mockResolvedValue([share1, share2]);
      mockVaultShareCreate.mockResolvedValue({
        _id: { toString: () => "partial-b" },
      });

      await service.confirmWithdraw("withdraw-sig", testUserId, 50);

      // share1 fully withdrawn (30 USDC)
      expect(share1.status).toBe("withdrawn");
      expect(share1.save).toHaveBeenCalled();
      // share2 partially withdrawn (20 USDC out of 70)
      expect(share2.sharesAmount).toBe(50_000_000);
      expect(share2.save).toHaveBeenCalled();
    });
  });

  // ==================== APY ====================

  describe("Supply APY", () => {
    it("should return APY from Kamino reserve stats", async () => {
      const apy = await service.getSupplyAPY();
      // Mock returns supplyInterestAPY: 0.065 → 6.5%
      expect(apy).toBeCloseTo(6.5, 0);
    });

    it("should use cached APY when available", async () => {
      const redis = require("../../config/redis").default;
      redis.get.mockResolvedValueOnce("7.2");

      const apy = await service.getSupplyAPY();
      expect(apy).toBe(7.2);
    });
  });
});
