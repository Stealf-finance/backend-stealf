/**
 * Tests TDD pour le service lending Kamino collatéralisé
 *
 * Couverture :
 * - 2.1 : Builders de transactions et calcul de position
 * - 2.2 : Confirmation on-chain, persistance LoanPosition, taux marché
 *
 * Approche : les tests sont écrits AVANT l'implémentation (RED phase).
 * Les mocks couvrent : SDK Kamino, API Jupiter, Redis, LoanPosition model.
 */

// ===== MOCKS =====

// Mock Redis
jest.mock("../../config/redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue("OK"),
  },
}));

// Mock Socket.io
jest.mock("../../services/socket/socketService", () => ({
  getSocketService: () => ({
    emitPrivateTransferUpdate: jest.fn(),
    emit: jest.fn(),
  }),
}));

// Mock Solana Connection
const mockGetTransaction = jest.fn();
const mockGetLatestBlockhash = jest.fn().mockResolvedValue({
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 9999,
});
const mockGetSlot = jest.fn().mockResolvedValue(123456789n);

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getTransaction: mockGetTransaction,
      getLatestBlockhash: mockGetLatestBlockhash,
      getSlot: mockGetSlot,
    })),
  };
});

// Mock Kamino SDK
const mockBuildDepositTxns = jest.fn();
const mockBuildBorrowTxns = jest.fn();
const mockBuildRepayTxns = jest.fn();
const mockBuildWithdrawTxns = jest.fn();
const mockLoadReserves = jest.fn();
const mockGetReserves = jest.fn();
const mockKaminoMarketLoad = jest.fn();

const mockKaminoAction = {
  setupIxs: [],
  lendingIxs: [],
  cleanupIxs: [],
  computeBudgetIxs: [],
};

jest.mock("@kamino-finance/klend-sdk", () => ({
  KaminoMarket: {
    load: (...args: any[]) => mockKaminoMarketLoad(...args),
  },
  KaminoAction: {
    buildDepositTxns: (...args: any[]) => mockBuildDepositTxns(...args),
    buildBorrowTxns: (...args: any[]) => mockBuildBorrowTxns(...args),
    buildRepayTxns: (...args: any[]) => mockBuildRepayTxns(...args),
    buildWithdrawTxns: (...args: any[]) => mockBuildWithdrawTxns(...args),
  },
  VanillaObligation: jest.fn().mockImplementation(() => ({})),
  PROGRAM_ID: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
}));

// Mock axios — Jupiter Lite Price API
jest.mock("axios", () => ({
  get: jest.fn(),
}));

// Mock LoanPosition model
const mockLoanPositionCreate = jest.fn();
const mockLoanPositionFindOne = jest.fn();
const mockLoanPositionFind = jest.fn();
const mockLoanPositionSave = jest.fn();

jest.mock("../../models/LoanPosition", () => ({
  LoanPosition: {
    create: (...args: any[]) => mockLoanPositionCreate(...args),
    findOne: (...args: any[]) => mockLoanPositionFindOne(...args),
    find: (...args: any[]) => mockLoanPositionFind(...args),
  },
  getLoanPositionModel: () => ({
    create: (...args: any[]) => mockLoanPositionCreate(...args),
    findOne: (...args: any[]) => mockLoanPositionFindOne(...args),
    find: (...args: any[]) => mockLoanPositionFind(...args),
  }),
}));

// ===== IMPORTS (après les mocks) =====

import axios from "axios";
import { getLendingService } from "../../services/lending/lending.service";

// ===== SETUP =====

const SOL_PRICE_USD = 185.42;
const USER_PUBLIC_KEY = "Hq7TGnspJfMFKn6bRkf3J6Y5YJQdHVhHBkPeqmM1uzYq";
const USER_ID = "507f1f77bcf86cd799439011";

const mockMarket = {
  loadReserves: mockLoadReserves,
  getReserves: mockGetReserves,
};

beforeEach(() => {
  jest.clearAllMocks();

  // Setup par défaut : Kamino market disponible (mainnet)
  process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
  process.env.VAULT_SHARES_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  mockKaminoMarketLoad.mockResolvedValue(mockMarket);
  mockLoadReserves.mockResolvedValue(undefined);
  mockGetReserves.mockReturnValue([]);

  mockBuildDepositTxns.mockResolvedValue(mockKaminoAction);
  mockBuildBorrowTxns.mockResolvedValue(mockKaminoAction);
  mockBuildRepayTxns.mockResolvedValue(mockKaminoAction);
  mockBuildWithdrawTxns.mockResolvedValue(mockKaminoAction);

  // Jupiter prix SOL
  (axios.get as jest.Mock).mockResolvedValue({
    data: {
      data: {
        So11111111111111111111111111111111111111112: {
          price: SOL_PRICE_USD,
        },
      },
    },
  });

  const redis = require("../../config/redis").default;
  redis.get.mockResolvedValue(null);
  redis.setex.mockResolvedValue("OK");
});

