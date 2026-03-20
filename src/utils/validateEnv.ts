/**
 * Validation fail-fast des variables d'environnement critiques.
 * Doit être appelée en tout premier dans server.ts, avant mongoose.connect().
 * Écrit sur stderr — non supprimé par le override console.log en production.
 *
 * Requirements: 4.1, 4.4
 */

export const REQUIRED_ENV_VARS: readonly string[] = [
  'MONGODB_URI',
  'SOLANA_RPC_URL',
  'WALLET_JWT_SECRET',
  'POOL_AUTHORITY_PRIVATE_KEY',
  'VAULT_AUTHORITY_PRIVATE_KEY',
  'VAULT_SHARES_ENCRYPTION_KEY',
  'PORT',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === ''
  );

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    process.stderr.write(`[FATAL] ${message}\n`);
    throw new Error(message);
  }
}
