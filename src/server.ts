/**
 * Stealf Auth Bridge - Point d'entrée du serveur
 * Bridge d'authentification pour Grid Protocol (Squads)
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createApp } from './config/app.js';

// Charger variables d'environnement
dotenv.config({ path: '.env' });

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0'; // Écouter sur toutes interfaces réseau

/**
 * Connexion à MongoDB
 */
async function connectDatabase(): Promise<void> {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.warn('⚠️  No MONGODB_URI found, running without MongoDB');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    console.warn('⚠️  Starting server without MongoDB...');
  }
}

/**
 * Démarrage du serveur
 */
async function startServer(): Promise<void> {
  // Connexion MongoDB d'abord
  await connectDatabase();

  // Créer application Express
  const app = createApp();

  // Démarrer le serveur
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🚀 Kero Auth Bridge Server`);
    console.log(`${'═'.repeat(60)}\n`);
    console.log(`🌐 Server running on: http://localhost:${PORT}`);
    console.log(`🌍 Network: http://${HOST}:${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}\n`);

    console.log(`📋 Available Routes:\n`);
    console.log(`  🔐 AUTHENTICATION:`);
    console.log(`    POST   /grid/auth                        - Initiate Auth (Send OTP)`);
    console.log(`    POST   /grid/auth/verify                 - Verify Auth OTP + JWT\n`);

    console.log(`  👤 ACCOUNT MANAGEMENT:`);
    console.log(`    POST   /grid/accounts                    - Create Account (Send OTP)`);
    console.log(`    POST   /grid/accounts/verify             - Verify OTP + Create Wallet`);
    console.log(`    GET    /grid/accounts/:address           - Get Account Details`);
    console.log(`    PATCH  /grid/accounts/:address           - Update Account`);
    console.log(`    GET    /grid/accounts/:address/balances  - Get Balance`);
    console.log(`    GET    /grid/accounts/:address/transactions - Get Transactions\n`);

    console.log(`  ⚙️  UTILITIES:`);
    console.log(`    GET    /health                           - Health Check`);
    console.log(`    POST   /internal/generate-hpke-keys      - Generate HPKE Keys\n`);

    console.log(`${'═'.repeat(60)}\n`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received, shutting down gracefully...`);

    // Fermer le serveur HTTP
    server.close(() => {
      console.log('✅ HTTP server closed');

      // Fermer connexion MongoDB
      mongoose.connection.close().then(() => {
        console.log('✅ MongoDB connection closed');
        process.exit(0);
      }).catch((err) => {
        console.error('❌ Error closing MongoDB:', err);
        process.exit(1);
      });
    });

    // Force shutdown après 10s
    setTimeout(() => {
      console.error('⚠️  Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  // Handlers pour signaux système
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handler pour erreurs non gérées
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });
}

// Démarrer le serveur
startServer().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
