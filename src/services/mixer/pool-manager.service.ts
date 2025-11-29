import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { MIXER_CONFIG } from '../../config/mixer.config.js';
import bs58 from 'bs58';

/**
 * Pool Manager Service
 *
 * Manages the mixer pool wallet that holds all deposited funds.
 * Privacy design:
 * - Single pool address for all deposits
 * - Withdrawals come from pool (not individual users)
 * - Pool balance tracking for liquidity
 */
class PoolManagerService {
  private poolKeypair: Keypair | null = null;
  private connection: Connection | null = null;

  /**
   * Initialize the pool manager with Solana connection
   */
  initialize(connection: Connection): void {
    this.connection = connection;
    this.loadOrCreatePoolWallet();
  }

  /**
   * Load existing pool wallet from config or create a new one
   *
   * SECURITY: In production, pool wallet private key should be:
   * - Stored in secure key management service (AWS KMS, HashiCorp Vault, etc.)
   * - Never committed to version control
   * - Rotated regularly
   * - Access logged and monitored
   */
  private loadOrCreatePoolWallet(): void {
    const privateKeyBase58 = MIXER_CONFIG.POOL_WALLET_PRIVATE_KEY;

    if (privateKeyBase58) {
      try {
        const privateKeyBytes = bs58.decode(privateKeyBase58);
        this.poolKeypair = Keypair.fromSecretKey(privateKeyBytes);
        console.log('✅ Pool wallet loaded from environment');
        console.log(`   Address: ${this.poolKeypair.publicKey.toBase58()}`);
      } catch (error) {
        console.error('❌ Failed to load pool wallet from environment:', error);
        console.log('   Generating temporary pool wallet...');
        this.poolKeypair = Keypair.generate();
        console.warn('⚠️  WARNING: Using temporary pool wallet');
        console.warn('   This wallet will be lost on server restart');
        console.warn('   Set MIXER_POOL_PRIVATE_KEY in .env for production');
      }
    } else {
      // Generate temporary wallet for development
      this.poolKeypair = Keypair.generate();
      console.log('🔑 Generated temporary pool wallet:');
      console.log(`   Address: ${this.poolKeypair.publicKey.toBase58()}`);
      // SECURITY: Never log private keys in production
      console.warn('⚠️  WARNING: Add MIXER_POOL_PRIVATE_KEY to .env for production');
    }
  }

  /**
   * Get the pool wallet's public key
   */
  getPoolAddress(): PublicKey {
    if (!this.poolKeypair) {
      throw new Error('Pool manager not initialized');
    }
    return this.poolKeypair.publicKey;
  }

  /**
   * Get the pool keypair (for signing transactions)
   */
  getPoolKeypair(): Keypair {
    if (!this.poolKeypair) {
      throw new Error('Pool manager not initialized');
    }
    return this.poolKeypair;
  }

  /**
   * Get current pool balance
   */
  async getPoolBalance(): Promise<number> {
    if (!this.connection || !this.poolKeypair) {
      throw new Error('Pool manager not initialized');
    }

    const balance = await this.connection.getBalance(this.poolKeypair.publicKey);
    return balance;
  }

  /**
   * Get pool balance in SOL (human-readable)
   */
  async getPoolBalanceSOL(): Promise<number> {
    const lamports = await this.getPoolBalance();
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Check if pool has enough liquidity for a withdrawal
   */
  async hasLiquidity(amount: number): Promise<boolean> {
    const balance = await this.getPoolBalance();
    const requiredReserve = balance * MIXER_CONFIG.POOL_RESERVE_RATIO;
    const availableBalance = balance - requiredReserve;

    return availableBalance >= amount;
  }

  /**
   * Get available liquidity (total balance minus reserve)
   */
  async getAvailableLiquidity(): Promise<number> {
    const balance = await this.getPoolBalance();
    const requiredReserve = balance * MIXER_CONFIG.POOL_RESERVE_RATIO;
    return Math.max(0, balance - requiredReserve);
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    address: string;
    totalBalance: number;
    totalBalanceSOL: number;
    availableLiquidity: number;
    availableLiquiditySOL: number;
    reserveRatio: number;
  }> {
    const totalBalance = await this.getPoolBalance();
    const availableLiquidity = await this.getAvailableLiquidity();

    return {
      address: this.getPoolAddress().toBase58(),
      totalBalance,
      totalBalanceSOL: totalBalance / LAMPORTS_PER_SOL,
      availableLiquidity,
      availableLiquiditySOL: availableLiquidity / LAMPORTS_PER_SOL,
      reserveRatio: MIXER_CONFIG.POOL_RESERVE_RATIO,
    };
  }

  /**
   * Check if pool manager is initialized
   */
  isInitialized(): boolean {
    return this.poolKeypair !== null && this.connection !== null;
  }
}

// Export singleton instance
export const poolManagerService = new PoolManagerService();
