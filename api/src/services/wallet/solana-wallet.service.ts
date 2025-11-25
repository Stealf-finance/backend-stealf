import { Keypair } from '@solana/web3.js';
import { User } from '../../models/User.js';
import crypto from 'crypto';
import bs58 from 'bs58';

/**
 * Solana Wallet Service
 * Manages user wallet keypairs with encrypted storage
 */
class SolanaWalletService {
  private walletCache = new Map<string, Keypair>();
  private encryptionKey: Buffer;

  constructor() {
    // In production, use a proper secret key from environment
    const secretKey = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
    this.encryptionKey = crypto.scryptSync(secretKey, 'wallet-salt', 32);
  }

  /**
   * Get wallet keypair for user
   * Creates a new one if it doesn't exist
   * Accepts either MongoDB _id or Grid userId (UUID)
   * Returns { keypair, mongoUserId }
   */
  async getKeypairForUser(userId: string): Promise<{ keypair: Keypair; mongoUserId: string }> {
    // Try to load from database (check both _id and gridUserId)
    let user;
    try {
      // Try MongoDB ObjectId first
      user = await User.findById(userId);
    } catch (error) {
      // If not a valid ObjectId, try gridUserId
      user = await User.findOne({ gridUserId: userId });
    }

    // If still not found, try gridUserId explicitly
    if (!user) {
      user = await User.findOne({ gridUserId: userId });
    }

    // Auto-create user if not found (for Grid users)
    if (!user) {
      console.log(`📝 Creating new user for Grid userId: ${userId}`);
      user = await User.create({
        email: `${userId}@grid.temp`, // Temporary email
        gridUserId: userId,
        preferredMode: 'public',
      });
      console.log(`✅ Created user with MongoDB _id: ${user._id}`);
    }

    const mongoUserId = user._id.toString();

    // Check cache
    if (this.walletCache.has(mongoUserId)) {
      return { keypair: this.walletCache.get(mongoUserId)!, mongoUserId };
    }

    // If user has a stored wallet, decrypt and return it
    if (user.solanaWallet && (user as any).encryptedPrivateKey) {
      try {
        const keypair = this.decryptKeypair((user as any).encryptedPrivateKey);
        this.walletCache.set(mongoUserId, keypair);
        console.log(`✅ Loaded wallet for user ${userId} (MongoDB: ${mongoUserId}): ${keypair.publicKey.toBase58()}`);
        return { keypair, mongoUserId };
      } catch (error) {
        console.error(`Failed to decrypt wallet for user ${userId}:`, error);
        // Fall through to generate new wallet
      }
    }

    // Generate new keypair
    const keypair = Keypair.generate();
    await this.storeKeypair(mongoUserId, keypair);

    this.walletCache.set(mongoUserId, keypair);
    console.log(`✅ Generated new wallet for user ${userId} (MongoDB: ${mongoUserId}): ${keypair.publicKey.toBase58()}`);

    return { keypair, mongoUserId };
  }

  /**
   * Get wallet keypair from a known private key (base58)
   */
  async getKeypairFromPrivateKey(privateKeyBase58: string): Promise<Keypair> {
    const secretKey = bs58.decode(privateKeyBase58);
    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * Store wallet keypair for user (encrypted)
   */
  private async storeKeypair(userId: string, keypair: Keypair): Promise<void> {
    const encrypted = this.encryptKeypair(keypair);

    await User.findByIdAndUpdate(userId, {
      solanaWallet: keypair.publicKey.toBase58(),
      encryptedPrivateKey: encrypted,
    });

    console.log(`✅ Stored encrypted wallet for user ${userId}`);
  }

  /**
   * Encrypt keypair using AES-256-GCM
   */
  private encryptKeypair(keypair: Keypair): string {
    const secretKeyBase58 = bs58.encode(keypair.secretKey);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(secretKeyBase58, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt keypair using AES-256-GCM
   */
  private decryptKeypair(encryptedData: string): Keypair {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Decode base58 to get secret key
    const secretKey = bs58.decode(decrypted);
    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * Generate a deterministic keypair from user seed
   * (Alternative approach for HD wallets)
   */
  async generateDeterministicKeypair(userId: string, userSecret: string): Promise<Keypair> {
    // Derive seed from user ID + secret
    const seed = crypto.pbkdf2Sync(
      userId + userSecret,
      'solana-wallet-seed',
      100000,
      32,
      'sha256'
    );

    const keypair = Keypair.fromSeed(seed);

    // Store in database
    await this.storeKeypair(userId, keypair);
    this.walletCache.set(userId, keypair);

    return keypair;
  }

  /**
   * Clear wallet from cache
   */
  clearCache(userId: string): void {
    this.walletCache.delete(userId);
  }

  /**
   * Export wallet private key (for backup/recovery)
   * WARNING: Only call this for authorized operations
   */
  async exportPrivateKey(userId: string): Promise<string> {
    const { keypair } = await this.getKeypairForUser(userId);
    return bs58.encode(keypair.secretKey);
  }

  /**
   * Import wallet from private key
   */
  async importPrivateKey(userId: string, privateKeyBase58: string): Promise<void> {
    const keypair = await this.getKeypairFromPrivateKey(privateKeyBase58);
    await this.storeKeypair(userId, keypair);
    this.walletCache.set(userId, keypair);

    console.log(`✅ Imported wallet for user ${userId}: ${keypair.publicKey.toBase58()}`);
  }
}

export const solanaWalletService = new SolanaWalletService();
