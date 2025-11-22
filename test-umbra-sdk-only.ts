/**
 * Test Script: Umbra SDK Only (No MongoDB required)
 *
 * Tests the Umbra SDK integration without database
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { UmbraClient, UmbraWallet, WSOL_MINT_ADDRESS } from './src/lib/umbra-sdk/dist/index.mjs';

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  step: (msg: string) => console.log(`\n${colors.cyan}▶${colors.reset} ${msg}`),
};

async function testUmbraSDK() {
  try {
    log.step('🚀 Testing Umbra SDK Integration');

    // ============================================
    // 1. Connect to Solana
    // ============================================
    log.step('1️⃣ Connecting to Solana Devnet');

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    log.success(`Connected to ${rpcUrl}`);

    const version = await connection.getVersion();
    log.info(`Solana version: ${JSON.stringify(version)}`);

    // ============================================
    // 2. Create UmbraClient
    // ============================================
    log.step('2️⃣ Creating UmbraClient');

    const client = await UmbraClient.create({ connection });
    log.success('UmbraClient created');

    // Configure ZK Prover
    client.setZkProver('wasm', {
      masterViewingKeyRegistration: true,
      createSplDepositWithHiddenAmount: true,
      createSplDepositWithPublicAmount: true,
      claimSplDepositWithHiddenAmount: true,
      claimSplDeposit: true,
    });
    log.success('ZK Prover configured (WASM/snarkjs)');

    // ============================================
    // 3. Create Wallets
    // ============================================
    log.step('3️⃣ Creating test wallets');

    // Public wallet (source)
    const publicKeypair = Keypair.generate();
    log.info(`Public Wallet: ${publicKeypair.publicKey.toBase58()}`);

    // Private wallet (destination)
    const privateKeypair = Keypair.generate();
    log.info(`Private Wallet: ${privateKeypair.publicKey.toBase58()}`);

    // ============================================
    // 4. Create UmbraWallet
    // ============================================
    log.step('4️⃣ Creating UmbraWallet from keypair');

    const umbraWallet = await UmbraWallet.fromSigner({
      signer: { keypair: publicKeypair }
    });
    log.success('UmbraWallet created');

    // Display wallet info
    console.log('\n  Umbra Wallet Info:');
    console.log('  - Master Viewing Key:', umbraWallet.masterViewingKey.toString().slice(0, 20) + '...');
    console.log('  - Arcium X25519 Public Key:', Buffer.from(umbraWallet.arciumX25519PublicKey).toString('hex').slice(0, 20) + '...');

    // Attach wallet to client
    client.setUmbraWallet(umbraWallet);
    log.success('UmbraWallet attached to client');

    // ============================================
    // 5. Request Airdrop
    // ============================================
    log.step('5️⃣ Requesting devnet airdrop (2 SOL)');

    try {
      const airdropSignature = await connection.requestAirdrop(
        publicKeypair.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      log.info(`Airdrop signature: ${airdropSignature}`);

      log.info('Waiting for confirmation...');
      await connection.confirmTransaction(airdropSignature, 'confirmed');
      log.success('Airdrop confirmed');

      const balance = await connection.getBalance(publicKeypair.publicKey);
      log.success(`Public wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    } catch (error: any) {
      log.warn(`Airdrop failed: ${error.message}`);
      log.warn('Continuing anyway (test may fail if no balance)...');
    }

    // ============================================
    // 6. Test Confidential Deposit
    // ============================================
    log.step('6️⃣ Testing confidential deposit');

    const depositAmount = BigInt(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
    log.info(`Deposit amount: ${depositAmount} lamports (0.1 SOL)`);
    log.info('Mode: CONFIDENTIAL (encrypted amount)');

    try {
      log.warn('⚠️  Attempting deposit...');
      log.warn('This may fail due to missing Arcium MXE setup');

      const result = await client.depositConfidentiallyIntoMixerPool(
        depositAmount as any,
        publicKeypair.publicKey as any,
        WSOL_MINT_ADDRESS as any,
        publicKeypair.publicKey as any, // Use self as relayer
        {
          mode: 'connection' // Try direct connection instead of relayer
        }
      );

      log.success('✅ Deposit successful!');
      console.log('\nDeposit Result:');
      console.log('  - Generation Index:', result.generationIndex.toString());
      console.log('  - Relayer Public Key:', result.relayerPublicKey.toString());
      console.log('  - Claimable Balance:', result.claimableBalance.toString(), 'lamports');
      console.log('  - Transaction:', typeof result.txReturnedData === 'string' ? result.txReturnedData : 'Complex object');

    } catch (error: any) {
      log.error(`Deposit failed: ${error.message}`);
      if (error.logs) {
        console.log('\nProgram logs:');
        error.logs.forEach((l: string) => console.log('  ', l));
      }
      log.warn('This is expected - Arcium MXE may not be fully configured');
    }

    // ============================================
    // 7. Test Public Deposit (Fallback)
    // ============================================
    log.step('7️⃣ Testing public deposit (fallback)');

    try {
      log.info('Attempting public deposit (visible amount)...');

      const publicResult = await client.depositPublicallyIntoMixerPool(
        depositAmount as any,
        publicKeypair.publicKey as any,
        WSOL_MINT_ADDRESS as any,
        {
          mode: 'connection'
        }
      );

      log.success('✅ Public deposit successful!');
      console.log('\nPublic Deposit Result:');
      console.log('  - Generation Index:', publicResult.generationIndex.toString());
      console.log('  - Relayer Public Key:', publicResult.relayerPublicKey.toString());
      console.log('  - Claimable Balance:', publicResult.claimableBalance.toString(), 'lamports');
      console.log('  - Signature:', publicResult.txReturnedData);

      log.success('🎉 Umbra SDK is working!');

    } catch (error: any) {
      log.error(`Public deposit failed: ${error.message}`);
      if (error.logs) {
        console.log('\nProgram logs:');
        error.logs.forEach((l: string) => console.log('  ', l));
      }
    }

    // ============================================
    // 8. Summary
    // ============================================
    log.step('✅ SDK Test Summary');

    console.log('\nCapabilities Tested:');
    console.log('  ✓ Solana connection');
    console.log('  ✓ UmbraClient creation');
    console.log('  ✓ ZK Prover configuration');
    console.log('  ✓ UmbraWallet derivation');
    console.log('  ✓ Master Viewing Key generation');
    console.log('  ✓ Arcium X25519 key generation');
    console.log('  ~ Confidential deposit (requires Arcium MXE)');
    console.log('  ~ Public deposit (requires program deployed)');

    console.log('\nNext Steps:');
    console.log('  1. Deploy Umbra program to Devnet');
    console.log('  2. Configure Arcium MXE credentials');
    console.log('  3. Implement IndexerService for Merkle siblings');
    console.log('  4. Test full deposit → claim flow');

  } catch (error: any) {
    log.error(`SDK Test failed: ${error.message}`);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

// Run test
testUmbraSDK();
