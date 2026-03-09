import { Router } from 'express';
import { WalletController } from '../controllers/walletController';
import { verifyAuth } from '../middleware/verifyAuth';
import { walletLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/privacy-wallet', verifyAuth, WalletController.registerPrivacyWallet);
router.get('/history/:address', walletLimiter, verifyAuth, WalletController.getHistory);
router.get('/balance/:address', walletLimiter, verifyAuth, WalletController.getBalance);
export default router;