// ===== SUITE 2.1 : BUILDERS DE TRANSACTIONS =====

describe("LendingService — builders de transactions", () => {
  // ---- buildDepositCollateralTx ----

  describe("buildDepositCollateralTx", () => {
    it("retourne une transaction base64 et une obligationAddress", async () => {
      const service = getLendingService();
      const result = await service.buildDepositCollateralTx(USER_PUBLIC_KEY, 1.0);

      expect(result).toHaveProperty("transaction");
      expect(typeof result.transaction).toBe("string");
      expect(result.transaction.length).toBeGreaterThan(0);
      expect(result).toHaveProperty("obligationAddress");
      expect(typeof result.obligationAddress).toBe("string");
    });

    it("rejette les montants inférieurs à 0.1 SOL", async () => {
      const service = getLendingService();
      await expect(
        service.buildDepositCollateralTx(USER_PUBLIC_KEY, 0.05)
      ).rejects.toThrow(/0\.1 SOL/i);
    });

    it("rejette les montants nuls ou négatifs", async () => {
      const service = getLendingService();
      await expect(
        service.buildDepositCollateralTx(USER_PUBLIC_KEY, 0)
      ).rejects.toThrow();
      await expect(
        service.buildDepositCollateralTx(USER_PUBLIC_KEY, -1)
      ).rejects.toThrow();
    });

    it("lance une erreur explicite sur devnet", async () => {
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
      const service = getLendingService();
      await expect(
        service.buildDepositCollateralTx(USER_PUBLIC_KEY, 1.0)
      ).rejects.toThrow(/devnet/i);
    });
  });

  // ---- buildBorrowTx ----

  describe("buildBorrowTx", () => {
    beforeEach(() => {
      // Position active : 2 SOL collateral, 0 emprunté
      mockLoanPositionFindOne.mockResolvedValue({
        _id: "pos123",
        collateralLamports: 2_000_000_000,
        borrowedUsdcBaseUnits: 0,
        status: "active",
        save: mockLoanPositionSave,
      });
    });

    it("calcule maxBorrowable = collateral × prix × 0.75", async () => {
      const service = getLendingService();
      // 2 SOL × 185.42 × 0.75 = 278.13 USDC
      const result = await service.buildBorrowTx(USER_PUBLIC_KEY, USER_ID, 100);
      expect(result).toHaveProperty("maxBorrowable");
      const expected = 2 * SOL_PRICE_USD * 0.75;
      expect(result.maxBorrowable).toBeCloseTo(expected, 0);
    });

    it("retourne une transaction base64", async () => {
      const service = getLendingService();
      const result = await service.buildBorrowTx(USER_PUBLIC_KEY, USER_ID, 100);
      expect(result).toHaveProperty("transaction");
      expect(typeof result.transaction).toBe("string");
      expect(result.transaction.length).toBeGreaterThan(0);
    });

    it("rejette si montant demandé > maxBorrowable", async () => {
      const service = getLendingService();
      // 2 SOL × 185.42 × 0.75 ≈ 278 USDC — demander 500 doit échouer
      await expect(
        service.buildBorrowTx(USER_PUBLIC_KEY, USER_ID, 500)
      ).rejects.toThrow(/maxBorrowable|LTV|insuffisant/i);
    });

    it("lance une erreur explicite sur devnet", async () => {
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
      const service = getLendingService();
      await expect(
        service.buildBorrowTx(USER_PUBLIC_KEY, USER_ID, 10)
      ).rejects.toThrow(/devnet/i);
    });
  });

  // ---- buildRepayTx ----

  describe("buildRepayTx", () => {
    beforeEach(() => {
      mockLoanPositionFindOne.mockResolvedValue({
        _id: "pos123",
        collateralLamports: 2_000_000_000,
        borrowedUsdcBaseUnits: 100_000_000, // 100 USDC
        status: "active",
        save: mockLoanPositionSave,
      });
    });

    it("retourne une transaction base64", async () => {
      const service = getLendingService();
      const result = await service.buildRepayTx(USER_PUBLIC_KEY, USER_ID, 50);
      expect(result).toHaveProperty("transaction");
      expect(typeof result.transaction).toBe("string");
      expect(result.transaction.length).toBeGreaterThan(0);
    });

    it("plafonne le montant à borrowedUsdcBaseUnits si supérieur", async () => {
      const service = getLendingService();
      // Doit rembourser max 100 USDC même si on demande 200
      const result = await service.buildRepayTx(USER_PUBLIC_KEY, USER_ID, 200);
      expect(result.amountUsdc).toBeCloseTo(100, 1);
    });

    it("lance une erreur explicite sur devnet", async () => {
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
      const service = getLendingService();
      await expect(
        service.buildRepayTx(USER_PUBLIC_KEY, USER_ID, 50)
      ).rejects.toThrow(/devnet/i);
    });
  });

  // ---- buildWithdrawCollateralTx ----

  describe("buildWithdrawCollateralTx", () => {
    it("retourne une transaction base64 si aucun emprunt actif", async () => {
      mockLoanPositionFindOne.mockResolvedValue({
        _id: "pos123",
        collateralLamports: 2_000_000_000,
        borrowedUsdcBaseUnits: 0,
        status: "active",
        save: mockLoanPositionSave,
      });
      const service = getLendingService();
      const result = await service.buildWithdrawCollateralTx(USER_PUBLIC_KEY, USER_ID, 1.0);
      expect(result).toHaveProperty("transaction");
      expect(typeof result.transaction).toBe("string");
    });

    it("rejette si un emprunt est encore actif", async () => {
      mockLoanPositionFindOne.mockResolvedValue({
        _id: "pos123",
        collateralLamports: 2_000_000_000,
        borrowedUsdcBaseUnits: 50_000_000, // 50 USDC encore actif
        status: "active",
        save: mockLoanPositionSave,
      });
      const service = getLendingService();
      await expect(
        service.buildWithdrawCollateralTx(USER_PUBLIC_KEY, USER_ID, 1.0)
      ).rejects.toThrow(/emprunt|borrow/i);
    });

    it("lance une erreur explicite sur devnet", async () => {
      process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
      const service = getLendingService();
      await expect(
        service.buildWithdrawCollateralTx(USER_PUBLIC_KEY, USER_ID, 1.0)
      ).rejects.toThrow(/devnet/i);
    });
  });
});

