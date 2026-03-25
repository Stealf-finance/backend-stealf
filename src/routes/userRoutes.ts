import { Router } from 'express';
import { UserController } from '../controllers/authController';
import { MagicLinkController } from '../controllers/magicLinkController';
import { SolPriceController } from '../controllers/solPriceController';
import { availabilityCheckLimiter, authLimiter, pollingLimiter } from '../middleware/rateLimiter';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();


router.post('/auth', authLimiter, UserController.authUser);
router.post('/check-availability', availabilityCheckLimiter, UserController.checkAvailability);
router.get('/check-verification', pollingLimiter, MagicLinkController.checkVerification);
router.get('/verify-magic-link', authLimiter, MagicLinkController.verifyMagicLink);

router.get('/sol-price', verifyAuth, SolPriceController.getSolPrice);
router.delete('/account', verifyAuth, UserController.deleteAccount);
router.get('/:userId', verifyAuth, UserController.getUser);

export default router;
