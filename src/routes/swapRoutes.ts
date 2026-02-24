import { Router } from 'express';
import { SwapController } from '../controllers/swapController';
import { swapLimiter } from '../middleware/rateLimiter';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();

router.post('/order', swapLimiter, verifyAuth, SwapController.order);
router.post('/execute', swapLimiter, verifyAuth, SwapController.execute);

export default router;
