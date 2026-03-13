import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { handleVaultTransaction } from "../services/yield/scanner";
import { heliusWebhookPayloadSchema } from "../utils/validations";
import logger from "../config/logger";

export class WebhookVaultController {
  static async handleVaultWebhook(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;

      if (!expectedSecret) {
        logger.error("HELIUS_WEBHOOK_SECRET not configured");
        return res.status(500).json({ success: false, error: "Server configuration error" });
      }

      const authBuffer = Buffer.from(authHeader || "");
      const expectedBuffer = Buffer.from(expectedSecret);
      if (
        authBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(authBuffer, expectedBuffer)
      ) {
        logger.warn("Unauthorized vault webhook request");
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const validatedPayload = heliusWebhookPayloadSchema.parse(req.body);

      // Respond immediately — MPC finalization takes ~30s,
      // Helius would timeout and retry causing duplicate processing
      res.status(200).json({ success: true });

      handleVaultTransaction(validatedPayload).catch((err) => {
        logger.error({ err }, "Background vault transaction processing failed");
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn({ issues: error.issues }, "Vault webhook payload validation failed");
        return res.status(400).json({ success: false, error: "Invalid payload format" });
      }
      logger.error({ err: error }, "Vault webhook error");
      return res.status(500).json({ success: false });
    }
  }
}
