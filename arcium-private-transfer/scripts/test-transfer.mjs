import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createHash, randomBytes } from 'crypto';
import nacl from 'tweetnacl';

const PROGRAM_ID = new PublicKey('6jHxqxwB7sRykqAGk1aoEYeEbxHvWxGSzXqrFXCQ25aA');
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c';

// MXE x25519 public key
const MXE_X25519_PUBLIC_KEY = new Uint8Array([
  27, 146, 220, 227, 8, 51, 189, 69, 119, 116, 110, 176, 137, 108, 212, 154,
  185, 95, 149, 7, 4, 186, 213, 240, 72, 99, 178, 235, 183, 45, 153, 36,
]);

const CLUSTER_OFFSET = 768109697n;

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf-8')))
);

function compDefOffset(name) {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

// PDA derivation helpers
function getMXEPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mxe')],
    PROGRAM_ID
  )[0];
}

function getCompDefPDA(offset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('comp_def'), Buffer.from(new Uint32Array([offset]).buffer)],
    PROGRAM_ID
  )[0];
}

function getMempoolPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mempool')],
    ARCIUM_PROGRAM_ID
  )[0];
}

function getExecpoolPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('exec_pool')],
    ARCIUM_PROGRAM_ID
  )[0];
}

function getComputationPDA(offset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('computation'), Buffer.from(new BigUint64Array([offset]).buffer)],
    ARCIUM_PROGRAM_ID
  )[0];
}

function getClusterPDA(clusterOffset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('cluster'), Buffer.from(new BigUint64Array([clusterOffset]).buffer)],
    ARCIUM_PROGRAM_ID
  )[0];
}

function getSignPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('sign')],
    PROGRAM_ID
  )[0];
}

function getTransferAccountPDA(payer, compOffset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transfer'), payer.toBuffer(), Buffer.from(new BigUint64Array([compOffset]).buffer)],
    PROGRAM_ID
  )[0];
}

// Simple encrypt function (placeholder - in real use, use proper x25519 + ChaCha20)
function encryptData(data, mxePubkey) {
  // For testing, just return padded data (real impl needs x25519 encryption)
  const padded = new Uint8Array(32);
  padded.set(data.slice(0, 32));
  return padded;
}

