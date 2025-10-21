import express, { Request, Response } from 'express';
import { publicTransactionService } from '../services/transaction/public-transaction.service.js';
import { authenticateJWT } from '../middleware/auth.js';
import { User } from '../models/User.js';

const router = express.Router();

/**
 * POST /api/v1/transaction/public
 * Send a public transaction on Solana devnet
 */
router.post('/public', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { toAddress, amount } = req.body;
    const gridUserId = (req as any).user?.grid_user_id;

    if (!gridUserId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!toAddress || !amount) {
      return res.status(400).json({ error: 'Missing required fields: toAddress, amount' });
    }

    // Find user in MongoDB to get the _id
    const user = await User.findOne({ gridUserId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await publicTransactionService.sendPublicTransaction({
      fromUserId: user._id.toString(),
      toAddress,
      amount: parseFloat(amount),
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error: any) {
    console.error('Transaction route error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/v1/transaction/status/:signature
 * Get transaction status by signature
 */
router.get('/status/:signature', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { signature } = req.params;
    const status = await publicTransactionService.getTransactionStatus(signature);
    return res.status(200).json({ signature, status });
  } catch (error: any) {
    console.error('Get transaction status error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
