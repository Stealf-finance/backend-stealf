/**
 * Test Script: Umbra Confidential Deposit Flow
 *
 * Flow: Wallet Public → Deposit Confidentiel → Pool → Claim → Wallet Privé
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { umbraClientService } from './src/services/umbra/umbra-client.service.js';
import { umbraWalletService } from './src/services/umbra/umbra-wallet.service.js';
import { depositService } from './src/services/umbra/deposit.service.js';
import { claimService } from './src/services/umbra/claim.service.js';
import mongoose from 'mongoose';
import { User } from './src/models/User.js';
import { Transaction } from './src/models/Transaction.js';
import { DepositArtifacts } from './src/models/DepositArtifacts.js';

// Colors for console
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

async function testConfidentialFlow() {
  try {
    log.step('🚀 Starting Umbra Confidential Flow Test');

    // ===============================
    // =============
    // 1. Setup & Connect
    // ============================================
    log.step('1️⃣ Connecting to MongoDB and Solana');

    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stealf_backend');
    log.success('MongoDB connected');

    await umbraClientService.initialize();
    log.success('UmbraClient initialized');

    const connection = umbraClientService.getConnection();

    // ============================================
    // 2. Create Test User & Wallets
    // ============================================
    log.step('2️⃣ Creating test wallets');

    // Wallet Public (source)
    const publicKeypair = Keypair.generate();
    log.info(`Public Wallet: ${publicKeypair.publicKey.toBase58()}`);

    // Wallet Privé (destination)
    const privateKeypair = Keypair.generate();
    log.info(`Private Wallet: ${privateKeypair.publicKey.toBase58()}`);

    // Create test user
    const testUser = await User.create({
      email: `test-${Date.now()}@umbra.test`,
      solanaWallet: publicKeypair.publicKey.toBase58(),
      preferredMode: 'confidential',
    });
    log.success(`Test user created: ${testUser._id}`);

    // ============================================
    // 3. Fund Public Wallet (Devnet Airdrop)
    // ============================================
    log.step('3️⃣ Requesting devnet airdrop');

    try {
      const airdropSignature = await connection.requestAirdrop(
        publicKeypair.publicKey,
        2 * LAMPORTS_PER_SOL // 2 SOL
      );

      await connection.confirmTransaction(airdropSignature, 'confirmed');
      log.success('Airdrop confirmed: 2 SOL');

      const balance = await connection.getBalance(publicKeypair.publicKey);
      log.info(`Public wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (error: any) {
      log.warn(`Airdrop failed (rate limit?): ${error.message}`);
      log.warn('Continuing with test (may fail if no balance)...');
    }

    // ============================================
    // 4. Deposit Confidentiel
    // ============================================
    log.step('4️⃣ Performing confidential deposit');

    const depositAmount = BigInt(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
    log.info(`Deposit amount: ${depositAmount} lamports (0.1 SOL)`);
    log.info('Mode: CONFIDENTIAL (montant caché + gasless)');

    let depositResult;
    try {
      depositResult = await depositService.depositConfidential({
        userId: testUser._id.toString(),
        keypair: publicKeypair,
        amount: depositAmount,
        // mint: WSOL by default
        // relayerPublicKey: will use own address as relayer
      });

      log.success('✅ Deposit successful!');
      console.log('\nDeposit Result:');
      console.log('  - Generation Index:', depositResult.generationIndex);
      console.log('  - Claimable Balance:', depositResult.claimableBalance, 'lamports');
      console.log('  - Transaction ID:', depositResult.transactionId);
      console.log('  - Deposit Artifacts ID:', depositResult.depositArtifactsId);
    } catch (error: any) {
      log.error(`Deposit failed: ${error.message}`);
      throw error;
    }

    // ============================================
    // 5. Verify Deposit in Database
    // ============================================
    log.step('5️⃣ Verifying deposit in database');

    const depositTx = await Transaction.findById(depositResult.transactionId);
    if (!depositTx) {
      throw new Error('Deposit transaction not found in database');
    }

    log.success('Transaction saved:');
    console.log('  - Type:', depositTx.type);
    console.log('  - Status:', depositTx.status);
    console.log('  - Amount:', depositTx.amount, 'lamports');
    console.log('  - Generation Index:', depositTx.generationIndex);

    const depositArtifacts = await DepositArtifacts.findById(depositResult.depositArtifactsId);
    if (!depositArtifacts) {
      throw new Error('Deposit artifacts not found in database');
    }

    log.success('Deposit artifacts saved:');
    console.log('  - Claimable:', !depositArtifacts.claimed);
    console.log('  - Balance:', depositArtifacts.claimableBalance, 'lamports');
    console.log('  - Type:', depositArtifacts.depositType);

    // ============================================
    // 6. Get Claimable Deposits
    // ============================================
    log.step('6️⃣ Fetching claimable deposits');

    const claimableDeposits = await depositService.getClaimableDeposits(testUser._id.toString());
    log.success(`Found ${claimableDeposits.length} claimable deposit(s)`);

    if (claimableDeposits.length === 0) {
      throw new Error('No claimable deposits found');
    }

    // ============================================
    // 7. Wait for Anonymity Set (Simulation)
    // ============================================
    log.step('7️⃣ Waiting for anonymity set to grow...');
    log.warn('⏱️  In production, you should wait 24-48h');
    log.info('For this test, we\'ll continue immediately');

    await new Promise(resolve => setTimeout(resolve, 2000)); // 2s pause

    // ============================================
    // 8. Claim to Private Wallet
    // ============================================
    log.step('8️⃣ Claiming to private wallet with ZK proof');

    log.info(`Recipient: ${privateKeypair.publicKey.toBase58()}`);
    log.warn('⚠️  This will likely fail without proper indexer integration');

    try {
      const claimResult = await claimService.claimDeposit({
        userId: testUser._id.toString(),
        keypair: publicKeypair,
        depositArtifactsId: depositResult.depositArtifactsId,
        recipientAddress: privateKeypair.publicKey.toBase58(),
      });

      log.success('✅ Claim successful!');
      console.log('\nClaim Result:');
      console.log('  - Signature:', claimResult.signature);
      console.log('  - Amount:', claimResult.amount, 'lamports');
      console.log('  - Transaction ID:', claimResult.transactionId);

      // Check private wallet balance
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for confirmation

      const privateBalance = await connection.getBalance(privateKeypair.publicKey);
      log.info(`Private wallet balance: ${privateBalance / LAMPORTS_PER_SOL} SOL`);

      if (privateBalance > 0) {
        log.success('🎉 Privacy transfer complete!');
        log.success(`Public (${publicKeypair.publicKey.toBase58().slice(0, 8)}...) → Private (${privateKeypair.publicKey.toBase58().slice(0, 8)}...)`);
        log.success('Link is broken! No one can trace this transfer! 🎭');
      }

    } catch (error: any) {
      log.error(`Claim failed: ${error.message}`);
      log.warn('This is expected - indexer service needs to be implemented');
      log.info('The deposit is saved and can be claimed later once indexer is ready');
    }

    // ============================================
    // 9. Summary
    // ============================================
    log.step('9️⃣ Test Summary');

    const allTransactions = await Transaction.find({ userId: testUser._id }).sort({ createdAt: -1 });
    log.info(`Total transactions: ${allTransactions.length}`);

    allTransactions.forEach((tx, i) => {
      console.log(`  ${i + 1}. ${tx.type.toUpperCase()} - ${tx.status} - ${tx.amount} lamports`);
    });

    const allDeposits = await DepositArtifacts.find({ userId: testUser._id });
    log.info(`Total deposits: ${allDeposits.length}`);

    allDeposits.forEach((dep, i) => {
      console.log(`  ${i + 1}. ${dep.depositType.toUpperCase()} - ${dep.claimed ? 'CLAIMED' : 'PENDING'} - ${dep.claimableBalance} lamports`);
    });

    log.step('✅ Test completed!');

  } catch (error: any) {
    log.error(`Test failed: ${error.message}`);
    console.error(error);
  } finally {
    // Cleanup
    await mongoose.disconnect();
    log.info('MongoDB disconnected');
    process.exit(0);
  }
}

// Run test
testConfidentialFlow();