// ===== SUITE 2.2 : CONFIRMATION, PERSISTANCE ET TAUX =====

describe("LendingService — confirmation et persistance", () => {
  const validTxInfo = {
    meta: { err: null },
    transaction: { message: { accountKeys: [] } },
  };

  // ---- confirmLendingAction : collateral ----

  describe("confirmLendingAction — action collateral", () => {
    it("crée un LoanPosition après transaction on-chain confirmée", async () => {
      mockGetTransaction.mockResolvedValue(validTxInfo);
      mockLoanPositionCreate.mockResolvedValue({
        _id: "newpos123",
        status: "active",
      });

      const service = getLendingService();
      const result = await service.confirmLendingAction(
        "sig123",
        USER_ID,
        "collateral",
        1_000_000_000
      );

      expect(mockLoanPositionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          collateralLamports: 1_000_000_000,
          borrowedUsdcBaseUnits: 0,
          status: "active",
        })
      );
      expect(result.success).toBe(true);
      expect(result).toHaveProperty("positionId");
    });

    it("rejette et ne modifie pas la DB si la transaction on-chain échoue", async () => {
      mockGetTransaction.mockResolvedValue({
        meta: { err: { InstructionError: [0, "Custom"] } },
      });

      const service = getLendingService();
      await expect(
        service.confirmLendingAction("sig_fail", USER_ID, "collateral", 1_000_000_000)
      ).rejects.toThrow(/on-chain|échoué|failed/i);

      expect(mockLoanPositionCreate).not.toHaveBeenCalled();
    });

    it("rejette si la transaction est introuvable", async () => {
      mockGetTransaction.mockResolvedValue(null);

      const service = getLendingService();
      await expect(
        service.confirmLendingAction("sig_missing", USER_ID, "collateral", 1_000_000_000)
      ).rejects.toThrow(/introuvable|not found/i);

      expect(mockLoanPositionCreate).not.toHaveBeenCalled();
    });
  });

  // ---- confirmLendingAction : borrow ----

  describe("confirmLendingAction — action borrow", () => {
    it("met à jour borrowedUsdcBaseUnits après confirmation emprunt", async () => {
      mockGetTransaction.mockResolvedValue(validTxInfo);
      const mockSave = jest.fn().mockResolvedValue(undefined);
      mockLoanPositionFindOne.mockResolvedValue({
        _id: "pos123",
        borrowedUsdcBaseUnits: 0,
        save: mockSave,
      });

      const service = getLendingService();
      await service.confirmLendingAction("sig_borrow", USER_ID, "borrow", 50_000_000);

      expect(mockSave).toHaveBeenCalled();
    });
  });

  // ---- confirmLendingAction : repay ----

  describe("confirmLendingAction — action repay", () => {
    it("décrémente borrowedUsdcBaseUnits du montant remboursé", async () => {
      mockGetTransaction.mockResolvedValue(validTxInfo);
      const mockSave = jest.fn().mockResolvedValue(undefined);
      const mockPosition = {
        _id: "pos123",
        borrowedUsdcBaseUnits: 100_000_000,
        save: mockSave,
      };
      mockLoanPositionFindOne.mockResolvedValue(mockPosition);

      const service = getLendingService();
      await service.confirmLendingAction("sig_repay", USER_ID, "repay", 50_000_000);

      expect(mockPosition.borrowedUsdcBaseUnits).toBe(50_000_000);
      expect(mockSave).toHaveBeenCalled();
    });
  });
});

