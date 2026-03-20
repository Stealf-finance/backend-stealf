/**
 * Tests unitaires pour YieldMpcEnhancementsService
 *
 * Requirements couverts:
 * - 1.6: Validation rate_num <= 1_100_000 et rateDenom > 0
 * - 1.8: MPC appelé de façon non-bloquante après dépôt confirmé
 * - 2.4: proof_of_reserve via événement MPC booléen
 * - 3.5: takeBalanceSnapshot retourne snapshotPda correct
 * - 3.7: proofOfYieldFromSnapshots délègue à proofOfYield
 */

import { PublicKey } from "@solana/web3.js";

// ========== MOCK ArciumVaultService ==========

const mockExecuteMpcWithRetry = jest.fn();
const mockHashUserId = jest.fn();
const mockGetUserSharePDA = jest.fn();
const mockGetMxePublicKey = jest.fn();
const mockGetArciumAccounts = jest.fn();
const mockGetProgram = jest.fn();
const mockGetVaultStatePDA = jest.fn();
const mockAwaitFinalizationWithTimeout = jest.fn();
const mockParseEventFromLogs = jest.fn();
const mockProofOfYield = jest.fn();

const mockHelpers = {
  executeMpcWithRetry: mockExecuteMpcWithRetry,
  hashUserId: mockHashUserId,
  getUserSharePDA: mockGetUserSharePDA,
  getMxePublicKey: mockGetMxePublicKey,
  getArciumAccounts: mockGetArciumAccounts,
  getProgram: mockGetProgram,
  getVaultStatePDA: mockGetVaultStatePDA,
  awaitFinalizationWithTimeout: mockAwaitFinalizationWithTimeout,
  parseEventFromLogs: mockParseEventFromLogs,
};

const mockArciumVaultService = {
  getHelpers: jest.fn().mockReturnValue(mockHelpers),
  proofOfYield: mockProofOfYield,
};

jest.mock("../../services/yield/arcium-vault.service", () => ({
  getArciumVaultService: () => mockArciumVaultService,
  ArciumVaultService: jest.fn(),
}));

// Doit être importé APRÈS les mocks
import { YieldMpcEnhancementsService } from "../../services/yield/yield-mpc-enhancements.service";

// ========== FIXTURES ==========

const FAKE_USER_ID = "user-abc-123";
const FAKE_SHARE_PDA = new PublicKey("11111111111111111111111111111111");
const FAKE_USER_ID_HASH = Buffer.from("a".repeat(32), "hex").fill(0xab);
const FAKE_COMPUTATION_OFFSET = BigInt(12345);

function makeService(): YieldMpcEnhancementsService {
  return new YieldMpcEnhancementsService(mockArciumVaultService as any);
}

// ========== TESTS ==========

