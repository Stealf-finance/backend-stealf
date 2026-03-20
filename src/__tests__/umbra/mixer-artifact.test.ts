/**
 * Tests TDD pour MixerArtifact model
 * Requirements: 3.1, 3.2, 3.4
 */

import { encryptString, decryptString } from '../../utils/umbra-encryption';

// Mock VAULT_SHARES_ENCRYPTION_KEY (32 bytes hex = 64 chars)
const TEST_KEY = 'a'.repeat(64);

describe('umbra-encryption helpers', () => {
  beforeEach(() => {
    process.env.VAULT_SHARES_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.VAULT_SHARES_ENCRYPTION_KEY;
  });

  it('encryptString produit le format iv:tag:ciphertext', () => {
    const result = encryptString('12345678901234567890');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Tag = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext non vide
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('decryptString restitue la valeur originale', () => {
    const original = '99999999999999999999999999';
    const encrypted = encryptString(original);
    const decrypted = decryptString(encrypted);
    expect(decrypted).toBe(original);
  });

  it('deux appels encryptString produisent des IVs différents (randomness)', () => {
    const val = 'same-value';
    const e1 = encryptString(val);
    const e2 = encryptString(val);
    // Les IVs doivent différer (randomBytes)
    expect(e1.split(':')[0]).not.toBe(e2.split(':')[0]);
    // Mais les deux se déchiffrent correctement
    expect(decryptString(e1)).toBe(val);
    expect(decryptString(e2)).toBe(val);
  });

  it('decryptString throw sur données corrompues', () => {
    expect(() => decryptString('bad:data:here')).toThrow();
  });
});

describe('MixerArtifact champs sensibles chiffrés (req 3.2)', () => {
  beforeEach(() => {
    process.env.VAULT_SHARES_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.VAULT_SHARES_ENCRYPTION_KEY;
  });

  it('generationIndex est chiffré avant stockage et déchiffré après lecture', () => {
    const generationIndex = '7237005577332262213973186563042994240857116359379907606001950938285454250989';
    const encrypted = encryptString(generationIndex);
    expect(encrypted).not.toBe(generationIndex);
    expect(decryptString(encrypted)).toBe(generationIndex);
  });

  it('claimableBalance (bigint string) est chiffré avant stockage et déchiffré après lecture', () => {
    const claimableBalance = '1000000000'; // 1 SOL en lamports
    const encrypted = encryptString(claimableBalance);
    expect(encrypted).not.toBe(claimableBalance);
    expect(decryptString(encrypted)).toBe(claimableBalance);
  });
});
