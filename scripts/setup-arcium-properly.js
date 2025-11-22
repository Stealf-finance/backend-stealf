#!/usr/bin/env node

/**
 * Setup Arcium MXE and CompDef properly using the Arcium CLI approach
 * This script shows the correct way to initialize everything
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const PROGRAM_ID = process.env.ARCIUM_PROGRAM_ID || 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp';
const CLUSTER_ID = process.env.ARCIUM_CLUSTER_ID || '768109697';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

console.log('🔧 Setting up Arcium properly...');
console.log('Program ID:', PROGRAM_ID);
console.log('Cluster ID:', CLUSTER_ID);
console.log('RPC URL:', RPC_URL);
console.log('');

// Check if arcium CLI is available
try {
  execSync('arcium --version', { stdio: 'ignore' });
  console.log('✅ Arcium CLI is available');
} catch (error) {
  console.error('❌ Arcium CLI not found. Please install it:');
  console.error('   curl --proto \'=https\' --tlsv1.2 -sSfL https://install.arcium.com/ | bash');
  process.exit(1);
}

// Check if solana CLI is available
try {
  execSync('solana --version', { stdio: 'ignore' });
  console.log('✅ Solana CLI is available');
} catch (error) {
  console.error('❌ Solana CLI not found. Please install it.');
  process.exit(1);
}

console.log('');
console.log('📋 Next steps to fix the callbacks:');
console.log('');
console.log('1. The MXE was created with authority: 12LEGYXA3BBbTFHS7vxEHqmq9tHERu7qrKGycxi1f9h');
console.log('   Current wallet: DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU');
console.log('');
console.log('2. Options:');
console.log('');
console.log('   OPTION A: Find the original wallet');
console.log('   - Look for backup files: find ~ -name "*.json" -type f 2>/dev/null | grep -E "(key|pair|wallet)"');
console.log('   - Check if you have the private key elsewhere');
console.log('');
console.log('   OPTION B: Deploy a new program (recommended)');
console.log('   - This will give you a fresh program ID that you control');
console.log('   - Update .env with the new program ID');
console.log('   - Re-run this setup');
console.log('');
console.log('   OPTION C: Use arcium CLI to close and recreate MXE');
console.log('   - This requires the original wallet authority');
console.log('   - Or you need to find a way to close the existing MXE');
console.log('');
console.log('3. Once you have control, run:');
console.log('   arcium init-mxe --callback-program ' + PROGRAM_ID + ' --cluster-offset ' + CLUSTER_ID + ' --keypair-path ~/.config/solana/id.json --mempool-size Medium');
console.log('   node scripts/init-compdef-with-authority.js');
console.log('');
console.log('4. Then restart your backend and test callbacks');