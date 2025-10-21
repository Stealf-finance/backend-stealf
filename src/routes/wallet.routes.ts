/**
 * Routes Wallet
 * Endpoints pour gérer les wallets Solana des utilisateurs
 */

import { Router, Request, Response } from 'express';
import { User } from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/v1/wallet/info
 * Récupère les informations du wallet Solana de l'utilisateur
 * 🔒 Protégé par JWT
 */
router.get('/info', authenticateJWT, asyncHandler(async (req: Request, res: Response) => {
  try {
    // @ts-ignore - user est ajouté par le middleware authenticateJWT
    const userId = req.user?.user_id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID not found in token'
      });
    }

    // Récupérer l'utilisateur depuis MongoDB
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Retourner les infos du wallet
    res.json({
      success: true,
      solana_wallet: user.solanaWallet,
      solana_public_key: user.solanaWallet, // Alias pour compatibilité
      grid_address: user.gridAddress, // Pour référence
      email: user.email
    });

  } catch (error: any) {
    console.error('Error fetching wallet info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet information',
      message: error.message
    });
  }
}));

export default router;
