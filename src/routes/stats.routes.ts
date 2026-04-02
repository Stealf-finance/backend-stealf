import { Router } from 'express';
import { StatsController } from '../controllers/StatsController';

const router = Router();

router.get('/', StatsController.getStats);

export default router;
