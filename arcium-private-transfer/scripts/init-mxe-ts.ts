import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { MxeClient } from '@arcium-hq/client';

const PROGRAM_ID = new PublicKey('G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp');
const RPC_URL = 'https://api.devnet.solana.com';
const CLUSTER_OFFSET = 768109697; // v0.4.0 cluster

async function main() {
  // Load wallet
  const walletPath = join(homedir(), '.config/solana/id.json');
  const walletKeyfile = JSON.parse(readFileSync(walletPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Initializing MXE with v0.4.0 cluster...');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Cluster Offset:', CLUSTER_OFFSET);

  // Initialize MXE using Arcium client
  const client = new MxeClient(connection, wallet);

  try {
    const mxeAddress = await client.initializeMxe(PROGRAM_ID, CLUSTER_OFFSET);
    console.log('✅ MXE initialized with v0.4.0 cluster!');
    console.log('MXE Address:', mxeAddress.toBase58());
  } catch (error: any) {
    console.error('❌ Error initializing MXE:', error);
    if (error.logs) {
      console.error('Program logs:', error.logs);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
