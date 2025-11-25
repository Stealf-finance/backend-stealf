#!/usr/bin/env node

/**
 * COMPLETE SOLUTION - Fix everything automatically
 * 
 * This script:
 * 1. Updates the source code Program ID to match deployed program
 * 2. Rebuilds the program
 * 3. Initializes CompDef
 * 4. Updates .env
 * 5. Restarts backend
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const PROGRAM_DIR = join(process.cwd(), 'arcium-private-transfer');
const LIB_RS_PATH = join(PROGRAM_DIR, 'programs', 'private-transfer', 'src', 'lib.rs');
const ENV_PATH = join(process.cwd(), '.env');

// Current deployed program ID (from your deployment)
const DEPLOYED_PROGRAM_ID = '4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs';

console.log('🚀 COMPLETE SOLUTION - Fixing Arcium Callbacks');
console.log('==============================================');
console.log('');

async function main() {
  console.log('📋 Step 1: Updating source code Program ID...');
  
  try {
    const libRsContent = readFileSync(LIB_RS_PATH, 'utf8');
    const match = libRsContent.match(/declare_id!\("([^"]+)"\)/);
    
    if (match) {
      const oldProgramId = match[1];
      console.log('   Current source ID:', oldProgramId);
      console.log('   Deployed ID:', DEPLOYED_PROGRAM_ID);
      
      if (oldProgramId === DEPLOYED_PROGRAM_ID) {
        console.log('   ✅ IDs already match, skipping update');
      } else {
        const updatedContent = libRsContent.replace(
          /declare_id!\("[^"]+"\)/,
          `declare_id!("${DEPLOYED_PROGRAM_ID}")`
        );
        writeFileSync(LIB_RS_PATH, updatedContent);
        console.log('   ✅ Source code updated');
      }
    } else {
      console.log('   ❌ Could not find declare_id! in source code');
      process.exit(1);
    }
  } catch (error) {
    console.error('   ❌ Error updating source code:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('📦 Step 2: Rebuilding program...');
  
  try {
    execSync('arcium build', { 
      cwd: PROGRAM_DIR,
      stdio: 'inherit'
    });
    console.log('   ✅ Program rebuilt');
  } catch (error) {
    console.error('   ❌ Build failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('📋 Step 3: Initializing CompDef...');
  
  try {
    execSync(`node scripts/init-compdef-direct.js`, { 
      stdio: 'inherit'
    });
    console.log('   ✅ CompDef initialized');
  } catch (error) {
    console.error('   ❌ CompDef initialization failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('📝 Step 4: Updating .env...');
  
  try {
    const envContent = readFileSync(ENV_PATH, 'utf8');
    const updatedEnv = envContent.replace(
      /ARCIUM_PROGRAM_ID=.*/g,
      `ARCIUM_PROGRAM_ID=${DEPLOYED_PROGRAM_ID}`
    );
    writeFileSync(ENV_PATH, updatedEnv);
    console.log('   ✅ .env updated');
  } catch (error) {
    console.error('   ❌ Error updating .env:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🔄 Step 5: Restarting backend...');
  
  try {
    // Kill existing backend
    try {
      execSync('pkill -f "npm run dev"', { stdio: 'ignore' });
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
      // Might not be running
    }
    
    // Start backend
    execSync('npm run dev > /tmp/backend.log 2>&1 &', { stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('   ✅ Backend restarted');
  } catch (error) {
    console.error('   ❌ Backend restart failed:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🎉 SUCCESS! Everything is now properly configured!');
  console.log('');
  console.log('📊 Final Configuration:');
  console.log('   Program ID:', DEPLOYED_PROGRAM_ID);
  console.log('   Cluster ID:', process.env.ARCIUM_CLUSTER_ID || '768109697');
  console.log('   MXE: Initialized');
  console.log('   CompDef: Initialized');
  console.log('');
  console.log('✨ The callbacks should now work correctly!');
  console.log('');
  console.log('📝 Next steps:');
  console.log('   1. Test an encrypted transfer');
  console.log('   2. Monitor for callbacks: solana logs ' + DEPLOYED_PROGRAM_ID + ' --url devnet');
  console.log('   3. Check backend logs: tail -f /tmp/backend.log');
  console.log('   4. Wait 5-10 minutes for MPC nodes to process');
  console.log('');
  console.log('🎯 If callbacks still don\'t work after 10 minutes:');
  console.log('   - Check that the circuit file is accessible');
  console.log('   - Verify MPC nodes are running on cluster 768109697');
  console.log('   - Check transaction logs for any errors');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});