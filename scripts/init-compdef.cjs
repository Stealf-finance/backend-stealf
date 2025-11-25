/**
 * Script to initialize the CompDef for encrypted_transfer instruction
 * Usage: node scripts/init-compdef.cjs
 */

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
} = require('@arcium-hq/client');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Configuration - New deployment
const PROGRAM_ID = new PublicKey('HcvbRxkVBvJEtkexVgi9JjLpas74TbYASkpLeqaxgApi');
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');

// Discriminator for init_encrypted_transfer_comp_def from IDL
const INIT_COMP_DEF_DISCRIMINATOR = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);

async function main() {
  console.log('🔧 Initializing CompDef for encrypted_transfer...\n');

  // Load keypair from ~/.config/solana/id.json
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Program ID:', PROGRAM_ID.toBase58());

  // Get PDAs using SDK
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  console.log('MXE Account:', mxeAccount.toBase58());

  // Calculate CompDef offset and PDA
  const compDefOffsetBytes = getCompDefAccOffset('encrypted_transfer');
  const compDefOffset = Buffer.from(compDefOffsetBytes).readUInt32LE(0);
  const compDefPda = getCompDefAccAddress(PROGRAM_ID, compDefOffset);

  console.log('CompDef Offset:', compDefOffset);
  console.log('CompDef PDA:', compDefPda.toBase58());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check if MXE exists
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (!mxeInfo) {
    console.log('\n❌ MXE account not found! Run `arcium deploy --skip-deploy` first.');
    return;
  }
  console.log('✅ MXE account exists');

  // Check if CompDef already exists
  const compDefInfo = await connection.getAccountInfo(compDefPda);
  if (compDefInfo) {
    console.log('\n✅ CompDef already initialized!');
    return;
  }

  // Check payer balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log('Payer balance:', balance / 1e9, 'SOL');

  if (balance < 0.01 * 1e9) {
    console.log('\n❌ Insufficient balance. Need at least 0.01 SOL');
    return;
  }

  // Build instruction
  // Accounts from IDL:
  // 0. payer (signer, writable)
  // 1. mxe_account (writable)
  // 2. comp_def_account (writable)
  // 3. arcium_program
  // 4. system_program

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefPda, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: INIT_COMP_DEF_DISCRIMINATOR,
  });

  console.log('\n📤 Sending transaction...');

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  try {
    const signature = await connection.sendTransaction(transaction, [payer], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('Transaction sent:', signature);
    console.log('Waiting for confirmation...');

    await connection.confirmTransaction(signature, 'confirmed');

    console.log('\n✅ CompDef initialized successfully!');
    console.log('Signature:', signature);
    console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } catch (error) {
    console.error('\n❌ Transaction failed:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }
  }
}

main().catch(console.error);
