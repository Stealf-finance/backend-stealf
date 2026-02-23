/**
 * StealthCryptoService — Couche cryptographique pure (aucun I/O, aucun effet de bord)
 *
 * Implémentation EIP-5564 adaptée ed25519/X25519 pour Solana.
 * Algorithme :
 *   1. Meta-adresse = base58(spending_pub_ed25519 || viewing_pub_x25519)
 *   2. Expéditeur : S = X25519(r, viewing_pub), h = SHA256(S), P = spending_pub + h*G
 *   3. Destinataire : recompute S, vérifie h[0] == view_tag, vérifie P == spending_pub + h*G
 *   4. Dépense : p_stealth = (spending_scalar + h_scalar) mod L
 *
 * Requirements : 1.1, 1.2, 2.1–2.5, 3.2, 3.3, 4.1, 5.1–5.6
 */

import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';

/** Ordre de la courbe ed25519 */
const L = ed25519.CURVE.n;

export class StealthCryptoService {
  // ==========================================================================
  // Génération de keypairs (tâche 1.2)
  // ==========================================================================

  /**
   * Génère une paire de clés ed25519 pour le spending.
   * Utilise crypto.getRandomValues via @noble/curves — jamais Math.random().
   */
  generateSpendingKeypair(): { seed: Uint8Array; publicKey: Uint8Array } {
    const seed = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(seed);
    return { seed, publicKey };
  }

