import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { walletSignupSchema, walletLoginSchema } from "../utils/validations";
import {
  createWalletUser,
  findUserByWallet,
} from "../services/auth/walletAuth.service";

const JWT_SECRET = process.env.WALLET_JWT_SECRET || "stealf-wallet-auth-secret-change-in-production";

export class WalletAuthController {
  /**
   * POST /api/users/wallet-signup
   * Create a new user account using a Solana wallet as authenticator.
   */
  static async walletSignup(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, pseudo, publicKeyHex } = walletSignupSchema.parse(
        req.body
      );

      const result = await createWalletUser({ email, pseudo, publicKeyHex });

      const token = jwt.sign(
        {
          mongoUserId: result.user._id.toString(),
          organizationId: result.subOrgId,
          authMethod: "wallet",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.status(201).json({
        success: true,
        data: {
          user: {
            userId: result.user._id,
            email: result.user.email,
            pseudo: result.user.pseudo,
            cash_wallet: result.user.cash_wallet,
            stealf_wallet: result.user.stealf_wallet,
            authMethod: result.user.authMethod,
            status: result.user.status,
          },
          subOrgId: result.subOrgId,
          cashWallet: result.cashWalletAddress,
          token,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          errors,
        });
      }

      if (error.statusCode === 409) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      console.error("[walletSignup] Unhandled error:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }

  /**
   * POST /api/users/wallet-login
   * Authenticate an existing user by their Solana wallet public key.
   */
  static async walletLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { publicKeyHex } = walletLoginSchema.parse(req.body);

      const user = await findUserByWallet(publicKeyHex);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "No account found for this wallet",
        });
      }

      const token = jwt.sign(
        {
          mongoUserId: user._id.toString(),
          organizationId: user.turnkey_subOrgId,
          authMethod: "wallet",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        success: true,
        data: {
          user: {
            userId: user._id,
            email: user.email,
            pseudo: user.pseudo,
            cash_wallet: user.cash_wallet,
            stealf_wallet: user.stealf_wallet,
            authMethod: user.authMethod,
            status: user.status,
            turnkey_subOrgId: user.turnkey_subOrgId,
          },
          token,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          errors,
        });
      }

      next(error);
    }
  }
}
