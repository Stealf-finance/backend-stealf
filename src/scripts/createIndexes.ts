/**
 * Script de migration : Création des indexes MongoDB
 *
 * Usage:
 *   npm run migrate:indexes
 *
 * ou directement:
 *   tsx src/scripts/createIndexes.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Session } from '../models/Session.js';

dotenv.config({ path: '.env' });

async function createIndexes() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in .env');
    process.exit(1);
  }

  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Créer les indexes pour User
    console.log('📊 Creating indexes for User collection...');
    await User.createIndexes();
    const userIndexes = await User.collection.getIndexes();
    console.log('✅ User indexes created:');
    Object.keys(userIndexes).forEach(indexName => {
      console.log(`   - ${indexName}`);
    });

    // Créer les indexes pour Session
    console.log('\n📊 Creating indexes for Session collection...');
    await Session.createIndexes();
    const sessionIndexes = await Session.collection.getIndexes();
    console.log('✅ Session indexes created:');
    Object.keys(sessionIndexes).forEach(indexName => {
      console.log(`   - ${indexName}`);
    });

    // Stats
    console.log('\n📈 Collection stats:');
    const userCount = await User.countDocuments();
    const sessionCount = await Session.countDocuments();
    console.log(`   - Users: ${userCount}`);
    console.log(`   - Sessions: ${sessionCount}`);

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run migration
createIndexes();
