/**
 * Tests unitaires — StealthCryptoService
 *
 * Couvre :
 * - 1.2 : generateSpendingKeypair, generateViewingKeypair, encodeMetaAddress, parseMetaAddress
 * - 1.3 : deriveStealthAddress (ECDH + point addition + view_tag)
 * - 1.4 : verifyStealthOwnership, recoverSpendingScalar
 *
 * Requirements : 1.1, 1.2, 2.1–2.5, 3.2, 3.3, 4.1, 5.1–5.4, 5.6
 */

import { StealthCryptoService } from '../../services/stealth/stealth-crypto.service';

describe('StealthCryptoService', () => {
  let service: StealthCryptoService;

  beforeEach(() => {
    service = new StealthCryptoService();
  });

  // =====================================================================
  // Tâche 1.2 — Génération de keypairs et encodage meta-adresse
  // =====================================================================

  describe('generateSpendingKeypair', () => {
    it('should return seed and publicKey, both 32 bytes', () => {
      const { seed, publicKey } = service.generateSpendingKeypair();
      expect(seed).toBeInstanceOf(Uint8Array);
      expect(seed.length).toBe(32);
      expect(publicKey).toBeInstanceOf(Uint8Array);
      expect(publicKey.length).toBe(32);
    });

    it('should return different keypairs on each call (CSPRNG randomness)', () => {
      const kp1 = service.generateSpendingKeypair();
      const kp2 = service.generateSpendingKeypair();
      expect(Buffer.from(kp1.seed).toString('hex')).not.toBe(
        Buffer.from(kp2.seed).toString('hex'),
      );
    });

    it('should produce a valid ed25519 public key deterministically from seed', () => {
      const { seed, publicKey } = service.generateSpendingKeypair();
      // Re-derive from same seed should give same publicKey
      const { publicKey: publicKey2 } = service.generateSpendingKeypair();
      // Different calls → different seeds; but same seed → same pubkey
      // We test determinism by re-deriving from the first seed
      const derived = service.derivePublicKeyFromSeed(seed);
      expect(Buffer.from(derived).toString('hex')).toBe(
        Buffer.from(publicKey).toString('hex'),
      );
    });
  });

  describe('generateViewingKeypair', () => {
    it('should return privateKey and publicKey, both 32 bytes', () => {
      const { privateKey, publicKey } = service.generateViewingKeypair();
      expect(privateKey).toBeInstanceOf(Uint8Array);
      expect(privateKey.length).toBe(32);
      expect(publicKey).toBeInstanceOf(Uint8Array);
      expect(publicKey.length).toBe(32);
    });

    it('should return different keypairs on each call', () => {
      const kp1 = service.generateViewingKeypair();
      const kp2 = service.generateViewingKeypair();
      expect(Buffer.from(kp1.privateKey).toString('hex')).not.toBe(
        Buffer.from(kp2.privateKey).toString('hex'),
      );
    });
  });

  describe('encodeMetaAddress', () => {
    it('should encode spending_pub (32 bytes) || viewing_pub (32 bytes) as base58', () => {
      const spendingPub = new Uint8Array(32).fill(1);
      const viewingPub = new Uint8Array(32).fill(2);
      const metaAddress = service.encodeMetaAddress(spendingPub, viewingPub);
      expect(typeof metaAddress).toBe('string');
      expect(metaAddress.length).toBeGreaterThan(0);
    });

    it('should produce a base58 string decodable to exactly 64 bytes', () => {
      const spendingPub = new Uint8Array(32).fill(0xaa);
      const viewingPub = new Uint8Array(32).fill(0xbb);
      const metaAddress = service.encodeMetaAddress(spendingPub, viewingPub);
      const { spendingPub: sp, viewingPub: vp } = service.parseMetaAddress(metaAddress);
      expect(sp.length).toBe(32);
      expect(vp.length).toBe(32);
    });

    it('should throw if spendingPub is not 32 bytes', () => {
      expect(() =>
        service.encodeMetaAddress(new Uint8Array(31), new Uint8Array(32)),
      ).toThrow();
    });

    it('should throw if viewingPub is not 32 bytes', () => {
      expect(() =>
        service.encodeMetaAddress(new Uint8Array(32), new Uint8Array(33)),
      ).toThrow();
    });
  });

  describe('parseMetaAddress', () => {
    it('should correctly split meta-address back into spendingPub and viewingPub', () => {
      const spendingPub = new Uint8Array(32).fill(0x01);
      const viewingPub = new Uint8Array(32).fill(0x02);
      const metaAddress = service.encodeMetaAddress(spendingPub, viewingPub);
      const { spendingPub: sp, viewingPub: vp } = service.parseMetaAddress(metaAddress);

      expect(Buffer.from(sp).toString('hex')).toBe(Buffer.from(spendingPub).toString('hex'));
      expect(Buffer.from(vp).toString('hex')).toBe(Buffer.from(viewingPub).toString('hex'));
    });

    it('should throw on invalid base58 input', () => {
      expect(() => service.parseMetaAddress('not-valid-base58-!!!!')).toThrow();
    });

    it('should throw if decoded length is not 64 bytes', () => {
      // Valid base58 but only 32 bytes (a single Solana pubkey for example)
      const shortEncoded = service.encodeMetaAddress(
        new Uint8Array(32).fill(1),
        new Uint8Array(32).fill(2),
      );
      // Tamper: manually build a 32-byte base58 string
      const bs58 = require('bs58');
      const shortBase58 = bs58.encode(new Uint8Array(32).fill(3));
      expect(() => service.parseMetaAddress(shortBase58)).toThrow(/64 bytes/);
    });

    it('round-trip encode → parse preserves both keys', () => {
      const { seed: spendingSeed, publicKey: spendingPub } = service.generateSpendingKeypair();
      const { publicKey: viewingPub } = service.generateViewingKeypair();
      const metaAddress = service.encodeMetaAddress(spendingPub, viewingPub);
      const parsed = service.parseMetaAddress(metaAddress);

      expect(Buffer.from(parsed.spendingPub).toString('hex')).toBe(
        Buffer.from(spendingPub).toString('hex'),
      );
      expect(Buffer.from(parsed.viewingPub).toString('hex')).toBe(
        Buffer.from(viewingPub).toString('hex'),
      );
    });
  });

  // =====================================================================
  // Tâche 1.3 — Dérivation d'adresse stealth one-time
  // =====================================================================

  describe('deriveStealthAddress', () => {
    it('should return stealthAddress (base58 string), ephemeralPub (32 bytes), viewTag (0–255)', () => {
      const { publicKey: spendingPub } = service.generateSpendingKeypair();
      const { publicKey: viewingPub } = service.generateViewingKeypair();

      const result = service.deriveStealthAddress({ recipientSpendingPub: spendingPub, recipientViewingPub: viewingPub });

      expect(typeof result.stealthAddress).toBe('string');
      expect(result.stealthAddress.length).toBeGreaterThan(0);
      expect(result.ephemeralPub).toBeInstanceOf(Uint8Array);
      expect(result.ephemeralPub.length).toBe(32);
      expect(result.viewTag).toBeGreaterThanOrEqual(0);
      expect(result.viewTag).toBeLessThanOrEqual(255);
    });

    it('should produce different stealth addresses for the same recipient (ephemeral randomness)', () => {
      const { publicKey: spendingPub } = service.generateSpendingKeypair();
      const { publicKey: viewingPub } = service.generateViewingKeypair();

      const r1 = service.deriveStealthAddress({ recipientSpendingPub: spendingPub, recipientViewingPub: viewingPub });
      const r2 = service.deriveStealthAddress({ recipientSpendingPub: spendingPub, recipientViewingPub: viewingPub });

      expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
      expect(Buffer.from(r1.ephemeralPub).toString('hex')).not.toBe(
        Buffer.from(r2.ephemeralPub).toString('hex'),
      );
    });
  });

  // =====================================================================
  // Tâche 1.4 — Vérification de propriété et récupération du scalaire
  // =====================================================================

  describe('verifyStealthOwnership', () => {
    it('should return true for a payment derived from the recipient meta-address', () => {
      const { publicKey: spendingPub } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv, publicKey: viewingPub } = service.generateViewingKeypair();

      const { stealthAddress, ephemeralPub, viewTag } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub,
        recipientViewingPub: viewingPub,
      });

      const isOwner = service.verifyStealthOwnership({
        txDestination: stealthAddress,
        ephemeralPub,
        viewTag,
        viewingPriv,
        spendingPub,
      });

      expect(isOwner).toBe(true);
    });

    it('should return false for a wrong viewTag (early exit)', () => {
      const { publicKey: spendingPub } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv, publicKey: viewingPub } = service.generateViewingKeypair();

      const { stealthAddress, ephemeralPub, viewTag } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub,
        recipientViewingPub: viewingPub,
      });

      const isOwner = service.verifyStealthOwnership({
        txDestination: stealthAddress,
        ephemeralPub,
        viewTag: (viewTag + 1) % 256, // wrong tag
        viewingPriv,
        spendingPub,
      });

      expect(isOwner).toBe(false);
    });

    it('should return false for a wrong txDestination even with correct viewTag and ephemeral', () => {
      const { publicKey: spendingPub } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv, publicKey: viewingPub } = service.generateViewingKeypair();

      const { ephemeralPub, viewTag } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub,
        recipientViewingPub: viewingPub,
      });

      const isOwner = service.verifyStealthOwnership({
        txDestination: 'SomeFakeAddress111111111111111111111111111111', // wrong destination
        ephemeralPub,
        viewTag,
        viewingPriv,
        spendingPub,
      });

      expect(isOwner).toBe(false);
    });

    it('should return false for payments belonging to a different recipient', () => {
      const { publicKey: spendingPub1 } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv1, publicKey: viewingPub1 } = service.generateViewingKeypair();

      const { publicKey: spendingPub2 } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv2 } = service.generateViewingKeypair();

      // Payment derived for recipient 1
      const { stealthAddress, ephemeralPub, viewTag } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub1,
        recipientViewingPub: viewingPub1,
      });

      // Recipient 2 tries to verify
      const isOwner = service.verifyStealthOwnership({
        txDestination: stealthAddress,
        ephemeralPub,
        viewTag,
        viewingPriv: viewingPriv2,
        spendingPub: spendingPub2,
      });

      expect(isOwner).toBe(false);
    });
  });

  describe('recoverSpendingScalar', () => {
    it('should return a 32-byte Uint8Array', () => {
      const { seed: spendingSeed, publicKey: spendingPub } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv, publicKey: viewingPub } = service.generateViewingKeypair();

      const { ephemeralPub } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub,
        recipientViewingPub: viewingPub,
      });

      const scalar = service.recoverSpendingScalar({ spendingSeed, viewingPriv, ephemeralPub });

      expect(scalar).toBeInstanceOf(Uint8Array);
      expect(scalar.length).toBe(32);
    });

    it('should produce a scalar consistent with the stealth address (round-trip derive → recover)', () => {
      const { seed: spendingSeed, publicKey: spendingPub } = service.generateSpendingKeypair();
      const { privateKey: viewingPriv, publicKey: viewingPub } = service.generateViewingKeypair();

      const { stealthAddress, ephemeralPub } = service.deriveStealthAddress({
        recipientSpendingPub: spendingPub,
        recipientViewingPub: viewingPub,
      });

      const stealthScalar = service.recoverSpendingScalar({ spendingSeed, viewingPriv, ephemeralPub });

      // The public key derived from stealthScalar should equal stealthAddress
      const recoveredPub = service.derivePublicKeyFromScalar(stealthScalar);
      const { ed25519 } = require('@noble/curves/ed25519');
      const bs58 = require('bs58');
      const expectedAddress = bs58.encode(recoveredPub);

      expect(expectedAddress).toBe(stealthAddress);
    });
  });
});
