import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { getCompDefAccAddress, getMXEAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress, getClusterAccAddress, getComputationAccAddress, getClockAccAddress, getFeePoolAccAddress } from '@arcium-hq/client';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createHash, randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import BN from 'bn.js';

const PROGRAM_ID = new PublicKey('9iLVPsyFbARWtNex6SetuE1JD7xyXPxV3Y9paMJ7MFAh');
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c';

const CLUSTER_OFFSET = 768109697;

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf-8')))
);

function compDefOffset(name) {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

function getTransferAccountPDA(payer, compOffset) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('transfer'), payer.toBuffer(), Buffer.from(new BigUint64Array([BigInt(compOffset)]).buffer)],
    PROGRAM_ID
  )[0];
}

async function main() {
  console.log('Testing encrypted transfer with @arcium-hq/client...\n');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Payer:', keypair.publicKey.toBase58());
  
  const compDefOffsetVal = compDefOffset('encrypted_transfer');
  console.log('CompDef offset:', compDefOffsetVal);
  
  // Use @arcium-hq/client for PDA derivation
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const compDefAccount = getCompDefAccAddress(PROGRAM_ID, compDefOffsetVal);
  const mempoolAccount = getMempoolAccAddress(PROGRAM_ID);
  const execpoolAccount = getExecutingPoolAccAddress(PROGRAM_ID);
  // Sign PDA derived by our program with "SignerAccount" seed (from derive_seed! macro)
  const signPDA = PublicKey.findProgramAddressSync([Buffer.from('SignerAccount')], PROGRAM_ID)[0];
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  
  console.log('\nPDAs (from @arcium-hq/client):');
  console.log('MXE Account:', mxeAccount.toBase58());
  console.log('CompDef Account:', compDefAccount.toBase58());
  console.log('Mempool Account:', mempoolAccount.toBase58());
  console.log('Execpool Account:', execpoolAccount.toBase58());
  console.log('Sign PDA:', signPDA.toBase58());
  console.log('Cluster Account:', clusterAccount.toBase58());
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();
  console.log('Pool Account:', poolAccount.toBase58());
  console.log('Clock Account:', clockAccount.toBase58());
  
  // Check accounts
  const mxeInfo = await conn.getAccountInfo(mxeAccount);
  console.log('\nMXE exists:', !!mxeInfo);
  if (mxeInfo) console.log('MXE data length:', mxeInfo.data.length);
  
  const clusterInfo = await conn.getAccountInfo(clusterAccount);
  console.log('Cluster 768109697 exists:', !!clusterInfo);
  if (clusterInfo) console.log('Cluster data length:', clusterInfo.data.length);
  
  const compDefInfo = await conn.getAccountInfo(compDefAccount);
  console.log('CompDef exists:', !!compDefInfo);
  
  if (!mxeInfo) {
    console.log('\n❌ MXE not initialized.');
    return;
  }
  
  if (!compDefInfo) {
    console.log('\n❌ CompDef not initialized.');
    return;
  }
  
  console.log('\n✅ All accounts exist!');
  
  // Generate computation offset
  const computationOffset = BigInt(Date.now());
  const computationOffsetBN = new BN(computationOffset.toString());
  const computationAccount = getComputationAccAddress(PROGRAM_ID, computationOffsetBN);
  const transferAccount = getTransferAccountPDA(keypair.publicKey, computationOffset);
  
  console.log('\nComputation offset:', computationOffset.toString());
  console.log('Computation Account:', computationAccount.toBase58());
  console.log('Transfer Account:', transferAccount.toBase58());
  
  // Create test data
  const amount = 100000n; // 0.0001 SOL in lamports
  const timestamp = BigInt(Date.now());
  const nonce = BigInt('0x' + randomBytes(16).toString('hex'));
  const recipient = keypair.publicKey;
  
  // Generate ephemeral x25519 keypair for sender_pubkey
  const ephemeralKeyPair = nacl.box.keyPair();
  
  // Encrypt amount (8 bytes, padded to 32)
  const amountBytes = new Uint8Array(32);
  new DataView(amountBytes.buffer).setBigUint64(0, amount, true);
  
  // Encrypt timestamp
  const timestampBytes = new Uint8Array(32);
  new DataView(timestampBytes.buffer).setBigInt64(0, timestamp, true);
  
  console.log('\nTest data:');
  console.log('Amount:', amount.toString(), 'lamports');
  console.log('Recipient:', recipient.toBase58());
  
  // Build discriminator
  const discriminator = createHash('sha256')
    .update('global:encrypted_transfer')
    .digest()
    .slice(0, 8);
    
  console.log('Discriminator:', discriminator.toString('hex'));
  
  // Serialize: discriminator (8) + computation_offset (8) + encrypted_amount (32) + encrypted_timestamp (32) + sender_pubkey (32) + nonce (16) + recipient (32)
  const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 32);
  let off = 0;
  
  discriminator.copy(data, off); off += 8;
  data.writeBigUInt64LE(computationOffset, off); off += 8;
  Buffer.from(amountBytes).copy(data, off); off += 32;
  Buffer.from(timestampBytes).copy(data, off); off += 32;
  Buffer.from(ephemeralKeyPair.publicKey).copy(data, off); off += 32;
  data.writeBigUInt64LE(nonce & BigInt('0xFFFFFFFFFFFFFFFF'), off); off += 8;
  data.writeBigUInt64LE(nonce >> 64n, off); off += 8;
  recipient.toBuffer().copy(data, off);
  
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
      { pubkey: poolAccount, isSigner: false, isWritable: true }, // pool_account
      { pubkey: clockAccount, isSigner: false, isWritable: false },   // clock_account
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
