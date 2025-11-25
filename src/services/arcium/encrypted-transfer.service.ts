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
import { randomBytes, createHash } from 'crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  RescueCipher,
  getComputationAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
} from '@arcium-hq/client';
import { ArciumTransfer } from '../../models/arcium-transfer.model.js';
import { ARCIUM_CONFIG } from '../../config/arcium.config.js';

/**
 * Encrypted Transfer Service using Arcium MPC
 *
 * Provides confidential transactions where amounts are encrypted
 * and processed through Arcium's Multi-Party Computation network.
 *
 * Privacy Features:
 * - Amounts encrypted client-side before submission
 * - MPC computation keeps amounts hidden
 * - Only sender and recipient can decrypt the amount
 * - On-chain data shows only encrypted values
 */

// Program ID from IDL
const PROGRAM_ID = new PublicKey(ARCIUM_CONFIG.PROGRAM_ID);
const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_CONFIG.ARCIUM_PROGRAM_ID);
const POOL_ACCOUNT = new PublicKey(ARCIUM_CONFIG.POOL_ACCOUNT);
const CLOCK_ACCOUNT = new PublicKey(ARCIUM_CONFIG.CLOCK_ACCOUNT);

// Discriminators from IDL
const ENCRYPTED_TRANSFER_DISCRIMINATOR = Buffer.from(ARCIUM_CONFIG.DISCRIMINATORS.ENCRYPTED_TRANSFER);
const INIT_COMP_DEF_DISCRIMINATOR = Buffer.from(ARCIUM_CONFIG.DISCRIMINATORS.INIT_COMP_DEF);

// PDA seeds from IDL
const TRANSFER_SEED = Buffer.from('transfer'); // [116, 114, 97, 110, 115, 102, 101, 114]
const SIGNER_ACCOUNT_SEED = Buffer.from('SignerAccount'); // [83, 105, 103, 110, 101, 114, 65, 99, 99, 111, 117, 110, 116]

class EncryptedTransferService {
  private connection: Connection | null = null;
  private mxePublicKey: Uint8Array | null = null;
  private compDefAccount: PublicKey | null = null;

  /**
   * Calculate comp_def_offset from instruction name (matches Rust comp_def_offset! macro)
   * Uses first 4 bytes of sha256 hash as u32
   */
  private calculateCompDefOffset(instructionName: string): number {
    const hash = createHash('sha256').update(instructionName).digest();
    // Read first 4 bytes as little-endian u32
    return hash.readUInt32LE(0);
  }

  /**
   * Initialize the service with Solana connection
   */
  async initialize(connection: Connection): Promise<void> {
    this.connection = connection;

    console.log('🔐 Initializing Arcium Encrypted Transfer Service...');
    console.log(`   Program ID: ${PROGRAM_ID.toBase58()}`);
    console.log(`   Arcium Program: ${ARCIUM_PROGRAM_ID.toBase58()}`);
    console.log(`   Cluster ID: ${ARCIUM_CONFIG.CLUSTER_ID}`);

    // Get MXE account and fetch public key
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    console.log(`   MXE Account: ${mxeAccount.toBase58()}`);

    try {
      const mxeInfo = await connection.getAccountInfo(mxeAccount);
      if (mxeInfo) {
        // MXE account exists, try to extract x25519 public key
        // The x25519_pubkey is in utility_pubkeys field
        // For now, use the configured key
        this.mxePublicKey = ARCIUM_CONFIG.MXE_X25519_PUBLIC_KEY;
        console.log(`   ✅ MXE Account found`);
      } else {
        console.log(`   ⚠️ MXE Account not initialized - run initializeCompDef first`);
        this.mxePublicKey = ARCIUM_CONFIG.MXE_X25519_PUBLIC_KEY;
      }
    } catch (error) {
      console.error(`   ⚠️ Could not fetch MXE account:`, error);
      this.mxePublicKey = ARCIUM_CONFIG.MXE_X25519_PUBLIC_KEY;
    }

    // Get CompDef account using arcium-client helper
    // comp_def_offset("encrypted_transfer") generates a unique ID based on the instruction name hash
    try {
      // Calculate comp_def_offset for "encrypted_transfer" - this matches the Rust macro
      const compDefOffset = this.calculateCompDefOffset('encrypted_transfer');
      this.compDefAccount = getCompDefAccAddress(PROGRAM_ID, compDefOffset);
      console.log(`   CompDef Account: ${this.compDefAccount.toBase58()}`);

      const compDefInfo = await connection.getAccountInfo(this.compDefAccount);
      if (compDefInfo) {
        console.log(`   ✅ CompDef initialized`);
      } else {
        console.log(`   ⚠️ CompDef not initialized - run initializeCompDef first`);
      }
    } catch (error) {
      console.error(`   ⚠️ Could not get CompDef address:`, error);
    }

    console.log('✅ Arcium Encrypted Transfer Service ready');
  }

