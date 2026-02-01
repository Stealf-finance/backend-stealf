import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import {
  RescueCipher,
  getMXEPublicKey,
  getMXEAccAddress,
  getClusterAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
} from '@arcium-hq/client';
import { randomBytes } from 'crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import StealfArciumIDL from '../idl/stealf_arcium.json';

// Type definitions
type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

type BackupError =
  | { type: 'MXE_UNAVAILABLE'; message: string }
  | { type: 'ENCRYPTION_FAILED'; message: string }
  | { type: 'COMPUTATION_TIMEOUT'; message: string }
  | { type: 'CALLBACK_INVALID'; message: string };

type VerificationError =
  | { type: 'MXE_UNAVAILABLE'; message: string }
  | { type: 'BALANCE_FETCH_FAILED'; message: string }
  | { type: 'COMPUTATION_TIMEOUT'; message: string };

type RecoveryError =
  | { type: 'DATA_NOT_FOUND'; message: string }
  | { type: 'INVALID_SIGNATURE'; message: string }
  | { type: 'DECRYPTION_FAILED'; message: string }
  | { type: 'TURNKEY_AUTH_FAILED'; message: string };

interface SessionKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  sharedSecret: Uint8Array;
  cipher: RescueCipher;
}

class ArciumService {
  private isInitialized: boolean = false;
  private program: Program | null = null;
  private provider: AnchorProvider | null = null;
  private clusterOffset: number = 456; // Devnet MXE cluster offset
  private connection: Connection | null = null;

