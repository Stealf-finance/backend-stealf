const { Connection, Keypair, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = 'G3dDdXck7X3f7o3ytqZcVigcP4aJAQBDto6XC1MQoFfp';
const MXE_PROGRAM_ID = 'Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp';
const RPC_URL = 'https://api.devnet.solana.com';
const WALLET_PATH = path.join(process.env.HOME, '.config/solana/id.json');

async function main() {
  // Load wallet
  const walletKeyfile = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletKeyfile));

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Initializing CompDef...');
  console.log('Program ID:', PROGRAM_ID);
  console.log('Wallet:', wallet.publicKey.toString());

  // Calculate MXE PDA
  const [mxePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('MXEAccount'), new PublicKey(PROGRAM_ID).toBuffer()],
    new PublicKey(MXE_PROGRAM_ID)
  );
  console.log('MXE PDA:', mxePda.toString());

  // CompDef PDA from program error log (correct address)
  // @arcium-hq/client calculates wrong PDA, use hardcoded correct one
  const compDefPda = new PublicKey('Bk6wm9kF137kV8VVjHPwUgcamqw3x9ius8674P6ZPEnt');
  console.log('CompDef PDA:', compDefPda.toString());

  // Skip check, just try to initialize
  console.log('Attempting to initialize CompDef...');

  // Build init_encrypted_transfer_comp_def instruction
  // Discriminator from IDL
  const discriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);

  // Build instruction
  const instruction = {
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: mxePda, isSigner: false, isWritable: true }, // mxe_account
      { pubkey: compDefPda, isSigner: false, isWritable: true }, // comp_def_account
      { pubkey: new PublicKey(MXE_PROGRAM_ID), isSigner: false, isWritable: false }, // arcium_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    programId: new PublicKey(PROGRAM_ID),
    data: discriminator,
  };

  try {
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log('✅ CompDef initialized!');
    console.log('Transaction:', signature);
  } catch (error) {
    console.error('❌ Error initializing CompDef:', error);
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
