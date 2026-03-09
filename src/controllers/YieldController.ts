import { Request, Response } from "express";
import { z } from "zod";
import { getYieldService } from "../services/yield/yield.service";
import { getArciumVaultService, isArciumEnabled } from "../services/yield/arcium-vault.service";
import { getYieldMpcEnhancementsService } from "../services/yield/yield-mpc-enhancements.service";
import { VaultShare } from "../models/VaultShare";
import { getTotalActiveDepositLamports } from "../services/yield/yield-rates.service";
import { confirmPrivateDepositArcium } from "../services/yield/private-sol.service";
import { getBatchStakingService } from "../services/yield/batch-staking.service";
import { stripProdError } from "../utils/logger";

// --- Zod schemas ---

const depositSchema = z.object({
  amount: z.number().positive(),
});

const withdrawSchema = z.object({
  amount: z.number().positive(),
});

const confirmSchema = z.object({
  signature: z.string().min(64, "Invalid transaction signature"),
  type: z.enum(["deposit", "withdraw"]),
  amount: z.number().positive().optional(),
});

const proofOfYieldSchema = z.object({
  thresholdBps: z.coerce.number().int().min(0).max(10000),
});

// Schema for POST /api/yield/distribute-yield (admin trigger)
export const distributeYieldSchema = z.object({
  rateNum: z.number().int().positive().max(1_100_000).optional(),
  rateDenom: z.number().int().positive().optional(),
});