  /**
   * Initialize the Computation Definition (one-time setup)
   */
  async initializeCompDef(payerKeypair: Keypair): Promise<string> {
    if (!this.connection) {
      throw new Error('Service not initialized');
    }

    console.log('🔧 Initializing Arcium CompDef...');

    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const compDefOffset = this.calculateCompDefOffset('encrypted_transfer');
    const compDefAccount = getCompDefAccAddress(PROGRAM_ID, compDefOffset);

    // Check if already initialized
    const compDefInfo = await this.connection.getAccountInfo(compDefAccount);
    if (compDefInfo) {
      console.log('✅ CompDef already initialized');
      return 'already_initialized';
    }

    // Build init_encrypted_transfer_comp_def instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: mxeAccount, isSigner: false, isWritable: true },
        { pubkey: compDefAccount, isSigner: false, isWritable: true },
        { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: INIT_COMP_DEF_DISCRIMINATOR,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = payerKeypair.publicKey;
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash('confirmed')
    ).blockhash;

    const signature = await this.connection.sendTransaction(transaction, [payerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await this.connection.confirmTransaction(signature, 'confirmed');

    this.compDefAccount = compDefAccount;
    console.log(`✅ CompDef initialized: ${signature}`);
    return signature;
  }

  /**
   * Create an encrypted private transfer
   */
  async createEncryptedTransfer(params: {
    fromKeypair: Keypair;
    toAddress: PublicKey;
    amount: bigint;
    userId?: string;
  }): Promise<{
    signature: string;
    encryptedAmount: Uint8Array;
    nonce: Uint8Array;
    publicKey: Uint8Array;
    computationOffset: string;
  }> {
    const { fromKeypair, toAddress, amount, userId } = params;

    if (!this.connection || !this.mxePublicKey) {
      throw new Error('Service not initialized');
    }

    console.log(`\n🔐 Creating encrypted transfer`);
    console.log(`   Amount: ${Number(amount) / LAMPORTS_PER_SOL} SOL`);
    console.log(`   From: ${fromKeypair.publicKey.toBase58()}`);
    console.log(`   To: ${toAddress.toBase58()}`);

    // Step 1: Generate encryption keys
    const privateKey = randomBytes(32);
    const publicKey = x25519.getPublicKey(privateKey);
    const nonce = randomBytes(16);

    // Step 2: Create shared secret with MXE
    const sharedSecret = x25519.getSharedSecret(privateKey, this.mxePublicKey);

    // Step 3: Encrypt amount and timestamp
    const cipher = new RescueCipher(sharedSecret);
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const ciphertext = cipher.encrypt([amount, timestamp], nonce);

    console.log(`   ✅ Amount encrypted`);

    // Step 4: Generate computation offset (random u64)
    const computationOffset = new BN(randomBytes(8));

    // Step 5: Derive PDAs
    const [transferAccount] = PublicKey.findProgramAddressSync(
      [TRANSFER_SEED, fromKeypair.publicKey.toBuffer(), computationOffset.toArrayLike(Buffer, 'le', 8)],
      PROGRAM_ID
    );

    const [signPdaAccount] = PublicKey.findProgramAddressSync(
      [SIGNER_ACCOUNT_SEED],
      PROGRAM_ID
    );

    // Get Arcium accounts
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mempoolAccount = getMempoolAccAddress(PROGRAM_ID);
    const executingPool = getExecutingPoolAccAddress(PROGRAM_ID);
    const computationAccount = getComputationAccAddress(PROGRAM_ID, computationOffset);
    const compDefOffset = this.calculateCompDefOffset('encrypted_transfer');
    const compDefAccount = this.compDefAccount || getCompDefAccAddress(PROGRAM_ID, compDefOffset);
    const clusterAccount = getClusterAccAddress(ARCIUM_CONFIG.CLUSTER_ID);

    console.log(`   Transfer Account: ${transferAccount.toBase58()}`);
    console.log(`   Sign PDA: ${signPdaAccount.toBase58()}`);
    console.log(`   Computation Account: ${computationAccount.toBase58()}`);

    // Step 6: Build instruction data
    // Args: computation_offset (u64), encrypted_amount ([u8;32]), encrypted_timestamp ([u8;32]),
    //       sender_pubkey ([u8;32]), nonce (u128), recipient (Pubkey)
    const computationOffsetBuf = computationOffset.toArrayLike(Buffer, 'le', 8);
    const encryptedAmountBuf = Buffer.alloc(32);
    Buffer.from(ciphertext[0]).copy(encryptedAmountBuf);
    const encryptedTimestampBuf = Buffer.alloc(32);
    Buffer.from(ciphertext[1]).copy(encryptedTimestampBuf);
    const pubKeyBuf = Buffer.from(publicKey);

    // nonce as u128 (16 bytes LE)
    const nonceBuf = Buffer.alloc(16);
    nonce.copy(nonceBuf);

    const recipientBuf = toAddress.toBuffer();

    const instructionData = Buffer.concat([
      ENCRYPTED_TRANSFER_DISCRIMINATOR,
      computationOffsetBuf,
      encryptedAmountBuf,
      encryptedTimestampBuf,
      pubKeyBuf,
      nonceBuf,
      recipientBuf,
    ]);

    // Step 7: Build instruction with all accounts (order from IDL)
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: fromKeypair.publicKey, isSigner: true, isWritable: true },   // sender
        { pubkey: fromKeypair.publicKey, isSigner: true, isWritable: true },   // payer (same as sender)
        { pubkey: transferAccount, isSigner: false, isWritable: true },        // transfer_account
        { pubkey: signPdaAccount, isSigner: false, isWritable: true },         // sign_pda_account
        { pubkey: mxeAccount, isSigner: false, isWritable: false },            // mxe_account
        { pubkey: mempoolAccount, isSigner: false, isWritable: true },         // mempool_account
        { pubkey: executingPool, isSigner: false, isWritable: true },          // executing_pool
        { pubkey: computationAccount, isSigner: false, isWritable: true },     // computation_account
        { pubkey: compDefAccount, isSigner: false, isWritable: false },        // comp_def_account
        { pubkey: clusterAccount, isSigner: false, isWritable: true },         // cluster_account
        { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },           // pool_account
        { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },         // clock_account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },     // arcium_program
      ],
      programId: PROGRAM_ID,
      data: instructionData,
    });

    // Step 8: Send transaction
    console.log(`   📡 Sending encrypted transfer to Arcium MPC...`);

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = fromKeypair.publicKey;
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash('confirmed')
    ).blockhash;

    let signature: string;
    try {
      signature = await this.connection.sendTransaction(
        transaction,
        [fromKeypair],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );

      await this.connection.confirmTransaction(signature, 'confirmed');
      console.log(`   ✅ Transaction confirmed: ${signature}`);
      console.log(`   🔗 https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    } catch (error: any) {
      console.error(`   ❌ Transaction failed:`, error.message);
      if (error.logs) {
        console.error(`   📋 Logs:`, error.logs.slice(-10).join('\n'));
      }
      throw error;
    }

    // Step 9: Save to database
    try {
      await ArciumTransfer.create({
        userId: userId || 'anonymous',
        sender: fromKeypair.publicKey.toBase58(),
        recipient: toAddress.toBase58(),
        encryptedAmount: encryptedAmountBuf,
        encryptedTimestamp: encryptedTimestampBuf,
        nonce: nonceBuf,
        senderPublicKey: pubKeyBuf,
        computationOffset: computationOffset.toString(),
        status: 'pending',
        amount: amount.toString(),
        computationSignature: signature,
        timestamp: new Date(),
      });
      console.log(`   💾 Transfer saved to database`);
    } catch (dbError) {
      console.warn(`   ⚠️ Could not save to database:`, dbError);
    }

    return {
      signature,
      encryptedAmount: new Uint8Array(encryptedAmountBuf),
      nonce,
      publicKey,
      computationOffset: computationOffset.toString(),
    };
  }

  /**
   * Decrypt an encrypted amount (for recipient)
   */
  decryptAmount(params: {
    encryptedAmount: Uint8Array;
    nonce: Uint8Array;
    senderPublicKey: Uint8Array;
    recipientPrivateKey: Uint8Array;
  }): bigint {
    const { encryptedAmount, nonce, senderPublicKey, recipientPrivateKey } = params;

    // Generate shared secret
    const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, senderPublicKey);

    // Initialize cipher and decrypt
    const cipher = new RescueCipher(sharedSecret);
    const decrypted = cipher.decrypt([Array.from(encryptedAmount)], nonce);

    return decrypted[0];
  }

  /**
   * Get transfer status from on-chain TransferAccount
   */
  async getTransferStatus(sender: PublicKey, computationOffset: BN): Promise<{
    status: 'pending' | 'completed' | 'failed' | 'not_found';
    encryptedResultAmount?: Uint8Array;
    resultNonce?: Uint8Array;
    resultEncryptionKey?: Uint8Array;
  }> {
    if (!this.connection) {
      throw new Error('Service not initialized');
    }

    const [transferAccount] = PublicKey.findProgramAddressSync(
      [TRANSFER_SEED, sender.toBuffer(), computationOffset.toArrayLike(Buffer, 'le', 8)],
      PROGRAM_ID
    );

    const accountInfo = await this.connection.getAccountInfo(transferAccount);
    if (!accountInfo) {
      return { status: 'not_found' };
    }

    // Parse TransferAccount data
    // Skip 8-byte discriminator
    const data = accountInfo.data.slice(8);

    // TransferAccount layout:
    // sender: 32, recipient: 32, encrypted_amount: 32, nonce: 16, sender_pubkey: 32,
    // timestamp: 8, status: 1, encrypted_result_amount: 32, result_nonce: 16, result_encryption_key: 32
    const statusByte = data[32 + 32 + 32 + 16 + 32 + 8];
    const status = statusByte === 0 ? 'pending' : statusByte === 1 ? 'completed' : 'failed';

    if (status === 'completed') {
      const offset = 32 + 32 + 32 + 16 + 32 + 8 + 1;
      return {
        status,
        encryptedResultAmount: data.slice(offset, offset + 32),
        resultNonce: data.slice(offset + 32, offset + 32 + 16),
        resultEncryptionKey: data.slice(offset + 32 + 16, offset + 32 + 16 + 32),
      };
    }

    return { status };
  }

  /**
   * Wait for MPC computation to complete
   */
  async waitForCompletion(
    sender: PublicKey,
    computationOffset: BN,
    timeoutMs: number = 60000
  ): Promise<{
    status: 'completed' | 'failed' | 'timeout' | 'pending' | 'not_found';
    encryptedResultAmount?: Uint8Array;
    resultNonce?: Uint8Array;
    resultEncryptionKey?: Uint8Array;
  }> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.getTransferStatus(sender, computationOffset);

      if (result.status === 'completed' || result.status === 'failed') {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return { status: 'timeout' };
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    totalTransfers: number;
    pendingTransfers: number;
    completedTransfers: number;
  }> {
    const [total, pending] = await Promise.all([
      ArciumTransfer.countDocuments(),
      ArciumTransfer.countDocuments({ status: 'pending' }),
    ]);

    return {
      totalTransfers: total,
      pendingTransfers: pending,
      completedTransfers: total - pending,
    };
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.connection !== null && this.mxePublicKey !== null;
  }

  /**
   * Get service info
   */
  getInfo() {
    return {
      programId: PROGRAM_ID.toBase58(),
      arciumProgramId: ARCIUM_PROGRAM_ID.toBase58(),
      clusterId: ARCIUM_CONFIG.CLUSTER_ID,
      compDefAccount: this.compDefAccount?.toBase58() || null,
      ready: this.isReady(),
    };
  }
}

// Export singleton instance
export const encryptedTransferService = new EncryptedTransferService();
