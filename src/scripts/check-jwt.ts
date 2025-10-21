/**
 * Script pour vérifier le contenu d'un JWT token
 * Usage: npx tsx src/scripts/check-jwt.ts
 */

import mongoose from 'mongoose';
import { User } from '../models/User.js';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function checkJWT() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kero';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Trouver un utilisateur
    const user = await User.findOne({ email: 'louisspaccesi@gmail.com' }).sort({ createdAt: -1 });

    if (!user) {
      console.log('❌ User not found');
      await mongoose.disconnect();
      return;
    }

    console.log('👤 User found:');
    console.log('   - Email:', user.email);
    console.log('   - ID:', user._id);
    console.log('   - Grid Address:', user.gridAddress);
    console.log('   - Solana Wallet:', user.solanaWallet);
    console.log('');

    // Générer un JWT pour tester
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const testToken = jwt.sign(
      {
        user_id: user._id,
        email: user.email,
        address: user.gridAddress,
        grid_user_id: user.gridUserId,
        solana_wallet: user.solanaWallet
      },
      jwtSecret,
      { expiresIn: '7d' }
    );

    console.log('🔑 Test JWT generated:');
    console.log(testToken);
    console.log('');

    // Décoder le JWT
    const decoded = jwt.decode(testToken) as any;
    console.log('📋 JWT Payload:');
    console.log(JSON.stringify(decoded, null, 2));
    console.log('');

    if (decoded.solana_wallet) {
      console.log('✅ solana_wallet is present in JWT:', decoded.solana_wallet);
    } else {
      console.log('❌ solana_wallet is MISSING in JWT!');
    }

    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkJWT();
