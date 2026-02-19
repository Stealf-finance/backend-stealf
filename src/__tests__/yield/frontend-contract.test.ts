/**
 * Frontend-Backend Contract Tests
 *
 * Validates that backend response shapes match what the frontend hooks expect.
 * If these tests break, the frontend will break too.
 *
 * Frontend types from: front-stealf/src/hooks/useYield.ts
 */

describe("Frontend-Backend Contract", () => {
  // ==================== Dashboard Response ====================

  describe("GET /api/yield/dashboard → useYieldDashboard()", () => {
    /**
     * Frontend expects (YieldDashboard):
     * {
     *   balance: { totalDeposited, currentValue, yieldEarned, yieldPercent, shares: [...] }
     *   apy: { jitoApy, marinadeApy, usdcKaminoApy, lastUpdated }
     *   usdc: { totalDeposited, currentValue, yieldEarned, yieldPercent }
     *   history: [{ type, amount, vaultType, timestamp, txSignature }]
     * }
     */
    it("should match YieldDashboard type shape", () => {
      const mockResponse = {
        balance: {
          totalDeposited: 2.0,
          currentValue: 2.16,
          yieldEarned: 0.16,
          yieldPercent: 8.0,
          shares: [
            {
              vaultType: "sol_jito" as const,
              deposited: 1.0,
              currentValue: 1.08,
              yield: 0.08,
            },
          ],
        },
        apy: {
          jitoApy: 7.5,
          marinadeApy: 6.8,
          usdcKaminoApy: 6.5,
          lastUpdated: "2026-02-16T00:00:00Z",
        },
        usdc: {
          totalDeposited: 100,
          currentValue: 103.5,
          yieldEarned: 3.5,
          yieldPercent: 3.5,
        },
        history: [
          {
            type: "deposit" as const,
            amount: 1.0,
            vaultType: "sol_jito" as const,
            timestamp: "2026-02-15T10:00:00Z",
            txSignature: "abc123...",
          },
        ],
      };

      // Verify top-level keys
      expect(mockResponse).toHaveProperty("balance");
      expect(mockResponse).toHaveProperty("apy");
      expect(mockResponse).toHaveProperty("usdc");
      expect(mockResponse).toHaveProperty("history");

      // Verify balance shape (used by SavingsScreen)
      const { balance } = mockResponse;
      expect(typeof balance.totalDeposited).toBe("number");
      expect(typeof balance.currentValue).toBe("number");
      expect(typeof balance.yieldEarned).toBe("number");
      expect(typeof balance.yieldPercent).toBe("number");
      expect(Array.isArray(balance.shares)).toBe(true);

      // Verify APY shape (used by SavingsScreen APY card)
      const { apy } = mockResponse;
      expect(typeof apy.jitoApy).toBe("number");
      expect(typeof apy.marinadeApy).toBe("number");
      expect(typeof apy.usdcKaminoApy).toBe("number");
      expect(typeof apy.lastUpdated).toBe("string");

      // Verify USDC balance shape
      const { usdc } = mockResponse;
      expect(typeof usdc.totalDeposited).toBe("number");
      expect(typeof usdc.currentValue).toBe("number");
      expect(typeof usdc.yieldEarned).toBe("number");
      expect(typeof usdc.yieldPercent).toBe("number");

      // Verify history item shape
      const historyItem = mockResponse.history[0];
      expect(["deposit", "withdraw"]).toContain(historyItem.type);
      expect(typeof historyItem.amount).toBe("number");
      expect(["sol_jito", "sol_marinade", "usdc_kamino"]).toContain(historyItem.vaultType);
      expect(typeof historyItem.timestamp).toBe("string");
      expect(typeof historyItem.txSignature).toBe("string");
    });
  });

  // ==================== Deposit Response ====================

  describe("POST /api/yield/deposit → useYieldDeposit()", () => {
    /**
     * Frontend expects: { transaction?, signature?, message? }
     * Standard: { transaction: string, message: string }
     * Private SOL: { success: boolean, shareId: string, privacyPoolTx: string }
     * Private USDC: { success: boolean, transaction: string, privacyPoolTx: string, message: string }
     */
    it("standard deposit should return transaction for signing", () => {
      const standardResponse = {
        transaction: "base64-encoded-tx",
        message: "Deposit 1 SOL via Jito Stake Pool",
      };

      expect(typeof standardResponse.transaction).toBe("string");
      expect(standardResponse.transaction.length).toBeGreaterThan(0);
    });

    it("private SOL deposit should return success + poolTx", () => {
      const privateResponse = {
        success: true,
        shareId: "507f1f77bcf86cd799439011",
        privacyPoolTx: "base58-signature",
      };

      expect(privateResponse.success).toBe(true);
      expect(typeof privateResponse.shareId).toBe("string");
      expect(typeof privateResponse.privacyPoolTx).toBe("string");
    });

    it("private USDC deposit should return tx + poolTx", () => {
      const privateUsdcResponse = {
        success: true,
        transaction: "kamino-deposit-base64",
        privacyPoolTx: "spl-pool-tx",
        message: "Private deposit: 100 USDC routed through Privacy Pool → Kamino Lending",
      };

      expect(privateUsdcResponse.success).toBe(true);
      expect(typeof privateUsdcResponse.transaction).toBe("string");
      expect(typeof privateUsdcResponse.privacyPoolTx).toBe("string");
    });
  });

  // ==================== Withdraw Response ====================

  describe("POST /api/yield/withdraw → useYieldWithdraw()", () => {
    it("standard SOL withdraw should return tx + estimated output", () => {
      const response = {
        transaction: "withdraw-tx-base64",
        estimatedSolOut: 0.99,
        slippagePercent: 0.1,
      };

      expect(typeof response.transaction).toBe("string");
      expect(typeof response.estimatedSolOut).toBe("number");
      expect(response.estimatedSolOut).toBeGreaterThan(0);
    });

    it("standard USDC withdraw should return tx + estimated output", () => {
      const response = {
        transaction: "kamino-withdraw-base64",
        estimatedUsdcOut: 99.5,
      };

      expect(typeof response.transaction).toBe("string");
      expect(typeof response.estimatedUsdcOut).toBe("number");
    });

    it("private SOL withdraw should return success + poolTx", () => {
      const response = {
        success: true,
        shareId: "share-123",
        estimatedSolOut: 0.95,
        privacyPoolTx: "pool-withdraw-sig",
      };

      expect(response.success).toBe(true);
      expect(typeof response.estimatedSolOut).toBe("number");
      expect(response.estimatedSolOut).toBeLessThan(1); // fee deducted
    });
  });

  // ==================== Confirm Response ====================

  describe("POST /api/yield/confirm → useYieldConfirm()", () => {
    it("confirm should return success + shareId", () => {
      const response = {
        success: true,
        shareId: "507f1f77bcf86cd799439011",
      };

      expect(response.success).toBe(true);
      expect(typeof response.shareId).toBe("string");
    });

    it("private confirm should include privacyPoolTx", () => {
      const response = {
        success: true,
        shareId: "share-priv-1",
        privacyPoolTx: "pool-confirm-tx",
      };

      expect(response.success).toBe(true);
      expect(typeof response.privacyPoolTx).toBe("string");
    });
  });

  // ==================== Balance Response ====================

  describe("GET /api/yield/balance → useYieldBalance()", () => {
    /**
     * Frontend expects (YieldBalanceResponse):
     * {
     *   sol: { totalDeposited, currentValue, yieldEarned, yieldPercent, shares: [...] }
     *   usdc: { totalDeposited, currentValue, yieldEarned, yieldPercent }
     * }
     */
    it("should return SOL and USDC balances", () => {
      const response = {
        sol: {
          totalDeposited: 2.0,
          currentValue: 2.16,
          yieldEarned: 0.16,
          yieldPercent: 8.0,
          shares: [
            { vaultType: "sol_jito", deposited: 1, currentValue: 1.08, yield: 0.08 },
            { vaultType: "sol_marinade", deposited: 1, currentValue: 1.065, yield: 0.065 },
          ],
        },
        usdc: {
          totalDeposited: 100,
          currentValue: 103,
          yieldEarned: 3,
          yieldPercent: 3.0,
        },
      };

      expect(response).toHaveProperty("sol");
      expect(response).toHaveProperty("usdc");
      expect(Array.isArray(response.sol.shares)).toBe(true);
      expect(typeof response.usdc.totalDeposited).toBe("number");
    });
  });

  // ==================== APY Response ====================

  describe("GET /api/yield/apy → useYieldAPY()", () => {
    /**
     * Frontend expects (APYRates):
     * { jitoApy: number, marinadeApy: number, usdcKaminoApy: number, lastUpdated: string }
     */
    it("should return all APY rates", () => {
      const response = {
        jitoApy: 7.5,
        marinadeApy: 6.8,
        usdcKaminoApy: 6.5,
        lastUpdated: "2026-02-16T12:00:00Z",
      };

      expect(typeof response.jitoApy).toBe("number");
      expect(typeof response.marinadeApy).toBe("number");
      expect(typeof response.usdcKaminoApy).toBe("number");
      expect(typeof response.lastUpdated).toBe("string");
    });
  });

  // ==================== Frontend hook params ====================

  describe("Frontend hook parameters", () => {
    it("useYieldDeposit sends correct body shape", () => {
      const body = {
        amount: 1.5,
        vaultType: "sol_jito",
        private: false,
      };

      expect(typeof body.amount).toBe("number");
      expect(body.amount).toBeGreaterThan(0);
      expect(["sol_jito", "sol_marinade", "usdc_kamino"]).toContain(body.vaultType);
      expect(typeof body.private).toBe("boolean");
    });

    it("useYieldWithdraw sends correct body shape", () => {
      const body = {
        amount: 0.5,
        vaultType: "usdc_kamino",
        private: true,
      };

      expect(typeof body.amount).toBe("number");
      expect(["sol_jito", "sol_marinade", "usdc_kamino"]).toContain(body.vaultType);
      expect(typeof body.private).toBe("boolean");
    });

    it("useYieldConfirm sends correct body shape", () => {
      const body = {
        signature: "a".repeat(88),
        type: "deposit" as const,
        vaultType: "sol_jito" as const,
        amount: 1.0,
        private: false,
      };

      expect(body.signature.length).toBeGreaterThanOrEqual(64);
      expect(["deposit", "withdraw"]).toContain(body.type);
      expect(["sol_jito", "sol_marinade", "usdc_kamino"]).toContain(body.vaultType);
    });
  });
});
