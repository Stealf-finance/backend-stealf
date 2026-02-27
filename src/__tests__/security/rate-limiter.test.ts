/**
 * Tests — Rate limiters étendus (Task 1.3)
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * Vérifie les configurations des limiters swap, yield, wallet.
 */

import { swapLimiter, yieldLimiter, walletLimiter } from '../../middleware/rateLimiter';

describe('Rate Limiters — Req 6.1, 6.2, 6.3, 6.4, 6.5', () => {
  it('swapLimiter est défini et est une fonction middleware (Req 6.1)', () => {
    expect(swapLimiter).toBeDefined();
    expect(typeof swapLimiter).toBe('function');
  });

  it('yieldLimiter est défini et est une fonction middleware (Req 6.2)', () => {
    expect(yieldLimiter).toBeDefined();
    expect(typeof yieldLimiter).toBe('function');
  });

  it('walletLimiter est défini et est une fonction middleware (Req 6.3)', () => {
    expect(walletLimiter).toBeDefined();
    expect(typeof walletLimiter).toBe('function');
  });

  it('chaque limiter accepte ≤ 3 arguments — pattern middleware Express', () => {
    expect(swapLimiter.length).toBeLessThanOrEqual(3);
    expect(yieldLimiter.length).toBeLessThanOrEqual(3);
    expect(walletLimiter.length).toBeLessThanOrEqual(3);
  });
});

describe('Rate Limiter — réponse 429 sur dépassement (Req 6.4)', () => {
  it('swapLimiter retourne 429 après 10 requêtes depuis la même IP', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;

    const app = express();
    // trust proxy needed only in production; loopback IP is used in tests
    app.use(swapLimiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));

    // 10 requêtes passent (même IP loopback supertest)
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    // La 11ème doit retourner 429
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
  });

  it('la réponse 429 inclut les headers RateLimit standard (Req 6.4)', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;

    const app = express();
    app.use(swapLimiter);
    app.get('/test', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 10; i++) {
      await request(app).get('/test');
    }

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    // standardHeaders: true génère RateLimit-* (IETF draft) ou X-RateLimit-* (legacy)
    const hasRateLimitHeader =
      res.headers['ratelimit-limit'] !== undefined ||
      res.headers['x-ratelimit-limit'] !== undefined;
    expect(hasRateLimitHeader).toBe(true);
  });
});
