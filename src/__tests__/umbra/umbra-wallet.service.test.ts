/**
 * Tests TDD pour UmbraWalletService
 * Requirements: 1.2, 1.4
 */

jest.mock('../../models/User');
jest.mock('../../utils/umbra-encryption', () => ({
  decryptString: jest.fn(),
}));

import { UmbraWalletService } from '../../services/umbra/umbra-wallet.service';
import { User } from '../../models/User';
import { decryptString } from '../../utils/umbra-encryption';

const mockFindById = User.findById as jest.Mock;

describe('UmbraWalletService', () => {
  let service: UmbraWalletService;

  const mockUser = {
    _id: 'user-123',
    umbraX25519CashPublic: 'cash-x25519-pubkey-base58',
    umbraX25519WealthPublic: 'wealth-x25519-pubkey-base58',
    umbraMasterViewingKeyEnc: 'iv:tag:ciphertext-mvk',
    umbraWealthKeypairEnc: 'iv:tag:ciphertext-keypair',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UmbraWalletService();
    mockFindById.mockReturnValue({ lean: () => Promise.resolve(mockUser) });
  });

  describe('getX25519PublicKey()', () => {
    it('retourne la clé X25519 cash depuis MongoDB', async () => {
      const key = await service.getX25519PublicKey('user-123', 'cash');
      expect(key).toBe('cash-x25519-pubkey-base58');
    });

    it('retourne la clé X25519 wealth depuis MongoDB', async () => {
      const key = await service.getX25519PublicKey('user-123', 'wealth');
      expect(key).toBe('wealth-x25519-pubkey-base58');
    });

    it('met en cache la clé au second appel (pas de deuxième appel DB)', async () => {
      await service.getX25519PublicKey('user-123', 'cash');
      await service.getX25519PublicKey('user-123', 'cash');
      expect(mockFindById).toHaveBeenCalledTimes(1);
    });

    it('cache séparé pour cash et wealth', async () => {
      await service.getX25519PublicKey('user-123', 'cash');
      await service.getX25519PublicKey('user-123', 'wealth');
      expect(mockFindById).toHaveBeenCalledTimes(2);
    });

    it('throw si user introuvable', async () => {
      mockFindById.mockReturnValue({ lean: () => Promise.resolve(null) });
      await expect(service.getX25519PublicKey('unknown', 'cash')).rejects.toThrow('User not found');
    });

    it('throw si la clé X25519 cash est absente du user', async () => {
      mockFindById.mockReturnValue({
        lean: () => Promise.resolve({ ...mockUser, umbraX25519CashPublic: undefined }),
      });
      await expect(service.getX25519PublicKey('user-123', 'cash')).rejects.toThrow(/cash/);
    });

    it('throw si la clé X25519 wealth est absente du user', async () => {
      mockFindById.mockReturnValue({
        lean: () => Promise.resolve({ ...mockUser, umbraX25519WealthPublic: undefined }),
      });
      await expect(service.getX25519PublicKey('user-123', 'wealth')).rejects.toThrow(/wealth/);
    });
  });

  describe('getMasterViewingKey()', () => {
    it('déchiffre et retourne le masterViewingKey', async () => {
      (decryptString as jest.Mock).mockReturnValue('decrypted-mvk-hex');
      const mvk = await service.getMasterViewingKey('user-123');
      expect(decryptString).toHaveBeenCalledWith('iv:tag:ciphertext-mvk');
      expect(mvk).toBe('decrypted-mvk-hex');
    });

    it('throw si umbraMasterViewingKeyEnc est absent', async () => {
      mockFindById.mockReturnValue({
        lean: () => Promise.resolve({ ...mockUser, umbraMasterViewingKeyEnc: undefined }),
      });
      await expect(service.getMasterViewingKey('user-123')).rejects.toThrow(/MVK/);
    });

    it('throw si user introuvable', async () => {
      mockFindById.mockReturnValue({ lean: () => Promise.resolve(null) });
      await expect(service.getMasterViewingKey('user-123')).rejects.toThrow('User not found');
    });
  });

  describe('decryptWealthKeypair()', () => {
    it('déchiffre et retourne le keypair Wealth en Uint8Array', async () => {
      const hexKeypair = Buffer.from(new Uint8Array(64)).toString('hex'); // 64 zeros
      (decryptString as jest.Mock).mockReturnValue(hexKeypair);
      const keypair = await service.decryptWealthKeypair('user-123');
      expect(decryptString).toHaveBeenCalledWith('iv:tag:ciphertext-keypair');
      expect(keypair).toBeInstanceOf(Uint8Array);
      expect(keypair).toHaveLength(64);
    });

    it('throw si umbraWealthKeypairEnc est absent', async () => {
      mockFindById.mockReturnValue({
        lean: () => Promise.resolve({ ...mockUser, umbraWealthKeypairEnc: undefined }),
      });
      await expect(service.decryptWealthKeypair('user-123')).rejects.toThrow(/wealth keypair/i);
    });
  });
});
