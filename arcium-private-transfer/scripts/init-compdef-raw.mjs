import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { getCompDefAccAddress, getMXEAccAddress } from '@arcium-hq/client';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('6jHxqxwB7sRykqAGk1aoEYeEbxHvWxGSzXqrFXCQ25aA');
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c';

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf-8')))
);

// Calculate comp_def_offset for "encrypted_transfer"
function compDefOffset(name) {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

const compDefName = 'encrypted_transfer';
const offset = compDefOffset(compDefName);
console.log('CompDef name:', compDefName);
console.log('CompDef offset:', offset);

// Get PDA addresses
const mxeAccount = getMXEAccAddress(PROGRAM_ID);
const compDefAccount = getCompDefAccAddress(PROGRAM_ID, offset);

console.log('MXE Account:', mxeAccount.toBase58());
console.log('CompDef Account:', compDefAccount.toBase58());

// Check if CompDef already exists
const compDefInfo = await conn.getAccountInfo(compDefAccount);
if (compDefInfo) {
  console.log('\n✅ CompDef already exists!');
  console.log('Data length:', compDefInfo.data.length);
  process.exit(0);
}

console.log('\nCompDef does not exist, need to initialize...');

// Build discriminator for init_encrypted_transfer_comp_def
// Anchor instruction discriminator = first 8 bytes of sha256("global:init_encrypted_transfer_comp_def")
const discriminator = createHash('sha256')
  .update('global:init_encrypted_transfer_comp_def')
  .digest()
  .slice(0, 8);

console.log('Discriminator:', discriminator.toString('hex'));

// Build instruction
const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },  // payer
    { pubkey: mxeAccount, isSigner: false, isWritable: true },         // mxe_account
    { pubkey: compDefAccount, isSigner: false, isWritable: true },     // comp_def_account
    { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false }, // arcium_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ],
  data: discriminator,
});

const tx = new Transaction().add(ix);
tx.feePayer = keypair.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

try {
  const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
  console.log('\n✅ CompDef initialized!');
  console.log('Signature:', sig);
} catch (e) {
  console.error('\n❌ Error:', e.message);
  if (e.logs) {
    console.error('Logs:', e.logs);
  }
}
