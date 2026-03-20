/**
 * Tests TDD pour AccountInitService
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

// Mock SDK (virtual: true — pas encore installé)
const mockRegisterFn = jest.fn();
const mockGetUserRegistrationFunction = jest.fn().mockReturnValue(mockRegisterFn);

jest.mock(
  '@umbra-privacy/sdk',
  () => ({
    getUserRegistrationFunction: mockGetUserRegistrationFunction,
  }),
  { virtual: true }
);

jest.mock('../../models/User');
jest.mock('../../utils/umbra-encryption', () => ({
  encryptString: jest.fn().mockImplementation((v: string) => `enc(${v})`),
}));

// Mock UmbraClientService
const mockCreateClientForSigner = jest.fn().mockResolvedValue({ mockClient: true });
const mockGetRegistrationProver = jest.fn().mockReturnValue({ type: 'reg-prover' });

jest.mock('../../services/umbra/umbra-client.service', () => ({
  UmbraClientService: jest.fn().mockImplementation(() => ({
    createClientForSigner: mockCreateClientForSigner,
    getRegistrationProver: mockGetRegistrationProver,
  })),
  umbraClientService: {
    createClientForSigner: mockCreateClientForSigner,
    getRegistrationProver: mockGetRegistrationProver,
  },
}));

import { AccountInitService } from '../../services/umbra/account-init.service';
import { User } from '../../models/User';
import { encryptString } from '../../utils/umbra-encryption';

const mockFindById = User.findById as jest.Mock;
const mockFindByIdAndUpdate = User.findByIdAndUpdate as jest.Mock;

describe('AccountInitService', () => {
  let service: AccountInitService;

  const mockSigner = { type: 'mock-signer' };
  const mockRegistrationResult = {
    masterViewingKey: 'mvk-hex-value',
    wealthKeypairBytes: Buffer.from(new Uint8Array(64)).toString('hex'),
    x25519CashPublic: 'cash-x25519-pub',
    x25519WealthPublic: 'wealth-x25519-pub',
  };

  const mockUser = (registered = false) => ({
    _id: 'user-123',
    umbraRegisteredCash: registered,
    umbraRegisteredWealth: registered,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountInitService();
    mockFindById.mockReturnValue({ lean: () => Promise.resolve(mockUser()) });
    mockFindByIdAndUpdate.mockResolvedValue({});
    mockRegisterFn.mockResolvedValue(mockRegistrationResult);
  });

  describe('registerWallet() — cash', () => {
    it('appelle getUserRegistrationFunction et persiste le résultat', async () => {
      await service.registerWallet('user-123', mockSigner as any, 'cash');

      expect(mockCreateClientForSigner).toHaveBeenCalledWith(mockSigner);
      expect(mockGetUserRegistrationFunction).toHaveBeenCalledWith(
        { client: { mockClient: true } },
        { zkProver: { type: 'reg-prover' } }
      );
      expect(mockRegisterFn).toHaveBeenCalled();
      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ umbraRegisteredCash: true })
      );
    });

    it('chiffre et persiste masterViewingKey + x25519CashPublic', async () => {
      await service.registerWallet('user-123', mockSigner as any, 'cash');

      expect(encryptString).toHaveBeenCalledWith('mvk-hex-value');
      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          umbraMasterViewingKeyEnc: 'enc(mvk-hex-value)',
          umbraX25519CashPublic: 'cash-x25519-pub',
        })
      );
    });

    it('idempotence : skip si umbraRegisteredCash=true', async () => {
      mockFindById.mockReturnValue({ lean: () => Promise.resolve(mockUser(true)) });

      await service.registerWallet('user-123', mockSigner as any, 'cash');

      expect(mockRegisterFn).not.toHaveBeenCalled();
      expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throw "User not found" si le user est absent', async () => {
      mockFindById.mockReturnValue({ lean: () => Promise.resolve(null) });
      await expect(service.registerWallet('unknown', mockSigner as any, 'cash')).rejects.toThrow(
        'User not found'
      );
    });
  });

  describe('registerWallet() — wealth', () => {
    it('chiffre et persiste le keypair Wealth + x25519WealthPublic', async () => {
      await service.registerWallet('user-123', mockSigner as any, 'wealth');

      const hexKeypair = Buffer.from(new Uint8Array(64)).toString('hex');
      expect(encryptString).toHaveBeenCalledWith(hexKeypair);
      expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          umbraRegisteredWealth: true,
          umbraWealthKeypairEnc: `enc(${hexKeypair})`,
          umbraX25519WealthPublic: 'wealth-x25519-pub',
        })
      );
    });

    it('idempotence : skip si umbraRegisteredWealth=true', async () => {
      mockFindById.mockReturnValue({ lean: () => Promise.resolve(mockUser(true)) });

      await service.registerWallet('user-123', mockSigner as any, 'wealth');

      expect(mockRegisterFn).not.toHaveBeenCalled();
    });
  });

  describe('retry logic (req 1.6)', () => {
    it('réessaie jusqu\'à 3 fois en cas d\'échec', async () => {
      mockRegisterFn
        .mockRejectedValueOnce(new Error('RPC timeout'))
        .mockRejectedValueOnce(new Error('RPC timeout'))
        .mockResolvedValueOnce(mockRegistrationResult);

      await expect(service.registerWallet('user-123', mockSigner as any, 'cash')).resolves.not.toThrow();
      expect(mockRegisterFn).toHaveBeenCalledTimes(3);
    });

    it('throw après 3 échecs consécutifs', async () => {
      mockRegisterFn.mockRejectedValue(new Error('Permanent failure'));

      await expect(service.registerWallet('user-123', mockSigner as any, 'cash')).rejects.toThrow(
        'Permanent failure'
      );
      expect(mockRegisterFn).toHaveBeenCalledTimes(3);
    });
  });
});