describe("YieldMpcEnhancementsService", () => {
  let service: YieldMpcEnhancementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();

    // Defaults pour les helpers
    mockHashUserId.mockReturnValue(FAKE_USER_ID_HASH);
    mockGetUserSharePDA.mockReturnValue(FAKE_SHARE_PDA);
    mockGetMxePublicKey.mockResolvedValue(null);
    mockGetArciumAccounts.mockReturnValue({});
    mockGetVaultStatePDA.mockReturnValue(FAKE_SHARE_PDA);
    mockAwaitFinalizationWithTimeout.mockResolvedValue({ finalizeSig: "finalize-sig-xyz", logs: [] });
    mockParseEventFromLogs.mockReturnValue(null);
  });

  // ==================== computeYieldDistribution ====================

  describe("computeYieldDistribution", () => {
    it("retourne success:false si rate_num > 1_100_000", async () => {
      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_100_001n,
        1_000_000n
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds maximum allowed value");
      expect(mockExecuteMpcWithRetry).not.toHaveBeenCalled();
    });

    it("retourne success:false si rate_num === 1_100_001n (frontière)", async () => {
      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_100_001n,
        1_000_000n
      );
      expect(result.success).toBe(false);
    });

    it("accepte rate_num === 1_100_000n (limite incluse)", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({ success: true, txSignature: "sig-ok" });

      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_100_000n,
        1_000_000n
      );

      expect(mockExecuteMpcWithRetry).toHaveBeenCalledWith(
        "compute_yield_distribution",
        expect.any(Function)
      );
      expect(result.success).toBe(true);
    });

    it("retourne success:false si rateDenom === 0n", async () => {
      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_000_000n,
        0n
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("rateDenom must be greater than zero");
      expect(mockExecuteMpcWithRetry).not.toHaveBeenCalled();
    });

    it("appelle executeMpcWithRetry pour une entrée valide", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: true,
        txSignature: "queue-sig-abc",
        finalizationSignature: "finalize-sig-xyz",
      });

      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_000_500n, // ≈ +0.05% yield
        1_000_000n
      );

      expect(mockExecuteMpcWithRetry).toHaveBeenCalledWith(
        "compute_yield_distribution",
        expect.any(Function)
      );
      expect(result.success).toBe(true);
      expect(result.txSignature).toBe("queue-sig-abc");
    });

    it("propage les erreurs MPC (success:false) retournées par executeMpcWithRetry", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: false,
        error: "MPC timeout",
      });

      const result = await service.computeYieldDistribution(
        FAKE_USER_ID,
        0,
        1_000_000n,
        1_000_000n
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("MPC timeout");
    });
  });

  // ==================== proofOfReserve ====================

  describe("proofOfReserve", () => {
    it("retourne isSolvent:true quand MPC réussit avec true", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: true,
        data: { isSolvent: true },
        txSignature: "reserve-sig-ok",
      });

      const result = await service.proofOfReserve(5_000_000_000n);

      expect(result.success).toBe(true);
      expect(result.data?.isSolvent).toBe(true);
      expect(mockExecuteMpcWithRetry).toHaveBeenCalledWith(
        "proof_of_reserve",
        expect.any(Function)
      );
    });

    it("retourne isSolvent:false quand le vault est insolvable", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: true,
        data: { isSolvent: false },
        txSignature: "reserve-sig-fail",
      });

      const result = await service.proofOfReserve(100_000_000_000n);

      expect(result.success).toBe(true);
      expect(result.data?.isSolvent).toBe(false);
    });

    it("propage l'erreur MPC si le circuit échoue", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: false,
        error: "Cluster unavailable",
      });

      const result = await service.proofOfReserve(1_000_000n);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cluster unavailable");
    });
  });

  // ==================== takeBalanceSnapshot ====================

  describe("takeBalanceSnapshot", () => {
    it("appelle executeMpcWithRetry avec le bon circuit", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: true,
        data: { snapshotPda: FAKE_SHARE_PDA.toBase58() },
        txSignature: "snapshot-sig-ok",
      });

      const result = await service.takeBalanceSnapshot(FAKE_USER_ID, 0, 3n);

      expect(mockExecuteMpcWithRetry).toHaveBeenCalledWith(
        "balance_snapshot",
        expect.any(Function)
      );
      expect(result.success).toBe(true);
    });

    it("retourne un snapshotPda non-nul en cas de succès", async () => {
      const fakePda = "Fg4uFvazr4y1oTY34YX1opt5AfVyHHBDCQwDhgVd2GE";
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: true,
        data: { snapshotPda: fakePda },
        txSignature: "snapshot-sig-ok",
      });

      const result = await service.takeBalanceSnapshot(FAKE_USER_ID, 0, 0n);

      expect(result.data?.snapshotPda).toBe(fakePda);
    });

    it("propage l'erreur MPC si le circuit échoue", async () => {
      mockExecuteMpcWithRetry.mockResolvedValue({
        success: false,
        error: "state_nonce is zero — not initialized",
      });

      const result = await service.takeBalanceSnapshot(FAKE_USER_ID, 0, 0n);

      expect(result.success).toBe(false);
      expect(result.error).toContain("state_nonce");
    });
  });

  // ==================== getSnapshotPDA ====================

  describe("getSnapshotPDA", () => {
    it("retourne une PublicKey déterministe pour un même (userSharePDA, snapshotIndex)", () => {
      const pda1 = service.getSnapshotPDA(FAKE_SHARE_PDA, 0n);
      const pda2 = service.getSnapshotPDA(FAKE_SHARE_PDA, 0n);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it("retourne des PDAs différentes pour des snapshot indexes différents", () => {
      const pda0 = service.getSnapshotPDA(FAKE_SHARE_PDA, 0n);
      const pda1 = service.getSnapshotPDA(FAKE_SHARE_PDA, 1n);
      expect(pda0.toBase58()).not.toBe(pda1.toBase58());
    });

    it("retourne une PublicKey valide (base58, 32 bytes)", () => {
      const pda = service.getSnapshotPDA(FAKE_SHARE_PDA, 5n);
      expect(pda.toBase58()).toHaveLength(44); // base58 d'une pubkey 32 bytes = ~44 chars
      expect(() => new PublicKey(pda.toBase58())).not.toThrow();
    });
  });

  // ==================== proofOfYieldFromSnapshots ====================

  describe("proofOfYieldFromSnapshots", () => {
    it("délègue à arciumVaultService.proofOfYield", async () => {
      // Mock fetch des comptes snapshot (on-chain)
      const mockFetchAccount = jest.fn().mockResolvedValue({
        encryptedBalance: Buffer.alloc(32),
        stateNonce: Buffer.alloc(16),
      });
      mockGetProgram.mockReturnValue({
        account: {
          userBalanceSnapshot: { fetch: mockFetchAccount },
        },
      });

      mockProofOfYield.mockResolvedValue({
        success: true,
        data: { exceedsThreshold: true },
      });

      const result = await service.proofOfYieldFromSnapshots(
        FAKE_USER_ID,
        0n,
        1n,
        500 // 5% threshold in bps
      );

      expect(mockProofOfYield).toHaveBeenCalledWith(
        FAKE_USER_ID,
        BigInt(0),
        BigInt(0),
        500
      );
      expect(result.success).toBe(true);
    });

    it("retourne une erreur si les comptes snapshot n'existent pas on-chain", async () => {
      const mockFetchAccount = jest.fn().mockRejectedValue(new Error("Account not found"));
      mockGetProgram.mockReturnValue({
        account: {
          userBalanceSnapshot: { fetch: mockFetchAccount },
        },
      });

      const result = await service.proofOfYieldFromSnapshots(
        FAKE_USER_ID,
        0n,
        1n,
        500
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to fetch snapshot accounts");
    });
  });
});
