#!/usr/bin/env node

/**
 * FINAL FIX - Complete verification and solution
 * 
 * This script:
 * 1. Verifies the deployed program matches the source code
 * 2. Checks all required accounts
 * 3. Provides the exact solution
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { getCompDefAccAddress } from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || '4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs');
const CLUSTER_ID = parseInt(process.env.ARCIUM_CLUSTER_ID || '768109697');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

async function main() {
  console.log('🔍 FINAL VERIFICATION & FIX');
  console.log('============================');
  console.log('RPC URL:', RPC_URL);
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Cluster ID:', CLUSTER_ID);
  console.log('Wallet:', WALLET_PATH);
  console.log('');

  // Load wallet
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    const { Keypair } = await import('@solana/web3.js');
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('✅ Wallet loaded:', payerKeypair.publicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load wallet:', error.message);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  // Step 1: Verify deployed program
  console.log('📋 Step 1: Verifying deployed program...');
  try {
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (!programInfo) {
      console.log('❌ Program not found on-chain!');
      console.log('   You need to deploy it first.');
      process.exit(1);
    }
    
    // Check program authority
    const programData = await connection.getAccountInfo(
      new PublicKey('JkGSoECMGP4cH9Pp3NUonmvgoP4dAHn7QceMnq4axyJ')
    );
    
    if (programData) {
      // Authority is at offset 13 in program data
      const authority = new PublicKey(programData.data.slice(13, 45));
      console.log('✅ Program deployed');
      console.log('   Authority:', authority.toBase58());
      console.log('   Your wallet:', payerKeypair.publicKey.toBase58());
      
      if (authority.toBase58() === payerKeypair.publicKey.toBase58()) {
        console.log('   ✅ You control this program!');
      } else {
        console.log('   ❌ You do NOT control this program');
      }
    }
  } catch (error) {
    console.error('❌ Error checking program:', error.message);
    process.exit(1);
  }

  console.log('');
  
  // Step 2: Check source code program ID
  console.log('📋 Step 2: Checking source code program ID...');
  try {
    const libRsPath = join(process.cwd(), 'arcium-private-transfer', 'programs', 'private-transfer', 'src', 'lib.rs');
    const libRsContent = readFileSync(libRsPath, 'utf8');
    
    const match = libRsContent.match(/declare_id!\("([^"]+)"\)/);
    if (match) {
      const sourceProgramId = match[1];
      console.log('   Source code Program ID:', sourceProgramId);
      console.log('   Deployed Program ID:', PROGRAM_ID.toBase58());
      
      if (sourceProgramId === PROGRAM_ID.toBase58()) {
        console.log('   ✅ IDs match!');
      } else {
        console.log('   ❌ IDs DO NOT MATCH!');
        console.log('');
        console.log('   🔧 FIX: Update the source code');
        console.log('   Edit:', libRsPath);
        console.log('   Change: declare_id!("' + sourceProgramId + '")');
        console.log('   To: declare_id!("' + PROGRAM_ID.toBase58() + '")');
        console.log('');
        console.log('   Then rebuild and redeploy:');
        console.log('   arcium build');
        console.log('   solana program deploy --program-id ' + join(process.cwd(), 'arcium-private-transfer', 'target', 'deploy', 'arcium_private_transfer-keypair.json') + ' --url ' + RPC_URL + ' ' + join(process.cwd(), 'arcium-private-transfer', 'target', 'deploy', 'arcium_private_transfer.so'));
      }
    } else {
      console.log('   ❌ Could not find declare_id! in source code');
    }
  } catch (error) {
    console.error('❌ Error reading source code:', error.message);
  }

  console.log('');
  
  // Step 3: Check CompDef
  console.log('📋 Step 3: Checking CompDef...');
  const compDefPda = getCompDefAccAddress(PROGRAM_ID, 'encrypted_transfer');
  console.log('   CompDef PDA:', compDefPda.toBase58());
  
  try {
    const compDefInfo = await connection.getAccountInfo(compDefPda);
    if (compDefInfo) {
      console.log('   ✅ CompDef is initialized!');
      console.log('   Data length:', compDefInfo.data.length);
    } else {
      console.log('   ❌ CompDef is NOT initialized');
      console.log('');
      console.log('   🔧 To initialize CompDef:');
      console.log('');
      console.log('   The issue is likely that the program ID in the source code');
      console.log('   does not match the deployed program ID.');
      console.log('');
      console.log('   After fixing the source code and redeploying, run:');
      console.log('   node scripts/init-compdef-direct.js');
    }
  } catch (error) {
    console.error('   ❌ Error checking CompDef:', error.message);
  }

  console.log('');
  console.log('🎯 SUMMARY:');
  console.log('');
  console.log('The error "DeclaredProgramIdMismatch" means:');
  console.log('The program deployed on-chain has a different ID than what');
  console.log('is declared in your source code (lib.rs).');
  console.log('');
  console.log('You MUST:');
  console.log('1. Update declare_id! in the source code to match the deployed program');
  console.log('2. Rebuild with: arcium build');
  console.log('3. Redeploy with: solana program deploy ...');
  console.log('4. Then initialize CompDef: node scripts/init-compdef-direct.js');
  console.log('');
  console.log('OR use the existing program:');
  console.log('1. Update .env: ARCIUM_PROGRAM_ID=G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
  console.log('2. Rebuild and redeploy to that address');
  console.log('3. Initialize CompDef');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});