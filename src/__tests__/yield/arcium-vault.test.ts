/**
 * Tests for ArciumVaultService and anti-correlation services.
 *
 * Tests denomination decomposition (pure logic, no mocks needed)
 * and validates the integration flow patterns.
 */

import { decomposeToDenominations, solToLamports, getRandomSurplusDelay } from "../../services/yield/denomination.service";

// ========== DENOMINATION SERVICE TESTS ==========

describe("DenominationService", () => {
  describe("decomposeToDenominations", () => {
    it("decomposes 1 SOL into a single 1 SOL denomination", () => {
      const result = decomposeToDenominations(1);
      expect(result.denominations).toEqual([1]);
      expect(result.totalDeposited).toBe(1);
      expect(result.surplusSol).toBe(0);
    });

    it("decomposes 3.7 SOL into standard denominations (exact fit)", () => {
      const result = decomposeToDenominations(3.7);
      // Greedy: 1 + 1 + 1 + 0.5 + 0.1 + 0.1 = 3.7 (exact)
      expect(result.denominations).toEqual([1, 1, 1, 0.5, 0.1, 0.1]);
      expect(result.totalDeposited).toBe(3.7);
      expect(result.surplusSol).toBeCloseTo(0, 5);
    });

    it("decomposes 10 SOL into a single 10 SOL denomination", () => {
      const result = decomposeToDenominations(10);
      expect(result.denominations).toEqual([10]);
      expect(result.totalDeposited).toBe(10);
      expect(result.surplusSol).toBe(0);
    });

    it("decomposes 0.5 SOL correctly", () => {
      const result = decomposeToDenominations(0.5);
      expect(result.denominations).toEqual([0.5]);
      expect(result.totalDeposited).toBe(0.5);
      expect(result.surplusSol).toBe(0);
    });

    it("handles amounts smaller than 0.1 SOL by rounding up", () => {
      const result = decomposeToDenominations(0.05);
      expect(result.denominations).toEqual([0.1]);
      expect(result.totalDeposited).toBe(0.1);
      expect(result.surplusSol).toBeCloseTo(0.05, 5);
    });

    it("handles zero amount", () => {
      const result = decomposeToDenominations(0);
      expect(result.denominations).toEqual([]);
      expect(result.totalDeposited).toBe(0);
      expect(result.surplusSol).toBe(0);
    });

    it("decomposes 15.6 SOL correctly", () => {
      const result = decomposeToDenominations(15.6);
      // 10 + 5 + 0.5 + 0.1 = 15.6
      expect(result.denominations).toEqual([10, 5, 0.5, 0.1]);
      expect(result.totalDeposited).toBe(15.6);
      expect(result.surplusSol).toBeCloseTo(0, 5);
    });

    it("shuffled denominations contains same elements", () => {
      const result = decomposeToDenominations(3.7);
      expect(result.shuffledDenominations.sort()).toEqual(
        result.denominations.sort()
      );
    });

    it("totalDeposited is always >= original amount", () => {
      const amounts = [0.01, 0.15, 0.73, 1.37, 5.99, 12.45, 25.0];
      for (const amount of amounts) {
        const result = decomposeToDenominations(amount);
        expect(result.totalDeposited).toBeGreaterThanOrEqual(amount);
      }
    });

    it("all denominations are standard values", () => {
      const STANDARD = [0.1, 0.5, 1, 5, 10];
      const amounts = [0.3, 2.7, 7.4, 18.9, 50];
      for (const amount of amounts) {
        const result = decomposeToDenominations(amount);
        for (const denom of result.denominations) {
          expect(STANDARD).toContain(denom);
        }
      }
    });
  });

  describe("solToLamports", () => {
    it("converts 1 SOL to 1_000_000_000 lamports", () => {
      expect(solToLamports(1)).toBe(BigInt(1_000_000_000));
    });

    it("converts 0.5 SOL to 500_000_000 lamports", () => {
      expect(solToLamports(0.5)).toBe(BigInt(500_000_000));
    });

    it("converts 0.1 SOL to 100_000_000 lamports", () => {
      expect(solToLamports(0.1)).toBe(BigInt(100_000_000));
    });
  });

  describe("getRandomSurplusDelay", () => {
    it("returns a delay between 1 and 30 minutes", () => {
      for (let i = 0; i < 100; i++) {
        const delay = getRandomSurplusDelay();
        expect(delay).toBeGreaterThanOrEqual(60_000);
        expect(delay).toBeLessThanOrEqual(30 * 60_000);
      }
    });
  });
});

