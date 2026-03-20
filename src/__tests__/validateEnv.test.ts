/**
 * Tests TDD pour validateEnv()
 * Requirements: 4.1, 4.4
 */

import { validateEnv, REQUIRED_ENV_VARS } from '../utils/validateEnv';

describe('validateEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Sauvegarder l'env original
    originalEnv = { ...process.env };
    // Définir toutes les vars requises par défaut
    REQUIRED_ENV_VARS.forEach((key) => {
      process.env[key] = `test-value-${key}`;
    });
  });

  afterEach(() => {
    // Restaurer l'env original
    process.env = originalEnv;
  });

  it('ne throw pas quand toutes les vars requises sont définies', () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it('throw quand une seule var est manquante', () => {
    delete process.env['MONGODB_URI'];
    expect(() => validateEnv()).toThrow('MONGODB_URI');
  });

  it('throw avec la liste complète des vars manquantes (pas seulement la première)', () => {
    delete process.env['MONGODB_URI'];
    delete process.env['SOLANA_RPC_URL'];
    delete process.env['POOL_AUTHORITY_PRIVATE_KEY'];

    let errorMessage = '';
    try {
      validateEnv();
    } catch (e: any) {
      errorMessage = e.message;
    }

    expect(errorMessage).toContain('MONGODB_URI');
    expect(errorMessage).toContain('SOLANA_RPC_URL');
    expect(errorMessage).toContain('POOL_AUTHORITY_PRIVATE_KEY');
  });

  it('throw quand une var est définie mais vide (chaîne vide)', () => {
    process.env['VAULT_SHARES_ENCRYPTION_KEY'] = '';
    expect(() => validateEnv()).toThrow('VAULT_SHARES_ENCRYPTION_KEY');
  });

  it('throw quand une var est définie mais ne contient que des espaces', () => {
    process.env['WALLET_JWT_SECRET'] = '   ';
    expect(() => validateEnv()).toThrow('WALLET_JWT_SECRET');
  });

  it('couvre toutes les vars critiques dans la liste', () => {
    const expected = [
      'MONGODB_URI',
      'SOLANA_RPC_URL',
      'WALLET_JWT_SECRET',
      'POOL_AUTHORITY_PRIVATE_KEY',
      'VAULT_AUTHORITY_PRIVATE_KEY',
      'VAULT_SHARES_ENCRYPTION_KEY',
      'PORT',
    ];
    expect(REQUIRED_ENV_VARS).toEqual(expect.arrayContaining(expected));
    expect(REQUIRED_ENV_VARS.length).toBe(expected.length);
  });
});