// ===== SUITE 2.2 : LECTURE DE POSITION =====

describe("LendingService — getPosition", () => {
  it("retourne une position vide si aucun LoanPosition actif", async () => {
    mockLoanPositionFindOne.mockResolvedValue(null);

    const service = getLendingService();
    const position = await service.getPosition(USER_ID);

    expect(position.collateralSol).toBe(0);
    expect(position.borrowedUsdc).toBe(0);
    expect(position.healthFactor).toBe(-1); // -1 = pas d'emprunt (Infinity n'est pas sérialisable JSON)
  });

  it("calcule correctement healthFactor et liquidationPrice", async () => {
    mockLoanPositionFindOne.mockResolvedValue({
      _id: "pos123",
      collateralLamports: 2_000_000_000, // 2 SOL
      borrowedUsdcBaseUnits: 200_000_000, // 200 USDC
      status: "active",
    });

    const service = getLendingService();
    const position = await service.getPosition(USER_ID);

    // healthFactor = (2 × 185.42 × 0.85) / 200 = 1.5760...
    const expectedHF = (2 * SOL_PRICE_USD * 0.85) / 200;
    expect(position.healthFactor).toBeCloseTo(expectedHF, 2);

    // liquidationPrice = 200 / (2 × 0.85) = 117.647...
    const expectedLiqPrice = 200 / (2 * 0.85);
    expect(position.liquidationPrice).toBeCloseTo(expectedLiqPrice, 1);
  });
});

// ===== SUITE 2.2 : TAUX DU MARCHÉ =====

describe("LendingService — getRates", () => {
  it("retourne les taux Kamino avec maxLtv et liquidationThreshold", async () => {
    const mockStats = {
      borrowInterestAPY: 0.08,
    };
    const mockUsdcReserve = {
      getLiquidityMint: () => "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      stats: mockStats,
    };
    mockGetReserves.mockReturnValue([mockUsdcReserve]);

    const service = getLendingService();
    const rates = await service.getRates();

    expect(rates).toHaveProperty("usdcBorrowApr");
    expect(rates).toHaveProperty("maxLtv", 0.75);
    expect(rates).toHaveProperty("liquidationThreshold", 0.85);
  });

  it("retourne les taux depuis le cache Redis si disponible", async () => {
    const redis = require("../../config/redis").default;
    redis.get.mockImplementation((key: string) => {
      if (key === "lending:rates") {
        return Promise.resolve(
          JSON.stringify({ usdcBorrowApr: 8.5, maxLtv: 0.75, liquidationThreshold: 0.85 })
        );
      }
      return Promise.resolve(null);
    });

    const service = getLendingService();
    const rates = await service.getRates();

    expect(rates.usdcBorrowApr).toBe(8.5);
    expect(mockKaminoMarketLoad).not.toHaveBeenCalled();
  });

  it("utilise le fallback usdcBorrowApr: 8.0 si le marché est indisponible", async () => {
    mockKaminoMarketLoad.mockRejectedValue(new Error("market unavailable"));

    const service = getLendingService();
    const rates = await service.getRates();

    expect(rates.usdcBorrowApr).toBe(8.0);
    expect(rates.maxLtv).toBe(0.75);
  });
});
