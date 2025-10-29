import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';

async function main() {
  console.log('\n🧪 TEST: Transfer 0.05 SOL\n');

  // Load sender wallet
  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const sender = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  // Generate random receiver
  const receiver = Keypair.generate();

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check balance before
  const balanceBefore = await connection.getBalance(sender.publicKey);
  console.log(`💰 Balance avant: ${balanceBefore / LAMPORTS_PER_SOL} SOL`);

  // Transfer 0.05 SOL
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    })
  );

  console.log('\n🚀 Envoi de 0.05 SOL...');
  const signature = await sendAndConfirmTransaction(connection, transaction, [sender]);
  console.log(`✅ Transaction: ${signature}`);

  // Check balance after
  const balanceAfter = await connection.getBalance(sender.publicKey);
  console.log(`💰 Balance après: ${balanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`📊 Différence: ${(balanceBefore - balanceAfter) / LAMPORTS_PER_SOL} SOL`);

  const expectedBalance = 4.044;
  const actualBalance = balanceAfter / LAMPORTS_PER_SOL;
  const tolerance = 0.001;

  if (Math.abs(actualBalance - expectedBalance) < tolerance) {
    console.log(`\n✅ SUCCESS! Balance ~${expectedBalance} SOL (${actualBalance} SOL)`);
  } else {
    console.log(`\n⚠️  Balance différente: attendu ~${expectedBalance} SOL, reçu ${actualBalance} SOL`);
  }
}

main().catch(console.error);
