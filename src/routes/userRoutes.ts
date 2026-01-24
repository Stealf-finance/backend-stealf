import { Router } from 'express';
import { UserController } from '../controllers/authController';
import { MagicLinkController } from '../controllers/magicLinkController';
import { SolPriceController } from '../controllers/solPriceController';
import { availabilityCheckLimiter } from '../middleware/rateLimiter';
import { verifyAuth } from '../middleware/verifyAuth';

const router = Router();


router.post('/auth', UserController.authUser);
router.post('/check-availability', availabilityCheckLimiter, UserController.checkAvailability);
router.get('/check-verification', MagicLinkController.checkVerification);
router.get('/verify-magic-link', MagicLinkController.verifyMagicLink);

router.get('/sol-price', verifyAuth, SolPriceController.getSolPrice);
router.get('/:userId', verifyAuth, UserController.getUser);

export default router;