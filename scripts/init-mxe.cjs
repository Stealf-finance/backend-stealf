/**
 * Script to manually initialize MXE account for our Arcium program
 * Uses @arcium-hq/client for proper account derivation
 */
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
} = require('@arcium-hq/client');
const { AnchorProvider, Program, Wallet } = require('@coral-xyz/anchor');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Configuration
const OUR_PROGRAM_ID = new PublicKey('HcvbRxkVBvJEtkexVgi9JjLpas74TbYASkpLeqaxgApi');
const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');
const CLUSTER_OFFSET = 768109697;

// Arcium IDL for InitMxe
const ARCIUM_IDL = {
  address: "Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp",
  metadata: { name: "arcium", version: "0.4.0" },
  instructions: [
    {
      name: "init_mxe",
      discriminator: [240, 227, 11, 166, 193, 167, 25, 79],
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "mxe_authority" },
        { name: "mxe_account", writable: true },
        { name: "mempool_account", writable: true },
        { name: "executing_pool", writable: true },
        { name: "cluster", writable: true },
        { name: "system_program" },
        { name: "integrated_program" },
      ],
      args: [
        { name: "cluster_offset", type: "u64" },
        { name: "persistent_mempool", type: "bool" },
      ],
    },
  ],
  types: [],
};

async function main() {
  console.log('🔧 Initializing MXE for program:', OUR_PROGRAM_ID.toBase58());

  // Load keypair
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Authority:', payer.publicKey.toBase58());

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Get PDAs using SDK
  const mxePda = getMXEAccAddress(OUR_PROGRAM_ID);
  const mempoolPda = getMempoolAccAddress(OUR_PROGRAM_ID);
  const execPoolPda = getExecutingPoolAccAddress(OUR_PROGRAM_ID);
  const clusterPda = getClusterAccAddress(CLUSTER_OFFSET);

  console.log('MXE PDA:', mxePda.toBase58());
  console.log('Mempool PDA:', mempoolPda.toBase58());
  console.log('ExecPool PDA:', execPoolPda.toBase58());
  console.log('Cluster PDA:', clusterPda.toBase58());

  // Check if MXE already exists
  const mxeInfo = await connection.getAccountInfo(mxePda);
  if (mxeInfo) {
    console.log('\n✅ MXE already exists!');
    console.log('Owner:', mxeInfo.owner.toBase58());
    return;
  }

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log('Payer balance:', balance / 1e9, 'SOL');

  // Derive MXE authority PDA - this is a PDA owned by our program
  const [mxeAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_authority')],
    OUR_PROGRAM_ID
  );
  console.log('MXE Authority PDA:', mxeAuthority.toBase58());

  // Setup Anchor provider and program
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  // Create program interface
  const arciumProgram = new Program(ARCIUM_IDL, provider);

  console.log('\n📤 Sending InitMxe transaction...');

  try {
    const tx = await arciumProgram.methods
      .initMxe(CLUSTER_OFFSET, false) // cluster_offset, persistent_mempool
      .accounts({
        authority: payer.publicKey,
        mxeAuthority: mxeAuthority,
        mxeAccount: mxePda,
        mempoolAccount: mempoolPda,
        executingPool: execPoolPda,
        cluster: clusterPda,
        systemProgram: new PublicKey('11111111111111111111111111111111'),
        integratedProgram: OUR_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });

    console.log('\n✅ MXE initialized successfully!');
    console.log('Signature:', tx);
    console.log('Explorer:', `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (error) {
    console.error('\n❌ Transaction failed:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs.join('\n'));
    }
  }
}

main().catch(console.error);
