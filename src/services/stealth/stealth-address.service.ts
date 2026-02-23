/**
 * StealthAddressService — Gestion du cycle de vie de la meta-adresse utilisateur.
 *
 * Responsabilités :
 * - Enregistrer la viewing key (chiffrement AES-256-GCM + persistance User)
 * - Retourner la meta-adresse publique de l'utilisateur
 *
 * Requirements : 1.3, 1.4, 1.5
 */

import { User } from '../../models/User';
import { stealthCryptoService } from './stealth-crypto.service';
import { encryptBytes, decryptToBytes } from '../../utils/encryption';
import bs58 from 'bs58';

export class StealthAddressService {
  /**
   * Enregistre la viewing key d'un utilisateur.
   * Reçoit la clé privée en clair (sur HTTPS), la chiffre AES-256-GCM et la persiste.
   */
  async registerViewingKey(
    userId: string,
    params: {
      viewingPublicKey: string;         // base58 X25519 public key
      viewingPrivateKeyHex: string;     // hex viewing private key (32 bytes)
      spendingPublicKey: string;        // base58 ed25519 public key
    },
  ): Promise<{ metaAddress: string }> {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    if (user.stealthEnabled) {
      throw Object.assign(new Error('Stealth already registered for this user'), { statusCode: 409 });
    }

    // Chiffrer la viewing private key côté backend (jamais en clair en DB)
    const viewingPrivBytes = Buffer.from(params.viewingPrivateKeyHex, 'hex');
    const encryptedViewingPrivate = encryptBytes(new Uint8Array(viewingPrivBytes));

    user.stealthEnabled = true;
    user.stealthSpendingPublic = params.spendingPublicKey;
    user.stealthViewingPublic = params.viewingPublicKey;
    user.stealthViewingPrivateEnc = encryptedViewingPrivate;
    await user.save();

    // Construire la meta-adresse publique
    const spendingPub = new Uint8Array(bs58.decode(params.spendingPublicKey));
    const viewingPub = new Uint8Array(bs58.decode(params.viewingPublicKey));
    const metaAddress = stealthCryptoService.encodeMetaAddress(spendingPub, viewingPub);

    return { metaAddress };
  }

  /**
   * Retourne la meta-adresse publique si l'utilisateur a le stealth activé.
   * Ne retourne jamais la viewing private key.
   */
  async getMetaAddress(userId: string): Promise<{ metaAddress: string } | null> {
    const user = await User.findById(userId);
    if (!user || !user.stealthEnabled || !user.stealthSpendingPublic || !user.stealthViewingPublic) {
      return null;
    }

    const spendingPub = new Uint8Array(bs58.decode(user.stealthSpendingPublic));
    const viewingPub = new Uint8Array(bs58.decode(user.stealthViewingPublic));
    const metaAddress = stealthCryptoService.encodeMetaAddress(spendingPub, viewingPub);

    return { metaAddress };
  }

  /**
   * Déchiffre la viewing private key pour usage interne du scanner.
   * NE PAS exposer dans les réponses API.
   */
  async decryptViewingPrivateKey(encryptedViewingPrivateEnc: string): Promise<Uint8Array> {
    const decrypted = decryptToBytes(encryptedViewingPrivateEnc);
    return new Uint8Array(decrypted);
  }
}

let instance: StealthAddressService | null = null;

export function getStealthAddressService(): StealthAddressService {
  if (!instance) instance = new StealthAddressService();
  return instance;
}