  /**
   * Génère une paire de clés X25519 pour le viewing (ECDH).
   */
  generateViewingKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const privateKey = x25519.utils.randomPrivateKey();
    const publicKey = x25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
  }

  // ==========================================================================
  // Encodage / décodage meta-adresse (tâche 1.2)
  // ==========================================================================

  /**
   * Encode la meta-adresse publique : base58(spending_pub || viewing_pub) — 64 bytes.
   */
  encodeMetaAddress(spendingPub: Uint8Array, viewingPub: Uint8Array): string {
    if (spendingPub.length !== 32) {
      throw new Error(`encodeMetaAddress: spendingPub doit être 32 bytes, reçu ${spendingPub.length}`);
    }
    if (viewingPub.length !== 32) {
      throw new Error(`encodeMetaAddress: viewingPub doit être 32 bytes, reçu ${viewingPub.length}`);
    }
    const combined = new Uint8Array(64);
    combined.set(spendingPub, 0);
    combined.set(viewingPub, 32);
    return bs58.encode(combined);
  }

  /**
   * Décode la meta-adresse et valide qu'elle fait exactement 64 bytes.
   */
  parseMetaAddress(metaAddress: string): { spendingPub: Uint8Array; viewingPub: Uint8Array } {
    let decoded: Uint8Array;
    try {
      decoded = new Uint8Array(bs58.decode(metaAddress));
    } catch {
      throw new Error('parseMetaAddress: décodage base58 échoué — meta-adresse invalide');
    }
    if (decoded.length !== 64) {
      throw new Error(
        `parseMetaAddress: attendu 64 bytes après décodage, reçu ${decoded.length}`,
      );
    }
    return {
      spendingPub: decoded.slice(0, 32),
      viewingPub: decoded.slice(32, 64),
    };
  }

  // ==========================================================================
  // Dérivation d'adresse stealth one-time (tâche 1.3)
  // ==========================================================================

  /**
   * Dérive une adresse stealth one-time à partir de la meta-adresse du destinataire.
   *
   * Algorithme :
   *   1. Génère paire éphémère X25519 (r, R) aléatoire
   *   2. S = X25519(r, viewing_pub)
   *   3. h = SHA256(S), view_tag = h[0]
   *   4. h_scalar = bytesToBigIntLE(h) mod L
   *   5. P_stealth = spending_pub_point + h_scalar * G
   */
  deriveStealthAddress(params: {
    recipientSpendingPub: Uint8Array;
    recipientViewingPub: Uint8Array;
  }): { stealthAddress: string; ephemeralPub: Uint8Array; viewTag: number } {
    // Paire éphémère — randomness via CSPRNG
    const ephemeralPriv = x25519.utils.randomPrivateKey();
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

    // Shared secret ECDH
    const S = x25519.getSharedSecret(ephemeralPriv, params.recipientViewingPub);

    // Dérivation h et view_tag
    const h = sha256(S);
    const viewTag = h[0];

    // Scalaire réduit modulo L (protection small-subgroup)
    const hScalar = this._bytesToBigIntLE(h) % L;

    // P_stealth = spending_pub_point + h_scalar * G (ed25519 point addition)
    const spendingPoint = ed25519.ExtendedPoint.fromHex(params.recipientSpendingPub);
    const hG = ed25519.ExtendedPoint.BASE.multiply(hScalar);
    const stealthPoint = spendingPoint.add(hG);

    return {
      stealthAddress: bs58.encode(stealthPoint.toRawBytes()),
      ephemeralPub,
      viewTag,
    };
  }

  // ==========================================================================
  // Vérification de propriété stealth (tâche 1.4)
  // ==========================================================================

  /**
   * Vérifie si une transaction stealth appartient à l'utilisateur.
   * Filtre rapide en O(n/256) via view_tag, puis vérification ed25519 complète.
   */
  verifyStealthOwnership(params: {
    txDestination: string;
    ephemeralPub: Uint8Array;
    viewTag: number;
    viewingPriv: Uint8Array;
    spendingPub: Uint8Array;
  }): boolean {
    // Recompute shared secret
    const S = x25519.getSharedSecret(params.viewingPriv, params.ephemeralPub);
    const h = sha256(S);

    // Filtrage rapide — 1/256 faux positifs maximum
    if (h[0] !== params.viewTag) return false;

    // Vérification ed25519 complète
    const hScalar = this._bytesToBigIntLE(h) % L;
    const spendingPoint = ed25519.ExtendedPoint.fromHex(params.spendingPub);
    const hG = ed25519.ExtendedPoint.BASE.multiply(hScalar);
    const expectedPoint = spendingPoint.add(hG);
    const expectedAddress = bs58.encode(expectedPoint.toRawBytes());

    return expectedAddress === params.txDestination;
  }

  // ==========================================================================
  // Récupération du scalaire de dépense (tâche 1.4)
  // ==========================================================================

  /**
   * Calcule le scalaire de dépense stealth : p_stealth = (spending_scalar + h_scalar) mod L.
   * NE JAMAIS persister ce scalaire — calculé à la volée uniquement.
   */
  recoverSpendingScalar(params: {
    spendingSeed: Uint8Array;
    viewingPriv: Uint8Array;
    ephemeralPub: Uint8Array;
  }): Uint8Array {
    // Scalaire ed25519 depuis le seed (SHA-512 + clamping interne à noble/curves)
    const { scalar: spendingScalar } = ed25519.utils.getExtendedPublicKey(params.spendingSeed);

    // Recompute shared secret
    const S = x25519.getSharedSecret(params.viewingPriv, params.ephemeralPub);
    const h = sha256(S);
    const hScalar = this._bytesToBigIntLE(h) % L;

    // p_stealth = (spending_scalar + h_scalar) mod L
    const stealthScalar = (spendingScalar + hScalar) % L;

    return this._bigIntToBytesLE(stealthScalar, 32);
  }

  // ==========================================================================
  // Helpers publics (utilisés dans les tests pour la vérification)
  // ==========================================================================

  /** Dérive la clé publique ed25519 depuis un seed — helper pour les tests round-trip. */
  derivePublicKeyFromSeed(seed: Uint8Array): Uint8Array {
    return ed25519.getPublicKey(seed);
  }

  /**
   * Dérive la clé publique ed25519 depuis un scalaire brut (little-endian BigInt → point).
   * Utilisé côté test pour vérifier que recoverSpendingScalar est cohérent avec deriveStealthAddress.
   */
  derivePublicKeyFromScalar(scalarLE: Uint8Array): Uint8Array {
    const scalar = this._bytesToBigIntLE(scalarLE);
    const point = ed25519.ExtendedPoint.BASE.multiply(scalar % L);
    return point.toRawBytes();
  }

  // ==========================================================================
  // Helpers privés — conversions scalaires little-endian
  // ==========================================================================

  /** Convertit des bytes little-endian en BigInt. */
  private _bytesToBigIntLE(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
      result |= BigInt(bytes[i]) << (BigInt(i) * 8n);
    }
    return result;
  }

  /** Convertit un BigInt en bytes little-endian de longueur fixe. */
  private _bigIntToBytesLE(n: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let value = n;
    for (let i = 0; i < length; i++) {
      bytes[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return bytes;
  }
}

/** Singleton exporté pour usage dans les services backend. */
export const stealthCryptoService = new StealthCryptoService();
