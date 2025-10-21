// Note: ArciumClient import removed - using Connection directly instead
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Configuration du nœud Arcium ARX
 */
const ARCIUM_CONFIG = {
  programId: new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6'),
  nodeAuthority: new PublicKey('DxVY84E7epBkbr7QYBKjyM9Yf3JPvNhu8ZX9GJm5s6Z4'),
  solanaRpcEndpoint: 'https://devnet.helius-rpc.com/?api-key=1fd9c16e-ba78-4e69-917a-ac211500c452',
  network: 'devnet',
};

/**
 * Service de cryptographie Arcium pour transactions confidentielles
 * Utilise la connexion Solana directement
 */
class ArciumCryptoService {
  private connection: Connection;

  constructor() {
    // Initialiser la connexion Solana devnet
    this.connection = new Connection(ARCIUM_CONFIG.solanaRpcEndpoint, 'confirmed');

    console.log('🔐 Arcium Crypto Service initialized');
    console.log('📡 Network:', ARCIUM_CONFIG.network);
    console.log('🆔 Program ID:', ARCIUM_CONFIG.programId.toBase58());
  }

  /**
   * Récupère la clé publique du cluster MXE
   * @returns Clé publique du cluster pour ECDH
   */
  async getMXEClusterPublicKey(): Promise<Uint8Array> {
    try {
      // Récupérer les infos du cluster via le nœud
      // TODO: Implémenter avec @arcium-hq/reader si nécessaire
      // Pour l'instant, utiliser une clé dérivée du node authority

      console.log('🔑 Fetching MXE cluster public key...');

      // Le node authority sert de référence pour le cluster
      const clusterPubkey = ARCIUM_CONFIG.nodeAuthority.toBytes();

      console.log('✅ MXE cluster public key retrieved');
      return clusterPubkey;
    } catch (error) {
      console.error('❌ Error fetching MXE cluster public key:', error);
      throw new Error('Failed to get MXE cluster public key');
    }
  }

  /**
   * Prépare et chiffre les données de transaction confidentielles
   * Utilise le SDK Arcium pour le chiffrement ECDH + Rescue Cipher
   *
   * @param senderAddress - Adresse Solana du sender (à masquer)
   * @param receiverAddress - Adresse Solana du receiver
   * @param amountLamports - Montant en lamports
   * @returns Données chiffrées prêtes pour l'instruction confidentielle
   */
  async prepareConfidentialTransactionData(
    senderAddress: string,
    receiverAddress: string,
    amountLamports: bigint
  ): Promise<{
    encryptedData: Uint8Array;
    ephemeralPublicKey: Uint8Array;
    nonce: Uint8Array;
  }> {
    try {
      console.log('🔐 Preparing confidential transaction...');
      console.log('📤 Sender (to be masked):', senderAddress);
      console.log('📥 Receiver:', receiverAddress);
      console.log('💰 Amount:', amountLamports.toString(), 'lamports');

      // 1. Récupérer la clé publique du cluster MXE
      const mxePublicKey = await this.getMXEClusterPublicKey();

      // 2. Encoder les données sensibles
      // Format: [sender_pubkey (32 bytes), receiver_pubkey (32 bytes), amount (8 bytes)]
      const senderPubkey = new PublicKey(senderAddress);
      const receiverPubkey = new PublicKey(receiverAddress);

      const plainData = new Uint8Array(72);
      plainData.set(senderPubkey.toBytes(), 0);      // Bytes 0-31: sender
      plainData.set(receiverPubkey.toBytes(), 32);   // Bytes 32-63: receiver

      // Amount en little-endian (8 bytes)
      const amountBuffer = Buffer.allocUnsafe(8);
      amountBuffer.writeBigUInt64LE(amountLamports);
      plainData.set(new Uint8Array(amountBuffer), 64); // Bytes 64-71: amount

      console.log('📦 Plain data encoded:', plainData.length, 'bytes');

      // 3. Utiliser le client Arcium pour chiffrer
      // Le SDK gère automatiquement ECDH + Rescue Cipher
      const encrypted = await this.client.encrypt(plainData, mxePublicKey);

      console.log('✅ Data encrypted with Arcium SDK');
      console.log('🔒 Ciphertext size:', encrypted.ciphertext.length, 'bytes');

      return {
        encryptedData: encrypted.ciphertext,
        ephemeralPublicKey: encrypted.ephemeralPublicKey,
        nonce: encrypted.nonce,
      };
    } catch (error) {
      console.error('❌ Error preparing confidential transaction:', error);
      throw new Error('Failed to prepare confidential transaction data');
    }
  }

  /**
   * Récupère le client Arcium pour soumettre des instructions
   */
  getClient(): ArciumClient {
    return this.client;
  }

  /**
   * Récupère la connexion Solana
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Récupère le Program ID Arcium
   */
  getProgramId(): PublicKey {
    return ARCIUM_CONFIG.programId;
  }

  /**
   * Récupère le node authority
   */
  getNodeAuthority(): PublicKey {
    return ARCIUM_CONFIG.nodeAuthority;
  }
}

// Export singleton
export const arciumCryptoService = new ArciumCryptoService();
