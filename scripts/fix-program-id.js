#!/usr/bin/env node

/**
 * Quick fix: Rebuild and redeploy with correct program ID
 */

import { execSync } from 'child_process';
import { join } from 'path';

console.log('🔧 Fixing program ID mismatch...');
console.log('');

const PROGRAM_DIR = join(process.cwd(), 'arcium-private-transfer');

try {
  console.log('1. Rebuilding program with new ID...');
  execSync('arcium build', { 
    cwd: PROGRAM_DIR,
    stdio: 'inherit'
  });
  console.log('✅ Program rebuilt');
  
  console.log('');
  console.log('2. Redeploying program...');
  execSync(
    `solana program deploy --program-id ${join(PROGRAM_DIR, 'target', 'deploy', 'arcium_private_transfer-keypair.json')} --url https://api.devnet.solana.com ${join(PROGRAM_DIR, 'target', 'deploy', 'arcium_private_transfer.so')}`,
    { stdio: 'inherit', cwd: PROGRAM_DIR }
  );
  console.log('✅ Program redeployed');
  
  console.log('');
  console.log('🎉 Program ID mismatch fixed!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Initialize MXE: arcium init-mxe --callback-program 4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs --cluster-offset 768109697 --keypair-path ~/.config/solana/id.json --mempool-size Medium');
  console.log('2. Restart backend: npm run dev');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}