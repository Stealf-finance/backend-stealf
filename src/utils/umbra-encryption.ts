/**
 * Helpers de chiffrement AES-256-GCM pour les champs sensibles Umbra.
 * Format : iv:tag:ciphertext (hex) — identique au pattern VaultShare.
 * Chiffre/déchiffre des strings (generationIndex, claimableBalance, etc.)
 */
import crypto from 'crypto';

function getKey(): Buffer {
  const key = process.env.VAULT_SHARES_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_SHARES_ENCRYPTION_KEY is not set');
  return Buffer.from(key, 'hex');
}

export function encryptString(value: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(value, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptString(data: string): string {
  const key = getKey();
  const [ivHex, tagHex, ciphertextHex] = data.split(':');
  if (!ivHex || !tagHex || !ciphertextHex) throw new Error('Invalid encrypted data format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
