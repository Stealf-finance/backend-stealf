import { Request, Response } from "express";
import { z } from "zod";
import { getYieldService } from "../services/yield/yield.service";
import { getUsdcYieldService } from "../services/yield/usdc-yield.service";
import { getPrivacyYieldService } from "../services/yield/privacy-yield.service";
import { getAutoSweepService } from "../services/yield/auto-sweep.service";
import { getArciumVaultService, isArciumEnabled } from "../services/yield/arcium-vault.service";
import { confirmPrivateDepositArcium } from "../services/yield/private-sol.service";
import { getBatchStakingService } from "../services/yield/batch-staking.service";

// --- Zod schemas ---

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

const proofOfYieldSchema = z.object({
  vaultType: z.enum(VAULT_TYPES),
  thresholdBps: z.coerce.number().int().min(0).max(10000),
});

const autoSweepConfigSchema = z.object({
  enabled: z.boolean(),
  interval: z.enum(["daily", "weekly"]).optional(),
  minYield: z.number().positive().optional(),
  vaultType: z.enum(["sol_jito", "sol_marinade"]).optional(),
});

// --- Controller ---

export class YieldController {
  static async deposit(req: Request, res: Response) {
    try {
      const parsed = depositSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const userPublicKey = req.user?.publicKey;
      if (!userPublicKey) {
        return res.status(400).json({ error: "User public key not found" });
      }

      const { amount, vaultType, private: isPrivate } = parsed.data;

      // --- Private mode: route through privacy flow ---
      if (isPrivate) {
        if (vaultType === "usdc_kamino") {
          const privacyService = getPrivacyYieldService();
          const result = await privacyService.executePrivateUsdcDeposit(
            userId,
            userPublicKey,
            amount
          );
          return res.status(200).json(result);
        } else {
          // SOL private deposit: authority-indirection (Phase 1).
          // User signs user→authority TX, backend does authority→vault at /confirm.
          // Arcium MPC recording happens non-blocking at confirm step.
          const yieldService = getYieldService();
          const result = await yieldService.buildPrivateDepositTransaction(
            userPublicKey,
            amount
          );
          return res.status(200).json(result);
        }
      }

      // --- Standard mode ---
      let result;
      if (vaultType === "usdc_kamino") {
        const usdcService = getUsdcYieldService();
        result = await usdcService.buildDepositTransaction(
          userPublicKey,
          amount
        );
      } else {
        const yieldService = getYieldService();
        result = await yieldService.buildDepositTransaction(
          userPublicKey,
          amount,
          vaultType
        );
      }

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("YieldController.deposit error:", error);
      return res.status(error.message?.includes("Minimum") ? 422 : 500).json({
        error: error.message || "Failed to build deposit transaction",
      });
    }
  }

