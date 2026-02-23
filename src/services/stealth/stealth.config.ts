/**
 * Configuration constantes pour le protocole stealth.
 */
import { PublicKey, Connection, Keypair } from '@solana/web3.js';

/** Préfixe de memo identifiant les transactions stealth */
export const STEALTH_MEMO_PREFIX = 'stealth:v1:';

/** Programme Memo Solana v1 — ne requiert pas que les accounts référencés signent */
export const MEMO_PROGRAM_ID = new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new Error('SOLANA_RPC_URL not configured');
    _connection = new Connection(rpcUrl, 'confirmed');
  }
  return _connection;
}

/**
 * Keypair de l'autorité stealth.
 * Signe TX2 (authority → stealthAddress) pour masquer l'expéditeur.
 * Réutilise VAULT_AUTHORITY_PRIVATE_KEY — l'authority gère déjà de multiples
 * types de TX (yield, pool), rendant les TXs stealth indistinguables.
 */
export function getStealthAuthority(): Keypair {
  const key = process.env.VAULT_AUTHORITY_PRIVATE_KEY;
  if (!key) throw new Error('VAULT_AUTHORITY_PRIVATE_KEY not configured');
  const secretKey = JSON.parse(key) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}
