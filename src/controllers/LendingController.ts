import { Request, Response } from "express";
import { z } from "zod";
import { getLendingService } from "../services/lending/lending.service";
import { stripProdError } from "../utils/logger";
import { User } from "../models/User";

// Lending uses Cash wallet only (public, Kamino-compatible)
async function getCashWallet(req: Request): Promise<string | null> {
  const mongoUserId = req.user?.mongoUserId;
  if (mongoUserId) {
    const user = await User.findById(mongoUserId).select("cash_wallet").lean();
    return (user as any)?.cash_wallet || null;
  }
  // Passkey users: publicKey from JWT is already the cash wallet
  return req.user?.publicKey || null;
}

// --- Zod schemas ---

const collateralSchema = z.object({
  amount: z.number().min(0.1, "Minimum collateral is 0.1 SOL"),
});

const borrowSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
});

const repaySchema = z.object({
  amount: z.number().positive("Amount must be positive"),
});

const withdrawCollateralSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
});

const confirmSchema = z.object({
  signature: z.string().min(64, "Invalid transaction signature"),
  action: z.enum(["collateral", "borrow", "repay", "withdraw"]),
  amount: z.number().positive("Amount must be positive"),
});

// --- Controller ---

export class LendingController {
  static async depositCollateral(req: Request, res: Response) {
    try {
      const parsed = collateralSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userPublicKey = await getCashWallet(req);
      if (!userPublicKey) {
        return res.status(401).json({ error: "Missing user public key" });
      }

      const { amount } = parsed.data;
      const service = getLendingService();
      const result = await service.buildDepositCollateralTx(userPublicKey, amount);
      return res.json(result);
    } catch (error: any) {
      if (error.message?.toLowerCase().includes("devnet")) {
        return res.status(503).json({ error: "Kamino lending is not available on devnet" });
      }
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to build deposit collateral transaction",
      });
    }
  }

  static async borrow(req: Request, res: Response) {
    try {
      const parsed = borrowSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Missing userId" });
      }
      const userPublicKey = await getCashWallet(req);
      if (!userPublicKey) {
        return res.status(401).json({ error: "Missing user public key" });
      }

      const { amount } = parsed.data;
      const service = getLendingService();
      const result = await service.buildBorrowTx(userPublicKey, userId, amount);
      return res.json(result);
    } catch (error: any) {
      if (error.message?.toLowerCase().includes("devnet")) {
        return res.status(503).json({ error: "Kamino lending is not available on devnet" });
      }
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to build borrow transaction",
      });
    }
  }

  static async repay(req: Request, res: Response) {
    try {
      const parsed = repaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Missing userId" });
      }
      const userPublicKey = await getCashWallet(req);
      if (!userPublicKey) {
        return res.status(401).json({ error: "Missing user public key" });
      }

      const { amount } = parsed.data;
      const service = getLendingService();
      const result = await service.buildRepayTx(userPublicKey, userId, amount);
      return res.json(result);
    } catch (error: any) {
      if (error.message?.toLowerCase().includes("devnet")) {
        return res.status(503).json({ error: "Kamino lending is not available on devnet" });
      }
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to build repay transaction",
      });
    }
  }

  static async withdrawCollateral(req: Request, res: Response) {
    try {
      const parsed = withdrawCollateralSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Missing userId" });
      }
      const userPublicKey = await getCashWallet(req);
      if (!userPublicKey) {
        return res.status(401).json({ error: "Missing user public key" });
      }

      const { amount } = parsed.data;
      const service = getLendingService();
      const result = await service.buildWithdrawCollateralTx(userPublicKey, userId, amount);
      return res.json(result);
    } catch (error: any) {
      if (error.message?.toLowerCase().includes("devnet")) {
        return res.status(503).json({ error: "Kamino lending is not available on devnet" });
      }
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to build withdraw collateral transaction",
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
        return res.status(401).json({ error: "Missing userId" });
      }

      const { signature, action, amount } = parsed.data;
      const service = getLendingService();
      const result = await service.confirmLendingAction(signature, userId, action, amount);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to confirm lending action",
      });
    }
  }

  static async getPosition(req: Request, res: Response) {
    try {
      const userId = req.user?.mongoUserId;
      if (!userId) {
        return res.status(401).json({ error: "Missing userId" });
      }

      const service = getLendingService();
      const position = await service.getPosition(userId);
      return res.json(position);
    } catch (error: any) {
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to get lending position",
      });
    }
  }

  static async getRates(req: Request, res: Response) {
    try {
      const service = getLendingService();
      const rates = await service.getRates();
      return res.json(rates);
    } catch (error: any) {
      return res.status(500).json({
        error: stripProdError(error.message) || "Failed to get lending rates",
      });
    }
  }

  static async getSolPrice(_req: Request, res: Response) {
    try {
      const price = await getLendingService().getSolPriceUsd();
      return res.json({ solPriceUsd: price });
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get SOL price" });
    }
  }
}
