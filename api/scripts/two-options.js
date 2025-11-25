#!/usr/bin/env node

/**
 * TWO OPTIONS - Choose your solution
 * 
 * Option 1: Use the existing deployed program (G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp)
 * Option 2: Redeploy to a new address (4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const PROGRAM_DIR = join(process.cwd(), 'arcium-private-transfer');
const LIB_RS_PATH = join(PROGRAM_DIR, 'programs', 'private-transfer', 'src', 'lib.rs');
const ENV_PATH = join(process.cwd(), '.env');

// Two possible program IDs
const EXISTING_PROGRAM_ID = 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp';
const NEW_PROGRAM_ID = '4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs';

console.log('🎯 TWO OPTIONS - Choose Your Solution');
console.log('======================================');
console.log('');
console.log('The issue is simple:');
console.log('The program deployed on-chain has a different ID than what');
console.log('is declared in your source code.');
console.log('');
console.log('You have TWO options:');
console.log('');

// Option 1: Use existing program
console.log('📋 OPTION 1: Use the existing deployed program');
console.log('   Program ID:', EXISTING_PROGRAM_ID);
console.log('   Status: Already deployed and working');
console.log('   MXE: Already initialized');
console.log('   Authority: 12LEGYXA3BBbTFHS7vxEHqmq9tHERu7qrKGycxi1f9h (NOT your wallet)');
console.log('');
console.log('   Pros:');
console.log('   - No need to redeploy');
console.log('   - MXE already initialized');
console.log('   - Ready to use immediately');
console.log('');
console.log('   Cons:');
console.log('   - You do NOT control the authority');
console.log('   - Cannot initialize CompDef (authority mismatch)');
console.log('   - Callbacks will NOT work');
console.log('');
console.log('   Verdict: ❌ NOT RECOMMENDED - callbacks won\'t work');
console.log('');

// Option 2: Use new program
console.log('🚀 OPTION 2: Use the newly deployed program');
console.log('   Program ID:', NEW_PROGRAM_ID);
console.log('   Status: Deployed but not fully configured');
console.log('   MXE: Needs initialization');
console.log('   Authority: DXTwJwdnH6Eh84SPANtCwg4KM4Cuu7HNHFYoztRpaHYU (YOUR wallet)');
console.log('');
console.log('   Pros:');
console.log('   - You control the authority');
console.log('   - Can initialize CompDef');
console.log('   - Callbacks WILL work');
console.log('');
console.log('   Cons:');
console.log('   - Need to initialize MXE');
console.log('   - Need to initialize CompDef');
console.log('');
console.log('   Verdict: ✅ RECOMMENDED - callbacks will work');
console.log('');

console.log('💡 RECOMMENDATION:');
console.log('');
console.log('Use Option 2 (new program) because:');
console.log('1. You control the authority (essential for CompDef)');
console.log('2. Callbacks will work once configured');
console.log('3. You have full control over the program');
console.log('');

console.log('🎯 TO FIX WITH OPTION 2:');
console.log('');
console.log('1. Update source code to match deployed program:');
console.log('   Edit:', LIB_RS_PATH);
console.log('   Change: declare_id!("' + EXISTING_PROGRAM_ID + '")');
console.log('   To: declare_id!("' + NEW_PROGRAM_ID + '")');
console.log('');
console.log('2. Rebuild the program:');
console.log('   arcium build');
console.log('');
console.log('3. Redeploy to the SAME address:');
console.log('   solana program deploy --program-id ' + join(PROGRAM_DIR, 'target', 'deploy', 'arcium_private_transfer-keypair.json') + ' --url https://api.devnet.solana.com ' + join(PROGRAM_DIR, 'target', 'deploy', 'arcium_private_transfer.so'));
console.log('');
console.log('4. Initialize MXE:');
console.log('   arcium init-mxe --callback-program ' + NEW_PROGRAM_ID + ' --cluster-offset 768109697 --keypair-path ~/.config/solana/id.json --mempool-size Medium');
console.log('');
console.log('5. Initialize CompDef:');
console.log('   node scripts/init-compdef-direct.js');
console.log('');
console.log('6. Update .env:');
console.log('   ARCIUM_PROGRAM_ID=' + NEW_PROGRAM_ID);
console.log('');
console.log('7. Restart backend:');
console.log('   npm run dev');
console.log('');
console.log('OR run the complete solution:');
console.log('   node scripts/complete-solution.js');
console.log('');
console.log('📝 Note: The arcium CLI may have bugs. If init-mxe fails,');
console.log('   the accounts might already exist. In that case, just run:');
console.log('   node scripts/init-compdef-direct.js');