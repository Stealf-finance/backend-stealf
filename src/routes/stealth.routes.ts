/**
 * Routes stealth — EIP-5564 stealth addresses pour Solana.
 *
 * Toutes les routes requièrent verifyAuth sauf si explicitement indiqué.
 * Requirements : 1.5, 2.7, 3.6, 4.2, 4.3, 4.5, 5.5
 */

import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth';
import { StealthController } from '../controllers/StealthController';

const router = Router();

// Toutes les routes stealth requièrent authentification
router.use(verifyAuth);

// Meta-adresse
router.get('/meta-address', StealthController.getMetaAddress);
router.post('/register', StealthController.register);

// Paiements entrants
router.get('/incoming', StealthController.getIncoming);

// Enregistrement direct après TX (évite le scan blockchain)
router.post('/register-payment', StealthController.registerPayment);

// Scan on-demand (déclenche immédiatement un scan blockchain pour l'user)
router.post('/scan', StealthController.scan);

// Transfert stealth
router.post('/build-transfer', StealthController.buildTransfer);
router.post('/build-and-send-cash', StealthController.buildAndSendCash);

// Dépense de paiements stealth
router.post('/spend/prepare', StealthController.spendPrepare);
router.post('/spend/confirm', StealthController.spendConfirm);

export default router;
