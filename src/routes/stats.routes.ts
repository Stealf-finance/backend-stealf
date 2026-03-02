import { Router } from 'express';
import { StatsController } from '../controllers/StatsController';

const router = Router();

// Endpoint public — pas de verifyAuth (stats agrégées, aucune donnée personnelle)
router.get('/', StatsController.getStats);

export default router;
