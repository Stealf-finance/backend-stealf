/**
 * Arcium Configuration
 *
 * Configuration for Arcium MPC-powered encrypted transfers
 */

export const ARCIUM_CONFIG = {
  /**
   * Arcium cluster ID/offset
   * This identifies which Arcium cluster to use
   * For Arcium 0.4.0, the correct cluster is 768109697
   */
  CLUSTER_ID: parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '768109697'),
  CLUSTER_OFFSET: parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '768109697'),

  /**
   * MXE (Multi-Execution Environment) X25519 public key
   * Used for encrypting data that MPC nodes will process
   * Fetched from MXE PDA: HzauPmorFXUzbpFvk3qUQEaURDtgtuzSkCKUxPzKRo6x
   */
  MXE_X25519_PUBLIC_KEY: new Uint8Array([
    223, 178, 1, 205, 14, 53, 3, 229, 198, 4, 18, 236, 212, 128, 83, 231,
    222, 2, 37, 116, 235, 162, 108, 118, 185, 1, 129, 108, 200, 45, 1, 0,
  ]),

  /**
   * Arcium program ID - stealf_private_transfer program
   * Deployed on devnet with encrypted_transfer instruction
   * Latest deployment: 8pe8Hb3bSV8qXZ6Tahe9DE32wHrQvKMmwiyiXMDfcn5C
   */
  PROGRAM_ID: process.env.ARCIUM_PROGRAM_ID || '8pe8Hb3bSV8qXZ6Tahe9DE32wHrQvKMmwiyiXMDfcn5C',

  /**
   * Arcium global program ID
   */
  ARCIUM_PROGRAM_ID: 'Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp',

  /**
   * Fixed Arcium accounts from IDL
   */
  POOL_ACCOUNT: 'FsWbPQcJQ2cCyr9ndse13fDqds4F2Ezx2WgTL25Dke4M',
  CLOCK_ACCOUNT: 'AxygBawEvVwZPetj3yPJb9sGdZvaJYsVguET1zFUQkV',

  /**
   * Instruction discriminators from IDL
   */
  DISCRIMINATORS: {
    ENCRYPTED_TRANSFER: [73, 166, 170, 205, 212, 233, 55, 97],
    ENCRYPTED_TRANSFER_CALLBACK: [151, 231, 194, 137, 216, 104, 254, 108],
    INIT_COMP_DEF: [250, 215, 8, 129, 167, 245, 172, 181],
  },

  /**
   * Solana RPC URL
   */
  RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',

  /**
   * Network (devnet, testnet, mainnet-beta)
   */
  NETWORK: process.env.SOLANA_NETWORK || 'devnet',

  /**
   * Enable encrypted transfers
   * Set to false to disable feature if program not deployed yet
   */
  ENABLE_ENCRYPTED_TRANSFERS: process.env.ENABLE_ARCIUM_TRANSFERS === 'true',

  /**
   * Computation timeout (milliseconds)
   * How long to wait for MPC computation to complete
   */
  COMPUTATION_TIMEOUT: 60000, // 60 seconds

  /**
   * Enable transfer amount logging (for debugging)
   * SECURITY: Must be false in production!
   */
  LOG_AMOUNTS: process.env.NODE_ENV === 'development',
};

/**
 * Validate Arcium configuration
 */
export function validateArciumConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!ARCIUM_CONFIG.RPC_URL) {
    errors.push('SOLANA_RPC_URL not configured');
  }

  if (ARCIUM_CONFIG.MXE_X25519_PUBLIC_KEY.length !== 32) {
    errors.push('Invalid MXE public key length');
  }

  if (ARCIUM_CONFIG.ENABLE_ENCRYPTED_TRANSFERS && ARCIUM_CONFIG.PROGRAM_ID === 'DummyProgramID11111111111111111111111111111') {
    errors.push('ARCIUM_PROGRAM_ID must be set when encrypted transfers are enabled');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
