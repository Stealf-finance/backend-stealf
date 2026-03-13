import { Router } from 'express';
import { WebhookHeliusController } from '../controllers/WebhookHeliusController';
import { WebhookVaultController } from '../controllers/WebhookVaultController';

const router = Router();

router.post('/helius', WebhookHeliusController.handleHelius);
router.post('/vault', WebhookVaultController.handleVaultWebhook);

export default router;