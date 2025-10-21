/**
 * Key Manager Service - Secure storage and management of user keys
 * Handles HPKE keys and decrypted authorization keys for Grid Protocol
 */

import { privyCryptoService } from './privy-crypto.service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface UserKeys {
  email: string;
  gridAddress?: string;
  hpkeKeys?: {
    publicKey: string;  // SPKI DER base64
    privateKey: string; // PKCS#8 DER base64 (encrypted)
  };
  authorizationKey?: string; // Decrypted auth key (encrypted)
  createdAt: Date;
  updatedAt: Date;
}

export class KeyManagerService {
  private userKeys: Map<string, UserKeys> = new Map();
  private encryptionKey: Buffer;
  private keysFilePath: string;

  constructor() {
    // Generate or load master encryption key for storing sensitive data
    this.encryptionKey = this.loadOrCreateMasterKey();
    this.keysFilePath = path.join(process.cwd(), '.keys', 'user-keys.json');

    // Load existing keys from disk
    this.loadKeysFromDisk();
  }

  /**
   * Load or create master encryption key
   * In production, this should use HSM or KMS
   */
  private loadOrCreateMasterKey(): Buffer {
    const keyPath = path.join(process.cwd(), '.keys', 'master.key');

    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(keyPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(keyPath)) {
        console.log('🔐 Loading existing master key');
        return fs.readFileSync(keyPath);
      } else {
        console.log('🔑 Generating new master key');
        const key = crypto.randomBytes(32);
        fs.writeFileSync(keyPath, key, { mode: 0o600 }); // Restricted permissions
        return key;
      }
    } catch (error) {
      console.error('❌ Failed to load/create master key:', error);
      // Fallback to in-memory key (not recommended for production)
      return crypto.randomBytes(32);
    }
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine IV + authTag + encrypted data
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate and store HPKE keypair for a user
   */
  generateAndStoreHPKEKeys(email: string): {
    publicKey: string;
    privateKey: string;
  } {
    const keypair = privyCryptoService.generateHPKEKeyPair();

    const userKey: UserKeys = this.userKeys.get(email) || {
      email,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Encrypt the private key before storing
    userKey.hpkeKeys = {
      publicKey: keypair.publicKey,
      privateKey: this.encrypt(keypair.privateKey)
    };
    userKey.updatedAt = new Date();

    this.userKeys.set(email, userKey);
    this.saveKeysToDisk();

    console.log(`🔑 Generated and stored HPKE keys for ${email}`);

    return {
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey // Return unencrypted for immediate use
    };
  }

  /**
   * Get stored HPKE keys for a user
   */
  getHPKEKeys(email: string): {
    publicKey: string;
    privateKey: string;
  } | null {
    const userKey = this.userKeys.get(email);
    if (!userKey?.hpkeKeys) {
      return null;
    }

    return {
      publicKey: userKey.hpkeKeys.publicKey,
      privateKey: this.decrypt(userKey.hpkeKeys.privateKey)
    };
  }

  /**
   * Store Grid address for a user after account creation
   */
  storeGridAddress(email: string, gridAddress: string): void {
    const userKey = this.userKeys.get(email) || {
      email,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    userKey.gridAddress = gridAddress;
    userKey.updatedAt = new Date();

    this.userKeys.set(email, userKey);
    this.saveKeysToDisk();

    console.log(`📍 Stored Grid address ${gridAddress} for ${email}`);
  }

  /**
   * Store decrypted authorization key after OTP verification
   */
  async storeAuthorizationKey(
    email: string,
    encryptedAuthKey: {
      encapsulated_key: string;
      ciphertext: string;
    },
    privateKeyB64?: string
  ): Promise<string> {
    // Get private key from storage if not provided
    let hpkePrivateKey = privateKeyB64;
    if (!hpkePrivateKey) {
      const keys = this.getHPKEKeys(email);
      if (!keys) {
        throw new Error(`No HPKE keys found for ${email}`);
      }
      hpkePrivateKey = keys.privateKey;
    }

    // Decrypt the authorization key
    const authKey = await privyCryptoService.decryptAuthorizationKey(
      encryptedAuthKey,
      hpkePrivateKey
    );

    // Store encrypted
    const userKey = this.userKeys.get(email) || {
      email,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    userKey.authorizationKey = this.encrypt(authKey);
    userKey.updatedAt = new Date();

    this.userKeys.set(email, userKey);
    this.saveKeysToDisk();

    console.log(`🔓 Stored authorization key for ${email}`);
    return authKey;
  }

  /**
   * Get authorization key for signing transactions
   */
  getAuthorizationKey(email: string): string | null {
    const userKey = this.userKeys.get(email);
    if (!userKey?.authorizationKey) {
      return null;
    }

    return this.decrypt(userKey.authorizationKey);
  }

  /**
   * Sign a KMS payload for a user
   */
  signPayload(email: string, kmsPayloadB64: string): string {
    const authKey = this.getAuthorizationKey(email);
    if (!authKey) {
      throw new Error(`No authorization key found for ${email}`);
    }

    return privyCryptoService.signPayload(kmsPayloadB64, authKey);
  }

  /**
   * Save keys to disk (encrypted)
   */
  private saveKeysToDisk(): void {
    try {
      const dir = path.dirname(this.keysFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.userKeys.entries()).map(([, keys]) => keys);

      fs.writeFileSync(
        this.keysFilePath,
        JSON.stringify(data, null, 2),
        { mode: 0o600 }
      );

      console.log('💾 Saved user keys to disk');
    } catch (error) {
      console.error('❌ Failed to save keys to disk:', error);
    }
  }

  /**
   * Load keys from disk
   */
  private loadKeysFromDisk(): void {
    try {
      if (!fs.existsSync(this.keysFilePath)) {
        console.log('📁 No existing keys file found');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.keysFilePath, 'utf-8'));

      data.forEach((entry: any) => {
        this.userKeys.set(entry.email, {
          ...entry,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.updatedAt)
        });
      });

      console.log(`📂 Loaded ${this.userKeys.size} user keys from disk`);
    } catch (error) {
      console.error('❌ Failed to load keys from disk:', error);
    }
  }

  /**
   * Clear all keys for a user (for logout/revocation)
   */
  clearUserKeys(email: string): void {
    this.userKeys.delete(email);
    this.saveKeysToDisk();
    console.log(`🗑️ Cleared all keys for ${email}`);
  }
}

// Export singleton instance
export const keyManagerService = new KeyManagerService();