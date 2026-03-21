import { Request, Response, NextFunction } from "express";
import { getMxeKey } from "../services/yield/anchorProvider";
import { withdraw } from "../services/yield/withdraw";
import { queryBalanceByHash } from "../services/yield/balance";
import { yieldWithdrawSchema } from "../utils/validations";
import { uuidToU128 } from "../services/yield/constant";
import { JitoRateService } from "../services/pricing/jitoRate";
import logger from "../config/logger";

export class YieldController {
  static getMxePublicKey(_req: Request, res: Response, next: NextFunction) {
    try {
      const mxePublicKey = getMxeKey();
      return res.status(200).json({ mxePublicKey: Array.from(mxePublicKey) });
    } catch (error) {
      next(error);
    }
  }

  static async getBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const userIdHashHex = req.params.userId as string;
      if (!userIdHashHex || !/^[0-9a-f]{64}$/.test(userIdHashHex)) {
        return res.status(400).json({ error: "Valid userIdHash (64 hex chars) is required" });
      }

      const balance = await queryBalanceByHash(Buffer.from(userIdHashHex, "hex"));
      const { rate, apy } = await JitoRateService.getStats();

      // balance is in JitoSOL lamports → convert to SOL
      const balanceJitosol = Number(balance) / 1e9;
      const balanceSol = balanceJitosol * rate;

      return res.status(200).json({
        balanceLamports: balance.toString(),
        balanceJitosol,
        balanceSol,
        rate,
        apy,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await JitoRateService.getStats();
      return res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  }

  static async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, amount, wallet } = yieldWithdrawSchema.parse(req.body);

      const result = await withdraw(uuidToU128(userId), amount, wallet);

      logger.info(
        { wallet: wallet.slice(0, 8), sol: result.estimatedSolOut },
        "Withdrawal completed",
      );

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
