#!/usr/bin/env node

/**
 * Check SOL balance and airdrop if needed
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

async function main() {
  console.log('💰 Checking SOL balance...');
  console.log('RPC URL:', RPC_URL);
  console.log('Wallet:', WALLET_PATH);
  console.log('');

  // Load wallet
  let walletPublicKey;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    const { Keypair } = await import('@solana/web3.js');
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    walletPublicKey = keypair.publicKey;
    console.log('Wallet:', walletPublicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load wallet:', error.message);
    process.exit(1);
  }

  // Check balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(walletPublicKey);
  
  console.log('Balance:', (balance / 1000000000).toFixed(9), 'SOL');
  console.log('');

  if (balance < 100000000) { // Less than 0.1 SOL
    console.log('⚠️  Balance is too low!');
    console.log('   You need at least 0.1 SOL to initialize accounts');
    console.log('');
    console.log('💡 Solutions:');
    console.log('');
    console.log('Option 1: Get airdrop (devnet only)');
    console.log('   solana airdrop 2 ' + walletPublicKey.toBase58() + ' --url devnet');
    console.log('');
    console.log('Option 2: Use a different wallet with SOL');
    console.log('   solana config set --keypair /path/to/wallet/with/sol.json');
    console.log('');
    console.log('Option 3: Transfer SOL to this wallet');
    console.log('   solana transfer --from <source-wallet> ' + walletPublicKey.toBase58() + ' 2 --url devnet');
    console.log('');
    
    // Try airdrop automatically
    console.log('🎯 Attempting automatic airdrop...');
    try {
      execSync(`solana airdrop 2 ${walletPublicKey.toBase58()} --url devnet`, { stdio: 'inherit' });
      console.log('✅ Airdrop successful!');
    } catch (error) {
      console.log('❌ Airdrop failed:', error.message);
      console.log('');
      console.log('Please manually add SOL to your wallet and try again.');
    }
  } else {
    console.log('✅ Balance is sufficient!');
    console.log('');
    console.log('You can now initialize the MXE:');
    console.log('arcium init-mxe --callback-program <program-id> --cluster-offset 768109697 --keypair-path ' + WALLET_PATH + ' --mempool-size Medium');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});