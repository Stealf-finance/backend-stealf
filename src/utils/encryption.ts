/**
 * AES-256-GCM encryption utilities (shared across services).
 * Format : iv:tag:ciphertext (hex) — même format que VaultShare.
 */
import crypto from 'crypto';

export function getEncryptionKey(): Buffer {
  const key = process.env.VAULT_SHARES_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_SHARES_ENCRYPTION_KEY is not set');
  return Buffer.from(key, 'hex');
}

export function encryptBytes(bytes: Uint8Array): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToBytes(data: string): Buffer {
  const key = getEncryptionKey();
  const [ivHex, tagHex, ciphertextHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
