/**
 * UmbraWalletService — gestion des clés X25519 et du masterViewingKey.
 * - getX25519PublicKey() avec cache mémoire pour éviter les appels DB répétés
 * - getMasterViewingKey() déchiffre depuis umbraMasterViewingKeyEnc (AES-256-GCM)
 * - decryptWealthKeypair() déchiffre le keypair Wealth (64 bytes) depuis umbraWealthKeypairEnc
 * Requirements: 1.2, 1.4
 */
import { User } from '../../models/User';
import { decryptString } from '../../utils/umbra-encryption';

export class UmbraWalletService {
  /** Cache mémoire : clé = "userId:walletType" → valeur = clé X25519 base58 */
  private readonly _x25519Cache = new Map<string, string>();

  /**
   * Retourne la clé publique X25519 du wallet Umbra (cash ou wealth).
   * Résultat mis en cache pour éviter les allers-retours DB répétés.
   */
  async getX25519PublicKey(userId: string, walletType: 'cash' | 'wealth'): Promise<string> {
    const cacheKey = `${userId}:${walletType}`;
    const cached = this._x25519Cache.get(cacheKey);
    if (cached) return cached;

    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');

    const key =
      walletType === 'cash' ? (user as any).umbraX25519CashPublic : (user as any).umbraX25519WealthPublic;
    if (!key) {
      throw new Error(`No Umbra X25519 ${walletType} key for user ${userId}`);
    }

    this._x25519Cache.set(cacheKey, key);
    return key;
  }

  /**
   * Déchiffre et retourne le masterViewingKey depuis MongoDB.
   * Ne pas exposer en dehors du backend — clé privée Umbra.
   */
  async getMasterViewingKey(userId: string): Promise<string> {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');
    if (!(user as any).umbraMasterViewingKeyEnc) {
      throw new Error(`No MVK for user ${userId}`);
    }
    return decryptString((user as any).umbraMasterViewingKeyEnc);
  }

  /**
   * Déchiffre et retourne le keypair Wealth (64 bytes) depuis MongoDB.
   * Utilisé par AccountInitService et UmbraClaimService pour signer les claims Wealth.
   */
  async decryptWealthKeypair(userId: string): Promise<Uint8Array> {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');
    if (!(user as any).umbraWealthKeypairEnc) {
      throw new Error(`No wealth keypair for user ${userId}`);
    }
    const hex = decryptString((user as any).umbraWealthKeypairEnc);
    return Buffer.from(hex, 'hex');
  }
}

/** Singleton global */
export const umbraWalletService = new UmbraWalletService();
