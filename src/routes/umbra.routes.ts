import { Router, Request, Response } from 'express';
import { Keypair } from '@solana/web3.js';
import { depositService } from '../services/umbra/deposit.service.js';
import { claimService } from '../services/umbra/claim.service.js';
import { initAccountService } from '../services/umbra/init-account.service.js';
import { accountInitService } from '../services/umbra/account-init.service.js';
import { simplePrivateTransferService } from '../services/umbra/simple-private-transfer.service.js';
import { Transaction } from '../models/Transaction.js';
import { DepositArtifacts } from '../models/DepositArtifacts.js';
import { solanaWalletService } from '../services/wallet/solana-wallet.service.js';

const router = Router();

/**
 * POST /api/umbra/airdrop
 * Request airdrop for Umbra wallet (devnet only)
 */
router.post('/airdrop', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const { keypair, mongoUserId } = await solanaWalletService.getKeypairForUser(userId);
    const result = await initAccountService.requestAirdrop(mongoUserId, keypair);

    res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error('Airdrop error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/umbra/wallet/balance
 * Get Umbra wallet balance
 */
router.get('/wallet/balance', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const { keypair, mongoUserId } = await solanaWalletService.getKeypairForUser(userId);
    const balance = await initAccountService.getBalance(mongoUserId, keypair);

    res.json({
      success: true,
      balance
    });
  } catch (error: any) {
    console.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/umbra/transfer/simple-private
 * Simple private transfer from Grid wallet to Umbra wallet
 */
router.post('/transfer/simple-private', async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId and amount are required'
      });
    }

    // Get user's Grid wallet keypair (source)
    const { keypair: fromKeypair, mongoUserId } = await solanaWalletService.getKeypairForUser(userId);

    // Get user's Umbra wallet keypair (destination)
    // For now, we'll use the same keypair but in production this would be derived differently
    const { keypair: toKeypair } = await solanaWalletService.getKeypairForUser(userId);

    // Perform the simple private transfer
    const result = await simplePrivateTransferService.transferToPrivateWallet({
      userId: mongoUserId,
      amount: BigInt(amount),
      fromKeypair,
      toKeypair,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Simple private transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/umbra/deposit/public
 * Deposit with public amount (visible on-chain)
 */
router.post('/deposit/public', async (req: Request, res: Response) => {
  try {
    const { userId, amount, mint, generationIndex } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId and amount are required'
      });
    }

    // Get user's keypair (this also auto-creates user and returns MongoDB _id)
    const { keypair, mongoUserId } = await solanaWalletService.getKeypairForUser(userId);

    // Perform deposit using MongoDB _id
    const result = await depositService.depositPublic({
      userId: mongoUserId,
      keypair,
      amount: BigInt(amount),
      mint,
      generationIndex: generationIndex ? BigInt(generationIndex) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Deposit public error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/umbra/deposit/confidential
 * Deposit with confidential amount (hidden on-chain)
 */
router.post('/deposit/confidential', async (req: Request, res: Response) => {
  try {
    const { userId, amount, mint, relayerPublicKey } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId and amount are required'
      });
    }

    // Get user's keypair
    const keypair = await solanaWalletService.getKeypairForUser(userId);

    // Perform confidential deposit
    const result = await depositService.depositConfidential({
      userId,
      keypair,
      amount: BigInt(amount),
      mint,
      relayerPublicKey
    });

    res.json(result);
  } catch (error: any) {
    console.error('Deposit confidential error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/umbra/deposits/claimable
 * Get all claimable deposits for a user
 */
router.get('/deposits/claimable', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const deposits = await depositService.getClaimableDeposits(userId as string);

    res.json({
      success: true,
      deposits,
      count: deposits.length
    });
  } catch (error: any) {
    console.error('Get claimable deposits error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/umbra/claim
 * Claim a deposit using zero-knowledge proof
 */
router.post('/claim', async (req: Request, res: Response) => {
  try {
    const { userId, depositArtifactsId, recipientAddress } = req.body;

    if (!userId || !depositArtifactsId) {
      return res.status(400).json({
        success: false,
        message: 'userId and depositArtifactsId are required'
      });
    }

    // Get user's keypair
    const keypair = await solanaWalletService.getKeypairForUser(userId);

    // Claim the deposit
    const result = await claimService.claimDeposit({
      userId,
      keypair,
      depositArtifactsId,
      recipientAddress
    });

    res.json(result);
  } catch (error: any) {
    console.error('Claim error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/umbra/deposits/claimed
 * Get all claimed deposits for a user
 */
router.get('/deposits/claimed', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const deposits = await claimService.getClaimedDeposits(userId as string);

    res.json({
      success: true,
      deposits,
      count: deposits.length
    });
  } catch (error: any) {
    console.error('Get claimed deposits error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/umbra/transactions
 * Get transaction history for a user
 */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { userId, type, status, limit = 50, offset = 0 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    const query: any = { userId };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string));

    const total = await Transaction.countDocuments(query);

    res.json({
      success: true,
      transactions,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error: any) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/umbra/balance
 * Get balance summary for a user
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Get all claimable deposits
    const claimableDeposits = await DepositArtifacts.find({
      userId,
      claimed: false
    });

    // Calculate total claimable balance by mint
    const balanceByMint = claimableDeposits.reduce((acc: any, deposit: any) => {
      if (!acc[deposit.mint]) {
        acc[deposit.mint] = {
          mint: deposit.mint,
          claimableBalance: BigInt(0),
          depositCount: 0
        };
      }

      acc[deposit.mint].claimableBalance += BigInt(deposit.claimableBalance);
      acc[deposit.mint].depositCount += 1;

      return acc;
    }, {});

    // Convert BigInt to string for JSON serialization
    const balances = Object.values(balanceByMint).map((balance: any) => ({
      mint: balance.mint,
      claimableBalance: balance.claimableBalance.toString(),
      depositCount: balance.depositCount
    }));

    res.json({
      success: true,
      balances
    });
  } catch (error: any) {
    console.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
