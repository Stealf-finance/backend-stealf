import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getArciumService } from '../services/arcium.service';
import { verifyAuth } from '../middleware/verifyAuth';
import { User } from '../models/User';

const router = Router();

// ========== Helper Functions ==========

/**
 * Extract string value from Express header (handles string | string[] | undefined)
 * Returns the first string value or empty string if not found
 */
function extractHeaderString(header: string | string[] | undefined): string {
  if (typeof header === 'string') {
    return header;
  }
  if (Array.isArray(header) && header.length > 0 && typeof header[0] === 'string') {
    return header[0];
  }
  return '';
}

// ========== Zod Validation Schemas ==========

const BackupUserDataSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

const VerifyBalanceSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  minimumRequired: z.string().regex(/^\d+$/, 'minimumRequired must be a valid number string'),
});

// ========== Validation Middleware ==========

const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.issues,
        });
      }
      next(error);
    }
  };
};

// ========== Endpoints ==========

/**
 * GET /api/arcium/status
 * Returns service status (public endpoint)
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const arciumService = getArciumService();
    const ready = arciumService.isReady();

    res.json({
      ready,
      features: ['backup', 'verify-balance', 'recovery'],
      version: '0.6.3',
      clusterOffset: 456,
    });
  } catch (error) {
    console.error('[ArciumRoutes] /status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get service status',
    });
  }
});

/**
 * GET /api/arcium/health
 * Health check endpoint (public)
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const arciumService = getArciumService();
    const ready = arciumService.isReady();

    // TODO: Implement actual MXE cluster ping
    // For now, just return ready status
    const clusterReachable = ready;

    res.json({
      healthy: ready,
      clusterReachable,
      lastSuccess: ready ? Date.now() : undefined,
    });
  } catch (error) {
    console.error('[ArciumRoutes] /health error:', error);
    res.status(500).json({
      healthy: false,
      clusterReachable: false,
    });
  }
});

/**
 * POST /api/arcium/backup-user-data
 * Backup user email and pseudo on-chain with encryption
 * Requires authentication
 */
router.post(
  '/backup-user-data',
  verifyAuth,
  validateRequest(BackupUserDataSchema),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;

      // Fetch user from MongoDB
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Call ArciumService
      const arciumService = getArciumService();
      const result = await arciumService.backupUserData(
        userId,
        user.email,
        user.pseudo
      );

      if (result.success) {
        return res.json({
          success: true,
          signature: result.data.signature,
        });
      }

      // Error case
      const statusCode = result.error.type === 'MXE_UNAVAILABLE' ? 503 : 500;
      return res.status(statusCode).json({
        success: false,
        error: result.error.message,
        errorType: result.error.type,
      });
    } catch (error) {
      console.error('[ArciumRoutes] /backup-user-data error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

/**
 * POST /api/arcium/verify-balance
 * Verify user balance privately using MPC
 * Requires authentication
 */
router.post(
  '/verify-balance',
  verifyAuth,
  validateRequest(VerifyBalanceSchema),
  async (req: Request, res: Response) => {
    try {
      const { userId, minimumRequired } = req.body;

      // Fetch user from MongoDB
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Get user's Solana wallet address (public wallet for balance check)
      const walletAddress = user.cash_wallet;
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: 'User has no wallet address',
        });
      }

      // Fetch balance from Solana RPC
      // TODO: Use solanaService.getBalance() from existing service
      // For now, placeholder with 0 balance
      const balanceInLamports = 0n; // TODO: Implement actual balance fetch
      const minimumRequiredBigint = BigInt(minimumRequired);

      // Call ArciumService
      const arciumService = getArciumService();
      const result = await arciumService.verifyBalance(
        balanceInLamports,
        minimumRequiredBigint
      );

      if (result.success) {
        return res.json({
          success: true,
          isSufficient: result.data.isSufficient,
          minimumRequired: minimumRequired,
          verifiedAt: Date.now(),
        });
      }

      // Error case
      const statusCode = result.error.type === 'MXE_UNAVAILABLE' ? 503 : 500;
      return res.status(statusCode).json({
        success: false,
        error: result.error.message,
        errorType: result.error.type,
      });
    } catch (error) {
      console.error('[ArciumRoutes] /verify-balance error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

/**
 * GET /api/arcium/recover-user-data/:walletAddress
 * Recover user data from on-chain backup using Turnkey signature
 * Requires Turnkey signature in X-Turnkey-Signature header
 */
router.get(
  '/recover-user-data/:walletAddress',
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      const signatureHeader = req.headers['x-turnkey-signature'];

      // Extract signature string from header
      const turnkeySignature: string = extractHeaderString(signatureHeader);
      if (turnkeySignature === '') {
        return res.status(401).json({
          success: false,
          error: 'Missing X-Turnkey-Signature header',
        });
      }

      // Validate wallet address format (basic check)
      if (!walletAddress || walletAddress.length < 32) {
        return res.status(400).json({
          success: false,
          error: 'Invalid wallet address format',
        });
      }

      // Call ArciumService
      const arciumService = getArciumService();
      const result = await arciumService.recoverUserData(walletAddress as string, turnkeySignature as string);

      if (result.success) {
        return res.json({
          success: true,
          email: result.data.email,
          pseudo: result.data.pseudo,
        });
      }

      // Error case - determine status code based on error type
      let statusCode = 500;
      if (result.error.type === 'DATA_NOT_FOUND') statusCode = 404;
      if (result.error.type === 'INVALID_SIGNATURE' || result.error.type === 'TURNKEY_AUTH_FAILED') statusCode = 401;

      return res.status(statusCode).json({
        success: false,
        error: result.error.message,
        errorType: result.error.type,
      });
    } catch (error) {
      console.error('[ArciumRoutes] /recover-user-data error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

/**
 * GET /api/arcium/computation/:signature
 * Query computation status by signature
 * Requires authentication
 */
router.get(
  '/computation/:signature',
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const { signature } = req.params;

      // TODO: Implement with @arcium-hq/reader
      // For now, return placeholder
      res.json({
        status: 'unknown',
        signature,
        message: 'Computation status query not yet implemented (requires @arcium-hq/reader)',
      });
    } catch (error) {
      console.error('[ArciumRoutes] /computation/:signature error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to query computation status',
      });
    }
  }
);

export default router;
