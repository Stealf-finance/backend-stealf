/**
 * Configuration Express centralisée
 * Regroupe middleware, routes, et error handling
 */

import express, { Express } from 'express';
import cors from 'cors';
import gridRoutes from '../routes/grid.routes.js';
import internalRoutes from '../routes/internal.js';
import walletRoutes from '../routes/wallet.routes.js';
import transactionRoutes from '../routes/transaction.routes.js';
// import privateTransactionRoutes from '../routes/private-transaction.routes.js';
// import arciumRoutes from '../routes/arcium.routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

/**
 * Créer et configurer l'application Express
 */
export function createApp(): Express {
  const app = express();

  // ═══════════════════════════════════════════════════════════════
  // MIDDLEWARE DE BASE
  // ═══════════════════════════════════════════════════════════════

  // CORS - TODO: Restreindre en production
  app.use(cors());

  // Body parser
  app.use(express.json());

  // Request logging (simple)
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ROUTES
  // ═══════════════════════════════════════════════════════════════

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'kero-auth-bridge',
      version: '1.0.0'
    });
  });

  // Grid Protocol routes
  app.use('/grid', gridRoutes);

  // Wallet routes
  app.use('/api/v1/wallet', walletRoutes);

  // Transaction routes
  app.use('/api/v1/transaction', transactionRoutes);

  // Private transaction routes (Arcium MPC) - Disabled for now
  // app.use('/api/v1/transaction', privateTransactionRoutes);

  // Arcium MPC routes (100% private) - Disabled for now
  // app.use('/api/arcium', arciumRoutes);

  // Internal routes
  app.use('/internal', internalRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Route not found',
      path: req.path
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════

  // Middleware d'erreur centralisé (doit être en dernier)
  app.use(errorHandler);

  return app;
}
