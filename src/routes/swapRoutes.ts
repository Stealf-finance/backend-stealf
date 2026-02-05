import { Router } from 'express';
import { SwapController } from '../controllers/swapController';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();

router.post('/order', verifyAuth, SwapController.order);
router.post('/execute', verifyAuth, SwapController.execute);

export default router;
