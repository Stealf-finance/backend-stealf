import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet, Program } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const PROGRAM_ID = '8zD4DhL5FN4va4fDyBsNitgJT9R4BWYhfi61Hvk5dM9H';
const RPC_URL = 'https://api.devnet.solana.com';

const conn = new Connection(RPC_URL, 'confirmed');
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(homedir() + '/.config/solana/id.json', 'utf-8')))
);
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(conn, wallet, { commitment: 'confirmed' });

const idl = JSON.parse(readFileSync('./target/idl/arcium_private_transfer.json', 'utf-8'));

console.log('IDL accounts:', idl.accounts?.map(a => a.name));
console.log('IDL types:', idl.types?.map(t => t.name));

// Try to create program
try {
  const program = new Program(idl, new PublicKey(PROGRAM_ID), provider);
  console.log('Program created successfully');
  console.log('Methods:', Object.keys(program.methods));
} catch (e) {
  console.error('Error:', e.message);
}
