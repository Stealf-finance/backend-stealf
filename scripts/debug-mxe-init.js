#!/usr/bin/env node

/**
 * Debug MXE initialization and create missing accounts manually
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { 
  getMXEAccAddress, 
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress
} from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || '4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs');
const CLUSTER_ID = parseInt(process.env.ARCIUM_CLUSTER_ID || '768109697');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

async function main() {
  console.log('🔍 Debugging MXE initialization...');
  console.log('RPC URL:', RPC_URL);
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Cluster ID:', CLUSTER_ID);
  console.log('Wallet:', WALLET_PATH);
  console.log('');

  // Load wallet
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('✅ Wallet loaded:', payerKeypair.publicKey.toBase58());
    
    // Check balance
    const connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(payerKeypair.publicKey);
    console.log('💰 Balance:', (balance / 1000000000).toFixed(9), 'SOL');
    console.log('');
  } catch (error) {
    console.error('❌ Failed to load wallet:', error.message);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get all required PDAs
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const clusterAccount = getClusterAccAddress(CLUSTER_ID);
  const mempoolAccount = getMempoolAccAddress(PROGRAM_ID);
  const executingPool = getExecutingPoolAccAddress(PROGRAM_ID);
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();
  const arciumProgramId = new PublicKey('9BYVXpgn9CB1KrnwLdzsRDKd7VYX9YH96FjkLwk2Xtq7');

  console.log('📍 Checking required accounts:');
  console.log('');

  // Check each account
  const accounts = [
    { name: 'MXE', pubkey: mxeAccount },
    { name: 'Cluster', pubkey: clusterAccount },
    { name: 'Mempool', pubkey: mempoolAccount },
    { name: 'Executing Pool', pubkey: executingPool },
    { name: 'Fee Pool', pubkey: poolAccount },
    { name: 'Clock', pubkey: clockAccount },
  ];

  let allExist = true;
  for (const account of accounts) {
    const info = await connection.getAccountInfo(account.pubkey);
    if (info) {
      console.log(`✅ ${account.name}: ${account.pubkey.toBase58()} (exists, ${info.data.length} bytes)`);
    } else {
      console.log(`❌ ${account.name}: ${account.pubkey.toBase58()} (does NOT exist)`);
      allExist = false;
    }
  }

  console.log('');
  
  if (allExist) {
    console.log('🎉 All accounts exist! The MXE should be ready.');
    console.log('');
    console.log('If init-mxe still fails, the issue might be:');
    console.log('1. The MXE is already initialized with a different cluster');
    console.log('2. The arcium CLI has a bug');
    console.log('');
    console.log('Try initializing CompDef directly:');
    console.log('node scripts/init-compdef-with-authority.js');
  } else {
    console.log('❌ Some accounts are missing!');
    console.log('');
    console.log('The MXE needs to be initialized. The error you see is because');
    console.log('the arcium CLI is trying to create accounts but failing.');
    console.log('');
    console.log('💡 Solutions:');
    console.log('');
    console.log('Option 1: Use a different cluster offset');
    console.log('   - Edit .env and change ARCIUM_CLUSTER_ID to a new value');
    console.log('   - Try: ARCIUM_CLUSTER_ID=876543219');
    console.log('   - Then run: arcium init-mxe --callback-program 4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs --cluster-offset 876543219 --keypair-path ~/.config/solana/id.json --mempool-size Medium');
    console.log('');
    console.log('Option 2: Initialize manually (advanced)');
    console.log('   - The script would need to build and send the init transaction');
    console.log('   - This is complex due to the many accounts required');
    console.log('');
    console.log('Option 3: Use the existing MXE');
    console.log('   - The MXE at 7UwELMLLE8A2nn3aVPQDC7ysmk7QVFgj984tn5Qbbw26 exists');
    console.log('   - Just initialize CompDef for the new program');
    console.log('   - Update .env: ARCIUM_PROGRAM_ID=4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs');
    console.log('   - Keep ARCIUM_CLUSTER_ID=768109697');
    console.log('   - Then initialize CompDef');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});