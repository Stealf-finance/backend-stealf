import { Router } from 'express';
import { PrivateTransferController } from '../controllers/PrivateTransferController';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();

router.post('/initiatedeposit', verifyAuth, PrivateTransferController.initiatePrivateDeposit);
router.post('/initiatewithdraw', verifyAuth, PrivateTransferController.initiatePrivateWithdraw);

router.get('/balance', verifyAuth, PrivateTransferController.getUserBalance);
router.get('/vault/balance', verifyAuth, PrivateTransferController.getVaultBalance);
router.get('/user/history', verifyAuth, PrivateTransferController.getUserHistory);
router.get('/:transferId', verifyAuth, PrivateTransferController.getStatus);
router.post('/:transferId/retry', verifyAuth, PrivateTransferController.retry);

export default router;
