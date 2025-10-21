import express, { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import privateTransferService from '../services/arcium/private-transfer.service.js';
import { solanaWalletService } from '../services/wallet/solana-wallet.service.js';
import { authenticateJWT as authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/arcium/register
 * Enregistre un nouvel utilisateur dans le système Arcium MPC
 *
 * Body:
 * - userAddress: string (adresse Solana publique)
 *
 * Response:
 * - success: boolean
 * - userId: number (ID unique assigné)
 * - balancePDA: string (adresse du compte balance)
 * - signature: string (transaction signature)
 */
router.post('/register', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'userAddress is required',
      });
    }

    // Valider l'adresse Solana
    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(userAddress);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Solana address',
      });
    }

    console.log('📝 [Arcium] Register user:', userAddress);

    // Récupérer le wallet du serveur pour payer les frais
    const payerKeypair = await solanaWalletService.getServerKeypair();
    if (!payerKeypair) {
      return res.status(500).json({
        success: false,
        error: 'Server wallet not configured',
      });
    }

    const result = await privateTransferService.registerUser(userPubkey, payerKeypair);

    if (result.success) {
      return res.json({
        success: true,
        userId: result.userId,
        balancePDA: result.balancePDA,
        signature: result.signature,
        message: 'User registered successfully in Arcium MPC system',
        explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
      });
    } else {
      return res.status(500).json(result);
    }
  } catch (error: any) {
    console.error('❌ [Arcium] Register error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * POST /api/arcium/transfer
 * Effectue un transfert privé 100% via Arcium MPC
 *
 * Body:
 * - senderId: number (ID du sender)
 * - receiverId: number (ID du receiver)
 * - amount: string (montant en lamports)
 * - senderAddress: string (adresse du sender)
 *
 * Response:
 * - success: boolean
 * - signature: string (transaction signature)
 * - computationOffset: string (offset de la computation MPC)
 */
router.post('/transfer', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { senderId, receiverId, amount, senderAddress } = req.body;

    if (senderId === undefined || senderId === null) {
      return res.status(400).json({
        success: false,
        error: 'senderId is required',
      });
    }

    if (receiverId === undefined || receiverId === null) {
      return res.status(400).json({
        success: false,
        error: 'receiverId is required',
      });
    }

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'amount is required',
      });
    }

    if (!senderAddress) {
      return res.status(400).json({
        success: false,
        error: 'senderAddress is required',
      });
    }

    console.log('💸 [Arcium] Private transfer:', {
      senderId,
      receiverId,
      amount,
    });

    // Récupérer la keypair du sender
    const senderKeypair = await solanaWalletService.getWalletByAddress(senderAddress);
    if (!senderKeypair) {
      return res.status(404).json({
        success: false,
        error: 'Sender wallet not found',
      });
    }

    const amountBigInt = BigInt(amount);

    // Récupérer le keypair du serveur pour payer les frais
    const serverKeypair = await solanaWalletService.getServerKeypair();
    if (!serverKeypair) {
      return res.status(500).json({
        success: false,
        error: 'Server keypair not found',
      });
    }

    const result = await privateTransferService.executePrivateTransfer(
      senderId,
      receiverId,
      amountBigInt,
      senderKeypair,
      serverKeypair
    );

    if (result.success) {
      return res.json({
        success: true,
        signature: result.signature,
        computationOffset: result.computationOffset,
        message: 'Private transfer initiated. MPC computation in progress (10-30 seconds).',
        explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
      });
    } else {
      return res.status(500).json(result);
    }
  } catch (error: any) {
    console.error('❌ [Arcium] Transfer error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/arcium/balance/:userId
 * Récupère la balance chiffrée d'un utilisateur
 *
 * Response:
 * - success: boolean
 * - userId: number
 * - encryptedBalance: number[] (balance chiffrée)
 * - nonce: string
 */
router.get('/balance/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
      });
    }

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'userId must be a number',
      });
    }

    console.log('📊 [Arcium] Get balance for userId:', userIdNum);

    const balance = await privateTransferService.getEncryptedBalance(userIdNum);

    if (balance) {
      return res.json({
        success: true,
        userId: balance.userId,
        encryptedBalance: balance.encryptedBalance,
        nonce: balance.nonce,
        message: 'Balance is encrypted. Use client-side decryption with your private key.',
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'User balance not found',
      });
    }
  } catch (error: any) {
    console.error('❌ [Arcium] Balance error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/arcium/user-id/:address
 * Récupère l'ID d'un utilisateur depuis son adresse
 *
 * Response:
 * - success: boolean
 * - userId: number | null
 */
router.get('/user-id/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'address is required',
      });
    }

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(address);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Solana address',
      });
    }

    console.log('🔍 [Arcium] Get user ID for:', address);

    const userId = await privateTransferService.getUserId(userPubkey);

    if (userId !== null) {
      return res.json({
        success: true,
        userId,
        address,
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'User not registered',
        message: 'Call /api/arcium/register first to register this address',
      });
    }
  } catch (error: any) {
    console.error('❌ [Arcium] User ID error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/arcium/status
 * Vérifie le statut du système Arcium MPC
 *
 * Response:
 * - success: boolean
 * - programId: string
 * - mxeAccount: string
 * - network: string
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      programId: '2aeBxgUKEqDzp4fXByJzeiioXFMSD2VDB6QefUVME5cV',
      arciumProgramId: 'BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6',
      mxeAccount: '4uHCi1DNUBEm2uS31ztazam5LtyB5JfY6EXbwvAC5aJc',
      clusterOffset: 8,
      network: 'devnet',
      rpcEndpoint: 'https://devnet.helius-rpc.com',
      message: 'Arcium MPC system active and ready',
      explorerUrl: 'https://explorer.solana.com/address/2aeBxgUKEqDzp4fXByJzeiioXFMSD2VDB6QefUVME5cV?cluster=devnet',
    });
  } catch (error: any) {
    console.error('❌ [Arcium] Status error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;
