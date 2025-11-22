#!/usr/bin/env node

/**
 * Initialize CompDef directly using existing MXE
 * This bypasses the arcium CLI issues
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getMXEAccAddress, getCompDefAccAddress } from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || '4ySvMfaMFdQz5FL4DyE8Q4uvvziTMM7tjw5QbW8KbJNs');
const CLUSTER_ID = parseInt(process.env.ARCIUM_CLUSTER_ID || '768109697');
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

// CompDef PDA for encrypted_transfer
const COMP_DEF_PDA = getCompDefAccAddress(PROGRAM_ID, 'encrypted_transfer');

async function main() {
  console.log('🔧 Initializing CompDef directly...');
  console.log('RPC URL:', RPC_URL);
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Cluster ID:', CLUSTER_ID);
  console.log('CompDef PDA:', COMP_DEF_PDA.toBase58());
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

  // Check if CompDef already exists
  console.log('Checking if CompDef is already initialized...');
  const compDefInfo = await connection.getAccountInfo(COMP_DEF_PDA);
  
  if (compDefInfo) {
    console.log('✅ CompDef already initialized!');
    console.log('Data length:', compDefInfo.data.length);
    console.log('Owner:', compDefInfo.owner.toBase58());
    return;
  }

  console.log('❌ CompDef not found, initializing...');
  console.log('');

  // Get MXE account
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  console.log('MXE Account:', mxeAccount.toBase58());

  // Check MXE
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (!mxeInfo) {
    console.error('❌ MXE does not exist! Cannot initialize CompDef without MXE.');
    console.log('');
    console.log('You need to initialize MXE first.');
    console.log('Try: arcium init-mxe --callback-program ' + PROGRAM_ID.toBase58() + ' --cluster-offset ' + CLUSTER_ID + ' --keypair-path ' + WALLET_PATH + ' --mempool-size Medium');
    process.exit(1);
  }

  console.log('✅ MXE exists (', mxeInfo.data.length, 'bytes)');
  console.log('');

  // Build init_encrypted_transfer_comp_def instruction
  // Discriminator from IDL: [250, 215, 8, 129, 167, 245, 172, 181]
  const discriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: COMP_DEF_PDA, isSigner: false, isWritable: true }, // comp_def_account
      { pubkey: new PublicKey('9BYVXpgn9CB1KrnwLdzsRDKd7VYX9YH96FjkLwk2Xtq7'), isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  });

  try {
    console.log('Sending transaction...');
    const transaction = new Transaction().add(instruction);
    transaction.feePayer = payerKeypair.publicKey;
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash('confirmed')
    ).blockhash;

    const signature = await connection.sendTransaction(transaction, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Waiting for confirmation...');
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('');
    console.log('🎉 CompDef initialized successfully!');
    console.log('Transaction signature:', signature);
    console.log('Explorer: https://explorer.solana.com/tx/' + signature + '?cluster=devnet');
    console.log('');
    console.log('✅ The callbacks should now work!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Restart backend: npm run dev');
    console.log('2. Test an encrypted transfer');
    console.log('3. Monitor for callbacks: solana logs ' + PROGRAM_ID.toBase58() + ' --url devnet');
    
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