  /**
   * Initialize the Arcium service with Solana connection and wallet
   * @param connection - Solana RPC connection
   * @param wallet - Wallet for signing transactions
   * @param useLocalnet - Optional flag to use localnet instead of devnet (default: false)
   */
  async initialize(
    connection: Connection,
    wallet: Wallet,
    useLocalnet: boolean = false
  ): Promise<void> {
    try {
      console.log('[ArciumService] Initializing with cluster offset:', this.clusterOffset);

      this.connection = connection;

      // Create Anchor provider
      this.provider = new AnchorProvider(
        connection,
        wallet,
        { commitment: 'confirmed' }
      );

      // Load Anchor program with IDL
      // The program ID is embedded in the IDL at StealfArciumIDL.address
      // Override with env var if specified
      const programIdFromEnv = process.env.STEALF_ARCIUM_PROGRAM_ID;
      const idlToUse = programIdFromEnv
        ? { ...StealfArciumIDL, address: programIdFromEnv }
        : StealfArciumIDL;

      this.program = new Program(
        idlToUse as anchor.Idl,
        this.provider
      );

      // Test MXE connection
      try {
        await this.testMXEConnection();
        this.isInitialized = true;
        console.log('[ArciumService] ✅ Successfully initialized and connected to MXE cluster');
      } catch (mxeError) {
        console.warn('[ArciumService] ⚠️ MXE cluster not reachable, service in degraded mode:', mxeError);
        // Don't fail initialization if MXE is unavailable
        // Service will report isReady() = false but won't crash
        this.isInitialized = false;
      }
    } catch (error) {
      console.error('[ArciumService] ❌ Failed to initialize:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Check if the service is ready to handle requests
   * @returns true if initialized and MXE connection is healthy
   */
  isReady(): boolean {
    return this.isInitialized && this.program !== null && this.provider !== null;
  }

  /**
   * Test connection to MXE cluster
   * @private
   */
  private async testMXEConnection(): Promise<void> {
    if (!this.connection || !this.provider || !this.program) {
      throw new Error('Connection, Provider, or Program not initialized');
    }

    // Test RPC connection
    const version = await this.connection.getVersion();
    console.log('[ArciumService] Solana RPC version:', version);

    // Test MXE account derivation
    const mxeAccount = getMXEAccAddress(this.program.programId);
    console.log('[ArciumService] MXE account address:', mxeAccount.toBase58());

    // Test cluster account derivation
    const clusterAccount = getClusterAccAddress(this.clusterOffset);
    console.log('[ArciumService] Cluster account address:', clusterAccount.toBase58());

    // Attempt to fetch MXE public key (will throw if MXE not configured)
    try {
      const mxePublicKey = await getMXEPublicKey(this.provider, this.program.programId);
      console.log('[ArciumService] ✅ MXE public key retrieved, cluster is configured');
    } catch (error) {
      console.warn('[ArciumService] ⚠️ MXE public key fetch failed (expected if cluster not yet initialized):', error);
      throw new Error('MXE cluster not configured - deploy your program with `arcium deploy --cluster-offset 456` first');
    }
  }

  /**
   * Generate session keys for X25519 encryption
   * Creates ephemeral keypair, fetches MXE public key, derives shared secret
   */
  async generateSessionKeys(): Promise<SessionKeys> {
    if (!this.isReady()) {
      throw new Error('ArciumService not initialized');
    }

    try {
      console.log('[ArciumService] Generating X25519 session keys...');

      // Generate ephemeral X25519 keypair
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);

      // Fetch MXE public key with retry logic
      const mxePublicKey = await this.getMXEPublicKey();

      // Derive shared secret via ECDH
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

      // Validate shared secret is not all-zero (X25519 security check)
      const isAllZero = sharedSecret.every(byte => byte === 0);
      if (isAllZero) {
        throw new Error('Invalid shared secret: all-zero value (potential MITM attack)');
      }

      // Instantiate RescueCipher with shared secret
      const cipher = new RescueCipher(sharedSecret);

      console.log('[ArciumService] ✅ Session keys generated successfully');

      return {
        privateKey,
        publicKey,
        sharedSecret,
        cipher
      };
    } catch (error) {
      console.error('[ArciumService] ❌ Failed to generate session keys:', error);
      throw error;
    }
  }

  /**
   * Fetch MXE public key with retry logic
   * Retries up to 5 times with 1s delay between attempts
   * @private
   */
  private async getMXEPublicKey(): Promise<Uint8Array> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 1000;

    if (!this.provider || !this.program) {
      throw new Error('Provider or Program not initialized');
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[ArciumService] Fetching MXE public key (attempt ${attempt}/${MAX_RETRIES})...`);

        const mxePublicKey = await getMXEPublicKey(this.provider, this.program.programId);

        if (!mxePublicKey) {
          throw new Error('MXE public key not set (MXE cluster may not be configured)');
        }

        console.log('[ArciumService] ✅ MXE public key retrieved successfully');
        return mxePublicKey;
      } catch (error) {
        console.warn(`[ArciumService] ⚠️ Attempt ${attempt}/${MAX_RETRIES} failed:`, error);

        if (attempt === MAX_RETRIES) {
          console.error('[ArciumService] ❌ All retry attempts exhausted');
          throw new Error(`Failed to fetch MXE public key after ${MAX_RETRIES} attempts: ${error}`);
        }

        // Wait before next retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    // TypeScript requires this but it's unreachable
    throw new Error('Unexpected error in getMXEPublicKey');
  }

  /**
   * Encrypt plaintext using RescueCipher
   * Generates unique nonce and returns ciphertext blocks + nonce
   * @param plaintext - Array of bigints to encrypt
   * @param cipher - RescueCipher instance with shared secret
   * @returns Object containing ciphertext blocks and nonce
   * @private
   */
  private encrypt(
    plaintext: bigint[],
    cipher: RescueCipher
  ): { ciphertext: number[][]; nonce: Uint8Array } {
    // Generate unique 16-byte nonce
    const nonce = randomBytes(16);

    // Encrypt with RescueCipher
    // cipher.encrypt() returns number[][] (array of 32-byte blocks)
    const ciphertext = cipher.encrypt(plaintext, nonce);

    console.log(`[ArciumService] Encrypted ${plaintext.length} blocks with unique nonce`);

    return { ciphertext, nonce };
  }

  /**
   * Backup user data (email, pseudo) on-chain with encryption
   * Implements retry logic with exponential backoff
   */
  async backupUserData(
    userId: string,
    email: string,
    pseudo: string
  ): Promise<Result<{ signature: string }, BackupError>> {
    if (!this.isReady()) {
      return {
        success: false,
        error: { type: 'MXE_UNAVAILABLE', message: 'Arcium service not ready' }
      };
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAYS_MS = [2000, 4000, 8000]; // Exponential backoff
    const COMPUTATION_TIMEOUT_MS = 30000;

    let sessionKeys: SessionKeys | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[ArciumService] backupUserData attempt ${attempt}/${MAX_RETRIES} for user:`, userId);

        // Generate session keys
        sessionKeys = await this.generateSessionKeys();

        // Encrypt email and pseudo with RescueCipher
        const encryptedEmail = this.encryptString(email, 96, sessionKeys.cipher);
        const encryptedPseudo = this.encryptString(pseudo, 64, sessionKeys.cipher);

        // Derive UserData PDA
        if (!this.program || !this.provider) {
          throw new Error('Program or Provider not initialized');
        }

        const userPubkey = this.provider.wallet.publicKey;
        const [userDataPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('user_data'), userPubkey.toBuffer()],
          this.program.programId
        );

        console.log('[ArciumService] UserData PDA:', userDataPda.toBase58());

        // Build and send transaction
        const tx = await this.program.methods
          .encryptUserData(
            Array.from(encryptedEmail),
            Array.from(encryptedPseudo)
          )
          .accounts({
            userData: userDataPda,
            user: userPubkey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        console.log('[ArciumService] Transaction sent:', tx);

        // Wait for confirmation with timeout
        const signature = await this.awaitComputationFinalization(
          tx,
          COMPUTATION_TIMEOUT_MS
        );

        // Destroy session keys
        this.destroySessionKeys(sessionKeys);
        sessionKeys = null;

        console.log('[ArciumService] ✅ backupUserData completed with signature:', signature);

        return {
          success: true,
          data: { signature }
        };
      } catch (error) {
        console.warn(`[ArciumService] ⚠️ backupUserData attempt ${attempt}/${MAX_RETRIES} failed:`, error);

        // Cleanup session keys on error
        if (sessionKeys) {
          this.destroySessionKeys(sessionKeys);
          sessionKeys = null;
        }

        if (attempt === MAX_RETRIES) {
          console.error('[ArciumService] ❌ All backupUserData retry attempts exhausted');

          // Determine error type
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
            return {
              success: false,
              error: { type: 'COMPUTATION_TIMEOUT', message: `Computation timed out after ${COMPUTATION_TIMEOUT_MS}ms` }
            };
          } else if (errorMessage.includes('MXE') || errorMessage.includes('cluster')) {
            return {
              success: false,
              error: { type: 'MXE_UNAVAILABLE', message: 'MXE cluster unavailable' }
            };
          } else {
            return {
              success: false,
              error: { type: 'ENCRYPTION_FAILED', message: `Encryption failed: ${errorMessage}` }
            };
          }
        }

        // Wait before next retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
      }
    }