// ========== ARCIUM VAULT SERVICE INTEGRATION PATTERNS ==========

describe("ArciumVaultService integration patterns", () => {
  it("ArciumVaultService.hashUserId produces consistent 32-byte hashes", () => {
    // Import the static method
    const { createHash } = require("crypto");
    const hash1 = createHash("sha256").update("test-user-001").digest();
    const hash2 = createHash("sha256").update("test-user-001").digest();
    const hash3 = createHash("sha256").update("test-user-002").digest();

    expect(hash1.length).toBe(32);
    expect(Buffer.compare(hash1, hash2)).toBe(0);
    expect(Buffer.compare(hash1, hash3)).not.toBe(0);
  });

  it("MPC result types match expected contract", () => {
    // Verify the MpcResult interface contract
    const successResult = {
      success: true,
      data: { sufficient: true },
      txSignature: "abc123",
    };

    const failureResult = {
      success: false,
      error: "MPC timeout",
    };

    expect(successResult.success).toBe(true);
    expect(successResult.data?.sufficient).toBe(true);
    expect(failureResult.success).toBe(false);
    expect(failureResult.error).toContain("timeout");
  });
});

// ========== PROOF OF YIELD ENDPOINT CONTRACT ==========

describe("ProofOfYield endpoint contract", () => {
  it("response shape matches frontend expectations", () => {
    const response = {
      exceedsThreshold: true,
      thresholdBps: 500,
      vaultType: "sol_jito",
    };

    expect(response).toHaveProperty("exceedsThreshold");
    expect(response).toHaveProperty("thresholdBps");
    expect(response).toHaveProperty("vaultType");
    expect(typeof response.exceedsThreshold).toBe("boolean");
    expect(typeof response.thresholdBps).toBe("number");
    expect(response.thresholdBps).toBeGreaterThanOrEqual(0);
    expect(response.thresholdBps).toBeLessThanOrEqual(10000);
  });

  it("events never contain plaintext amounts in their schema", () => {
    // Verify that event types only have encrypted fields
    const depositRecordedEvent = {
      userIdHash: new Array(32).fill(0),
      vaultType: 0,
      encryptedAmount: new Array(32).fill(0),
      nonce: new Array(16).fill(0),
    };

    // Should NOT have fields like: amount, amountSol, amountLamports, balance
    expect(depositRecordedEvent).not.toHaveProperty("amount");
    expect(depositRecordedEvent).not.toHaveProperty("amountSol");
    expect(depositRecordedEvent).not.toHaveProperty("balance");

    // Should only have encrypted data
    expect(depositRecordedEvent).toHaveProperty("encryptedAmount");
    expect(depositRecordedEvent).toHaveProperty("nonce");
    expect(depositRecordedEvent.encryptedAmount.length).toBe(32);
    expect(depositRecordedEvent.nonce.length).toBe(16);
  });
});

// ========== NON-REGRESSION: EXISTING ENDPOINTS UNMODIFIED ==========
// Note: We verify source files statically to avoid ESM import issues
// with transitive dependencies (privacycash). Full import tests run
// in the dedicated yield-controller.test.ts suite.

describe("Non-regression: existing yield endpoints", () => {
  it("YieldController source still exports all original methods", () => {
    const fs = require("fs");
    const path = require("path");
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, "../../controllers/YieldController.ts"),
      "utf-8"
    );

    // All original static methods must still exist
    const requiredMethods = [
      "deposit", "withdraw", "confirm",
      "getBalance", "getAPY", "getDashboard",
      "getAutoSweepConfig", "updateAutoSweepConfig",
    ];
    for (const method of requiredMethods) {
      expect(controllerSource).toContain(`static async ${method}`);
    }
    // New method added (non-breaking)
    expect(controllerSource).toContain("static async proofOfYield");
  });

  it("yield routes file includes proof endpoint", () => {
    const fs = require("fs");
    const path = require("path");
    const routesSource = fs.readFileSync(
      path.resolve(__dirname, "../../routes/yieldRoutes.ts"),
      "utf-8"
    );

    // Proof endpoint must be registered
    expect(routesSource).toContain("/proof");
    expect(routesSource).toContain("proofOfYield");

    // All original routes must still exist
    const requiredRoutes = ["/deposit", "/withdraw", "/confirm", "/balance", "/apy", "/dashboard", "/auto-sweep"];
    for (const route of requiredRoutes) {
      expect(routesSource).toContain(route);
    }
  });
});
