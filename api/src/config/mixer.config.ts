/**
 * Simple Mixer Configuration
 *
 * This is a privacy-focused mixer implementation that provides
 * basic transaction privacy without requiring ZK proofs.
 *
 * Privacy Features:
 * - Sender/receiver decoupling via pool
 * - Cryptographic claim secrets (no user linking)
 * - Random time delays (breaks temporal analysis)
 * - Pool mixing (all funds in single pool)
 */

export const MIXER_CONFIG = {
  /**
   * Minimum wait time before withdrawal (milliseconds)
   * Prevents immediate deposit-withdraw correlation
   * Default: 0 (disabled for beta)
   */
  MIN_WITHDRAWAL_DELAY: 0, // Disabled for beta

  /**
   * Maximum additional random delay (milliseconds)
   * Adds randomness to break patterns
   * Default: 0 (disabled for beta)
   */
  MAX_RANDOM_DELAY: 0, // Disabled for beta

  /**
   * Pool wallet private key (from environment)
   * SECURITY: Must be stored securely in production
   */
  POOL_WALLET_PRIVATE_KEY: process.env.MIXER_POOL_PRIVATE_KEY,

  /**
   * Enable pool size standardization
   * When true, only accept standard deposit amounts
   * Improves privacy by increasing anonymity set
   */
  ENABLE_STANDARDIZED_POOLS: process.env.MIXER_STANDARDIZED_POOLS === 'true',

  /**
   * Standard pool sizes (in lamports)
   * Only used when ENABLE_STANDARDIZED_POOLS is true
   */
  STANDARD_POOL_SIZES: [
    0.1 * 1e9,  // 0.1 SOL
    1 * 1e9,    // 1 SOL
    5 * 1e9,    // 5 SOL
    10 * 1e9,   // 10 SOL
  ],

  /**
   * Minimum deposit amount (lamports)
   * Default: 0.01 SOL
   */
  MIN_DEPOSIT_AMOUNT: 0.01 * 1e9,

  /**
   * Maximum deposit amount (lamports)
   * Default: 100 SOL
   */
  MAX_DEPOSIT_AMOUNT: 100 * 1e9,

  /**
   * Pool reserve ratio (percentage)
   * Keeps X% in pool to ensure liquidity
   * Default: 10%
   */
  POOL_RESERVE_RATIO: 0.10,
};

/**
 * Validate mixer configuration
 */
export function validateMixerConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!MIXER_CONFIG.POOL_WALLET_PRIVATE_KEY) {
    errors.push('MIXER_POOL_PRIVATE_KEY not configured in environment');
  }

  if (MIXER_CONFIG.MIN_WITHDRAWAL_DELAY < 0) {
    errors.push('MIN_WITHDRAWAL_DELAY must be positive');
  }

  if (MIXER_CONFIG.MAX_RANDOM_DELAY < 0) {
    errors.push('MAX_RANDOM_DELAY must be positive');
  }

  if (MIXER_CONFIG.MIN_DEPOSIT_AMOUNT <= 0) {
    errors.push('MIN_DEPOSIT_AMOUNT must be positive');
  }

  if (MIXER_CONFIG.MAX_DEPOSIT_AMOUNT <= MIXER_CONFIG.MIN_DEPOSIT_AMOUNT) {
    errors.push('MAX_DEPOSIT_AMOUNT must be greater than MIN_DEPOSIT_AMOUNT');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
