import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/auth.js';
// ✅ Utilisation du service simplifié (pas de UserRegistry)
import privateTransferService from '../services/arcium/private-transfer-simple.service.js';
import { PublicKey } from '@solana/web3.js';

const router = Router();

/**
 * POST /api/transaction/private
 * Effectue un transfert 100% privé Arcium du wallet public vers Privacy 1
 * Le destinataire est automatiquement le wallet privé de l'utilisateur
 *
 * Body:
 * - amount: number (en SOL)
 */
router.post('/private', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const userId = (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount. Must be greater than 0',
      });
    }

    console.log(`🔐 Arcium private transfer to Privacy 1: ${amount} SOL for user ${userId}`);

    // Importer User pour récupérer le wallet privé
    const { User } = await import('../models/User.js');
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Pour le test simple, on utilise le wallet de l'user comme recipient
    if (!user.solanaWallet) {
      return res.status(400).json({
        success: false,
        message: 'User does not have a Solana wallet',
      });
    }
    const recipientAddress = new PublicKey(user.solanaWallet);

    // Convertir SOL en lamports
    const amountInLamports = BigInt(Math.floor(parseFloat(amount) * 1_000_000_000));

    // Exécuter le transfert privé 100% via Arcium MPC
    const result = await privateTransferService.executePrivateTransferFromUser(
      userId,
      recipientAddress,
      amountInLamports
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Arcium private transfer failed',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        signature: result.signature,
        computationOffset: result.computationOffset,
      },
      message: '🔐 Simple private transfer initiated. MPC computation in progress...',
    });

  } catch (error: any) {
    console.error('❌ Arcium private transfer error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/transaction/private/balance
 * DÉSACTIVÉ - Service simplifié ne gère pas encore les balances
 */
router.get('/private/balance', authenticateJWT, async (req: Request, res: Response) => {
  return res.status(501).json({
    success: false,
    message: 'Balance query not yet implemented in simple mode. Testing MPC circuit only.',
  });
});

/**
 * POST /api/transaction/arcium-private
 * Effectue une transaction 100% privée via Arcium MPC
 * - Crée le wallet Arcium privé si nécessaire
 * - Enregistre l'utilisateur dans Arcium
 * - Transfert avec sender, receiver, montant masqués
 *
 * Body:
 * - recipientAddress: string (adresse du destinataire)
 * - amount: number (montant en lamports)
 */
router.post('/arcium-private', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { recipientAddress, amount } = req.body;
    const userId = (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    if (!recipientAddress || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'recipientAddress and valid amount are required',
      });
    }

    console.log(`🔐 Arcium private transfer request`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Recipient: ${recipientAddress}`);
    console.log(`   Amount: ${amount} lamports`);

    // Valider l'adresse du destinataire
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(recipientAddress);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recipient address',
      });
    }

    // Exécuter la transaction privée Arcium
    // Le service va:
    // 1. Créer le wallet Arcium si nécessaire
    // 2. Enregistrer l'utilisateur dans Arcium
    // 3. Effectuer le transfert privé
    const result = await privateTransferService.executePrivateTransferFromUser(
      userId,
      recipientPubkey,
      BigInt(amount)
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Arcium private transfer failed',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        signature: result.signature,
        computationOffset: result.computationOffset,
      },
      message: '🔐 Simple private transfer initiated. MPC computation in progress...',
    });

  } catch (error: any) {
    console.error('❌ Arcium private transfer error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

export default router;
