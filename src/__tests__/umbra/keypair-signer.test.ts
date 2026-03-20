/**
 * Tests TDD pour createUmbraSignerFromKeypair
 * Requirements: 1.4, 4.3
 */

jest.mock(
  '@umbra-privacy/sdk',
  () => ({
    createSignerFromPrivateKeyBytes: jest.fn().mockResolvedValue({ type: 'umbra-signer', address: 'mock-address' }),
  }),
  { virtual: true }
);

import { Keypair } from '@solana/web3.js';
import { createUmbraSignerFromKeypair } from '../../services/umbra/keypair-signer';

describe('createUmbraSignerFromKeypair()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retourne un IUmbraSigner depuis des bytes de secretKey', async () => {
    const keypair = Keypair.generate();
    const signer = await createUmbraSignerFromKeypair(keypair.secretKey);
    expect(signer).toBeDefined();
    expect(signer).toEqual({ type: 'umbra-signer', address: 'mock-address' });
  });

  it('appelle createSignerFromPrivateKeyBytes avec les 64 bytes du secretKey', async () => {
    const { createSignerFromPrivateKeyBytes } = require('@umbra-privacy/sdk');
    const keypair = Keypair.generate();
    await createUmbraSignerFromKeypair(keypair.secretKey);
    expect(createSignerFromPrivateKeyBytes).toHaveBeenCalledWith(keypair.secretKey);
  });

  it('fonctionne avec des secretKeys différents', async () => {
    const { createSignerFromPrivateKeyBytes } = require('@umbra-privacy/sdk');
    const kp1 = Keypair.generate();
    const kp2 = Keypair.generate();
    await createUmbraSignerFromKeypair(kp1.secretKey);
    await createUmbraSignerFromKeypair(kp2.secretKey);
    expect(createSignerFromPrivateKeyBytes).toHaveBeenCalledTimes(2);
    expect(createSignerFromPrivateKeyBytes).toHaveBeenNthCalledWith(1, kp1.secretKey);
    expect(createSignerFromPrivateKeyBytes).toHaveBeenNthCalledWith(2, kp2.secretKey);
  });
});
