/**
 * Script pour forcer la mise à jour des JWT tokens
 * Supprime toutes les sessions pour forcer une reconnexion
 *
 * Usage: npx tsx src/scripts/refresh-jwt.ts
 */

import mongoose from 'mongoose';
import { Session } from '../models/Session.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function refreshJWT() {
  try {
    console.log('🔌 Connecting to MongoDB...');

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kero';
    await mongoose.connect(mongoUri);

    console.log('✅ Connected to MongoDB\n');

    // Supprimer toutes les sessions
    const result = await Session.deleteMany({});
    console.log(`🗑️  Deleted ${result.deletedCount} session(s)\n`);

    console.log('✅ All sessions cleared!');
    console.log('📝 Users will automatically get new JWT tokens on next login\n');

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Exécuter le script
refreshJWT();
