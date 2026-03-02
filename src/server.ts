// dotenv MUST be loaded before any other import that reads process.env at module load time
import 'dotenv/config';
import { validateEnv } from './utils/validateEnv';

// SECURITY: Fail-fast if critical env vars are missing — runs before any network call
validateEnv();

// Suppress all console output in production
if (process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'http';
import path from 'path';
import helmet from 'helmet';
import userRoutes from './routes/userRoutes'
import walletRoutes from './routes/walletRoutes';
import  webhookHeliusRoutes  from './routes/webhookHeliusRoutes'
import privateTransferRoutes from './routes/privateTransferRoutes';
import swapRoutes from './routes/swapRoutes';
import yieldRoutes from './routes/yieldRoutes';
import stealthRoutes from './routes/stealth.routes';
import lendingRoutes from './routes/lending.routes';
import pointsRoutes from './routes/points.routes';
import statsRoutes from './routes/stats.routes';
import { errorHandler } from './middleware/errorHandler';
import { getStealthScannerService } from './services/stealth/stealth-scanner.service';
import { getHeliusWebhookManager } from './services/helius/webhookManager';
import { getSocketService } from './services/socket/socketService';
import {
  swapLimiter,
  yieldLimiter,
  walletLimiter,
} from './middleware/rateLimiter';

const app = express();

const httpServer = createServer(app);

// SECURITY: HTTP security headers (helmet) — before all other middleware
// contentSecurityPolicy disabled to avoid breaking the Rhino.fi WebView
app.use(helmet({ contentSecurityPolicy: false }));

// SECURITY: Limit request body size to prevent DoS
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve Apple App Site Association file
// SECURITY: Use relative path instead of hardcoded absolute path
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, '../public/.well-known/apple-app-site-association'));
});

// SECURITY: CORS — restrict to known origins (no wildcard in production)
// ALLOWED_ORIGINS: comma-separated list of allowed web origins (e.g. https://app.stealf.fi)
// If empty/unset: web requests with an Origin header are blocked in production (safe for mobile-only beta)
// React Native native builds never send Origin → always allowed regardless of this setting
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins: string[] = rawAllowedOrigins
  ? rawAllowedOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // React Native native builds do not send Origin — always allow
  if (!origin) {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  }

  // In development, allow localhost origins by default
  const isDev = process.env.NODE_ENV !== 'production';
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
});

// SECURITY: Rate limiting per route group
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletLimiter, walletRoutes);
app.use('/api/private-transfer', walletLimiter, privateTransferRoutes);

app.use('/api/swap', swapLimiter, swapRoutes);
app.use('/api/yield', yieldLimiter, yieldRoutes);
app.use('/api/lending', yieldLimiter, lendingRoutes);
app.use('/api/stealth', walletLimiter, stealthRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/helius', webhookHeliusRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
app.use(errorHandler);

const PORT = process.env.PORT;

// SECURITY: Graceful shutdown on SIGTERM/SIGINT
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown…`);

  // Force exit after 10 seconds
  const forceExit = setTimeout(() => {
    console.error('[Shutdown] Graceful shutdown timed out after 10s. Forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        console.log('[Shutdown] HTTP server closed.');
        resolve();
      });
    });

    await mongoose.connection.close();
    console.log('[Shutdown] MongoDB connection closed.');

    console.log('[Shutdown] Graceful shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error during shutdown:', err);
    process.exit(1);
  }
}

async function start() {
  try {

    await mongoose.connect(process.env.MONGODB_URI!);
    console.log('MongoDB connected');

    const webhookUrl = process.env.WEBHOOK_URL || '';
    const heliusWebhookManager = getHeliusWebhookManager();
    await heliusWebhookManager.initialize(webhookUrl);
    console.log('Helius webhook initialized');

    const socketService = getSocketService();
    socketService.initialize(httpServer);
    console.log('Socket.io initialized');

    // Start stealth scanning job (60s interval)
    getStealthScannerService().startScanningJob();

    httpServer.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    // Register graceful shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error(' Failed to start server:', error);
    process.exit(1);
  }
}

start();