// --- Constants ---
const VAULT_TYPE = "sol_jito" as const;

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

      const { amount } = parsed.data;

      // Always private mode: authority-indirection (Phase 1).
      const yieldService = getYieldService();
      const result = await yieldService.buildPrivateDepositTransaction(
        userPublicKey,
        amount
      );
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
      if (!userPublicKey) {
        return res.status(400).json({ error: "User public key not found" });
      }

      const { amount } = parsed.data;

      // Always private mode: authority-indirection withdrawal

      // --- Double-spend guard: atomically transition active → processing ---
      const processingShare = await VaultShare.findOneAndUpdate(
        { userId, vaultType: VAULT_TYPE, status: "active" },
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
      if (arciumService) {
        try {
          const verifyResult = await arciumService.verifyWithdrawal(userId, lamports);
          if (verifyResult.success && verifyResult.data?.sufficient === false) {
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
          VAULT_TYPE,
          userPublicKey
        );
      } catch (solErr: any) {
        await VaultShare.findByIdAndUpdate(processingShare._id, { $set: { status: "active" } });
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
            const share = await VaultShare.findOne({ userId, vaultType: VAULT_TYPE, status: "active" });
            const currentIndex = share?.snapshotIndex ?? 0;
            const newIndex = BigInt(currentIndex + 1);
            const enhService = getYieldMpcEnhancementsService();
            const snapResult = await enhService.takeBalanceSnapshot(userId, 0, newIndex);
            if (snapResult.success && share) {
              const usedIndex = snapResult.data?.usedIndex ?? currentIndex + 1;
              await VaultShare.findByIdAndUpdate(share._id, { snapshotIndex: usedIndex });
            }
          } catch (err: any) {
            console.error("[Arcium] takeBalanceSnapshot (withdraw) failed:", err.message);
          }
        })();
      }

      return res.status(200).json({ ...result, sufficient: true });
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

      const { signature, type, amount } = parsed.data;

      // --- Private confirm for deposit (full Arcium flow) ---
      if (type === "deposit") {
        if (!amount) {
          return res.status(400).json({
            error: "amount is required for deposit confirmation",
          });
        }
        const userPublicKey = req.user?.publicKey;
        if (!userPublicKey) {
          return res.status(400).json({ error: "User public key not found" });
        }

        const result = await confirmPrivateDepositArcium(
          signature,
          userId,
          VAULT_TYPE,
          amount,
          userPublicKey
        );

        // Non-blocking background: Arcium + batch staking
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
              const lam = BigInt(Math.round(denominationsUsed[i] * 1e9));

              try {
                await arciumService.recordDeposit(userId, lam);
              } catch (err: any) {
                console.error(
                  `[Arcium] recordDeposit ${denominationsUsed[i]} SOL failed:`,
                  err.message
                );
              }

              try {
                await batchService.addToBatch(userId, lam, VAULT_TYPE, shareIds[i]);
              } catch (err: any) {
                console.error("[BatchStaking] addToBatch failed:", err.message);
              }
            }

            const totalLamports = BigInt(Math.round(totalDeposited * 1e9));
            arciumService.updateEncryptedTotal(totalLamports, true).catch((err: any) => {
              console.error("[Arcium] updateEncryptedTotal (deposit) failed:", err.message);
            });

            // Snapshot
            try {
              const share = await VaultShare.findById(shareIds[0]);
              const currentIndex = share?.snapshotIndex ?? 0;
              const newIndex = BigInt(currentIndex + 1);
              const enhService = getYieldMpcEnhancementsService();
              const snapResult = await enhService.takeBalanceSnapshot(userId, 0, newIndex);
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

        return res.status(200).json(result);
      }

      // --- Withdrawal confirm ---
      if (!amount) {
        return res.status(400).json({
          error: "amount is required for withdraw confirmation",
        });
      }
      const yieldService = getYieldService();
      const result = await yieldService.confirmWithdraw(
        signature,
        userId,
        VAULT_TYPE,
        amount
      );

      if (isArciumEnabled()) {
        const lam = BigInt(Math.round(amount * 1e9));
        getArciumVaultService().updateEncryptedTotal(lam, false).catch((err: any) => {
          console.error("[Arcium] updateEncryptedTotal (std withdraw) failed:", err.message);
        });
      }

      return res.status(200).json(result);
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

      const balance = await getYieldService().getBalance(userId);
      return res.status(200).json({ balance });
    } catch (error: any) {
      console.error("YieldController.getBalance error:", error);
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to get balance",
      });
    }
  }

  static async getAPY(_req: Request, res: Response) {
    try {
      const apy = await getYieldService().getAPYRates();
      return res.status(200).json(apy);
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

      const dashboard = await getYieldService().getDashboard(userId);
      return res.status(200).json(dashboard);
    } catch (error: any) {
      console.error("YieldController.getDashboard error:", error);
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to get dashboard",
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

      const { thresholdBps } = parsed.data;

      if (!isArciumEnabled()) {
        return res.status(503).json({
          error: "Arcium MPC is not enabled. Set ARCIUM_ENABLED=true to use proof of yield.",
        });
      }

      const yieldService = getYieldService();
      const balance = await yieldService.getBalance(userId);

      if (!balance || balance.currentValue <= 0) {
        return res.status(422).json({
          error: "No yield data available",
        });
      }

      if (!balance.totalDeposited || balance.currentValue < balance.totalDeposited) {
        return res.status(200).json({
          exceedsThreshold: false,
          thresholdBps,
          vaultType: VAULT_TYPE,
        });
      }

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
        vaultType: VAULT_TYPE,
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

      const query: Record<string, any> = { userId, vaultType: VAULT_TYPE, snapshotIndex: { $gt: 0 } };

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

      const activeShares = await VaultShare.find({
        status: "active",
        vaultType: VAULT_TYPE,
      })
        .select("userId")
        .lean();

      const seen = new Set<string>();
      const userIds: string[] = [];
      for (const s of activeShares as any[]) {
        const uid = s.userId.toString();
        if (!seen.has(uid)) {
          seen.add(uid);
          userIds.push(uid);
        }
      }

      let processed = 0;
      let failed = 0;

      for (const uid of userIds) {
        try {
          const rate = await getExchangeRate(VAULT_TYPE);
          const rateNum = BigInt(Math.round(rate * 10000));
          const rateDenom = 10000n;
          await enhService.computeYieldDistribution(uid, 0, rateNum, rateDenom);
          processed++;
        } catch (err: any) {
          console.error(`[Arcium] distributeYield failed for ${uid}:`, err.message);
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
