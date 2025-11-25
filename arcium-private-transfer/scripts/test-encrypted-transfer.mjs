import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { 
  getMXEPublicKey, 
  getMXEAccAddress,
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  x25519,
  RescueCipher
} from '@arcium-hq/client';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('8zD4DhL5FN4va4fDyBsNitgJT9R4BWYhfi61Hvk5dM9H');
const CLUSTER_OFFSET = 1078779259;
const RPC_URL = 'https://api.devnet.solana.com';

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf-8')))
);
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(conn, wallet, { commitment: 'confirmed' });

console.log('=== Test Encrypted Transfer Setup ===');
console.log('Program:', PROGRAM_ID.toBase58());
console.log('Wallet:', keypair.publicKey.toBase58());

// Get all PDAs
const mxeAccount = getMXEAccAddress(PROGRAM_ID);
const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
const mempoolAccount = getMempoolAccAddress(PROGRAM_ID);
const executingPool = getExecutingPoolAccAddress(PROGRAM_ID);

function compDefOffset(name) {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}
const compDefAccount = getCompDefAccAddress(PROGRAM_ID, compDefOffset('encrypted_transfer'));

console.log('\n=== PDA Addresses ===');
console.log('MXE:', mxeAccount.toBase58());
console.log('Cluster:', clusterAccount.toBase58());
console.log('Mempool:', mempoolAccount.toBase58());
console.log('ExecPool:', executingPool.toBase58());
console.log('CompDef:', compDefAccount.toBase58());

// Check all accounts exist
console.log('\n=== Checking Accounts ===');
const checks = [
  ['MXE', mxeAccount],
  ['Cluster', clusterAccount],
  ['Mempool', mempoolAccount],
  ['ExecPool', executingPool],
  ['CompDef', compDefAccount],
];

for (const [name, addr] of checks) {
  const info = await conn.getAccountInfo(addr);
  console.log(`${name}: ${info ? '✅ exists' : '❌ missing'}`);
}

// Get MXE public key
console.log('\n=== MXE Public Key ===');
try {
  const mxePubKey = await getMXEPublicKey(provider, PROGRAM_ID);
  if (mxePubKey) {
    const hex = Buffer.from(mxePubKey).toString('hex');
    const isZero = mxePubKey.every(b => b === 0);
    console.log('Key:', hex);
    console.log('Is zero:', isZero);
    
    if (!isZero) {
      console.log('\n✅ MXE keys are configured! Ready for encrypted transfers.');
      
      // Test encryption
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubKey);
      const cipher = new RescueCipher(sharedSecret);
      
      const amount = BigInt(1000000); // 0.001 SOL
      const nonce = randomBytes(16);
      const ciphertext = cipher.encrypt([amount], nonce);
      
      console.log('\nTest encryption:');
      console.log('Amount:', amount.toString());
      console.log('Ciphertext:', Buffer.from(ciphertext[0]).toString('hex'));
    } else {
      console.log('\n❌ MXE keys not configured - cluster nodes have not set keys yet');
    }
  } else {
    console.log('NULL - MXE not found');
  }
} catch (e) {
  console.error('Error getting MXE key:', e.message);
}
