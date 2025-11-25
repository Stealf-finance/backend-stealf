#!/usr/bin/env node

/**
 * Complete Arcium Redeployment Script
 * 
 * This script:
 * 1. Deploys a NEW Arcium program (so you control the authority)
 * 2. Initializes MXE with the new program
 * 3. Initializes CompDef
 * 4. Updates .env with new addresses
 * 5. Restarts the backend
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const CLUSTER_ID = parseInt(process.env.ARCIUM_CLUSTER_ID || '768109697');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

// Arcium v0.4.0 program ID
const ARCIUM_PROGRAM_ID = new PublicKey('9BYVXpgn9CB1KrnwLdzsRDKd7VYX9YH96FjkLwk2Xtq7');

console.log('🚀 Complete Arcium Redeployment');
console.log('=================================');
console.log('RPC URL:', RPC_URL);
console.log('Cluster ID:', CLUSTER_ID);
console.log('Wallet:', WALLET_PATH);
console.log('');

async function main() {
  // Load wallet
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('✅ Wallet loaded:', payerKeypair.publicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load wallet:', error.message);
    process.exit(1);
  }

  // Check if arcium CLI is available
  try {
    execSync('arcium --version', { stdio: 'ignore' });
    console.log('✅ Arcium CLI available');
  } catch (error) {
    console.error('❌ Arcium CLI not found. Install it:');
    console.error('   curl --proto \'=https\' --tlsv1.2 -sSfL https://install.arcium.com/ | bash');
    process.exit(1);
  }

  // Check if anchor is available
  try {
    execSync('anchor --version', { stdio: 'ignore' });
    console.log('✅ Anchor CLI available');
  } catch (error) {
    console.error('❌ Anchor CLI not found. Install it:');
    console.error('   npm install -g @coral-xyz/anchor-cli');
    process.exit(1);
  }

  console.log('');
  console.log('📦 Step 1: Building Arcium program...');
  
  try {
    // Build the program
    execSync('arcium build', { 
      cwd: join(process.cwd(), 'arcium-private-transfer'),
      stdio: 'inherit'
    });
    console.log('✅ Program built successfully');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🚀 Step 2: Deploying new Arcium program...');
  
  let newProgramId;
  try {
    // Deploy with a new keypair
    const deployOutput = execSync(
      `solana program deploy --program-id ${join(process.cwd(), 'arcium-private-transfer', 'target', 'deploy', 'arcium_private_transfer-keypair.json')} --url ${RPC_URL} ${join(process.cwd(), 'arcium-private-transfer', 'target', 'deploy', 'arcium_private_transfer.so')}`,
      { encoding: 'utf8' }
    );
    
    // Extract program ID from output
    const match = deployOutput.match(/Program Id: ([A-Za-z0-9]+)/);
    if (match) {
      newProgramId = match[1];
      console.log('✅ Program deployed:', newProgramId);
    } else {
      // Try to get from keypair file
      const keypairData = JSON.parse(readFileSync(
        join(process.cwd(), 'arcium-private-transfer', 'target', 'deploy', 'arcium_private_transfer-keypair.json'),
        'utf8'
      ));
      const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      newProgramId = keypair.publicKey.toBase58();
      console.log('✅ Program deployed:', newProgramId);
    }
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('⚙️  Step 3: Initializing MXE...');
  
  try {
    execSync(
      `arcium init-mxe --callback-program ${newProgramId} --cluster-offset ${CLUSTER_ID} --keypair-path ${WALLET_PATH} --mempool-size Medium --rpc-url ${RPC_URL}`,
      { stdio: 'inherit' }
    );
    console.log('✅ MXE initialized');
  } catch (error) {
    console.error('❌ MXE initialization failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('📋 Step 4: Initializing CompDef...');
  
  // Update .env with new program ID
  const envPath = join(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf8');
  const updatedEnv = envContent.replace(
    /ARCIUM_PROGRAM_ID=.*/g,
    `ARCIUM_PROGRAM_ID=${newProgramId}`
  );
  writeFileSync(envPath, updatedEnv);
  console.log('✅ .env updated with new program ID');

  // Initialize CompDef
  try {
    execSync(`node scripts/init-compdef-with-authority.js`, { stdio: 'inherit' });
    console.log('✅ CompDef initialized');
  } catch (error) {
    console.error('❌ CompDef initialization failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🔄 Step 5: Restarting backend...');
  
  try {
    // Kill existing backend
    try {
      execSync('pkill -f "npm start"', { stdio: 'ignore' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      // Process might not be running
    }
    
    // Start backend
    execSync('npm start > /tmp/backend.log 2>&1 &', { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if it's running
    execSync('curl -s http://localhost:3001/health > /dev/null');
    console.log('✅ Backend restarted');
  } catch (error) {
    console.error('❌ Backend restart failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🎉 SUCCESS! Everything is now properly configured!');
  console.log('');
  console.log('📊 Summary:');
  console.log('   - New Program ID:', newProgramId);
  console.log('   - MXE initialized with your wallet');
  console.log('   - CompDef initialized');
  console.log('   - Backend restarted');
  console.log('');
  console.log('✨ The callbacks should now work correctly!');
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Test an encrypted transfer');
  console.log('   2. Monitor for callbacks: solana logs ' + newProgramId + ' --url devnet');
  console.log('   3. Check backend logs: tail -f /tmp/backend.log');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});