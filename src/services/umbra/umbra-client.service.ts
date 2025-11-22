import { Connection } from '@solana/web3.js';
import { UmbraClient } from '../../lib/umbra-sdk/dist/index.mjs';
import { configureZkArtifactUrls, areZkArtifactsConfigured } from '../../config/zk-artifacts.config.js';

/**
 * Umbra Client Service
 * Manages the singleton UmbraClient instance
 */
class UmbraClientService {
  private client: typeof UmbraClient.prototype | null = null;
  private connection: Connection | null = null;

  /**
   * Initialize the Umbra client with Solana connection and ZK prover
   */
  async initialize(): Promise<void> {
    if (this.client) {
      console.log('⚠️  UmbraClient already initialized');
      return;
    }

    try {
      // Configure ZK artifact URLs before creating client
      console.log('🔧 Configuring ZK proof artifacts...');
      configureZkArtifactUrls();

      if (!areZkArtifactsConfigured()) {
        console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.warn('⚠️  ZK PROOF ARTIFACTS NOT CONFIGURED');
        console.warn('   Master Viewing Key registration will fail');
        console.warn('   Deposits and claims will be blocked');
        console.warn('   See ZK_ARTIFACTS_BLOCKER.md for details');
        console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }

      // Create Solana connection
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      this.connection = new Connection(rpcUrl, 'confirmed');

      console.log('🔗 Connecting to Solana RPC:', rpcUrl);

      // Create Umbra client
      this.client = await UmbraClient.create({ connection: this.connection });

      // Configure ZK prover (WASM-based)
      this.client.setZkProver('wasm', {
        masterViewingKeyRegistration: true,
        createSplDepositWithHiddenAmount: true,
        createSplDepositWithPublicAmount: true,
        claimSplDepositWithHiddenAmount: true,
        claimSplDeposit: true,
      });

      console.log('✅ UmbraClient initialized successfully');
      console.log('   - ZK Prover: WASM (snarkjs)');
      console.log('   - Network:', process.env.SOLANA_NETWORK || 'devnet');
      if (areZkArtifactsConfigured()) {
        console.log('   - ZK Artifacts: Configured ✅');
      } else {
        console.log('   - ZK Artifacts: NOT CONFIGURED ❌');
      }
    } catch (error) {
      console.error('❌ Failed to initialize UmbraClient:', error);
      throw error;
    }
  }

  /**
   * Get the initialized Umbra client
   */
  getClient(): typeof UmbraClient.prototype {
    if (!this.client) {
      throw new Error('UmbraClient not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Get the Solana connection
   */
  getConnection(): Connection {
    if (!this.connection) {
      throw new Error('Solana connection not initialized. Call initialize() first.');
    }
    return this.connection;
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.client !== null;
  }
}

// Export singleton instance
export const umbraClientService = new UmbraClientService();
