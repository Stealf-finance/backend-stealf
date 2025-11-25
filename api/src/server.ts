import 'dotenv/config';
import crypto from 'crypto';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { initTelegramBot } from './services/telegram.service.js';
import mixerRoutes from './routes/mixer.routes.js';
import userRoutes from './routes/user.routes.js';
import arciumRoutes from './routes/arcium.routes.js';
import { simpleMixerService } from './services/mixer/simple-mixer.service.js';
import { privacyPoolService } from './services/privacy-pool.service.js';
import { Connection } from '@solana/web3.js';

// Polyfill crypto.getRandomValues for Node.js (required by @noble/hashes)
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = crypto;
}
if (typeof globalThis.crypto.getRandomValues === 'undefined') {
  globalThis.crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      return crypto.randomFillSync(array) as T;
    }
    return array;
  };
}

/**
 * Server configuration
 */
const PORT = parseInt(process.env.PORT || '3001', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stealf_backend';
const ENABLE_TELEGRAM = process.env.ENABLE_TELEGRAM === 'true';

/**
 * Stealf Backend Server
 * Express server with MongoDB, Privacy Pool, Simple Mixer, and User Management
 */
class SteafBackendServer {
  private app: Express;

  constructor() {
    this.app = express();
  }

  /**
   * Initialize MongoDB connection
   */
  async connectDatabase(): Promise<void> {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('✅ MongoDB connected successfully');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      console.log('⚠️  Server will continue without database');
      console.log('   Some features may not work properly');
    }
  }

  /**
   * Configure Express middleware
   */
  configureMiddleware(): void {
    console.log('🔧 Configuring middleware...');

    // CORS
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Configure API routes
   */
  configureRoutes(): void {
    console.log('🔧 Configuring routes...');

    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mixer: {
          initialized: simpleMixerService.isInitialized(),
          rpcUrl: process.env.SOLANA_RPC_URL,
          network: process.env.SOLANA_NETWORK || 'devnet',
        },
      });
    });

    // Simple Mixer routes
    this.app.use('/api/mixer', mixerRoutes);

    // Arcium Privacy Pool routes
    this.app.use('/api/arcium', arciumRoutes);

    // User routes (search by username)
    this.app.use('/api/users', userRoutes);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`,
      });
    });

    // Error handler
    this.app.use((error: any, _req: Request, res: Response, _next: any) => {
      console.error('Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal Server Error',
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Stealf Backend Server');

      // Connect to MongoDB
      await this.connectDatabase();

      // Initialize Simple Mixer service
      console.log('🌀 Initializing Simple Mixer...');
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      await simpleMixerService.initialize(connection);

      // Initialize Privacy Pool service
      console.log('🔒 Initializing Privacy Pool...');
      await privacyPoolService.initialize(rpcUrl);

      // Configure middleware and routes
      this.configureMiddleware();
      this.configureRoutes();

      // Start Telegram bot if enabled
      if (ENABLE_TELEGRAM) {
        console.log('🤖 Starting Telegram bot...');
        initTelegramBot();
      }

      // Start Express server (listen on all interfaces for React Native access)
      this.app.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(60));
        console.log('✅ Server started successfully!');
        console.log('='.repeat(60));
        console.log(`📡 Server:       http://localhost:${PORT}`);
        console.log(`🌀 Mixer:        ${simpleMixerService.isInitialized() ? 'Initialized' : 'Not initialized'}`);
        console.log(`🔒 Privacy Pool: ${privacyPoolService.isReady() ? 'Ready' : 'Not initialized'}`);
        console.log(`🔗 Solana RPC:   ${process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'}`);
        console.log(`🤖 Telegram:     ${ENABLE_TELEGRAM ? 'Enabled' : 'Disabled'}`);
        console.log('='.repeat(60));
        console.log('\n📚 Available endpoints:');
        console.log('   GET  /health');
        console.log('');
        console.log('   🔒 Privacy Pool (Link-Breaking Transfers):');
        console.log('   POST /api/arcium/pool/transfer    (Private: Public → Pool → Private)');
        console.log('   GET  /api/arcium/pool/info');
        console.log('   POST /api/arcium/pool/deposit/build');
        console.log('');
        console.log('   🌀 Simple Mixer (Alternative):');
        console.log('   POST /api/mixer/transfer');
        console.log('   POST /api/mixer/deposit');
        console.log('   POST /api/mixer/withdraw');
        console.log('   POST /api/mixer/status');
        console.log('   GET  /api/mixer/stats');
        console.log('');
        console.log('   👤 User Management:');
        console.log('   GET  /api/users/check-username');
        console.log('   POST /api/users/register');
        console.log('   GET  /api/users/search');
        console.log('='.repeat(60) + '\n');
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down server gracefully...');

    try {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');
    } catch (error) {
      console.error('Error closing MongoDB:', error);
    }

    process.exit(0);
  }
}

/**
 * Start the server
 */
const server = new SteafBackendServer();

server.start().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});

// Handle shutdown signals
process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

export default server;
