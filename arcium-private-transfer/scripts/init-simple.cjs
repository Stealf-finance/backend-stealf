/**
 * Simple initialization script using direct web3.js
 */

const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const fs = require('fs');
const os = require('os');
const borsh = require('borsh');

const PROGRAM_ID = new PublicKey("8njQJYYCqeUZ37WvNW852ALRqykiUMxqHjT6KPxUKqeq");
const RPC_URL = "https://api.devnet.solana.com";

// Read keypair
const kpPath = `${os.homedir()}/.config/solana/id.json`;
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf-8')));
const payer = Keypair.fromSecretKey(secretKey);

async function main() {
  console.log('🔧 Initializing Arcium Computation Definition...\n');
  console.log(`📍 Payer: ${payer.publicKey.toBase58()}`);
  console.log(`📍 Program ID: ${PROGRAM_ID.toBase58()}\n`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get discriminator for init_encrypted_transfer_comp_def
  // In Anchor, it's the first 8 bytes of sha256("global:init_encrypted_transfer_comp_def")
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  hash.update('global:init_encrypted_transfer_comp_def');
  const discriminator = hash.digest().slice(0, 8);

  console.log(`📋 Instruction discriminator: ${discriminator.toString('hex')}`);

  // Derive PDAs
  const [mxeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('arcium_mxe')],
    PROGRAM_ID
  );

  const compDefOffset = 0; // encrypted_transfer offset
  const [compDefAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('comp_def'), Buffer.from([compDefOffset, 0, 0, 0])],
    PROGRAM_ID
  );

  const ARCIUM_PROGRAM_ID = new PublicKey("ARC7fuHFPRaoaJE2dDE4GeA62hoTzJDvPLTiYPoGjFHe");

  console.log(`📍 MXE Account: ${mxeAccount.toBase58()}`);
  console.log(`📍 Comp Def Account: ${compDefAccount.toBase58()}\n`);

  // Build instruction data: just the discriminator for init with no args
  const data = discriminator;

  // Build instruction
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAccount, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // System program
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);

  try {
    console.log('⏳ Sending transaction...');
    const signature = await connection.sendTransaction(tx, [payer]);
    console.log(`📝 Transaction sent: ${signature}`);

    console.log('⏳ Confirming...');
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('\n✅ Computation Definition Initialized!');
    console.log(`🔗 Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet\n`);
  } catch (error) {
    if (error.message?.includes('already in use')) {
      console.log('\n⚠️  Computation definition already initialized!');
      console.log('✅ You can proceed to use the program.\n');
    } else {
      throw error;
    }
  }
}

main()
  .then(() => {
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Error:', error);
    process.exit(1);
  });
