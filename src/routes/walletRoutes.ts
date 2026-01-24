import { Router } from 'express';
import { WalletController } from '../controllers/walletController';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();

router.get('/history/:address',verifyAuth, WalletController.getHistory);
router.get('/balance/:address', verifyAuth, WalletController.getBalance);
export default router;