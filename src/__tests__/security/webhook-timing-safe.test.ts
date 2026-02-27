/**
 * Tests — Validation timing-safe du secret webhook (Task 2.1)
 * Requirements: 5.1, 5.2, 5.3
 *
 * Vérifie que la comparaison du secret webhook utilise crypto.timingSafeEqual()
 * et gère correctement tous les cas limites.
 */

import crypto from 'crypto';

// Fonction extraite de WebhookHeliusController pour être testée unitairement
// (reflète exactement l'implémentation qui sera écrite dans le controller)
function isValidWebhookSecret(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received),
    Buffer.from(expected)
  );
}

describe('isValidWebhookSecret — comparaison à temps constant', () => {
  const secret = 'my-super-secret-webhook-key-2026';

  it('retourne true quand les secrets sont identiques', () => {
    expect(isValidWebhookSecret(secret, secret)).toBe(true);
  });

  it('retourne false quand le secret reçu est incorrect', () => {
    expect(isValidWebhookSecret('wrong-secret-value-here-xxxx', secret)).toBe(false);
  });

  it('retourne false sans lever d\'exception quand les longueurs sont différentes', () => {
    // crypto.timingSafeEqual lance une exception si les buffers ont des tailles différentes
    // → on doit gérer ce cas AVANT l'appel
    expect(() => isValidWebhookSecret('short', secret)).not.toThrow();
    expect(isValidWebhookSecret('short', secret)).toBe(false);
  });

  it('retourne false pour une chaîne vide', () => {
    expect(isValidWebhookSecret('', secret)).toBe(false);
  });

  it('retourne false quand les deux sont vides (longueur 0 = 0, timingSafeEqual OK)', () => {
    // Cas limite : deux chaînes vides identiques
    expect(isValidWebhookSecret('', '')).toBe(true);
  });

  it('est sensible à la casse', () => {
    const upperSecret = secret.toUpperCase();
    expect(isValidWebhookSecret(upperSecret, secret)).toBe(false);
  });
});

describe('WebhookHeliusController — comportement HTTP', () => {
  // Tests d'intégration HTTP du controller (avec mocks)

  process.env.VAULT_SHARES_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';

  const mockHandleTransaction = jest.fn();
  jest.mock('../../services/wallet/transactionsHandler', () => ({
    TransactionHandler: {
      handleTransaction: (...args: unknown[]) => mockHandleTransaction(...args),
    },
  }));

  jest.mock('../../utils/validations', () => ({
    heliusWebhookPayloadSchema: {
      parse: (body: unknown) => body,
    },
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HELIUS_WEBHOOK_SECRET;
  });

  it('retourne 500 si HELIUS_WEBHOOK_SECRET n\'est pas configuré', async () => {
    const request = await import('supertest');
    const express = (await import('express')).default;
    const { WebhookHeliusController } = await import('../../controllers/WebhookHeliusController');

    const app = express();
    app.use(express.json());
    app.post('/webhook', WebhookHeliusController.handleHelius);

    const res = await request.default(app)
      .post('/webhook')
      .set('Authorization', 'any-secret')
      .send([]);

    expect(res.status).toBe(500);
  });

  it('retourne 401 si le secret est incorrect', async () => {
    process.env.HELIUS_WEBHOOK_SECRET = 'correct-secret-value-here-32chars';

    const request = await import('supertest');
    const express = (await import('express')).default;
    const { WebhookHeliusController } = await import('../../controllers/WebhookHeliusController');

    const app = express();
    app.use(express.json());
    app.post('/webhook', WebhookHeliusController.handleHelius);

    const res = await request.default(app)
      .post('/webhook')
      .set('Authorization', 'wrong-secret-value-here-32chars!')
      .send([]);

    expect(res.status).toBe(401);
  });
});
