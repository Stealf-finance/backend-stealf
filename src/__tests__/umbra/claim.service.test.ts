/**
 * Tests TDD pour UmbraClaimService
 * Requirements: 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

// Mock SDK (virtual: true) -- fonctions inline, pas de variables externes dans la factory
jest.mock(
  '@umbra-privacy/sdk',
  () => ({
    getFetchClaimableUtxosFunction: jest.fn(),
    getClaimReceiverClaimableUtxoIntoEncryptedBalanceFunction: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('../../models/MixerArtifact');
jest.mock('../../models/User');

jest.mock('../../utils/umbra-encryption', () => ({
  decryptString: jest.fn(),
}));

jest.mock('../../services/auth/turnkeySign.service', () => ({
  signAndSendCashWalletTransaction: jest.fn(),
}));

jest.mock('../../services/umbra/umbra-client.service', () => ({
  umbraClientService: {
    createClientForSigner: jest.fn(),
    getClaimProver: jest.fn(),
  },
}));

jest.mock('../../services/umbra/umbra-wallet.service', () => ({
  umbraWalletService: { decryptWealthKeypair: jest.fn() },
}));

jest.mock('../../services/umbra/keypair-signer', () => ({
  createUmbraSignerFromKeypair: jest.fn(),
}));

import { UmbraClaimService } from '../../services/umbra/claim.service';
import { MixerArtifact } from '../../models/MixerArtifact';
import { User } from '../../models/User';
import { decryptString } from '../../utils/umbra-encryption';
import { signAndSendCashWalletTransaction } from '../../services/auth/turnkeySign.service';
import { createUmbraSignerFromKeypair } from '../../services/umbra/keypair-signer';
import { NATIVE_SOL_MINT } from '../../services/umbra/umbra.constants';

const MOCK_USER = {
  _id: 'user-456',
  cash_wallet: 'So11111111111111111111111111111111111111112',
  stealf_wallet: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  turnkey_subOrgId: 'sub-org-789',
};

const makeArtifact = (overrides = {}) => ({
  _id: 'artifact-123',
  userId: 'user-456',
  generationIndexEnc: 'enc-gen-index',
  mint: NATIVE_SOL_MINT,
  claimableBalanceEnc: 'enc-balance',
  recipientWallet: 'wealth',
  claimed: false,
  claimStatus: 'pending',
  ...overrides,
});

describe('UmbraClaimService', () => {
  let service: UmbraClaimService;

  // Refs SDK mocks (via require apres jest.mock hoisting)
  let mockGetFetchFunction: jest.Mock;
  let mockGetClaimFunction: jest.Mock;
  let mockFetchFn: jest.Mock;
  let mockClaimFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UmbraClaimService();

    // Recuperer les mocks SDK
    const sdk = require('@umbra-privacy/sdk');
    mockGetFetchFunction = sdk.getFetchClaimableUtxosFunction as jest.Mock;
    mockGetClaimFunction = sdk.getClaimReceiverClaimableUtxoIntoEncryptedBalanceFunction as jest.Mock;

    mockFetchFn = jest.fn().mockResolvedValue([{ generationIndex: 'dec(enc-gen-index)' }]);
    mockClaimFn = jest.fn().mockResolvedValue({
      unsignedTransaction: Buffer.from('claim-tx-bytes').toString('base64'),
      txSignature: 'sdk-wealth-claim-sig',
    });

    mockGetFetchFunction.mockReturnValue(mockFetchFn);
    mockGetClaimFunction.mockReturnValue(mockClaimFn);

    // Modeles
    (MixerArtifact.findOneAndUpdate as jest.Mock).mockResolvedValue(makeArtifact());
    (MixerArtifact.findByIdAndUpdate as jest.Mock).mockResolvedValue({});
    (MixerArtifact.find as jest.Mock).mockReturnValue({
      lean: () => Promise.resolve([makeArtifact()]),
    });
    (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(MOCK_USER) });

    // Encryption
    (decryptString as jest.Mock).mockImplementation((v) => 'dec(' + v + ')');

    // Turnkey
    (signAndSendCashWalletTransaction as jest.Mock).mockResolvedValue('turnkey-claim-sig-abc');

    // UmbraClientService
    const { umbraClientService } = require('../../services/umbra/umbra-client.service');
    (umbraClientService.createClientForSigner as jest.Mock).mockResolvedValue({ mockClient: true });
    (umbraClientService.getClaimProver as jest.Mock).mockReturnValue({ type: 'claim-prover' });

    // UmbraWalletService
    const { umbraWalletService } = require('../../services/umbra/umbra-wallet.service');
    (umbraWalletService.decryptWealthKeypair as jest.Mock).mockResolvedValue(new Uint8Array(64));

    // keypair-signer
    (createUmbraSignerFromKeypair as jest.Mock).mockResolvedValue({ type: 'wealth-signer' });
  });

  // ------------------------------------------------
  // triggerClaim
  describe('triggerClaim() -- fire-and-forget (req 4.1)', () => {
    it('retourne void immediatement sans bloquer', () => {
      const result = service.triggerClaim('user-456', 'artifact-123');
      expect(result).toBeUndefined();
    });

    it('execute le claim en arriere-plan via setImmediate', async () => {
      service.triggerClaim('user-456', 'artifact-123');
      expect(MixerArtifact.findOneAndUpdate).not.toHaveBeenCalled();
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
      expect(MixerArtifact.findOneAndUpdate).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------
  // double-claim guard
  describe('manualClaim() -- double-claim guard (req 4.7)', () => {
    it('marque atomiquement claimStatus->processing avant de commencer', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(MixerArtifact.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'artifact-123', claimStatus: { $in: ['pending', 'pending_retry'] } },
        { claimStatus: 'processing' },
        { new: true }
      );
    });

    it('throw si artifact deja en processing (null retourne par findOneAndUpdate)', async () => {
      (MixerArtifact.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
      await expect(service.manualClaim('user-456', 'artifact-123')).rejects.toThrow(
        /not found|processing/i
      );
    });
  });

  // ------------------------------------------------
  // claim Wealth wallet
  describe('manualClaim() -- claim Wealth wallet (req 4.3)', () => {
    it('decrypte le keypair Wealth et cree un signer', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      const { umbraWalletService } = require('../../services/umbra/umbra-wallet.service');
      expect(umbraWalletService.decryptWealthKeypair).toHaveBeenCalledWith('user-456');
      expect(createUmbraSignerFromKeypair).toHaveBeenCalled();
    });

    it('scanne les UTXOs via getFetchClaimableUtxosFunction (req 4.2)', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(mockGetFetchFunction).toHaveBeenCalledWith({ client: { mockClient: true } });
      expect(mockFetchFn).toHaveBeenCalledWith({ mint: NATIVE_SOL_MINT });
    });

    it('genere la preuve ZK via getClaimReceiverClaimableUtxoIntoEncryptedBalanceFunction', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(mockGetClaimFunction).toHaveBeenCalledWith(
        { client: { mockClient: true } },
        { zkProver: { type: 'claim-prover' } }
      );
      expect(mockClaimFn).toHaveBeenCalledWith(
        expect.objectContaining({ generationIndex: 'dec(enc-gen-index)' })
      );
    });

    it('met a jour artifact avec claimed true et claimTxSignature (req 4.4)', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(MixerArtifact.findByIdAndUpdate).toHaveBeenCalledWith(
        'artifact-123',
        expect.objectContaining({
          claimed: true,
          claimStatus: 'claimed',
          claimTxSignature: expect.any(String),
        })
      );
    });

    it('retourne sdk txSignature pour le wallet wealth', async () => {
      const result = await service.manualClaim('user-456', 'artifact-123');
      expect(result.claimTxSignature).toBe('sdk-wealth-claim-sig');
    });
  });

  // ------------------------------------------------
  // claim Cash via Turnkey
  describe('manualClaim() -- claim Cash wallet via Turnkey (req 4.3)', () => {
    beforeEach(() => {
      (MixerArtifact.findOneAndUpdate as jest.Mock).mockResolvedValue(
        makeArtifact({ recipientWallet: 'cash' })
      );
    });

    it('appelle signAndSendCashWalletTransaction avec hex TX + subOrgId', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(signAndSendCashWalletTransaction).toHaveBeenCalledWith(
        'sub-org-789',
        expect.any(String),
        MOCK_USER.cash_wallet
      );
    });

    it('ne cree pas de keypair signer pour le cash wallet', async () => {
      await service.manualClaim('user-456', 'artifact-123');
      expect(createUmbraSignerFromKeypair).not.toHaveBeenCalled();
    });

    it('retourne la signature Turnkey', async () => {
      const result = await service.manualClaim('user-456', 'artifact-123');
      expect(result.claimTxSignature).toBe('turnkey-claim-sig-abc');
    });
  });

  // ------------------------------------------------
  // erreurs
  describe('gestion des erreurs (req 4.5)', () => {
    it('marque claimStatus->pending_retry si le claim echoue', async () => {
      mockFetchFn.mockRejectedValue(new Error('Indexer unreachable'));
      await expect(service.manualClaim('user-456', 'artifact-123')).rejects.toThrow();
      expect(MixerArtifact.findByIdAndUpdate).toHaveBeenCalledWith('artifact-123', {
        claimStatus: 'pending_retry',
      });
    });

    it('log [UmbraMixer][ClaimFailed] avec artifactId + userId', async () => {
      mockFetchFn.mockRejectedValue(new Error('timeout'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.manualClaim('user-456', 'artifact-123')).rejects.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[UmbraMixer][ClaimFailed]'),
        expect.objectContaining({ artifactId: 'artifact-123', userId: 'user-456' })
      );
      consoleSpy.mockRestore();
    });
  });

  // ------------------------------------------------
  // scanUtxos
  describe('scanUtxos() -- 6.2 (req 3.5, 4.6)', () => {
    it('retourne les artifacts non claimed depuis MongoDB', async () => {
      const utxos = await service.scanUtxos('user-456');
      expect(MixerArtifact.find).toHaveBeenCalledWith({ userId: 'user-456', claimed: false });
      expect(utxos).toHaveLength(1);
    });

    it('dechiffre generationIndex et claimableBalance', async () => {
      const utxos = await service.scanUtxos('user-456');
      expect(utxos[0].generationIndex).toBe('dec(enc-gen-index)');
      expect(utxos[0].claimableBalance).toBe('dec(enc-balance)');
    });

    it('retourne mint et recipientWallet', async () => {
      const utxos = await service.scanUtxos('user-456');
      expect(utxos[0]).toMatchObject({
        mint: NATIVE_SOL_MINT,
        recipientWallet: 'wealth',
        claimStatus: 'pending',
      });
    });

    it('retourne liste vide si aucun artifact non claimed', async () => {
      (MixerArtifact.find as jest.Mock).mockReturnValue({ lean: () => Promise.resolve([]) });
      const utxos = await service.scanUtxos('user-456');
      expect(utxos).toHaveLength(0);
    });
  });
});
