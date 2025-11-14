/**
 * Routes internes pour le backend
 * Endpoints utilisés pour la génération de clés HPKE
 *
 * ⚠️ ATTENTION: Ces routes sont sensibles et doivent être protégées
 */

import { Router } from 'express';
import { keyManagerService } from '../services/key-manager.service.js';

const router = Router();

// Middleware de sécurité : vérifier une clé API interne
const requireInternalApiKey = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-internal-api-key'];
  const validKey = process.env.INTERNAL_API_KEY;

  if (!validKey) {
    console.warn('⚠️ INTERNAL_API_KEY not configured - internal routes exposed!');
    return next(); // Continuer si pas configuré (dev)
  }

  if (apiKey !== validKey) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or missing internal API key'
    });
  }

  next();
};

/**
 * Générer des clés HPKE pour un utilisateur
 * POST /internal/generate-hpke-keys
 * 🔒 Protégé par API key interne
 */
router.post('/generate-hpke-keys', requireInternalApiKey, (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    console.log(`🔑 Generating HPKE keys for ${email}`);

    // Générer les clés
    const keys = keyManagerService.generateAndStoreHPKEKeys(email);

    res.json({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey
    });

  } catch (error: any) {
    console.error('Failed to generate HPKE keys:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate HPKE keys'
    });
  }
});

export default router;
