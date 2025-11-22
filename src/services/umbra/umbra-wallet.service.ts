import { Keypair } from '@solana/web3.js';
import { UmbraWallet } from '../../lib/umbra-sdk/dist/index.mjs';
import { User } from '../../models/User.js';
import crypto from 'crypto';
import { KeypairSigner } from './keypair-signer.js';

/**
 * Umbra Wallet Service
 * Manages Umbra wallets, key derivation, and encryption
 */
class UmbraWalletService {
  private walletCache = new Map<string, typeof UmbraWallet.prototype>();
  private encryptionKey: Buffer;

  constructor() {
    // In production, use a proper secret key from environment
    const secretKey = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
    this.encryptionKey = crypto.scryptSync(secretKey, 'salt', 32);
  }

  /**
   * Create or retrieve an Umbra wallet for a user
   */
  async getOrCreateWallet(userId: string, keypair: Keypair): Promise<typeof UmbraWallet.prototype> {
    // Check cache first
    if (this.walletCache.has(userId)) {
      return this.walletCache.get(userId)!;
    }

    // Check if user already has master viewing key stored
    const user = await User.findById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Create Umbra wallet from signer
    const signer = new KeypairSigner(keypair);
    const umbraWallet = await UmbraWallet.fromSigner(signer);

    // If user doesn't have master viewing key yet, store it
    if (!user.masterViewingKey) {
      await this.storeMasterViewingKey(userId, umbraWallet.masterViewingKey);
      await this.storeArciumPublicKey(userId, umbraWallet.arciumX25519PublicKey);
    }

    // Cache wallet
    this.walletCache.set(userId, umbraWallet);

    return umbraWallet;
  }

  /**
   * Store encrypted master viewing key in database
   */
  private async storeMasterViewingKey(userId: string, masterViewingKey: any): Promise<void> {
    // Convert U128 to string/hex for storage
    const mvkString = masterViewingKey.toString();

    // Encrypt the master viewing key
    const encrypted = this.encrypt(mvkString);

    // Store in database
    await User.findByIdAndUpdate(userId, {
      masterViewingKey: encrypted
    });

    console.log(`✅ Stored encrypted master viewing key for user ${userId}`);
  }

  /**
   * Store Arcium X25519 public key
   */
  private async storeArciumPublicKey(userId: string, publicKey: Uint8Array): Promise<void> {
    // Convert to hex string
    const pubKeyHex = Buffer.from(publicKey).toString('hex');

    await User.findByIdAndUpdate(userId, {
      arciumX25519PublicKey: pubKeyHex
    });

    console.log(`✅ Stored Arcium X25519 public key for user ${userId}`);
  }

  /**
   * Encrypt a value using AES-256-GCM
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value using AES-256-GCM
   */
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
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
   * Get master viewing key for a user (decrypted)
   */
  async getMasterViewingKey(userId: string): Promise<string | null> {
    const user = await User.findById(userId);
    if (!user || !user.masterViewingKey) {
      return null;
    }

    return this.decrypt(user.masterViewingKey);
  }

  /**
   * Clear wallet from cache
   */
  clearCache(userId: string): void {
    this.walletCache.delete(userId);
  }

  /**
   * Clear all wallets from cache
   */
  clearAllCaches(): void {
    this.walletCache.clear();
  }
}

// Export singleton instance
export const umbraWalletService = new UmbraWalletService();
