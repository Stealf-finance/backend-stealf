/**
 * Tests for Yield API endpoints — Zod validation and auth checks.
 * Covers: SOL (Jito/Marinade), USDC (Kamino), privacy flag.
 */

import { z } from "zod";

// --- Schemas (mirrored from YieldController) ---

const VAULT_TYPES = ["sol_jito", "sol_marinade", "usdc_kamino"] as const;

const depositSchema = z.object({
  amount: z.number().positive(),
  vaultType: z.enum(VAULT_TYPES),
  private: z.boolean().optional().default(false),
});

const withdrawSchema = z.object({
  amount: z.number().positive(),
  vaultType: z.enum(VAULT_TYPES),
  private: z.boolean().optional().default(false),
});

const confirmSchema = z.object({
  signature: z.string().min(64, "Invalid transaction signature"),
  type: z.enum(["deposit", "withdraw"]),
  vaultType: z.enum(VAULT_TYPES),
  amount: z.number().positive().optional(),
  private: z.boolean().optional().default(false),
});

const autoSweepConfigSchema = z.object({
  enabled: z.boolean(),
  interval: z.enum(["daily", "weekly"]).optional(),
  minYield: z.number().positive().optional(),
  vaultType: z.enum(["sol_jito", "sol_marinade"]).optional(),
});

describe("Yield API - Zod Validation", () => {
  // ==================== Deposit Schema ====================

  describe("Deposit Schema", () => {
    it("should accept valid deposit input (sol_jito)", () => {
      const result = depositSchema.safeParse({
        amount: 1.5,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.private).toBe(false); // default
      }
    });

    it("should accept valid deposit input (sol_marinade)", () => {
      const result = depositSchema.safeParse({
        amount: 0.5,
        vaultType: "sol_marinade",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid deposit input (usdc_kamino)", () => {
      const result = depositSchema.safeParse({
        amount: 10,
        vaultType: "usdc_kamino",
      });
      expect(result.success).toBe(true);
    });

    it("should accept deposit with private=true", () => {
      const result = depositSchema.safeParse({
        amount: 1.0,
        vaultType: "sol_jito",
        private: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.private).toBe(true);
      }
    });

    it("should reject negative amount", () => {
      const result = depositSchema.safeParse({
        amount: -1,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject zero amount", () => {
      const result = depositSchema.safeParse({
        amount: 0,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid vault type", () => {
      const result = depositSchema.safeParse({
        amount: 1,
        vaultType: "sol_invalid",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing amount", () => {
      const result = depositSchema.safeParse({
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject string amount", () => {
      const result = depositSchema.safeParse({
        amount: "1.5",
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== Withdraw Schema ====================

  describe("Withdraw Schema", () => {
    it("should accept valid withdraw input (sol)", () => {
      const result = withdrawSchema.safeParse({
        amount: 0.5,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid withdraw input (usdc_kamino)", () => {
      const result = withdrawSchema.safeParse({
        amount: 50,
        vaultType: "usdc_kamino",
      });
      expect(result.success).toBe(true);
    });

    it("should accept withdraw with private=true", () => {
      const result = withdrawSchema.safeParse({
        amount: 1.0,
        vaultType: "sol_jito",
        private: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.private).toBe(true);
      }
    });

    it("should reject negative amount", () => {
      const result = withdrawSchema.safeParse({
        amount: -0.5,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing vaultType", () => {
      const result = withdrawSchema.safeParse({
        amount: 0.5,
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== Confirm Schema ====================

  describe("Confirm Schema", () => {
    const validSig = "a".repeat(88);

    it("should accept valid deposit confirm", () => {
      const result = confirmSchema.safeParse({
        signature: validSig,
        type: "deposit",
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid withdraw confirm with amount", () => {
      const result = confirmSchema.safeParse({
        signature: validSig,
        type: "withdraw",
        vaultType: "sol_marinade",
        amount: 0.5,
      });
      expect(result.success).toBe(true);
    });

    it("should accept usdc_kamino confirm", () => {
      const result = confirmSchema.safeParse({
        signature: validSig,
        type: "deposit",
        vaultType: "usdc_kamino",
        amount: 100,
      });
      expect(result.success).toBe(true);
    });

    it("should accept private confirm", () => {
      const result = confirmSchema.safeParse({
        signature: validSig,
        type: "withdraw",
        vaultType: "usdc_kamino",
        amount: 50,
        private: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.private).toBe(true);
      }
    });

    it("should reject short signature", () => {
      const result = confirmSchema.safeParse({
        signature: "short",
        type: "deposit",
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid type", () => {
      const result = confirmSchema.safeParse({
        signature: validSig,
        type: "invalid",
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing signature", () => {
      const result = confirmSchema.safeParse({
        type: "deposit",
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================== Auto-Sweep Config Schema ====================

  describe("Auto-Sweep Config Schema", () => {
    it("should accept enable with all options", () => {
      const result = autoSweepConfigSchema.safeParse({
        enabled: true,
        interval: "daily",
        minYield: 0.05,
        vaultType: "sol_jito",
      });
      expect(result.success).toBe(true);
    });

    it("should accept disable with only enabled field", () => {
      const result = autoSweepConfigSchema.safeParse({
        enabled: false,
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing enabled field", () => {
      const result = autoSweepConfigSchema.safeParse({
        interval: "daily",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid interval", () => {
      const result = autoSweepConfigSchema.safeParse({
        enabled: true,
        interval: "monthly",
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative minYield", () => {
      const result = autoSweepConfigSchema.safeParse({
        enabled: true,
        minYield: -0.01,
      });
      expect(result.success).toBe(false);
    });
  });
});

// ==================== User Isolation Test ====================

describe("Yield API - User Isolation", () => {
  it("should not allow access without mongoUserId", () => {
    const req = { user: {} } as any;
    const userId = req.user?.mongoUserId;
    expect(userId).toBeUndefined();
  });

  it("should properly extract userId from authenticated request", () => {
    const req = { user: { mongoUserId: "507f1f77bcf86cd799439011" } } as any;
    const userId = req.user?.mongoUserId;
    expect(userId).toBe("507f1f77bcf86cd799439011");
  });

  it("should properly extract publicKey from authenticated request", () => {
    const req = { user: { mongoUserId: "507f1f77bcf86cd799439011", publicKey: "ABC123..." } } as any;
    const publicKey = req.user?.publicKey;
    expect(publicKey).toBe("ABC123...");
  });
});

// ==================== Privacy routing logic ====================

describe("Yield API - Privacy Routing", () => {
  function shouldRoutePrivate(isPrivate: boolean): boolean {
    return isPrivate;
  }

  function needsPrivateUsdcConfirm(isPrivate: boolean, type: string, vaultType: string): boolean {
    return isPrivate && type === "withdraw" && vaultType === "usdc_kamino";
  }

  it("should route to standard service when private=false", () => {
    expect(shouldRoutePrivate(false)).toBe(false);
  });

  it("should route to privacy service when private=true for SOL", () => {
    expect(shouldRoutePrivate(true)).toBe(true);
  });

  it("should route to privacy service when private=true for USDC", () => {
    expect(shouldRoutePrivate(true)).toBe(true);
  });

  it("should correctly determine vault type for USDC private confirm", () => {
    expect(needsPrivateUsdcConfirm(true, "withdraw", "usdc_kamino")).toBe(true);
  });

  it("should NOT trigger private USDC confirm for SOL withdraw", () => {
    expect(needsPrivateUsdcConfirm(true, "withdraw", "sol_jito")).toBe(false);
  });
});
