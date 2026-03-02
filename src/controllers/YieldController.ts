import { Request, Response } from "express";
import { z } from "zod";
import { getYieldService } from "../services/yield/yield.service";
import { getUsdcYieldService } from "../services/yield/usdc-yield.service";
import { getAutoSweepService } from "../services/yield/auto-sweep.service";
import { getArciumVaultService, isArciumEnabled } from "../services/yield/arcium-vault.service";
import { getYieldMpcEnhancementsService } from "../services/yield/yield-mpc-enhancements.service";
import { VaultShare } from "../models/VaultShare";
import { getTotalActiveDepositLamports } from "../services/yield/yield-rates.service";
import { confirmPrivateDepositArcium } from "../services/yield/private-sol.service";
import { getBatchStakingService } from "../services/yield/batch-staking.service";
import { stripProdError } from "../utils/logger";
import { awardPoints } from "../services/points.service";

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

// Schema for POST /api/yield/distribute-yield (admin trigger)
// All fields optional — endpoint auto-computes from exchange rates if absent.
// If provided, values are validated to prevent overflow and division-by-zero.
export const distributeYieldSchema = z.object({
  vaultType: z.enum(VAULT_TYPES).optional(),
  rateNum: z.number().int().positive().max(1_100_000).optional(),
  rateDenom: z.number().int().positive().optional(),
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
          return res.status(501).json({ error: "Private USDC deposits are not yet available" });
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
        error: stripProdError(error.message) || "Failed to build deposit transaction",
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
          return res.status(501).json({ error: "Private USDC withdrawals are not yet available" });
        } else {
          // SOL private withdraw: Arcium balance verify → vault→authority→user

          // --- Double-spend guard: atomically transition active → processing ---
          // Prevents two concurrent withdrawals from both decrementing the Arcium
          // encrypted balance and executing on-chain. The "processing" status may
          // remain stuck if the server crashes — a cleanup job (out of scope for beta)
          // should reset stale "processing" entries after a TTL.
          const processingShare = await VaultShare.findOneAndUpdate(
            { userId, vaultType, status: "active" },
            { $set: { status: "processing" } },
            { new: true }
          );
          if (!processingShare) {
            return res.status(409).json({
              success: false,
              error: "Withdraw already in progress or no active share found",
            });
          }

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
                // Rollback: restore share to "active" so user can retry
                await VaultShare.findByIdAndUpdate(processingShare._id, { $set: { status: "active" } });
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
          let result;
          try {
            result = await yieldService.executePrivateWithdraw(
              userId,
              amount,
              vaultType,
              userPublicKey
            );
          } catch (solErr: any) {
            // Rollback: restore share to "active" so user can retry
            await VaultShare.findByIdAndUpdate(processingShare._id, { $set: { status: "active" } });
            // SOL TX failed after verifyWithdrawal already decremented encrypted_balance.
            // Compensate by fire-and-forget recordDeposit to restore the on-chain state.
            if (arciumService) {
              arciumService.recordDeposit(userId, lamports).catch((compErr: any) => {
                console.error(
                  "[Arcium][CRITICAL] compensation recordDeposit failed after SOL TX failure:",
                  compErr.message
                );
              });
            }
            throw solErr;
          }

          // Arcium: update encrypted global total (non-blocking, only on success)
          arciumService?.updateEncryptedTotal(lamports, false).catch((err: any) => {
            console.error("[Arcium] updateEncryptedTotal (withdraw) failed:", err.message);
          });

          // Snapshot: record encrypted balance state after successful private withdraw
          if (arciumService) {
            (async () => {
              try {
                const share = await VaultShare.findOne({ userId, vaultType, status: "active" });
                const currentIndex = share?.snapshotIndex ?? 0;
                const newIndex = BigInt(currentIndex + 1);
                const vaultTypeNum = vaultType === "sol_jito" ? 0 : 1;
                const enhService = getYieldMpcEnhancementsService();
                const snapResult = await enhService.takeBalanceSnapshot(userId, vaultTypeNum, newIndex);
                if (snapResult.success && share) {
                  const usedIndex = snapResult.data?.usedIndex ?? currentIndex + 1;
                  await VaultShare.findByIdAndUpdate(share._id, { snapshotIndex: usedIndex });
                }
              } catch (err: any) {
                console.error("[Arcium] takeBalanceSnapshot (withdraw) failed:", err.message);
              }
            })();
          }

          const pointsEarned = await awardPoints(userId, 'yield withdrawal');
          return res.status(200).json({ ...result, sufficient: true, pointsEarned });
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
        error: stripProdError(error.message) || "Failed to build withdrawal transaction",
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

            // Snapshot: record encrypted balance state after all deposits
            try {
              const share = await VaultShare.findById(shareIds[0]);
              const currentIndex = share?.snapshotIndex ?? 0;
              const newIndex = BigInt(currentIndex + 1);
              const vaultTypeNum = vaultType === "sol_jito" ? 0 : 1;
              const enhService = getYieldMpcEnhancementsService();
              const snapResult = await enhService.takeBalanceSnapshot(userId, vaultTypeNum, newIndex);
              if (snapResult.success) {
                const usedIndex = snapResult.data?.usedIndex ?? currentIndex + 1;
                await VaultShare.updateMany(
                  { _id: { $in: shareIds } },
                  { snapshotIndex: usedIndex }
                );
              }
            } catch (err: any) {
              console.error("[Arcium] takeBalanceSnapshot (deposit) failed:", err.message);
            }
          })();
        }

        const pointsEarned = await awardPoints(userId, 'private deposit');
        return res.status(200).json({ ...result, pointsEarned });
      }

      // --- Private confirm for USDC withdrawal ---
      if (isPrivate && type === "withdraw" && vaultType === "usdc_kamino") {
        return res.status(501).json({ error: "Private USDC withdrawals are not yet available" });
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
          // Arcium: update encrypted global total (non-blocking, standard SOL withdraw)
          if (isArciumEnabled() && vaultType.startsWith("sol_")) {
            const lamports = BigInt(Math.round(amount * 1e9));
            getArciumVaultService().updateEncryptedTotal(lamports, false).catch((err: any) => {
              console.error("[Arcium] updateEncryptedTotal (std withdraw) failed:", err.message);
            });
          }
        }
      }

      const depositAction = type === 'deposit'
        ? (isPrivate ? 'private deposit' : 'standard deposit')
        : 'yield withdrawal';
      const pointsEarned = await awardPoints(userId, depositAction);
      return res.status(200).json({ ...result, pointsEarned });
    } catch (error: any) {
      console.error("YieldController.confirm error:", error);
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to confirm transaction",
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
        error: stripProdError(error.message) || "Failed to get balance",
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
      if (error.message === "APY_SERVICE_UNAVAILABLE") {
        return res.status(503).json({ error: "APY service temporarily unavailable" });
      }
      console.error("YieldController.getAPY error:", error);
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to get APY rates",
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
        error: stripProdError(error.message) || "Failed to get dashboard",
      });
    }
  }

  // --- Auto-Sweep ---

  static async getAutoSweepConfig(_req: Request, res: Response) {
    return res.status(501).json({ error: "Auto-sweep not yet implemented" });
  }

  static async updateAutoSweepConfig(_req: Request, res: Response) {
    return res.status(501).json({ error: "Auto-sweep not yet implemented" });
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

  // ========== PROOF OF RESERVE (permissionless) ==========

  static async proofOfReserve(req: Request, res: Response) {
    try {
      if (!isArciumEnabled()) {
        return res.status(503).json({
          error: "Arcium MPC is not enabled. Set ARCIUM_ENABLED=true.",
        });
      }

      // If threshold not provided, aggregate total deposited from active VaultShares
      let thresholdLamports: bigint;
      if (req.query.threshold !== undefined) {
        const parsed = Number(req.query.threshold);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Invalid threshold parameter" });
        }
        thresholdLamports = BigInt(Math.round(parsed));
      } else {
        thresholdLamports = await getTotalActiveDepositLamports();
      }

      const enhancementsService = getYieldMpcEnhancementsService();
      const result = await enhancementsService.proofOfReserve(thresholdLamports);

      if (!result.success) {
        return res.status(503).json({
          error: "MPC computation unavailable",
          details: result.error,
        });
      }

      return res.status(200).json({
        isSolvent: result.data?.isSolvent,
        threshold: thresholdLamports.toString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("YieldController.proofOfReserve error:", error);
      return res.status(500).json({
        error: "Proof of reserve service temporarily unavailable",
      });
    }
  }

  // ========== PROOF FROM SNAPSHOTS ==========

  static async proofFromSnapshots(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!isArciumEnabled()) {
        return res.status(503).json({
          error: "Arcium MPC is not enabled. Set ARCIUM_ENABLED=true.",
        });
      }

      const schema = z.object({
        startIndex: z.coerce.number().int().min(0),
        endIndex: z.coerce.number().int().min(1),
        thresholdBps: z.coerce.number().int().min(0).max(10000).default(100),
        vaultType: z.enum(["sol_jito", "sol_marinade"]).default("sol_jito"),
      }).refine((d) => d.endIndex > d.startIndex, {
        message: "endIndex must be greater than startIndex",
      });

      const parsed = schema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid parameters",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { startIndex, endIndex, thresholdBps } = parsed.data;
      const enhService = getYieldMpcEnhancementsService();
      const result = await enhService.proofOfYieldFromSnapshots(
        userId,
        BigInt(startIndex),
        BigInt(endIndex),
        thresholdBps
      );

      if (!result.success) {
        // Snapshot PDAs not found on-chain or MPC unavailable
        return res.status(200).json({ exceedsThreshold: null, available: false });
      }

      return res.status(200).json({
        exceedsThreshold: result.data?.exceedsThreshold ?? null,
        available: true,
        thresholdBps,
      });
    } catch (error: any) {
      console.error("YieldController.proofFromSnapshots error:", error);
      return res.status(500).json({ error: "Proof from snapshots temporarily unavailable" });
    }
  }

  // ========== BALANCE SNAPSHOTS ==========

  static async getSnapshots(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const vaultType = req.query.vaultType as string | undefined;
      const query: Record<string, any> = { userId, snapshotIndex: { $gt: 0 } };
      if (vaultType) query.vaultType = vaultType;

      const shares = await VaultShare.find(query)
        .select("_id vaultType snapshotIndex createdAt")
        .sort({ snapshotIndex: 1 })
        .lean();

      const snapshots = shares.map((s: any) => ({
        shareId: s._id.toString(),
        vaultType: s.vaultType,
        snapshotIndex: s.snapshotIndex,
        createdAt: s.createdAt,
      }));

      return res.status(200).json({ snapshots });
    } catch (error: any) {
      console.error("YieldController.getSnapshots error:", error);
      return res.status(500).json({ error: "Failed to fetch snapshots" });
    }
  }

  // ========== YIELD DISTRIBUTION (admin trigger) ==========

  static async distributeYield(req: Request, res: Response) {
    try {
      const parsed = distributeYieldSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      if (!isArciumEnabled()) {
        return res.status(503).json({
          error: "Arcium MPC is not enabled. Set ARCIUM_ENABLED=true.",
        });
      }

      const enhService = getYieldMpcEnhancementsService();
      const { getExchangeRate } = await import("../services/yield/yield-rates.service");

      // Load all distinct users with active SOL shares
      const activeShares = await VaultShare.find({
        status: "active",
        vaultType: { $in: ["sol_jito", "sol_marinade"] },
      })
        .select("userId vaultType")
        .lean();

      const seen = new Set<string>();
      const jobs: Array<{ userId: string; vaultType: string }> = [];
      for (const s of activeShares as any[]) {
        const key = `${s.userId}:${s.vaultType}`;
        if (!seen.has(key)) {
          seen.add(key);
          jobs.push({ userId: s.userId, vaultType: s.vaultType });
        }
      }

      let processed = 0;
      let failed = 0;

      for (const { userId: uid, vaultType: vt } of jobs) {
        try {
          const rate = await getExchangeRate(vt as any);
          // Express daily yield as integer ratio (e.g. 1.0001 daily ≈ rateNum=10001, rateDenom=10000)
          const rateNum = BigInt(Math.round(rate * 10000));
          const rateDenom = 10000n;
          await enhService.computeYieldDistribution(uid, vt === "sol_jito" ? 0 : 1, rateNum, rateDenom);
          processed++;
        } catch (err: any) {
          console.error(`[Arcium] distributeYield failed for ${uid}:${vt}:`, err.message);
          failed++;
        }
      }

      return res.status(200).json({ processed, failed });
    } catch (error: any) {
      console.error("YieldController.distributeYield error:", error);
      return res.status(500).json({ error: "Yield distribution failed" });
    }
  }
}
