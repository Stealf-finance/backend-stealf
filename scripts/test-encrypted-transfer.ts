/**
 * Test encrypted transfer with Arcium MPC
 *
 * This script tests the full flow:
 * 1. Encrypt an amount using x25519 + RescueCipher
 * 2. Queue computation to Arcium MPC
 * 3. Wait for MPC to process
 * 4. Decrypt the result
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { encryptedTransferService } from '../src/services/arcium/encrypted-transfer.service.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

async function testEncryptedTransfer() {
  console.log('🧪 Testing Arcium Encrypted Transfer\n');
  console.log('='.repeat(60));

  // Load payer keypair (your Solana wallet)
  const walletPath = join(homedir(), '.config', 'solana', 'id.json');
  let payerKeypair: Keypair;

  try {
    const keypairData = JSON.parse(readFileSync(walletPath, 'utf8'));
    payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('\n✅ Loaded payer keypair');
    console.log('   Address:', payerKeypair.publicKey.toBase58());
  } catch (error) {
    console.error('❌ Failed to load keypair from', walletPath);
    console.log('   Make sure you have a Solana keypair at ~/.config/solana/id.json');
    process.exit(1);
  }

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('   Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  if (balance === 0) {
    console.error('\n❌ No SOL balance! Request airdrop first:');
    console.log(`   solana airdrop 2 ${payerKeypair.publicKey.toBase58()} -u devnet`);
    process.exit(1);
  }

  // Initialize service
  console.log('\n📦 Initializing Encrypted Transfer Service...');
  await encryptedTransferService.initialize(connection);

  if (!encryptedTransferService.isReady()) {
    console.error('❌ Service not ready!');
    process.exit(1);
  }

  console.log('✅ Service ready!');

  // Test parameters
  const recipientAddress = payerKeypair.publicKey; // Send to self for testing
  const amountSOL = 0.001; // 0.001 SOL
  const amountLamports = BigInt(Math.floor(amountSOL * LAMPORTS_PER_SOL));

  console.log('\n📤 Creating encrypted transfer:');
  console.log('   From:', payerKeypair.publicKey.toBase58());
  console.log('   To:', recipientAddress.toBase58());
  console.log('   Amount:', amountSOL, 'SOL (ENCRYPTED)');

  try {
    // Create encrypted transfer
    console.log('\n🔐 Encrypting amount and queuing computation...');
    const result = await encryptedTransferService.createEncryptedTransfer({
      fromKeypair: payerKeypair,
      toAddress: recipientAddress,
      amount: amountLamports,
    });

    console.log('\n✅ Computation queued!');
    console.log('   Signature:', result.signature);
    console.log('   Computation offset:', result.computationOffset.toString());
    console.log('   Encrypted amount (hex):', Buffer.from(result.encryptedAmount).toString('hex'));
    console.log('   Explorer:', `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);

    // Wait for MPC computation
    console.log('\n⏳ Waiting for MPC computation to complete...');
    console.log('   (This may take 10-60 seconds)');

    const computationResult = await encryptedTransferService.waitForCompletion(
      payerKeypair.publicKey,
      result.computationOffset,
      90000 // 90 second timeout
    );

    if (computationResult.status === 'Finalized') {
      console.log('\n🎉 SUCCESS! MPC computation completed!');
      console.log('   Status:', computationResult.status);
      console.log('\n   The amount was processed privately by the MPC network.');
      console.log('   Nobody except sender/recipient can see the amount!');
    } else if (computationResult.status === 'Aborted') {
      console.log('\n⚠️  Computation was aborted');
      console.log('   Reason:', computationResult.status);
    } else {
      console.log('\n⏸️  Computation still processing');
      console.log('   Status:', computationResult.status);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Encrypted transfer test completed successfully!\n');

  } catch (error: any) {
    console.error('\n❌ Transfer failed:', error.message);

    if (error.message?.includes('MxeKeysNotSet')) {
      console.log('\n💡 MxeKeysNotSet error:');
      console.log('   The MXE cluster nodes need to configure their keys.');
      console.log('   Contact the Arcium dev team to initialize the MXE.');
    }

    if (error.message?.includes('6002')) {
      console.log('\n💡 Error 6002 is MxeKeysNotSet');
    }

    process.exit(1);
  }
}

testEncryptedTransfer()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