async function main() {
  console.log('Testing encrypted transfer...\n');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Payer:', keypair.publicKey.toBase58());
  
  const compDefOffset_val = compDefOffset('encrypted_transfer');
  console.log('CompDef offset:', compDefOffset_val);
  
  // Derive all PDAs
  const mxeAccount = getMXEPDA();
  const compDefAccount = getCompDefPDA(compDefOffset_val);
  const mempoolAccount = getMempoolPDA();
  const execpoolAccount = getExecpoolPDA();
  const signPDA = getSignPDA();
  const clusterAccount = getClusterPDA(CLUSTER_OFFSET);
  
  console.log('\nPDAs:');
  console.log('MXE Account:', mxeAccount.toBase58());
  console.log('CompDef Account:', compDefAccount.toBase58());
  console.log('Mempool Account:', mempoolAccount.toBase58());
  console.log('Execpool Account:', execpoolAccount.toBase58());
  console.log('Sign PDA:', signPDA.toBase58());
  console.log('Cluster Account:', clusterAccount.toBase58());
  
  // Check if MXE exists
  const mxeInfo = await conn.getAccountInfo(mxeAccount);
  console.log('\nMXE exists:', !!mxeInfo);
  if (mxeInfo) {
    console.log('MXE data length:', mxeInfo.data.length);
  }
  
  // Check cluster
  const clusterInfo = await conn.getAccountInfo(clusterAccount);
  console.log('Cluster 768109697 exists:', !!clusterInfo);
  if (clusterInfo) {
    console.log('Cluster data length:', clusterInfo.data.length);
  }
  
  // Check CompDef
  const compDefInfo = await conn.getAccountInfo(compDefAccount);
  console.log('CompDef exists:', !!compDefInfo);
  
  if (!mxeInfo) {
    console.log('\n❌ MXE not initialized. Run arcium deploy first.');
    return;
  }
  
  if (!compDefInfo) {
    console.log('\n❌ CompDef not initialized. Run init-compdef-raw.mjs first.');
    return;
  }
  
  console.log('\n✅ All accounts exist, ready to test transfer');
  
  // Generate computation offset
  const computationOffset = BigInt(Date.now());
  const computationAccount = getComputationPDA(computationOffset);
  const transferAccount = getTransferAccountPDA(keypair.publicKey, computationOffset);
  
  console.log('\nComputation offset:', computationOffset.toString());
  console.log('Computation Account:', computationAccount.toBase58());
  console.log('Transfer Account:', transferAccount.toBase58());
  
  // Create test data
  const amount = 100000n; // 0.0001 SOL in lamports
  const timestamp = BigInt(Date.now());
  const nonce = BigInt('0x' + randomBytes(16).toString('hex'));
  const recipient = keypair.publicKey; // Send to self for testing
  
  // Generate ephemeral x25519 keypair
  const ephemeralKeyPair = nacl.box.keyPair();
  
  // Encrypt amount (8 bytes padded to 32)
  const amountBytes = new Uint8Array(32);
  const amountView = new DataView(amountBytes.buffer);
  amountView.setBigUint64(0, amount, true);
  
  // Encrypt timestamp
  const timestampBytes = new Uint8Array(32);
  const timestampView = new DataView(timestampBytes.buffer);
  timestampView.setBigInt64(0, timestamp, true);
  
  console.log('\nTest data:');
  console.log('Amount:', amount.toString(), 'lamports');
  console.log('Recipient:', recipient.toBase58());
  console.log('Nonce:', nonce.toString());
  
  // Build discriminator for encrypted_transfer
  const discriminator = createHash('sha256')
    .update('global:encrypted_transfer')
    .digest()
    .slice(0, 8);
    
  console.log('\nDiscriminator:', discriminator.toString('hex'));
  
  // Serialize instruction data
  // Layout: discriminator (8) + computation_offset (8) + encrypted_amount (32) + encrypted_timestamp (32) + sender_pubkey (32) + nonce (16) + recipient (32)
  const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 32);
  let offset = 0;
  
  discriminator.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(computationOffset, offset); offset += 8;
  Buffer.from(amountBytes).copy(data, offset); offset += 32;
  Buffer.from(timestampBytes).copy(data, offset); offset += 32;
  Buffer.from(ephemeralKeyPair.publicKey).copy(data, offset); offset += 32;
  data.writeBigUInt64LE(nonce & BigInt('0xFFFFFFFFFFFFFFFF'), offset); offset += 8;
  data.writeBigUInt64LE(nonce >> 64n, offset); offset += 8;
  recipient.toBuffer().copy(data, offset);
  
  // Fixed Arcium accounts
  const POOL_ACCOUNT = new PublicKey('FsWbPQcJQ2cCyr9ndse13fDqds4F2Ezx2WgTL25Dke4M');
  const CLOCK_ACCOUNT = new PublicKey('AxygBawEvVwZPetj3yPJb9sGdZvaJYsVguET1zFUQkV');
  
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },   // payer
      { pubkey: signPDA, isSigner: false, isWritable: true },             // sign_pda_account
      { pubkey: mxeAccount, isSigner: false, isWritable: false },         // mxe_account
      { pubkey: mempoolAccount, isSigner: false, isWritable: true },      // mempool_account
      { pubkey: execpoolAccount, isSigner: false, isWritable: true },     // executing_pool
      { pubkey: computationAccount, isSigner: false, isWritable: true },  // computation_account
      { pubkey: compDefAccount, isSigner: false, isWritable: false },     // comp_def_account
      { pubkey: clusterAccount, isSigner: false, isWritable: true },      // cluster_account
      { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },        // pool_account
      { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },      // clock_account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },  // arcium_program
      { pubkey: transferAccount, isSigner: false, isWritable: true },     // transfer_account
    ],
    data,
  });
  
  const tx = new Transaction().add(ix);
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  try {
    console.log('\nSending transaction...');
    const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
    console.log('\n✅ Encrypted transfer queued!');
    console.log('Signature:', sig);
    console.log('Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    if (e.logs) {
      console.error('\nProgram logs:');
      e.logs.forEach(log => console.error(log));
    }
  }
}

main().catch(console.error);
