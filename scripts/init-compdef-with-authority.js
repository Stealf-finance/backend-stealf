#!/usr/bin/env node

/**
 * Initialize Arcium CompDef with the correct authority
 * This script uses the wallet that created the MXE (authority: 12LEGYXA3BBbTFHS7vxEHqmq9tHERu7qrKGycxi1f9h)
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getMXEAccAddress } from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

// Configuration - UPDATED TO MATCH DEPLOYED PROGRAM G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = join(homedir(), '.config', 'solana', 'deploy-wallet.json');

// Hardcoded correct CompDef PDA (from program error logs)
// The program expects this PDA: Bk6wm9kF137kV8VVjHPwUgcamqw3x9ius8674P6ZPEnt
const COMP_DEF_PDA = new PublicKey('Bk6wm9kF137kV8VVjHPwUgcamqw3x9ius8674P6ZPEnt');

// MXE Authority (from on-chain data for MXE 7UwELMLLE8A2nn3aVPQDC7ysmk7QVFgj984tn5Qbbw26)
const MXE_AUTHORITY = new PublicKey('12LEGYXA3BBbTFHS7vxEHqmq9tHERu7qrKGycxi1f9h');

// Arcium program ID (v0.3.0 - based on deployed program)
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');

async function main() {
  console.log('🔧 Initializing Arcium CompDef with correct authority...');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('RPC URL:', RPC_URL);
  console.log('CompDef PDA:', COMP_DEF_PDA.toBase58());
  console.log('MXE Authority:', MXE_AUTHORITY.toBase58());

  // Load wallet
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Wallet:', payerKeypair.publicKey.toBase58());
    
    // Check if this wallet matches the MXE authority
    if (payerKeypair.publicKey.toBase58() !== MXE_AUTHORITY.toBase58()) {
      console.log('⚠️  WARNING: This wallet does NOT match the MXE authority!');
      console.log('   MXE was created with authority:', MXE_AUTHORITY.toBase58());
      console.log('   Current wallet:', payerKeypair.publicKey.toBase58());
      console.log('   You need to use the wallet that created the MXE.');
      
      // Try to find the correct wallet
      console.log('\n🔍 Searching for correct wallet...');
      // You might have multiple keypairs in ~/.config/solana/
      // Look for files like id.json, id2.json, etc.
    }
  } catch (error) {
    console.error('❌ Failed to load wallet from', WALLET_PATH);
    console.error('Error:', error.message);
    process.exit(1);
  }

  // Connect to Solana
  const connection = new Connection(RPC_URL, 'confirmed');

  // Check if CompDef is already initialized
  console.log('Checking if CompDef is already initialized...');
  const compDefInfo = await connection.getAccountInfo(COMP_DEF_PDA);
  
  if (compDefInfo) {
    console.log('✅ CompDef already initialized!');
    console.log('Data length:', compDefInfo.data.length);
    console.log('Owner:', compDefInfo.owner.toBase58());
    return;
  }

  console.log('CompDef not found, initializing...');

  // Get required accounts
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);

  console.log('MXE Account:', mxeAccount.toBase58());
  console.log('Arcium Program ID:', ARCIUM_PROGRAM_ID.toBase58());

  // Build init_encrypted_transfer_comp_def instruction
  // Discriminator from IDL: [250, 215, 8, 129, 167, 245, 172, 181]
  const discriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // payer (must be MXE authority)
      { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: COMP_DEF_PDA, isSigner: false, isWritable: true }, // comp_def_account
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  });

  try {
    const transaction = new Transaction().add(instruction);
    transaction.feePayer = payerKeypair.publicKey;
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash('confirmed')
    ).blockhash;

    console.log('Sending transaction...');
    const signature = await connection.sendTransaction(transaction, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Waiting for confirmation...');
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('✅ CompDef initialized successfully!');
    console.log('Transaction signature:', signature);
    console.log('Explorer: https://explorer.solana.com/tx/' + signature + '?cluster=devnet');
  } catch (error) {
    console.error('❌ Failed to initialize CompDef:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});