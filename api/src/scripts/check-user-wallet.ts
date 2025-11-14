import mongoose from 'mongoose';
import { User } from '../models/User.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function checkUserWallet() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kero';
    await mongoose.connect(mongoUri);

    const user = await User.findOne({ email: 'lo.uisspaccesi@gmail.com' });

    if (!user) {
      console.log('❌ User not found');
      await mongoose.disconnect();
      return;
    }

    console.log('\n📋 User Info:');
    console.log('  Email:', user.email);
    console.log('  ID:', user._id.toString());
    console.log('  Solana Wallet:', user.solanaWallet || '❌ NOT SET');
    console.log('  Grid Address:', user.gridAddress || 'N/A');
    console.log('');

    if (!user.solanaWallet) {
      console.log('⚠️  This user has NO Solana wallet!');
      console.log('💡 The wallet should be generated on next login.');
    } else {
      console.log('✅ User has a Solana wallet:', user.solanaWallet);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUserWallet();