    // Unreachable but TypeScript requires it
    return {
      success: false,
      error: { type: 'ENCRYPTION_FAILED', message: 'Unexpected error' }
    };
  }

  /**
   * Convert string to bigint array for RescueCipher
   * Encodes UTF-8 bytes into bigints (31 bytes per bigint for safety)
   * @param text - String to convert
   * @returns Array of bigints
   * @private
   */
  private stringToBigints(text: string): bigint[] {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    // Pack bytes into bigints (31 bytes per bigint to stay under field modulus)
    const BYTES_PER_BIGINT = 31;
    const numBigints = Math.ceil(bytes.length / BYTES_PER_BIGINT);
    const bigints: bigint[] = [];

    for (let i = 0; i < numBigints; i++) {
      let value = 0n;
      const start = i * BYTES_PER_BIGINT;
      const end = Math.min(start + BYTES_PER_BIGINT, bytes.length);

      for (let j = start; j < end; j++) {
        value = (value << 8n) | BigInt(bytes[j]);
      }

      bigints.push(value);
    }

    console.log(`[ArciumService] Encoded string (${bytes.length} bytes) → ${bigints.length} bigints`);
    return bigints;
  }

  /**
   * Encrypt string using RescueCipher and pack into byte array
   * @param text - String to encrypt
   * @param targetSize - Target byte array size (96 for email, 64 for pseudo)
   * @param cipher - RescueCipher instance
   * @returns Fixed-size byte array with ciphertext + nonce
   * @private
   */
  private encryptString(
    text: string,
    targetSize: number,
    cipher: RescueCipher
  ): number[] {
    // Convert string to bigints
    const plaintext = this.stringToBigints(text);

    // Encrypt with RescueCipher
    const { ciphertext, nonce } = this.encrypt(plaintext, cipher);

    // Flatten ciphertext blocks into byte array
    const ctBytes: number[] = [];
    for (const block of ciphertext) {
      ctBytes.push(...block);
    }

    // Combine ciphertext + nonce and pad to target size
    const result = new Array(targetSize).fill(0);
    const nonceArray = Array.from(nonce);

    // Pack: [ciphertext_bytes][nonce_bytes][padding]
    let offset = 0;
    const maxCtBytes = Math.min(ctBytes.length, targetSize - nonce.length);
    for (let i = 0; i < maxCtBytes; i++) {
      result[offset++] = ctBytes[i];
    }
    for (let i = 0; i < nonce.length && offset < targetSize; i++) {
      result[offset++] = nonceArray[i];
    }

    console.log(`[ArciumService] ✅ Encrypted string → ${targetSize} bytes (${ctBytes.length} ct + ${nonce.length} nonce)`);
    return result;
  }

  /**
   * Destroy session keys in memory (security cleanup)
   * @param keys - SessionKeys to destroy
   * @private
   */
  private destroySessionKeys(keys: SessionKeys): void {
    // Overwrite sensitive data with zeros
    keys.privateKey.fill(0);
    keys.sharedSecret.fill(0);

    console.log('[ArciumService] Session keys destroyed');
  }

  /**
   * Verify user balance privately using MPC
   * No retry logic - user can re-click if it fails
   * CRITICAL: Never logs actual balance value
   */
  async verifyBalance(
    userBalance: bigint,
    minimumRequired: bigint
  ): Promise<Result<{ isSufficient: boolean }, VerificationError>> {
    if (!this.isReady()) {
      return {
        success: false,
        error: { type: 'MXE_UNAVAILABLE', message: 'Arcium service not ready' }
      };
    }

    const COMPUTATION_TIMEOUT_MS = 15000;
    let sessionKeys: SessionKeys | null = null;

    try {
      console.log('[ArciumService] verifyBalance called (balance NOT logged for privacy)');

      // Generate session keys
      sessionKeys = await this.generateSessionKeys();

      // Encrypt balance with RescueCipher
      const encryptedBalance = this.encryptBigint(userBalance, sessionKeys.cipher);

      // Build and send transaction
      if (!this.program || !this.provider) {
        throw new Error('Program or Provider not initialized');
      }

      const userPubkey = this.provider.wallet.publicKey;

      const tx = await this.program.methods
        .verifyBalance(
          Array.from(encryptedBalance),
          minimumRequired
        )
        .accounts({
          user: userPubkey,
        })
        .rpc();

      console.log('[ArciumService] Transaction sent:', tx);

      // Wait for confirmation with timeout
      const signature = await this.awaitComputationFinalization(
        tx,
        COMPUTATION_TIMEOUT_MS
      );

      // Parse event to get result
      const isSufficient = await this.parseBalanceVerificationEvent(signature);

      console.log('[ArciumService] ✅ verifyBalance completed, result:', isSufficient);

      // Destroy session keys
      this.destroySessionKeys(sessionKeys);
      sessionKeys = null;

      return {
        success: true,
        data: { isSufficient }
      };
    } catch (error) {
      console.error('[ArciumService] ❌ verifyBalance failed:', error);

      // Cleanup session keys on error
      if (sessionKeys) {
        this.destroySessionKeys(sessionKeys);
        sessionKeys = null;
      }

      // Determine error type
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        return {
          success: false,
          error: { type: 'COMPUTATION_TIMEOUT', message: `Computation timed out after ${COMPUTATION_TIMEOUT_MS}ms` }
        };
      } else if (errorMessage.includes('MXE') || errorMessage.includes('cluster')) {
        return {
          success: false,
          error: { type: 'MXE_UNAVAILABLE', message: 'MXE cluster unavailable' }
        };
      } else {
        return {
          success: false,
          error: { type: 'BALANCE_FETCH_FAILED', message: `Balance verification failed: ${errorMessage}` }
        };
      }
    }
  }

  /**
   * Encrypt bigint using RescueCipher and pack into byte array
   * @param value - Bigint to encrypt
   * @param cipher - RescueCipher instance
   * @returns Fixed-size byte array (32 bytes for u64)
   * @private
   */
  private encryptBigint(value: bigint, cipher: RescueCipher): number[] {
    // Encrypt single bigint value
    const plaintext = [value];
    const { ciphertext, nonce } = this.encrypt(plaintext, cipher);

    // Flatten ciphertext blocks
    const ctBytes: number[] = [];
    for (const block of ciphertext) {
      ctBytes.push(...block);
    }

    // Pack ciphertext + nonce into 32-byte array
    const result = new Array(32).fill(0);
    const nonceArray = Array.from(nonce);

    let offset = 0;
    const maxCtBytes = Math.min(ctBytes.length, 32 - nonce.length);
    for (let i = 0; i < maxCtBytes; i++) {
      result[offset++] = ctBytes[i];
    }
    for (let i = 0; i < nonce.length && offset < 32; i++) {
      result[offset++] = nonceArray[i];
    }

    console.log('[ArciumService] ✅ Encrypted bigint → 32 bytes (value NOT logged for privacy)');
    return result;
  }

  /**
   * Wait for transaction confirmation with timeout
   * @param txSignature - Transaction signature
   * @param timeoutMs - Timeout in milliseconds
   * @returns Confirmed transaction signature
   * @private
   */
  private async awaitComputationFinalization(
    txSignature: string,
    timeoutMs: number
  ): Promise<string> {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    console.log(`[ArciumService] Awaiting confirmation for ${txSignature} (timeout: ${timeoutMs}ms)...`);

    const startTime = Date.now();

    // Poll for confirmation with timeout
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.connection.getSignatureStatus(txSignature);

      if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
        if (status.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }

        console.log(`[ArciumService] ✅ Transaction confirmed: ${txSignature}`);
        return txSignature;
      }

      // Wait 500ms before next poll
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Transaction timeout after ${timeoutMs}ms: ${txSignature}`);
  }

  /**
   * Parse BalanceVerificationResult event from transaction
   * @param txSignature - Transaction signature
   * @returns Whether balance is sufficient
   * @private
   */
  private async parseBalanceVerificationEvent(txSignature: string): Promise<boolean> {
    if (!this.connection || !this.program) {
      throw new Error('Connection or Program not initialized');
    }

    try {
      // Fetch transaction with parsed logs
      const tx = await this.connection.getTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) {
        throw new Error('Transaction not found or no metadata');
      }

      // Parse logs to find BalanceVerificationResult event
      const logs = tx.meta.logMessages || [];

      for (const log of logs) {
        // Anchor events are logged as base64 in Program data logs
        if (log.includes('Program data:')) {
          try {
            // Extract base64 event data from log
            const match = log.match(/Program data: (.+)/);
            if (!match) continue;

            const eventData = Buffer.from(match[1], 'base64');

            // Decode event (Anchor uses Borsh encoding)
            // Event format: [8-byte discriminator][event data]
            // For BalanceVerificationResult: bool is_sufficient (1 byte)
            if (eventData.length >= 9) {
              const isSufficient = eventData[8] !== 0;
              console.log('[ArciumService] Parsed event: is_sufficient =', isSufficient);
              return isSufficient;
            }
          } catch (parseError) {
            console.warn('[ArciumService] Failed to parse event log:', parseError);
          }
        }
      }

      throw new Error('BalanceVerificationResult event not found in transaction logs');
    } catch (error) {
      console.error('[ArciumService] Failed to parse event:', error);
      throw error;
    }
  }

  /**
   * Recover user data from on-chain backup using Turnkey signature
   * Will be implemented in Task 3.6
   */
  async recoverUserData(
    walletAddress: string,
    turnkeySignature: string
  ): Promise<Result<{ email: string; pseudo: string }, RecoveryError>> {
    if (!this.isReady()) {
      return {
        success: false,
        error: { type: 'DATA_NOT_FOUND', message: 'Arcium service not ready' }
      };
    }

    // TODO: Implement in Task 3.6
    console.log('[ArciumService] recoverUserData called for wallet:', walletAddress);
    return {
      success: false,
      error: { type: 'DATA_NOT_FOUND', message: 'Not implemented yet' }
    };
  }
}

// Singleton instance
let instance: ArciumService | null = null;

/**
 * Get the singleton instance of ArciumService
 */
export function getArciumService(): ArciumService {
  if (!instance) {
    instance = new ArciumService();
  }
  return instance;
}

// Export types for use in routes
export type {
  Result,
  BackupError,
  VerificationError,
  RecoveryError,
  SessionKeys
};
