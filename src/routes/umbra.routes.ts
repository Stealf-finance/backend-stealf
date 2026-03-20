/**
 * Routes Umbra Mixer — 5 endpoints JWT-protégés.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8
 */

import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth';
import { UmbraMixerController } from '../controllers/UmbraMixerController';

const router = Router();

// Toutes les routes Umbra requièrent authentification JWT (req 7.7)
router.use(verifyAuth);

// POST /api/umbra/mixer/register
router.post('/register', UmbraMixerController.register);

// POST /api/umbra/mixer/deposit
router.post('/deposit', UmbraMixerController.deposit);

// POST /api/umbra/mixer/submit
router.post('/submit', UmbraMixerController.submit);

// GET /api/umbra/mixer/utxos
router.get('/utxos', UmbraMixerController.getUtxos);

// POST /api/umbra/mixer/cash-deposit-submit (build + Turnkey sign + submit en 1 appel — req 5.3)
router.post('/cash-deposit-submit', UmbraMixerController.cashDepositSubmit);

// POST /api/umbra/mixer/claim
router.post('/claim', UmbraMixerController.manualClaim);

export default router;
