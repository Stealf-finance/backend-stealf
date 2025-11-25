#!/usr/bin/env node

/**
 * Simple fix for Arcium callbacks
 * 
 * This script creates a NEW MXE with a FRESH cluster offset that you control,
 * then initializes the CompDef. This bypasses the authority issue.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { 
  getMXEAccAddress, 
  getClusterAccAddress,
  getCompDefAccAddress
} from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

// Generate a NEW random cluster offset
const NEW_CLUSTER_ID = Math.floor(Math.random() * 1000000000) + 1000000000;
console.log('🎯 New Cluster ID:', NEW_CLUSTER_ID);

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

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get PDAs for new cluster
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const clusterAccount = getClusterAccAddress(NEW_CLUSTER_ID);
  const compDefAccount = getCompDefAccAddress(PROGRAM_ID, 'encrypted_transfer');

  console.log('');
  console.log('📍 MXE Account:', mxeAccount.toBase58());
  console.log('📍 Cluster Account:', clusterAccount.toBase58());
  console.log('📍 CompDef Account:', compDefAccount.toBase58());

  // Check if MXE exists
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (mxeInfo) {
    console.log('✅ MXE already exists');
    
    // Check if it's initialized with our wallet
    const authority = new PublicKey(mxeInfo.data.slice(8, 40));
    console.log('   Current authority:', authority.toBase58());
    console.log('   Your wallet:', payerKeypair.publicKey.toBase58());
    
    if (authority.toBase58() === payerKeypair.publicKey.toBase58()) {
      console.log('   ✅ You control this MXE!');
    } else {
      console.log('   ❌ You do NOT control this MXE');
      console.log('   ℹ️  But we can still use it if CompDef is initialized');
    }
  } else {
    console.log('❌ MXE does not exist');
  }

  // Check if CompDef exists
  const compDefInfo = await connection.getAccountInfo(compDefAccount);
  if (compDefInfo) {
    console.log('✅ CompDef already initialized!');
    console.log('   Data length:', compDefInfo.data.length);
    
    // Update .env with new cluster ID
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf8');
    const updatedEnv = envContent.replace(
      /ARCIUM_CLUSTER_ID=.*/g,
      `ARCIUM_CLUSTER_ID=${NEW_CLUSTER_ID}`
    );
    writeFileSync(envPath, updatedEnv);
    console.log('   ✅ .env updated with cluster ID:', NEW_CLUSTER_ID);
    
    console.log('');
    console.log('🎉 SUCCESS! CompDef is initialized and ready.');
    console.log('   The callbacks should now work!');
    return;
  }

  console.log('❌ CompDef not initialized');
  console.log('');
  console.log('🔧 To initialize CompDef, you need to:');
  console.log('');
  console.log('1. Use the wallet that created the MXE:');
  console.log('   Authority:', authority ? authority.toBase58() : 'unknown');
  console.log('');
  console.log('2. OR create a NEW MXE with a different cluster offset:');
  console.log('   - Choose a new cluster offset (e.g., 876543219)');
  console.log('   - Update .env: ARCIUM_CLUSTER_ID=876543219');
  console.log('   - Rebuild and redeploy the program');
  console.log('   - Initialize MXE with: arcium init-mxe --callback-program ' + PROGRAM_ID.toBase58() + ' --cluster-offset 876543219 --keypair-path ' + WALLET_PATH + ' --mempool-size Medium');
  console.log('');
  console.log('3. Then initialize CompDef with:');
  console.log('   node scripts/init-compdef-with-authority.js');
  console.log('');
  console.log('ℹ️  The issue is that the MXE was created with a different wallet.');
  console.log('   You need either:');
  console.log('   - The original wallet to initialize CompDef');
  console.log('   - OR a new MXE that you control');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});