  static async withdraw(req: Request, res: Response) {
    try {
      const parsed = withdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const userPublicKey = req.user?.publicKey;
      const { amount, vaultType, private: isPrivate } = parsed.data;

      // --- Private mode: authority-indirection withdrawal ---
      if (isPrivate) {
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }

        if (vaultType === "usdc_kamino") {
          const privacyService = getPrivacyYieldService();
          const result = await privacyService.buildPrivateUsdcWithdraw(
            userPublicKey,
            amount
          );
          return res.status(200).json(result);
        } else {
          // SOL private withdraw: Arcium balance verify → vault→authority→user
          const lamports = BigInt(Math.round(amount * 1e9));
          const arciumService = isArciumEnabled() ? getArciumVaultService() : null;

          // Arcium: verify encrypted balance before executing the withdrawal.
          // If MPC returns sufficient=false → reject. If MPC is unavailable → continue
          // (don't block user withdrawal because of an Arcium outage).
          // NOTE: when sufficient=true the circuit already decrements the on-chain
          // encrypted_balance. If the SOL withdrawal below fails, the encrypted balance
          // will be stale until the next deposit. Phase 3 will fix this with
          // verify_withdrawal_v2 (check-only) + record_withdrawal (post-confirmation).
          if (arciumService) {
            try {
              const verifyResult = await arciumService.verifyWithdrawal(userId, lamports);
              if (verifyResult.success && verifyResult.data?.sufficient === false) {
                return res.status(422).json({
                  error: "Insufficient encrypted balance",
                  sufficient: false,
                });
              }
            } catch (err: any) {
              console.error("[Arcium] verifyWithdrawal failed (continuing):", err.message);
            }
          }

          const yieldService = getYieldService();
          const result = await yieldService.executePrivateWithdraw(
            userId,
            amount,
            vaultType,
            userPublicKey
          );

          // Arcium: update encrypted global total (non-blocking)
          arciumService?.updateEncryptedTotal(lamports, false).catch((err: any) => {
            console.error("[Arcium] updateEncryptedTotal (withdraw) failed:", err.message);
          });

          return res.status(200).json({ ...result, sufficient: true });
        }
      }

      // --- Standard mode ---
      let result;
      if (vaultType === "usdc_kamino") {
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }
        const usdcService = getUsdcYieldService();
        result = await usdcService.buildWithdrawTransaction(
          userPublicKey,
          amount
        );
      } else {
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }
        const yieldService = getYieldService();
        result = await yieldService.buildWithdrawTransaction(
          userId,
          amount,
          vaultType,
          userPublicKey
        );
      }

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("YieldController.withdraw error:", error);
      const statusCode = error.message?.includes("Insufficient")
        ? 422
        : error.message?.includes("Slippage")
          ? 422
          : 500;
      return res.status(statusCode).json({
        error: error.message || "Failed to build withdrawal transaction",
      });
    }
  }

  static async confirm(req: Request, res: Response) {
    try {
      const parsed = confirmSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { signature, type, vaultType, amount, private: isPrivate } = parsed.data;

      // --- Private confirm for SOL deposit (full Arcium flow) ---
      if (isPrivate && type === "deposit" && vaultType !== "usdc_kamino") {
        if (!amount) {
          return res.status(400).json({
            error: "amount is required for private SOL deposit confirmation",
          });
        }
        const userPublicKey = req.user?.publicKey;
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }

        // Confirm with denomination splitting:
        // TX1 verified, then one authority→vault TX per standard denomination.
        // Staking is deferred — BatchStakingService handles it asynchronously.
        const result = await confirmPrivateDepositArcium(
          signature,
          userId,
          vaultType,
          amount,
          userPublicKey
        );

        // Non-blocking background: ensureUserShare → sequential recordDeposit per
        // denomination (sequential = critical: state_nonce must be updated between calls)
        // → batch staking per denomination → updateEncryptedTotal
        if (isArciumEnabled()) {
          const arciumService = getArciumVaultService();
          const batchService = getBatchStakingService();
          const { denominationsUsed, shareIds, totalDeposited } = result;

          (async () => {
            try {
              await arciumService.ensureUserShare(userId);
            } catch (err: any) {
              console.error("[Arcium] ensureUserShare failed:", err.message);
              return;
            }

            for (let i = 0; i < denominationsUsed.length; i++) {
              const lamports = BigInt(Math.round(denominationsUsed[i] * 1e9));

              // Arcium: encrypt this denomination into on-chain balance
              try {
                await arciumService.recordDeposit(userId, lamports);
              } catch (err: any) {
                console.error(
                  `[Arcium] recordDeposit ${denominationsUsed[i]} SOL failed:`,
                  err.message
                );
              }

              // BatchStaking: defer Jito/Marinade staking with random delay
              try {
                await batchService.addToBatch(userId, lamports, vaultType, shareIds[i]);
              } catch (err: any) {
                console.error("[BatchStaking] addToBatch failed:", err.message);
              }
            }

            // Update encrypted global total after all denominations recorded
            const totalLamports = BigInt(Math.round(totalDeposited * 1e9));
            arciumService.updateEncryptedTotal(totalLamports, true).catch((err: any) => {
              console.error("[Arcium] updateEncryptedTotal (deposit) failed:", err.message);
            });
          })();
        }

        return res.status(200).json(result);
      }

      // --- Private confirm for USDC withdrawal ---
      if (isPrivate && type === "withdraw" && vaultType === "usdc_kamino") {
        if (!amount) {
          return res.status(400).json({
            error: "amount is required for private USDC withdrawal confirmation",
          });
        }
        const userPublicKey = req.user?.publicKey;
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }

        const privacyService = getPrivacyYieldService();
        const result = await privacyService.confirmPrivateUsdcWithdraw(
          signature,
          userId,
          amount,
          userPublicKey
        );
        return res.status(200).json(result);
      }

      // --- Standard confirm ---
      let result;

      if (vaultType === "usdc_kamino") {
        if (!amount) {
          return res.status(400).json({
            error: "amount is required for USDC confirmation",
          });
        }
        const usdcService = getUsdcYieldService();
        if (type === "deposit") {
          result = await usdcService.confirmDeposit(
            signature,
            userId,
            amount
          );
        } else {
          result = await usdcService.confirmWithdraw(
            signature,
            userId,
            amount
          );
        }
      } else {
        const yieldService = getYieldService();
        if (type === "deposit") {
          result = await yieldService.confirmDeposit(
            signature,
            userId,
            vaultType
          );
        } else {
          if (!amount) {
            return res.status(400).json({
              error: "amount is required for withdraw confirmation",
            });
          }
          result = await yieldService.confirmWithdraw(
            signature,
            userId,
            vaultType,
            amount
          );
        }
      }

      return res.status(200).json(result);
    } catch (error: any) {
      console.error("YieldController.confirm error:", error);
      return res.status(500).json({
        error: error.message || "Failed to confirm transaction",
      });
    }
  }

  static async getBalance(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const [solBalance, usdcBalance] = await Promise.all([
        getYieldService().getBalance(userId),
        getUsdcYieldService().getBalance(userId),
      ]);

      return res.status(200).json({
        sol: solBalance,
        usdc: usdcBalance,
      });
    } catch (error: any) {
      console.error("YieldController.getBalance error:", error);
      return res.status(500).json({
        error: error.message || "Failed to get balance",
      });
    }
  }

  static async getAPY(_req: Request, res: Response) {
    try {
      const [solApy, usdcApy] = await Promise.all([
        getYieldService().getAPYRates(),
        getUsdcYieldService().getSupplyAPY(),
      ]);

      return res.status(200).json({
        ...solApy,
        usdcKaminoApy: usdcApy,
      });
    } catch (error: any) {
      console.error("YieldController.getAPY error:", error);
      return res.status(500).json({
        error: error.message || "Failed to get APY rates",
      });
    }
  }

  static async getDashboard(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const [solDashboard, usdcBalance, usdcApy] = await Promise.all([
        getYieldService().getDashboard(userId),
        getUsdcYieldService().getBalance(userId),
        getUsdcYieldService().getSupplyAPY(),
      ]);

      return res.status(200).json({
        ...solDashboard,
        apy: {
          ...solDashboard.apy,
          usdcKaminoApy: usdcApy,
        },
        usdc: usdcBalance,
      });
    } catch (error: any) {
      console.error("YieldController.getDashboard error:", error);
      return res.status(500).json({
        error: error.message || "Failed to get dashboard",
      });
    }
  }

  // --- Auto-Sweep ---

  static async getAutoSweepConfig(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const sweepService = getAutoSweepService();
      const config = await sweepService.getConfig(userId);
      return res.status(200).json(config);
    } catch (error: any) {
      console.error("YieldController.getAutoSweepConfig error:", error);
      return res.status(500).json({
        error: error.message || "Failed to get auto-sweep config",
      });
    }
  }

  static async updateAutoSweepConfig(req: Request, res: Response) {
    try {
      const parsed = autoSweepConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const sweepService = getAutoSweepService();
      await sweepService.configure(userId, parsed.data);

      return res.status(200).json({ success: true, ...parsed.data });
    } catch (error: any) {
      console.error("YieldController.updateAutoSweepConfig error:", error);
      return res.status(500).json({
        error: error.message || "Failed to update auto-sweep config",
      });
    }
  }

  // --- Arcium Proof of Yield ---

  static async proofOfYield(req: Request, res: Response) {
    try {
      const parsed = proofOfYieldSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { vaultType, thresholdBps } = parsed.data;

      if (!isArciumEnabled()) {
        return res.status(503).json({
          error: "Arcium MPC is not enabled. Set ARCIUM_ENABLED=true to use proof of yield.",
        });
      }

      // Get user's current balance and total deposited from off-chain ledger
      const yieldService = getYieldService();
      const balance = await yieldService.getBalance(userId);

      if (!vaultType.startsWith("sol_") || !balance || balance.currentValue <= 0) {
        return res.status(422).json({
          error: "No yield data available for this vault type",
        });
      }

      // If balance < totalDeposited (loss scenario), yield is 0 — skip MPC to avoid
      // u64 underflow in the Arcis circuit (balance - deposited wraps around).
      if (!balance.totalDeposited || balance.currentValue < balance.totalDeposited) {
        return res.status(200).json({
          exceedsThreshold: false,
          thresholdBps,
          vaultType,
        });
      }

      // Convert SOL amounts to lamports for the MPC circuit
      const balanceLamports = BigInt(Math.round(balance.currentValue * 1e9));
      const depositedLamports = BigInt(Math.round(balance.totalDeposited * 1e9));

      const arciumService = getArciumVaultService();
      const result = await arciumService.proofOfYield(
        userId,
        balanceLamports,
        depositedLamports,
        thresholdBps
      );

      if (!result.success) {
        return res.status(503).json({
          error: "MPC computation unavailable",
          details: result.error,
        });
      }

      return res.status(200).json({
        exceedsThreshold: result.data?.exceedsThreshold,
        thresholdBps,
        vaultType,
      });
    } catch (error: any) {
      console.error("YieldController.proofOfYield error:", error);
      return res.status(503).json({
        error: "Proof of yield service temporarily unavailable",
      });
    }
  }
}
