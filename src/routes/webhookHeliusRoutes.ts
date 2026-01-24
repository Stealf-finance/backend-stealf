import { Router } from 'express';
import { WebhookHeliusController } from '../controllers/WebhookHeliusController';

const router = Router();

router.post('/helius', WebhookHeliusController.handleHelius);

export default router;