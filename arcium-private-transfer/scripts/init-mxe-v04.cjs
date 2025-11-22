const { Connection, Keypair, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp';
const MXE_PROGRAM_ID = 'Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp';
const RPC_URL = 'https://api.devnet.solana.com';
const WALLET_PATH = path.join(process.env.HOME, '.config/solana/id.json');
const CLUSTER_OFFSET = 768109697; // v0.4.0 cluster

async function main() {
  // Load wallet
  const walletKeyfile = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Initializing MXE with v0.4.0 cluster...');
  console.log('Program ID:', PROGRAM_ID);
  console.log('Wallet:', wallet.publicKey.toString());
  console.log('Cluster Offset:', CLUSTER_OFFSET);

  // Calculate MXE PDA
  const [mxePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('MXEAccount'), new PublicKey(PROGRAM_ID).toBuffer()],
    new PublicKey(MXE_PROGRAM_ID)
  );
  console.log('MXE PDA:', mxePda.toString());

  // Check if MXE already exists
  try {
    const accountInfo = await connection.getAccountInfo(mxePda);
    if (accountInfo) {
      console.log('⚠️  MXE already exists. Skipping initialization.');
      console.log('If you need to change cluster, you must close the old MXE first.');
      return;
    }
  } catch (error) {
    console.log('MXE does not exist, will initialize...');
  }

  // Build init_mxe instruction
  // Discriminator from IDL for init_mxe
  const discriminator = Buffer.from([243, 13, 147, 106, 48, 49, 232, 245]);

  // Encode cluster_offset as little-endian u64
  const clusterOffsetBuffer = Buffer.alloc(8);
  clusterOffsetBuffer.writeBigUInt64LE(BigInt(CLUSTER_OFFSET));

  // Build instruction data
  const data = Buffer.concat([discriminator, clusterOffsetBuffer]);

  // Build instruction
  const instruction = {
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: mxePda, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: new PublicKey(MXE_PROGRAM_ID), isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: new PublicKey(PROGRAM_ID),
    data,
  };

  try {
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log('✅ MXE initialized with v0.4.0 cluster (768109697)!');
    console.log('Transaction:', signature);
    console.log('MXE PDA:', mxePda.toString());
  } catch (error) {
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
