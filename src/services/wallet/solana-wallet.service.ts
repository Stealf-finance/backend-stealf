import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Service de gestion des wallets Solana
 * Génère et stocke de manière sécurisée les wallets pour chaque utilisateur
 */
class SolanaWalletService {
  private walletDir: string;
  private encryptionKey: Buffer;

  constructor() {
    // Dossier de stockage des wallets (à côté de .keys/)
    this.walletDir = path.join(__dirname, '../../../.wallets');

    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(this.walletDir)) {
      fs.mkdirSync(this.walletDir, { recursive: true, mode: 0o700 });
      console.log('📁 Wallet directory created:', this.walletDir);
    }

    // Récupérer ou créer la clé de chiffrement
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }

  /**
   * Récupère ou crée la clé de chiffrement AES-256
   */
  private getOrCreateEncryptionKey(): Buffer {
    const keyPath = path.join(__dirname, '../../../.keys/wallet-encryption.key');

    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath);
    }

    // Générer une nouvelle clé AES-256 (32 bytes)
    const key = crypto.randomBytes(32);

    // Créer le dossier .keys s'il n'existe pas
    const keysDir = path.dirname(keyPath);
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
    }

    // Sauvegarder avec permissions restrictives
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    console.log('🔑 Wallet encryption key created:', keyPath);

    return key;
  }

  /**
   * Chiffre une clé privée avec AES-256-GCM
   */
  private encrypt(secretKey: Uint8Array): string {
    const iv = crypto.randomBytes(16); // IV de 16 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(secretKey)),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (en base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Déchiffre une clé privée
   */
  private decrypt(encryptedData: string): Uint8Array {
    const [ivB64, authTagB64, encryptedB64] = encryptedData.split(':');

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return new Uint8Array(decrypted);
  }

  /**
   * Génère un nouveau wallet Solana pour un utilisateur
   * @param userId - ID MongoDB de l'utilisateur
   * @param email - Email de l'utilisateur (pour logging)
   * @returns Adresse publique du wallet généré
   */
  async generateWallet(userId: string, email: string): Promise<string> {
    try {
      console.log(`🔑 Generating Solana wallet for user: ${email} (${userId})`);

      // Générer une nouvelle paire de clés Solana
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      const secretKey = keypair.secretKey;

      console.log(`✅ Wallet generated: ${publicKey}`);

      // Chiffrer la clé privée
      const encryptedSecretKey = this.encrypt(secretKey);

      // Sauvegarder dans un fichier JSON
      const walletData = {
        userId,
        email,
        publicKey,
        encryptedSecretKey,
        createdAt: new Date().toISOString()
      };

      const walletFilePath = path.join(this.walletDir, `${userId}.json`);
      fs.writeFileSync(
        walletFilePath,
        JSON.stringify(walletData, null, 2),
        { mode: 0o600 } // Permissions restrictives
      );

      console.log(`💾 Wallet saved: ${walletFilePath}`);
      console.log(`📍 Public key: ${publicKey}`);

      return publicKey;
    } catch (error) {
      console.error('❌ Error generating wallet:', error);
      throw new Error('Failed to generate Solana wallet');
    }
  }

  /**
   * Récupère le wallet d'un utilisateur
   * @param userId - ID MongoDB de l'utilisateur
   * @returns Keypair Solana déchiffré
   */
  async getWallet(userId: string): Promise<Keypair | null> {
    try {
      const walletFilePath = path.join(this.walletDir, `${userId}.json`);

      if (!fs.existsSync(walletFilePath)) {
        console.log(`⚠️ Wallet not found for user: ${userId}`);
        return null;
      }

      const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf8'));
      const secretKey = this.decrypt(walletData.encryptedSecretKey);

      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error('❌ Error retrieving wallet:', error);
      throw new Error('Failed to retrieve Solana wallet');
    }
  }

  /**
   * Récupère l'adresse publique d'un wallet
   * @param userId - ID MongoDB de l'utilisateur
   * @returns Adresse publique du wallet
   */
  async getPublicKey(userId: string): Promise<string | null> {
    try {
      const walletFilePath = path.join(this.walletDir, `${userId}.json`);

      if (!fs.existsSync(walletFilePath)) {
        return null;
      }

      const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf8'));
      return walletData.publicKey;
    } catch (error) {
      console.error('❌ Error retrieving public key:', error);
      return null;
    }
  }

  /**
   * Vérifie si un utilisateur a déjà un wallet
   * @param userId - ID MongoDB de l'utilisateur
   */
  async hasWallet(userId: string): Promise<boolean> {
    const walletFilePath = path.join(this.walletDir, `${userId}.json`);
    return fs.existsSync(walletFilePath);
  }

  /**
   * Génère un wallet privé (Privacy 1) pour un utilisateur
   * @param userId - ID MongoDB de l'utilisateur
   * @param email - Email de l'utilisateur (pour logging)
   * @returns Adresse publique du wallet privé généré
   */
  async generatePrivateWallet(userId: string, email: string): Promise<string> {
    try {
      console.log(`🔐 Generating private Solana wallet for user: ${email} (${userId})`);

      // Générer une nouvelle paire de clés Solana pour le wallet privé
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      const secretKey = keypair.secretKey;

      console.log(`✅ Private wallet generated: ${publicKey}`);

      // Chiffrer la clé privée
      const encryptedSecretKey = this.encrypt(secretKey);

      // Sauvegarder dans un fichier JSON séparé (avec suffix -private)
      const walletData = {
        userId,
        email,
        publicKey,
        encryptedSecretKey,
        type: 'private', // Privacy 1 wallet
        createdAt: new Date().toISOString()
      };

      const walletFilePath = path.join(this.walletDir, `${userId}-private.json`);
      fs.writeFileSync(
        walletFilePath,
        JSON.stringify(walletData, null, 2),
        { mode: 0o600 } // Permissions restrictives
      );

      console.log(`💾 Private wallet saved: ${walletFilePath}`);
      console.log(`📍 Private wallet public key: ${publicKey}`);

      return publicKey;
    } catch (error) {
      console.error('❌ Error generating private wallet:', error);
      throw new Error('Failed to generate private Solana wallet');
    }
  }

  /**
   * Récupère le wallet privé d'un utilisateur
   * @param userId - ID MongoDB de l'utilisateur
   * @returns Keypair Solana déchiffré du wallet privé
   */
  async getPrivateWallet(userId: string): Promise<Keypair | null> {
    try {
      const walletFilePath = path.join(this.walletDir, `${userId}-private.json`);

      if (!fs.existsSync(walletFilePath)) {
        console.log(`⚠️ Private wallet not found for user: ${userId}`);
        return null;
      }

      const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf8'));
      const secretKey = this.decrypt(walletData.encryptedSecretKey);

      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error('❌ Error retrieving private wallet:', error);
      throw new Error('Failed to retrieve private Solana wallet');
    }
  }

  /**
   * Alias pour getPrivateWallet (pour compatibilité)
   */
  async getPrivateWalletKeypair(userId: string): Promise<Keypair | null> {
    return this.getPrivateWallet(userId);
  }

  /**
   * Récupère l'adresse publique du wallet privé
   * @param userId - ID MongoDB de l'utilisateur
   * @returns Adresse publique du wallet privé
   */
  async getPrivatePublicKey(userId: string): Promise<string | null> {
    try {
      const walletFilePath = path.join(this.walletDir, `${userId}-private.json`);

      if (!fs.existsSync(walletFilePath)) {
        return null;
      }

      const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf8'));
      return walletData.publicKey;
    } catch (error) {
      console.error('❌ Error retrieving private wallet public key:', error);
      return null;
    }
  }

  /**
   * Récupère un wallet par son adresse publique
   * Parcourt tous les wallets pour trouver celui qui correspond
   * @param address - Adresse publique du wallet
   * @returns Keypair Solana déchiffré
   */
  async getWalletByAddress(address: string): Promise<Keypair | null> {
    try {
      const files = fs.readdirSync(this.walletDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const walletFilePath = path.join(this.walletDir, file);
        const walletData = JSON.parse(fs.readFileSync(walletFilePath, 'utf8'));

        if (walletData.publicKey === address) {
          const secretKey = this.decrypt(walletData.encryptedSecretKey);
          return Keypair.fromSecretKey(secretKey);
        }
      }

      console.log(`⚠️ No wallet found with address: ${address}`);
      return null;
    } catch (error) {
      console.error('❌ Error retrieving wallet by address:', error);
      return null;
    }
  }

  /**
   * Récupère le keypair du serveur pour payer les frais de transaction
   * Utilise le keypair Solana par défaut de l'utilisateur système
   * @returns Keypair du serveur
   */
  async getServerKeypair(): Promise<Keypair | null> {
    try {
      // Option 1: Utiliser une keypair spécifique pour le serveur
      const serverKeypairPath = path.join(__dirname, '../../../.keys/server-keypair.json');

      if (fs.existsSync(serverKeypairPath)) {
        const keypairData = JSON.parse(fs.readFileSync(serverKeypairPath, 'utf8'));
        return Keypair.fromSecretKey(new Uint8Array(keypairData));
      }

      // Option 2: Utiliser le keypair Solana par défaut de ~/.config/solana/id.json
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      if (!homeDir) {
        throw new Error('Cannot determine home directory');
      }

      const defaultKeypairPath = path.join(homeDir, '.config', 'solana', 'id.json');

      if (fs.existsSync(defaultKeypairPath)) {
        console.log('🔑 Using Solana default keypair:', defaultKeypairPath);
        const keypairData = JSON.parse(fs.readFileSync(defaultKeypairPath, 'utf8'));
        return Keypair.fromSecretKey(new Uint8Array(keypairData));
      }

      console.warn('⚠️ No server keypair found. Please create one:');
      console.warn('   solana-keygen new -o ~/.config/solana/id.json');
      console.warn('   OR');
      console.warn('   solana-keygen new -o apps/api/.keys/server-keypair.json');

      return null;
    } catch (error) {
      console.error('❌ Error retrieving server keypair:', error);
      return null;
    }
  }
}

// Export singleton
export const solanaWalletService = new SolanaWalletService();
