import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'http';
import path from 'path';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';

dotenv.config();

// Sentry must init before other imports to capture all errors
import './config/sentry';

import { env } from './config/env';
import { allowedOrigins } from './config/cors';
import logger, { httpLogger } from './config/logger';
import { globalLimiter, swapLimiter, yieldLimiter, walletLimiter } from './middleware/rateLimiter';
import redisClient from './config/redis';
import userRoutes from './routes/userRoutes'
import walletRoutes from './routes/walletRoutes';
import  webhookHeliusRoutes  from './routes/webhookHeliusRoutes'
import swapRoutes from './routes/swapRoutes';
import yieldRoutes from './routes/yieldRoutes';
import statsRoutes from './routes/stats.routes';
import { errorHandler } from './middleware/errorHandler';
import { getHeliusWebhookManager } from './services/helius/webhookManager';
import { getSocketService } from './services/socket/socketService';
import { initMxeKey, isMpcAvailable, getMxeKey } from './services/yield/anchorProvider';

const app = express();

const httpServer = createServer(app);

app.use(helmet());

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(httpLogger);

app.use('/api/helius', express.json({ limit: '5mb' }));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use(globalLimiter);

app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, '../public/.well-known/apple-app-site-association'));
});

app.use('/api/users', userRoutes);
app.use('/api/wallet', walletLimiter, walletRoutes);

app.use('/api/swap', swapLimiter, swapRoutes);
app.use('/api/yield', yieldLimiter, yieldRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/helius', webhookHeliusRoutes);


app.get('/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = redisClient.status === 'ready';
  const mxeInitialized = (() => { try { getMxeKey(); return true; } catch { return false; } })();
  const mpcOk = mxeInitialized && isMpcAvailable();
  const healthy = mongoOk && redisOk;

  const mem = process.memoryUsage();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    },
    dependencies: {
      mongodb: mongoOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      mpc: !mxeInitialized ? 'not_initialized' : mpcOk ? 'available' : 'circuit_breaker_open',
    },
  });
});

app.get('/ready', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = redisClient.status === 'ready';
  const ready = mongoOk && redisOk;

  if (ready) {
    return res.status(200).json({ ready: true });
  }

  return res.status(503).json({
    ready: false,
    dependencies: {
      mongodb: mongoOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
    },
  });
});

app.use(errorHandler);

const PORT = env.PORT;

async function start() {
  try {

    await mongoose.connect(env.MONGODB_URI);
    logger.info('MongoDB connected');

    const heliusWebhookManager = getHeliusWebhookManager();
    await heliusWebhookManager.initialize();
    logger.info('Helius webhook initialized');

    const socketService = getSocketService();
    socketService.initialize(httpServer);
    logger.info('Socket.io initialized');

    // Initialize Arcium MXE key (non-blocking — yield routes will fail gracefully if not ready)
    initMxeKey().catch((err) => {
      logger.warn({ err }, 'Failed to init MXE key — yield endpoints will be unavailable');
    });

    httpServer.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}`);
    })

  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  httpServer.close(async () => {
    try {
      const socketService = getSocketService();
      await socketService.close();
      logger.info('Socket.IO closed');

      await mongoose.connection.close();
      logger.info('MongoDB closed');

      await redisClient.quit();
      logger.info('Redis closed');

      logger.info('All connections closed. Exiting.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
