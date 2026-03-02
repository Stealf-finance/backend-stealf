import { Router } from 'express';
import { verifyAuth } from '../middleware/verifyAuth';
import { PointsController } from '../controllers/PointsController';

const router = Router();
router.use(verifyAuth);

router.get('/', PointsController.getPoints);

export default router;
