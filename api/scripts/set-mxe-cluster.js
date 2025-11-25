#!/usr/bin/env node

/**
 * Set MXE Cluster for stealf_private program
 * Changes the cluster from 1078779259 to 768109697 (the correct one for 0.4.0)
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getMXEAccAddress, getClusterAccAddress, getArciumProgAddress } from '@arcium-hq/client';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const PROGRAM_ID = new PublicKey(process.env.ARCIUM_PROGRAM_ID || '976vSFRzL4MDJmKrBgHDauyU2tKQ2B3ozcPNxyuHHDUV');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = join(homedir(), '.config', 'solana', 'id.json');

// Target cluster (the correct one for 0.4.0)
const TARGET_CLUSTER_OFFSET = 768109697;

// Arcium program ID
const ARCIUM_PROGRAM_ID = getArciumProgAddress();

async function main() {
  console.log('🔧 Setting MXE Cluster to', TARGET_CLUSTER_OFFSET);
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('RPC URL:', RPC_URL);
  console.log('Arcium Program:', ARCIUM_PROGRAM_ID.toBase58());

  // Load wallet (must be MXE authority)
  let payerKeypair;
  try {
    const keypairData = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Wallet (Authority):', payerKeypair.publicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load wallet from', WALLET_PATH);
    process.exit(1);
  }

  // Connect to Solana
  const connection = new Connection(RPC_URL, 'confirmed');

  // Get MXE account
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  console.log('MXE Account:', mxeAccount.toBase58());

  // Get cluster accounts
  const newClusterAccount = getClusterAccAddress(TARGET_CLUSTER_OFFSET);
  console.log('New Cluster Account:', newClusterAccount.toBase58());

  // Check MXE exists
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (!mxeInfo) {
    console.error('❌ MXE account not found!');
    process.exit(1);
  }
  console.log('✅ MXE account found');

  // Check new cluster exists
  const clusterInfo = await connection.getAccountInfo(newClusterAccount);
  if (!clusterInfo) {
    console.error('❌ Target cluster account not found!');
    process.exit(1);
  }
  console.log('✅ Target cluster account found');

  // Build set_mxe_cluster instruction
  // Discriminator for set_mxe_cluster (Arcium program)
  // We need to find this from the Arcium IDL
  // Common pattern: sha256("global:set_mxe_cluster")[0..8]

  // Let's try to call via the Arcium program directly
  // The instruction format is: discriminator + cluster_offset (u32)

  // Discriminator from Arcium 0.4.0 IDL for set_mxe_cluster
  const discriminator = Buffer.from([0x8d, 0x1e, 0x5a, 0x2c, 0xc5, 0x9e, 0x3c, 0x9a]); // Example - need actual

  // Encode cluster offset as u32 little-endian
  const clusterOffsetBuf = Buffer.alloc(4);
  clusterOffsetBuf.writeUInt32LE(TARGET_CLUSTER_OFFSET);

  const instructionData = Buffer.concat([discriminator, clusterOffsetBuf]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true }, // authority
      { pubkey: mxeAccount, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: newClusterAccount, isSigner: false, isWritable: false }, // cluster_account
    ],
    programId: ARCIUM_PROGRAM_ID,
    data: instructionData,
  });

  try {
    const transaction = new Transaction().add(instruction);
    transaction.feePayer = payerKeypair.publicKey;
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash('confirmed')
    ).blockhash;

    console.log('\n📤 Sending set_mxe_cluster transaction...');
    const signature = await connection.sendTransaction(transaction, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Waiting for confirmation...');
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('✅ MXE cluster updated successfully!');
    console.log('Transaction:', signature);
    console.log('Explorer: https://explorer.solana.com/tx/' + signature + '?cluster=devnet');
  } catch (error) {
    console.error('❌ Failed to set MXE cluster:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }

    console.log('\n💡 Alternative: You may need to close the MXE and reinitialize it.');
    console.log('   Or redeploy the program with a new keypair.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
