import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import BN from 'bn.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Privacy Pool Service
 *
 * Provides private transfers by breaking the on-chain link between sender and receiver.
 *
 * Flow:
 * 1. Sender deposits SOL into the pool PDA (visible: Sender → Pool)
 * 2. Backend triggers withdrawal to recipient (visible: Pool → Recipient)
 *
 * On-chain, there's NO direct link between Sender and Recipient!
 */

const POOL_PROGRAM_ID = new PublicKey('55RNcHf6ktm89ko4vraLGHhdkAvpuykzKP2Kosyci62E');
const POOL_PDA = new PublicKey('25MjNuRJiMhRgnGobfndBQQqehu5GhdZ1Ts4xyPYfTWj');

// Instruction discriminators (from Anchor IDL)
const DEPOSIT_DISCRIMINATOR = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]); // deposit
const WITHDRAW_DISCRIMINATOR = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]); // withdraw

class PrivacyPoolService {
  private connection: Connection | null = null;
  private authorityKeypair: Keypair | null = null;

  /**
   * Initialize the service
   */
  async initialize(rpcUrl: string): Promise<void> {
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load authority keypair (backend wallet that controls withdrawals)
    try {
      const walletPath = join(homedir(), '.config', 'solana', 'id.json');
      const keypairData = JSON.parse(readFileSync(walletPath, 'utf8'));
      this.authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      console.log('✅ Privacy Pool Service initialized');
      console.log('   Pool Program:', POOL_PROGRAM_ID.toBase58());
      console.log('   Pool PDA:', POOL_PDA.toBase58());
      console.log('   Authority:', this.authorityKeypair.publicKey.toBase58());
    } catch (error) {
      console.error('⚠️  Could not load authority keypair for privacy pool');
    }
  }

  /**
   * Build deposit instruction for the sender
   * Returns the instruction that the sender needs to sign
   */
  buildDepositInstruction(senderPubkey: PublicKey, amount: bigint): TransactionInstruction {
    // Encode amount as u64 little-endian
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount);

    const data = Buffer.concat([DEPOSIT_DISCRIMINATOR, amountBuf]);

    return new TransactionInstruction({
      keys: [
        { pubkey: POOL_PDA, isSigner: false, isWritable: true },
        { pubkey: senderPubkey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data,
    });
  }

  /**
   * Execute withdrawal from pool to recipient
   * This is called by the backend after deposit is confirmed
   */
  async executeWithdrawal(recipientPubkey: PublicKey, amount: bigint): Promise<string> {
    if (!this.connection || !this.authorityKeypair) {
      throw new Error('Service not initialized');
    }

    console.log(`🔐 Executing private withdrawal: ${Number(amount) / LAMPORTS_PER_SOL} SOL to ${recipientPubkey.toBase58()}`);

    // Encode amount as u64 little-endian
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount);

    const data = Buffer.concat([WITHDRAW_DISCRIMINATOR, amountBuf]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: POOL_PDA, isSigner: false, isWritable: true },
        { pubkey: this.authorityKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: POOL_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = this.authorityKeypair.publicKey;
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash('confirmed')
    ).blockhash;

    const signature = await this.connection.sendTransaction(
      transaction,
      [this.authorityKeypair],
      { skipPreflight: false, preflightCommitment: 'confirmed' }
    );

    await this.connection.confirmTransaction(signature, 'confirmed');

    console.log(`✅ Private withdrawal complete: ${signature}`);
    return signature;
  }

  /**
   * Execute a complete private transfer
   * 1. Build deposit instruction for sender to sign
   * 2. After deposit confirmed, trigger withdrawal to recipient
   */
  async createPrivateTransfer(params: {
    senderKeypair: Keypair;
    recipientPubkey: PublicKey;
    amount: bigint;
  }): Promise<{
    depositSignature: string;
    withdrawSignature: string;
    poolAddress: string;
  }> {
    const { senderKeypair, recipientPubkey, amount } = params;

    if (!this.connection || !this.authorityKeypair) {
      throw new Error('Service not initialized');
    }

    console.log(`\n🔒 Creating private transfer: ${Number(amount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`   From: ${senderKeypair.publicKey.toBase58()} (public wallet)`);
    console.log(`   To: ${recipientPubkey.toBase58()} (private wallet)`);
    console.log(`   Via: ${POOL_PDA.toBase58()} (privacy pool)`);

    // Step 1: Deposit into pool
    console.log('\n📥 Step 1: Depositing into privacy pool...');
    const depositIx = this.buildDepositInstruction(senderKeypair.publicKey, amount);

    const depositTx = new Transaction().add(depositIx);
    depositTx.feePayer = senderKeypair.publicKey;
    depositTx.recentBlockhash = (
      await this.connection.getLatestBlockhash('confirmed')
    ).blockhash;

    const depositSig = await this.connection.sendTransaction(
      depositTx,
      [senderKeypair],
      { skipPreflight: false, preflightCommitment: 'confirmed' }
    );
    await this.connection.confirmTransaction(depositSig, 'confirmed');
    console.log(`   ✅ Deposit confirmed: ${depositSig}`);

    // Small delay to ensure state is updated
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Withdraw to recipient
    console.log('\n📤 Step 2: Withdrawing to private wallet...');
    const withdrawSig = await this.executeWithdrawal(recipientPubkey, amount);

    console.log('\n🎉 Private transfer complete!');
    console.log('   On-chain, there is NO direct link between sender and recipient.');
    console.log(`   Deposit TX: https://explorer.solana.com/tx/${depositSig}?cluster=devnet`);
    console.log(`   Withdraw TX: https://explorer.solana.com/tx/${withdrawSig}?cluster=devnet`);

    return {
      depositSignature: depositSig,
      withdrawSignature: withdrawSig,
      poolAddress: POOL_PDA.toBase58(),
    };
  }

  /**
   * Get pool balance
   */
  async getPoolBalance(): Promise<number> {
    if (!this.connection) {
      throw new Error('Service not initialized');
    }
    const balance = await this.connection.getBalance(POOL_PDA);
    return balance;
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.connection !== null && this.authorityKeypair !== null;
  }

  /**
   * Get pool info
   */
  getPoolInfo() {
    return {
      programId: POOL_PROGRAM_ID.toBase58(),
      poolPda: POOL_PDA.toBase58(),
      authority: this.authorityKeypair?.publicKey.toBase58() || null,
    };
  }
}

export const privacyPoolService = new PrivacyPoolService();
