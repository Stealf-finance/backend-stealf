import express, { Request, Response } from 'express';
import { rhinoService } from '../services/rhino.service.js';

const router = express.Router();

// ==========================================
// RHINO.FI BRIDGE ROUTES
// Cross-chain bridges from Ethereum/L2s to Solana
// ==========================================

/**
 * GET /rhino/configs
 * Get supported chains and tokens for bridging to Solana
 */
router.get('/configs', async (_req: Request, res: Response): Promise<void> => {
  try {
    if (!rhinoService.isReady()) {
      res.status(503).json({
        success: false,
        error: 'Rhino bridge service not available',
      });
      return;
    }

    const configs = await rhinoService.getBridgeConfigs();

    res.json({
      success: true,
      data: configs,
    });
  } catch (error: any) {
    console.error('  Get configs error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /rhino/quote
 * Get a public quote (no deposit address, just pricing)
 */
router.post('/quote', async (req: Request, res: Response): Promise<void> => {
  try {
    const { chainIn, token, amount } = req.body;

    if (!chainIn || !token || !amount) {
      res.status(400).json({
        success: false,
        error: 'chainIn, token, and amount are required',
      });
      return;
    }

    const quote = await rhinoService.getPublicQuote({ chainIn, token, amount });

    res.json({
      success: true,
      data: quote,
    });
  } catch (error: any) {
    console.error('  Quote error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /rhino/deposit-address
 * Generate a deposit address for bridging from another chain to Solana
 */
router.post('/deposit-address', async (req: Request, res: Response): Promise<void> => {
  try {
    const { chainIn, token, amount, recipientAddress, userEmail } = req.body;

    // Validation
    if (!chainIn || !token || !amount || !recipientAddress) {
      res.status(400).json({
        success: false,
        error: 'chainIn, token, amount, and recipientAddress are required',
      });
      return;
    }

    if (!rhinoService.isReady()) {
      res.status(503).json({
        success: false,
        error: 'Rhino bridge service not available',
      });
      return;
    }

    const quote = await rhinoService.getDepositQuote({
      chainIn,
      token,
      amount,
      recipientAddress,
      userEmail,
    });

    res.json({
      success: true,
      data: quote,
    });
  } catch (error: any) {
    console.error('  Deposit address error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /rhino/status/:quoteId
 * Check the status of a bridge transaction
 */
router.get('/status/:quoteId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { quoteId } = req.params;

    if (!quoteId) {
      res.status(400).json({
        success: false,
        error: 'quoteId is required',
      });
      return;
    }

    if (!rhinoService.isReady()) {
      res.status(503).json({
        success: false,
        error: 'Rhino bridge service not available',
      });
      return;
    }

    const status = await rhinoService.getBridgeStatus(quoteId);

    res.json({
      success: true,
      data: {
        quoteId,
        state: status.state,
        depositTxHash: status.depositTxHash || null,
        withdrawTxHash: status.withdrawTxHash || null,
      },
    });
  } catch (error: any) {
    console.error('  Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /rhino/bridge/:quoteId
 * Get bridge details by quoteId
 */
router.get('/bridge/:quoteId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { quoteId } = req.params;

    if (!quoteId) {
      res.status(400).json({
        success: false,
        error: 'quoteId is required',
      });
      return;
    }

    const bridge = await rhinoService.getBridgeByQuoteId(quoteId);

    if (!bridge) {
      res.status(404).json({
        success: false,
        error: 'Bridge not found',
      });
      return;
    }

    res.json({
      success: true,
      data: bridge,
    });
  } catch (error: any) {
    console.error('  Get bridge error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /rhino/history
 * Get user's bridge history
 */
router.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userEmail, limit } = req.query;

    if (!userEmail || typeof userEmail !== 'string') {
      res.status(400).json({
        success: false,
        error: 'userEmail query parameter is required',
      });
      return;
    }

    const bridges = await rhinoService.getUserBridges(
      userEmail,
      parseInt(limit as string) || 20
    );

    res.json({
      success: true,
      data: {
        count: bridges.length,
        bridges,
      },
    });
  } catch (error: any) {
    console.error('  History error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /rhino/pending
 * Get user's pending bridges
 */
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userEmail } = req.query;

    if (!userEmail || typeof userEmail !== 'string') {
      res.status(400).json({
        success: false,
        error: 'userEmail query parameter is required',
      });
      return;
    }

    const bridges = await rhinoService.getPendingBridges(userEmail);

    res.json({
      success: true,
      data: {
        count: bridges.length,
        bridges,
      },
    });
  } catch (error: any) {
    console.error('  Pending bridges error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /rhino/webhook
 * Webhook endpoint for Rhino.fi status updates
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Optionally verify webhook signature
    // const signature = req.headers['x-rhino-signature'];
    // if (!verifyWebhookSignature(req.body, signature)) { ... }

    console.log('[Rhino Webhook] Received:', JSON.stringify(req.body));

    await rhinoService.handleWebhook(req.body);

    res.json({ success: true });
  } catch (error: any) {
    console.error('  Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
