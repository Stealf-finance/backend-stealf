/**
 * Script de nettoyage de la base de données
 * Supprime tous les utilisateurs pour forcer la régénération des wallets
 *
 * Usage: npx tsx src/scripts/clean-users.ts
 */

import mongoose from 'mongoose';
import { User } from '../models/User.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function cleanUsers() {
  try {
    console.log('🔌 Connecting to MongoDB...');

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kero';
    await mongoose.connect(mongoUri);

    console.log('✅ Connected to MongoDB\n');

    // Lister tous les utilisateurs
    const users = await User.find({});
    console.log(`📋 Found ${users.length} user(s) in database:\n`);

    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email}`);
      console.log(`   - ID: ${user._id}`);
      console.log(`   - Grid Address: ${user.gridAddress || 'N/A'}`);
      console.log(`   - Solana Wallet: ${user.solanaWallet || 'N/A'}`);
      console.log(`   - Created: ${user.createdAt}`);
      console.log('');
    });

    if (users.length === 0) {
      console.log('✅ No users to delete. Database is already clean.');
      await mongoose.disconnect();
      return;
    }

    // Demander confirmation
    console.log('⚠️  WARNING: This will DELETE ALL USERS from the database!');
    console.log('⚠️  This action cannot be undone.\n');

    // Suppression automatique (pas de prompt en script)
    console.log('🗑️  Deleting all users...');
    const result = await User.deleteMany({});

    console.log(`✅ Deleted ${result.deletedCount} user(s) successfully!\n`);
    console.log('📝 Next steps:');
    console.log('   1. Restart the API server');
    console.log('   2. Create a new account via the mobile app');
    console.log('   3. A new Solana wallet will be automatically generated\n');

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Exécuter le script
cleanUsers();
