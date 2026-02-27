/**
 * Tests — devLog() supprime les logs en production (Task 4.2)
 * Requirements: 13.2, 13.3, 13.4
 */

describe('devLog() — suppression en production', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  it('appelle console.log en development', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const { devLog } = await import('../../utils/logger');
    devLog('test message');
    expect(consoleSpy).toHaveBeenCalledWith('test message');
  });

  it('appelle console.log quand NODE_ENV non défini', async () => {
    delete process.env.NODE_ENV;
    jest.resetModules();
    const { devLog } = await import('../../utils/logger');
    devLog('test message');
    expect(consoleSpy).toHaveBeenCalledWith('test message');
  });

  it('supprime console.log en production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const { devLog } = await import('../../utils/logger');
    devLog('sensitive wallet address', 'tx signature');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('passe les arguments correctement en développement', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const { devLog } = await import('../../utils/logger');
    devLog('[Service] address:', '9xFoo', 'amount:', 1000);
    expect(consoleSpy).toHaveBeenCalledWith('[Service] address:', '9xFoo', 'amount:', 1000);
  });
});

describe('stripProdError() — masque les détails en production', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('retourne le message en développement', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const { stripProdError } = await import('../../utils/logger');
    expect(stripProdError('Connection refused at /var/app/db.ts:42')).toBe('Connection refused at /var/app/db.ts:42');
  });

  it('remplace le message par un générique en production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const { stripProdError } = await import('../../utils/logger');
    expect(stripProdError('Connection refused at /var/app/db.ts:42')).toBe('Internal server error');
  });

  it('utilise le fallback si message vide en production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const { stripProdError } = await import('../../utils/logger');
    expect(stripProdError(undefined)).toBe('Internal server error');
  });
});
