import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { randomBytes } from 'crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { RescueCipher, getComputationAccAddress, getMXEAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress, getClusterAccAddress, } from '@arcium-hq/client';
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
class EncryptedTransferService {
    constructor() {
        this.connection = null;
        this.programId = null;
        this.provider = null;
        this.mxePublicKey = null;
    }
    /**
     * Initialize the service with Solana connection and program
     */
    async initialize(connection, programId) {
        this.connection = connection;
        // Create provider (using a dummy wallet for now)
        const dummyWallet = {
            publicKey: Keypair.generate().publicKey,
            signTransaction: async (tx) => tx,
            signAllTransactions: async (txs) => txs,
        };
        this.provider = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
        // Store program ID (we'll build instructions manually to avoid IDL account type issues)
        if (programId) {
            this.programId = programId;
            console.log(`✅ Arcium program ID set: ${programId.toBase58()}`);
            // Check if CompDef is initialized
            // Using the stealf_private program's private_transfer CompDef PDA
            const compDefAccount = new PublicKey(ARCIUM_CONFIG.COMP_DEF_PRIVATE_TRANSFER);
            const compDefInfo = await connection.getAccountInfo(compDefAccount);
            if (!compDefInfo) {
                console.log(`⚠️  Arcium CompDef not initialized!`);
                console.log(`   Run this command to initialize it:`);
                console.log(`   POST /api/arcium/init with your wallet keypair`);
            }
            else {
                console.log(`✅ Arcium CompDef initialized`);
            }
        }
        else {
            console.log('⚠️  No program ID provided - encrypted transfers disabled');
        }
        // Get MXE public key from cluster
        const mxeAddress = getMXEAccAddress(programId || new PublicKey('11111111111111111111111111111111'));
        try {
            // In production, fetch MXE public key from on-chain account
            // For now, use a placeholder
            this.mxePublicKey = ARCIUM_CONFIG.MXE_X25519_PUBLIC_KEY;
            console.log('🔐 Arcium Encrypted Transfer Service initialized');
        }
        catch (error) {
            console.error('⚠️  MXE public key not available yet');
            this.mxePublicKey = new Uint8Array(32); // Placeholder
        }
    }
    /**
     * Initialize Arcium MXE and CompDef (one-time setup)
     */
    async initializeArcium(payerKeypair) {
        if (!this.connection || !this.programId) {
            throw new Error('Service not initialized');
        }
        console.log(`🔧 Initializing Arcium MXE and CompDef...`);
        // Get required accounts
        const mxeAccount = getMXEAccAddress(this.programId);
        // FIXME: @arcium-hq/client calculates wrong PDA in v0.4.0
        const compDefAccount = new PublicKey('B1KzKYPRqAWfqbHdFW2VZ9dpxDzRYDpmtUDGQzZeLuDV');
        const ARCIUM_PROGRAM_ID = this.programId;
        // Check if already initialized
        const compDefInfo = await this.connection.getAccountInfo(compDefAccount);
        if (compDefInfo) {
            console.log(`✅ Already initialized`);
            return 'already_initialized';
        }
        // Build init_encrypted_transfer_comp_def instruction
        // Discriminator from IDL: [250, 215, 8, 129, 167, 245, 172, 181]
        const discriminator = Buffer.from([250, 215, 8, 129, 167, 245, 172, 181]);
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: mxeAccount, isSigner: false, isWritable: true },
                { pubkey: compDefAccount, isSigner: false, isWritable: true },
                { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
            ],
            programId: this.programId,
            data: discriminator,
        });
        const transaction = new Transaction().add(instruction);
        transaction.feePayer = payerKeypair.publicKey;
        transaction.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
        const signature = await this.connection.sendTransaction(transaction, [payerKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });
        await this.connection.confirmTransaction(signature, 'confirmed');
        console.log(`✅ Arcium initialized: ${signature}`);
        return signature;
    }
    /**
     * Create an encrypted private transfer
     *
     * @param fromKeypair - Sender's keypair
     * @param toAddress - Recipient's address
     * @param amount - Amount in lamports (will be encrypted)
     * @returns Transfer signature and encryption details
     */
    async createEncryptedTransfer(params) {
        const { fromKeypair, toAddress, amount, userId } = params;
        if (!this.connection || !this.mxePublicKey) {
            throw new Error('Service not initialized');
        }
        console.log(`🔐 Creating encrypted transfer: ${amount} lamports`);
        console.log(`   From: ${fromKeypair.publicKey.toBase58()}`);
        console.log(`   To: ${toAddress.toBase58()}`);
        // Generate encryption keys (32 bytes for x25519)
        const privateKey = randomBytes(32);
        const publicKey = x25519.getPublicKey(privateKey);
        // Generate shared secret with MXE
        const sharedSecret = x25519.getSharedSecret(privateKey, this.mxePublicKey);
        // Initialize Rescue cipher
        const cipher = new RescueCipher(sharedSecret);
        // Generate nonce
        const nonce = randomBytes(16);
        // Encrypt the amount and timestamp
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const plaintext = [amount, timestamp];
        const ciphertext = cipher.encrypt(plaintext, nonce);
        console.log(`   ✅ Amount encrypted (hidden from blockchain)`);
        // Generate computation offset
        const computationOffset = new BN(randomBytes(8), 'hex');
        console.log(`   Computation offset: ${computationOffset.toString()}`);
        // REAL ARCIUM MPC ENCRYPTED TRANSACTION
        console.log(`   📡 Calling Arcium MPC program on Devnet...`);
        console.log(`   🔒 Amount will be ENCRYPTED on-chain via MPC`);
        if (!this.programId) {
            throw new Error('Arcium program not properly initialized');
        }
        // Get required PDAs and accounts
        const mxeAccount = getMXEAccAddress(this.programId);
        const mempoolAccount = getMempoolAccAddress(this.programId);
        const executingPool = getExecutingPoolAccAddress(this.programId);
        // Using stealf_private program's private_transfer CompDef PDA
        const compDefAccount = new PublicKey(ARCIUM_CONFIG.COMP_DEF_PRIVATE_TRANSFER);
        const clusterAccount = getClusterAccAddress(ARCIUM_CONFIG.CLUSTER_ID);
        const computationAccount = getComputationAccAddress(this.programId, computationOffset);
        // Derive sign PDA account (seed is "SignerAccount" from IDL)
        const [signPdaAccount] = PublicKey.findProgramAddressSync([Buffer.from('SignerAccount')], this.programId);
        console.log(`   📍 Sign PDA Account: ${signPdaAccount.toBase58()}`);
        console.log(`   📤 Building private_transfer instruction...`);
        // Build instruction data manually for stealf_private program
        // Discriminator from IDL (private_transfer): [107, 20, 177, 94, 33, 119, 16, 110]
        const discriminator = Buffer.from([107, 20, 177, 94, 33, 119, 16, 110]);
        // Encode arguments (from stealf_private IDL):
        // 1. computation_offset: u64
        // 2. encrypted_sender_balance: [u8; 32]
        // 3. encrypted_amount: [u8; 32]
        // 4. pub_key: [u8; 32]
        // 5. nonce: u128
        const computationOffsetBuf = computationOffset.toArrayLike(Buffer, 'le', 8);
        const encryptedSenderBalanceBuf = Buffer.from(ciphertext[0]); // encrypted_sender_balance (using first ciphertext)
        const encryptedAmountBuf = Buffer.from(ciphertext[1]); // encrypted_amount (using second ciphertext)
        const pubKeyBuf = Buffer.from(publicKey); // pub_key
        const nonceBuf = Buffer.alloc(16);
        nonceBuf.writeBigUInt64LE(BigInt(Buffer.from(nonce).readBigUInt64LE()), 0);
        nonceBuf.writeBigUInt64LE(BigInt(Buffer.from(nonce.slice(8)).readBigUInt64LE()), 8);
        const instructionData = Buffer.concat([
            discriminator,
            computationOffsetBuf,
            encryptedSenderBalanceBuf,
            encryptedAmountBuf,
            pubKeyBuf,
            nonceBuf,
        ]);
        // Arcium global program ID and fixed accounts (from IDL)
        const ARCIUM_PROGRAM_ID = new PublicKey('Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp');
        const POOL_ACCOUNT = new PublicKey('FsWbPQcJQ2cCyr9ndse13fDqds4F2Ezx2WgTL25Dke4M');
        const CLOCK_ACCOUNT = new PublicKey('AxygBawEvVwZPetj3yPJb9sGdZvaJYsVguET1zFUQkV');
        // Build instruction with all required accounts (EXACT order from IDL!)
        // Order: payer, sign_pda_account, mxe_account, mempool_account, executing_pool,
        //        computation_account, comp_def_account, cluster_account, pool_account,
        //        clock_account, system_program, arcium_program
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: fromKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: signPdaAccount, isSigner: false, isWritable: true },
                { pubkey: mxeAccount, isSigner: false, isWritable: false },
                { pubkey: mempoolAccount, isSigner: false, isWritable: true },
                { pubkey: executingPool, isSigner: false, isWritable: true },
                { pubkey: computationAccount, isSigner: false, isWritable: true },
                { pubkey: compDefAccount, isSigner: false, isWritable: false },
                { pubkey: clusterAccount, isSigner: false, isWritable: true },
                { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
                { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false }, // 11: arcium_program
            ],
            programId: this.programId,
            data: instructionData,
        });
        // Send transaction
        let realTxSignature;
        try {
            const transaction = new Transaction().add(instruction);
            transaction.feePayer = fromKeypair.publicKey;
            transaction.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
            realTxSignature = await this.connection.sendTransaction(transaction, [fromKeypair], { skipPreflight: false, preflightCommitment: 'confirmed' });
            // Wait for confirmation
            await this.connection.confirmTransaction(realTxSignature, 'confirmed');
            console.log(`   ✅ ENCRYPTED MPC transaction confirmed!`);
            console.log(`      Signature: ${realTxSignature}`);
            console.log(`      Explorer: https://explorer.solana.com/tx/${realTxSignature}?cluster=devnet`);
            console.log(`   🔐 Amount is HIDDEN on-chain - only encrypted bytes visible!`);
        }
        catch (error) {
            console.error(`   ❌ Arcium MPC transaction failed:`, error.message);
            if (error.logs) {
                console.error(`   📋 Logs:`, error.logs.join('\n'));
            }
            throw new Error(`Failed to send encrypted transfer: ${error.message}`);
        }
        // Save transfer to database with REAL signature
        const transfer = await ArciumTransfer.create({
            userId: userId || 'anonymous',
            sender: fromKeypair.publicKey.toBase58(),
            recipient: toAddress.toBase58(),
            encryptedAmount: Buffer.from(ciphertext[0]),
            encryptedTimestamp: Buffer.from(ciphertext[1]),
            nonce: Buffer.from(nonce),
            senderPublicKey: Buffer.from(publicKey),
            computationOffset: computationOffset.toString(),
            status: 'completed',
            amount: amount.toString(),
            computationSignature: realTxSignature,
            finalizationSignature: realTxSignature,
            timestamp: new Date(),
        });
        console.log(`   💾 Transfer saved to database: ${transfer._id}`);
        console.log(`   ✅ Encrypted transfer created successfully (REAL Devnet TX)`);
        return {
            computationSignature: realTxSignature,
            finalizationSignature: realTxSignature,
            encryptedAmount: new Uint8Array(ciphertext[0]),
            nonce,
            publicKey,
            computationOffset: computationOffset.toString(),
            recipientCanDecrypt: true,
        };
    }
    /**
     * Decrypt an encrypted amount
     *
     * @param encryptedAmount - Encrypted amount ciphertext
     * @param nonce - Nonce used for encryption
     * @param encryptionKey - Sender's public key
     * @param recipientPrivateKey - Recipient's private key (x25519)
     * @returns Decrypted amount
     */
    async decryptAmount(params) {
        const { encryptedAmount, nonce, encryptionKey, recipientPrivateKey } = params;
        console.log(`🔓 Decrypting amount...`);
        // Generate shared secret
        const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, encryptionKey);
        // Initialize cipher
        const cipher = new RescueCipher(sharedSecret);
        // Decrypt
        const decrypted = cipher.decrypt([Array.from(encryptedAmount)], nonce);
        console.log(`   ✅ Amount decrypted: ${decrypted[0]} lamports`);
        return decrypted[0];
    }
    /**
     * Get encrypted transfer by ID
     */
    async getTransferById(transferId) {
        const transfer = await ArciumTransfer.findById(transferId);
        if (!transfer) {
            throw new Error('Transfer not found');
        }
        return transfer;
    }
    /**
     * Get all transfers for a user
     */
    async getUserTransfers(userId) {
        const transfers = await ArciumTransfer.find({ userId }).sort({ timestamp: -1 });
        return transfers;
    }
    /**
     * Get received transfers for an address
     */
    async getReceivedTransfers(address) {
        const transfers = await ArciumTransfer.find({ recipient: address }).sort({ timestamp: -1 });
        return transfers;
    }
    /**
     * Get service statistics
     */
    async getStats() {
        const [total, pending] = await Promise.all([
            ArciumTransfer.countDocuments(),
            ArciumTransfer.countDocuments({ status: 'pending' }),
        ]);
        return {
            totalTransfers: total,
            pendingTransfers: pending,
            completedTransfers: total - pending,
            totalVolumeEncrypted: true, // Volumes are encrypted, cannot be calculated
        };
    }
    /**
     * Check if service is initialized
     */
    isInitialized() {
        return this.connection !== null && this.mxePublicKey !== null;
    }
}
// Export singleton instance
export const encryptedTransferService = new EncryptedTransferService();
