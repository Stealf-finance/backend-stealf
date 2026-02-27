/**
 * Tests — CORS origin-whitelist middleware (Task 1.2)
 * Requirements: 3.1, 3.2, 3.3, 3.4
 *
 * Vérifie que :
 * - Les apps natives (sans Origin) passent toujours
 * - Les origines whitelistées sont acceptées
 * - Les origines inconnues reçoivent 403 en production
 * - Pas de wildcard Access-Control-Allow-Origin: *
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

/**
 * Recréation fidèle du middleware CORS de server.ts pour tests unitaires.
 * Dupliqué ici pour isoler les tests du démarrage complet du serveur.
 */
function buildCorsMiddleware(allowedOrigins: string[], isDev: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (!origin) {
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      return next();
    }

    const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
    const isAllowed = allowedOrigins.includes(origin) || (isDev && isLocalhost);

    if (!isAllowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  };
}

function buildTestApp(allowedOrigins: string[], isDev = false) {
  const app = express();
  app.use(buildCorsMiddleware(allowedOrigins, isDev));
  app.get('/api/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CORS middleware — Req 3.1, 3.2, 3.3, 3.4', () => {
  const whitelist = ['https://app.stealf.fi', 'https://staging.stealf.fi'];

  describe('Requêtes sans en-tête Origin (app native React Native)', () => {
    it('laisse passer les requêtes sans Origin (Req 3.1)', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
    });

    it('ne retourne pas Access-Control-Allow-Origin sur les requêtes natives', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app).get('/api/test');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('répond 200 aux OPTIONS sans Origin', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app).options('/api/test');
      expect(res.status).toBe(200);
    });
  });

  describe('Origines autorisées (whitelist)', () => {
    it('accepte une origine dans la whitelist (Req 3.1)', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'https://app.stealf.fi');
      expect(res.status).toBe(200);
    });

    it('retourne Access-Control-Allow-Origin avec l\'origine exacte (jamais *) (Req 3.3)', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'https://app.stealf.fi');
      expect(res.headers['access-control-allow-origin']).toBe('https://app.stealf.fi');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('accepte le preflight OPTIONS depuis une origine whitelistée', async () => {
      const app = buildTestApp(whitelist);
      const res = await request(app)
        .options('/api/test')
        .set('Origin', 'https://app.stealf.fi');
      expect(res.status).toBe(200);
    });
  });

  describe('Origines non autorisées en production (Req 3.4)', () => {
    it('retourne 403 pour une origine inconnue en production', async () => {
      const app = buildTestApp(whitelist, false); // isDev = false = production
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'https://malicious.example.com');
      expect(res.status).toBe(403);
    });

    it('ne retourne jamais Access-Control-Allow-Origin: * (Req 3.3)', async () => {
      const app = buildTestApp(whitelist, false);
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'https://malicious.example.com');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('Mode développement — localhost autorisé (Req 3.2)', () => {
    it('autorise localhost en développement sans ALLOWED_ORIGINS', async () => {
      const app = buildTestApp([], true); // isDev = true, whitelist vide
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'http://localhost:3000');
      expect(res.status).toBe(200);
    });

    it('autorise localhost:PORT (avec port) en développement', async () => {
      const app = buildTestApp([], true);
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'http://localhost:8080');
      expect(res.status).toBe(200);
    });

    it('n\'autorise pas localhost en production si absent de la whitelist (Req 3.2)', async () => {
      const app = buildTestApp([], false); // isDev = false, whitelist vide
      const res = await request(app)
        .get('/api/test')
        .set('Origin', 'http://localhost:3000');
      expect(res.status).toBe(403);
    });
  });
});
