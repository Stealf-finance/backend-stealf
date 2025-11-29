import 'dotenv/config';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import arciumRoutes from './routes/arcium.routes.js';
import userRoutes from './routes/user.routes.js';
import { privacyPoolService } from './services/privacy-pool.service.js';

/**
 * Server configuration
 */
const PORT = parseInt(process.env.PORT || '3001', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stealf_backend';

/**
 * Stealf Backend Server (Beta)
 * Express server with Privacy Pool for private transfers
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
    this.app.use((req, _res, next) => {
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
        privacyPool: privacyPoolService.isReady() ? 'ready' : 'not_initialized',
        network: process.env.SOLANA_NETWORK || 'devnet',
      });
    });

    // Arcium routes (includes Privacy Pool)
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
      console.log('\n' + '='.repeat(60));
      console.log('🚀 Starting Stealf Backend Server (Beta)');
      console.log('='.repeat(60) + '\n');

      // Connect to MongoDB
      await this.connectDatabase();

      // Initialize Privacy Pool service
      console.log('🔒 Initializing Privacy Pool...');
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      await privacyPoolService.initialize(rpcUrl);

      // Configure middleware and routes
      this.configureMiddleware();
      this.configureRoutes();

      // Start Express server
      this.app.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(60));
        console.log('✅ Server started successfully!');
        console.log('='.repeat(60));
        console.log(`📡 Server:       http://localhost:${PORT}`);
        console.log(`💾 MongoDB:      ${MONGODB_URI}`);
        console.log(`🔒 Privacy Pool: ${privacyPoolService.isReady() ? 'Ready' : 'Not initialized'}`);
        console.log(`🔗 Solana RPC:   ${rpcUrl}`);
        console.log('='.repeat(60));
        console.log('\n📚 Available endpoints:');
        console.log('   GET  /health');
        console.log('');
        console.log('   🔒 Privacy Pool:');
        console.log('   POST /api/arcium/pool/transfer');
        console.log('   GET  /api/arcium/pool/info');
        console.log('   POST /api/arcium/airdrop');
        console.log('');
        console.log('   👤 Users:');
        console.log('   GET  /api/users/search?username=xxx');
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
