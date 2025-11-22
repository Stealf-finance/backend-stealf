#!/usr/bin/env node

/**
 * Find the wallet that matches the MXE authority
 */

import { readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Keypair } from '@solana/web3.js';

// MXE Authority (from on-chain data)
const MXE_AUTHORITY = '12LEGYXA3BBbTFHS7vxEHqmq9tHERu7qrKGycxi1f9h';

// Solana config directory
const SOLANA_DIR = join(homedir(), '.config', 'solana');

console.log('🔍 Searching for MXE authority wallet...');
console.log('MXE Authority:', MXE_AUTHORITY);
console.log('Searching in:', SOLANA_DIR);
console.log('');

try {
  // List all JSON files in the solana directory
  const files = readdirSync(SOLANA_DIR).filter(f => f.endsWith('.json'));
  
  console.log('Found', files.length, 'potential keypair files:');
  
  for (const file of files) {
    try {
      const filePath = join(SOLANA_DIR, file);
      const keypairData = JSON.parse(readFileSync(filePath, 'utf8'));
      const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      const publicKey = keypair.publicKey.toBase58();
      
      console.log(`  ${file}: ${publicKey}`);
      
      if (publicKey === MXE_AUTHORITY) {
        console.log('');
        console.log('✅ FOUND IT!');
        console.log(`   File: ${filePath}`);
        console.log(`   Public Key: ${publicKey}`);
        console.log('');
        console.log('To initialize the CompDef, use this wallet:');
        console.log(`   solana config set --keypair ${filePath}`);
        console.log(`   node scripts/init-compdef-with-authority.js`);
        
        // Also show the private key for backup
        console.log('');
        console.log('🔑 Private Key (base58):');
        const bs58 = await import('bs58');
        console.log(`   ${bs58.default.encode(keypair.secretKey)}`);
        
        process.exit(0);
      }
    } catch (error) {
      // Skip files that aren't valid keypairs
      continue;
    }
  }
  
  console.log('');
  console.log('❌ No matching wallet found!');
  console.log('');
  console.log('Options:');
  console.log('1. Check if you have the private key elsewhere');
  console.log('2. Recreate the MXE with your current wallet:');
  console.log('   arcium close-mxe --cluster-offset 768109697 --keypair-path ~/.config/solana/id.json');
  console.log('   arcium init-mxe --cluster-offset 768109697 --keypair-path ~/.config/solana/id.json');
  console.log('3. Look for backup files:');
  console.log('   find ~ -name "*.json" -type f 2>/dev/null | grep -E "(key|pair|wallet)"');
  
} catch (error) {
  console.error('❌ Error reading Solana directory:', error.message);
  process.exit(1);
}