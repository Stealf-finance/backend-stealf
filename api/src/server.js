import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { initTelegramBot } from './services/telegram.service.js';
import umbraRoutes from './routes/umbra.routes.js';
import mixerRoutes from './routes/mixer.routes.js';
import arciumRoutes from './routes/arcium.routes.js';
import arciumCircuitRoutes from './routes/arcium-circuit.routes.js';
import { umbraClientService } from './services/umbra/umbra-client.service.js';
import { indexerService } from './services/umbra/indexer.service.js';
import { simpleMixerService } from './services/mixer/simple-mixer.service.js';
import { encryptedTransferService } from './services/arcium/encrypted-transfer.service.js';
import { privacyPoolService } from './services/privacy-pool.service.js';
import { Connection } from '@solana/web3.js';
// Polyfill crypto.getRandomValues for Node.js (required by @noble/hashes)
if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = crypto;
}
if (typeof globalThis.crypto.getRandomValues === 'undefined') {
    globalThis.crypto.getRandomValues = (array) => {
        if (array) {
            return crypto.randomFillSync(array);
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
 * Express server with MongoDB, Umbra Privacy, and basic infrastructure
 */
class SteafBackendServer {
    constructor() {
        this.app = express();
    }
    /**
     * Initialize MongoDB connection
     */
    async connectDatabase() {
        try {
            await mongoose.connect(MONGODB_URI);
            console.log('✅ MongoDB connected successfully');
        }
        catch (error) {
            console.error('❌ MongoDB connection failed:', error);
            console.log('⚠️  Server will continue without database');
            console.log('   Some features may not work properly');
        }
    }
    /**
     * Configure Express middleware
     */
    configureMiddleware() {
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
    configureRoutes() {
        console.log('🔧 Configuring routes...');
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                umbra: {
                    initialized: umbraClientService.isInitialized(),
                    rpcUrl: process.env.SOLANA_RPC_URL,
                    network: process.env.SOLANA_NETWORK || 'devnet',
                },
            });
        });
        // Umbra Privacy routes
        this.app.use('/api/umbra', umbraRoutes);
        // Simple Mixer routes
        this.app.use('/api/mixer', mixerRoutes);
        // Arcium Encrypted Transfer routes
        this.app.use('/api/arcium', arciumRoutes);
        // Arcium Circuit file serving (for MPC nodes)
        this.app.use('/', arciumCircuitRoutes);
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                message: `Route ${req.method} ${req.path} not found`,
            });
        });
        // Error handler
        this.app.use((error, req, res, next) => {
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
    async start() {
        try {
            console.log('\n' + '='.repeat(60));
            console.log('🚀 Starting Stealf Backend Server');
            console.log('='.repeat(60) + '\n');
            // Connect to MongoDB
            await this.connectDatabase();
            // Initialize Umbra Privacy client
            console.log('🛡️  Initializing Umbra Privacy...');
            await umbraClientService.initialize();
            // Initialize Indexer service
            console.log('📊 Initializing Indexer...');
            await indexerService.initialize();
            // Initialize Simple Mixer service
            console.log('🌀 Initializing Simple Mixer...');
            const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
            const connection = new Connection(rpcUrl, 'confirmed');
            await simpleMixerService.initialize(connection);
            // Initialize Arcium Encrypted Transfer service
            console.log('🔐 Initializing Arcium Encrypted Transfers...');
            await encryptedTransferService.initialize(connection);
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
                console.log(`💾 MongoDB:      ${MONGODB_URI}`);
                console.log(`🛡️  Umbra:       ${umbraClientService.isInitialized() ? 'Initialized' : 'Not initialized'}`);
                console.log(`🔗 Solana RPC:   ${process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'}`);
                console.log(`🤖 Telegram:     ${ENABLE_TELEGRAM ? 'Enabled' : 'Disabled'}`);
                console.log('='.repeat(60));
                console.log('\n📚 Available endpoints:');
                console.log('   GET  /health');
                console.log('');
                console.log('   🛡️  Umbra Privacy (ZK Proofs - Currently Unavailable):');
                console.log('   POST /api/umbra/deposit/public');
                console.log('   POST /api/umbra/deposit/confidential');
                console.log('   POST /api/umbra/claim');
                console.log('   GET  /api/umbra/deposits/claimable');
                console.log('   GET  /api/umbra/deposits/claimed');
                console.log('   GET  /api/umbra/transactions');
                console.log('   GET  /api/umbra/balance');
                console.log('');
                console.log('   🌀 Simple Mixer (Privacy without ZK):');
                console.log('   POST /api/mixer/transfer    (One-step: Public → Pool → Private)');
                console.log('   POST /api/mixer/deposit');
                console.log('   POST /api/mixer/withdraw');
                console.log('   POST /api/mixer/status');
                console.log('   GET  /api/mixer/stats');
                console.log('');
                console.log('   🔐 Arcium Encrypted Transfers (MPC-powered, amounts HIDDEN):');
                console.log('   POST /api/arcium/transfer/encrypted');
                console.log('   POST /api/arcium/transfer/decrypt');
                console.log('   POST /api/arcium/keypair/generate');
                console.log('   GET  /api/arcium/transfers/:userId');
                console.log('   GET  /api/arcium/received/:address');
                console.log('   GET  /api/arcium/stats');
                console.log('');
                console.log('   🔒 Privacy Pool (Link-Breaking Transfers):');
                console.log('   POST /api/arcium/pool/transfer    (Public → Pool → Private)');
                console.log('   GET  /api/arcium/pool/info');
                console.log('   POST /api/arcium/pool/deposit/build');
                console.log('='.repeat(60) + '\n');
            });
        }
        catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }
    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('\n🛑 Shutting down server gracefully...');
        try {
            await mongoose.connection.close();
            console.log('✅ MongoDB connection closed');
        }
        catch (error) {
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
