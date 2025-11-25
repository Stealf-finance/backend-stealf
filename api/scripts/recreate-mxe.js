#!/usr/bin/env node

/**
 * Recreate MXE with current wallet and initialize CompDef
 * This is needed because the original MXE was created with a different wallet
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

// Configuration
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const CLUSTER_ID = parseInt(process.env.ARCIUM_CLUSTER_ID || '768109697');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

// Hardcoded correct CompDef PDA
const COMP_DEF_PDA = new PublicKey('Bk6wm9kF137kV8VVjHPwUgcamqw3x9ius8674P6ZPEnt');

// Arcium program ID (v0.4.0)
const ARCIUM_PROGRAM_ID = new PublicKey('9BYVXpgn9CB1KrnwLdzsRDKd7VYX9YH96FjkLwk2Xtq7');

async function main() {
  console.log('🔧 Recreating MXE and initializing CompDef...');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Cluster ID:', CLUSTER_ID);
  console.log('RPC URL:', RPC_URL);

  // Load wallet
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Wallet:', payerKeypair.publicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load wallet from', WALLET_PATH);
    console.error('Error:', error.message);
    process.exit(1);
  }

  // Connect to Solana
  const connection = new Connection(RPC_URL, 'confirmed');

  // Get all required PDAs
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const clusterAccount = getClusterAccAddress(CLUSTER_ID);
  const mempoolAccount = getMempoolAccAddress(PROGRAM_ID);
  const executingPool = getExecutingPoolAccAddress(PROGRAM_ID);
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();

  console.log('MXE Account:', mxeAccount.toBase58());
  console.log('Cluster Account:', clusterAccount.toBase58());

  // Check if MXE exists
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (mxeInfo) {
    console.log('✅ MXE already exists');
    // Try to close it first (send lamports to payer)
    console.log('Attempting to close existing MXE...');
    
    // Build close_mxe instruction
    // Discriminator for close_mxe: [183, 18, 70, 156, 148, 109, 243, 127]
    const closeDiscriminator = Buffer.from([183, 18, 70, 156, 148, 109, 243, 127]);
    
    const closeInstruction = new TransactionInstruction({
      keys: [
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      programId: PROGRAM_ID,
      data: closeDiscriminator,
    });

    try {
      const closeTx = new Transaction().add(closeInstruction);
      closeTx.feePayer = payerKeypair.publicKey;
      closeTx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

      const closeSig = await connection.sendTransaction(closeTx, [payerKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      await connection.confirmTransaction(closeSig, 'confirmed');
      console.log('✅ MXE closed successfully:', closeSig);
    } catch (error) {
      console.log('⚠️  Could not close MXE (might not be closable or wrong authority):', error.message);
    }
  }

  // Create new MXE
  console.log('Creating new MXE...');
  
  // Build init_mxe instruction
  // Discriminator for init_mxe: [250, 215, 8, 129, 167, 245, 172, 181]
  const initMxeDiscriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);
  
  // Encode arguments: cluster_id (u64, little-endian)
  const clusterIdBuf = Buffer.alloc(8);
  clusterIdBuf.writeBigUInt64LE(BigInt(CLUSTER_ID), 0);
  
  const initMxeData = Buffer.concat([initMxeDiscriminator, clusterIdBuf]);

  const initMxeInstruction = new TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: clusterAccount, isSigner: false, isWritable: true }, // cluster_account
      { pubkey: mempoolAccount, isSigner: false, isWritable: true }, // mempool_account
      { pubkey: executingPool, isSigner: false, isWritable: true }, // executing_pool
      { pubkey: poolAccount, isSigner: false, isWritable: true }, // pool_account
      { pubkey: clockAccount, isSigner: false, isWritable: false }, // clock_account
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: PROGRAM_ID,
    data: initMxeData,
  });

  try {
    const initMxeTx = new Transaction().add(initMxeInstruction);
    initMxeTx.feePayer = payerKeypair.publicKey;
    initMxeTx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

    const initMxeSig = await connection.sendTransaction(initMxeTx, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(initMxeSig, 'confirmed');
    console.log('✅ MXE created successfully:', initMxeSig);
    console.log('Explorer: https://explorer.solana.com/tx/' + initMxeSig + '?cluster=devnet');
  } catch (error) {
    console.error('❌ Failed to create MXE:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }
    process.exit(1);
  }

  // Initialize CompDef
  console.log('Initializing CompDef...');
  
  // Build init_encrypted_transfer_comp_def instruction
  const initCompDefDiscriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);

  const initCompDefInstruction = new TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: COMP_DEF_PDA, isSigner: false, isWritable: true }, // comp_def_account
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: PROGRAM_ID,
    data: initCompDefDiscriminator,
  });

  try {
    const initCompDefTx = new Transaction().add(initCompDefInstruction);
    initCompDefTx.feePayer = payerKeypair.publicKey;
    initCompDefTx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

    const initCompDefSig = await connection.sendTransaction(initCompDefTx, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(initCompDefSig, 'confirmed');
    console.log('✅ CompDef initialized successfully:', initCompDefSig);
    console.log('Explorer: https://explorer.solana.com/tx/' + initCompDefSig + '?cluster=devnet');
  } catch (error) {
    console.error('❌ Failed to initialize CompDef:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }
    process.exit(1);
  }

  console.log('');
  console.log('🎉 Success! MXE and CompDef are now initialized with your wallet.');
  console.log('   The callbacks should now work correctly.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});