/**
 * Tests TDD pour UmbraMixerController
 * Requirements: 7.6, 7.7, 7.8
 */

// -- Mocks modules ----------------------------------------------------------------

jest.mock('../../services/umbra/umbra-client.service', () => ({
  umbraClientService: {
    healthCheck: jest.fn(),
  },
}));

jest.mock('../../services/umbra/account-init.service', () => ({
  accountInitService: {
    registerWallet: jest.fn(),
  },
}));

jest.mock('../../services/umbra/deposit.service', () => ({
  umbraDepositService: {
    buildDepositTx: jest.fn(),
    submitSignedTx: jest.fn(),
  },
}));

jest.mock('../../services/umbra/claim.service', () => ({
  umbraClaimService: {
    scanUtxos: jest.fn(),
    manualClaim: jest.fn(),
    triggerClaim: jest.fn(),
  },
}));

jest.mock('../../models/User');

jest.mock('../../services/umbra/keypair-signer', () => ({
  createUmbraSignerFromKeypair: jest.fn().mockResolvedValue({ type: 'wealth-signer' }),
}));

// -- Imports ----------------------------------------------------------------------

import { Request, Response } from 'express';
import { UmbraMixerController } from '../../controllers/UmbraMixerController';
import { User } from '../../models/User';

// -- Helpers ----------------------------------------------------------------------

function mockReq(body: any = {}, user: any = { userId: 'user-123', mongoUserId: 'user-123' }): Request {
  return { body, user } as any;
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const VALID_WALLET = 'So11111111111111111111111111111111111111112'; // 44 chars

const REGISTERED_USER = {
  _id: 'user-123',
  umbraRegisteredCash: true,
  umbraRegisteredWealth: true,
  cash_wallet: VALID_WALLET,
  turnkey_subOrgId: 'sub-org-789',
};

const UNREGISTERED_USER = {
  _id: 'user-123',
  umbraRegisteredCash: false,
  umbraRegisteredWealth: false,
  cash_wallet: VALID_WALLET,
};

// -- Tests -----------------------------------------------------------------------

describe('UmbraMixerController', () => {
  let mockHealthCheck: jest.Mock;
  let mockRegisterWallet: jest.Mock;
  let mockBuildDepositTx: jest.Mock;
  let mockSubmitSignedTx: jest.Mock;
  let mockScanUtxos: jest.Mock;
  let mockManualClaim: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    const { umbraClientService } = require('../../services/umbra/umbra-client.service');
    mockHealthCheck = umbraClientService.healthCheck as jest.Mock;
    mockHealthCheck.mockResolvedValue(true);

    const { accountInitService } = require('../../services/umbra/account-init.service');
    mockRegisterWallet = accountInitService.registerWallet as jest.Mock;
    mockRegisterWallet.mockResolvedValue(undefined);

    const { umbraDepositService } = require('../../services/umbra/deposit.service');
    mockBuildDepositTx = umbraDepositService.buildDepositTx as jest.Mock;
    mockBuildDepositTx.mockResolvedValue({
      unsignedTxBase64: 'base64-tx==',
      ephemeralInfo: { generationIndex: 'gen-idx-U256', recipientX25519PublicKey: 'x25519-key' },
    });
    mockSubmitSignedTx = umbraDepositService.submitSignedTx as jest.Mock;
    mockSubmitSignedTx.mockResolvedValue({ txSignature: 'on-chain-sig-abc' });

    const { umbraClaimService } = require('../../services/umbra/claim.service');
    mockScanUtxos = umbraClaimService.scanUtxos as jest.Mock;
    mockScanUtxos.mockResolvedValue([{ artifactId: 'art-1', generationIndex: 'g1', claimableBalance: '1000000000', mint: 'sol', recipientWallet: 'wealth', claimStatus: 'pending' }]);
    mockManualClaim = umbraClaimService.manualClaim as jest.Mock;
    mockManualClaim.mockResolvedValue({ claimTxSignature: 'claim-sig-xyz' });

    (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(REGISTERED_USER) });
  });

  // -----------------------------------------------------------------------
  describe('POST /register (7.1)', () => {
    const validBody = {
      cashWalletPublicKey: VALID_WALLET,
      wealthWalletPublicKey: VALID_WALLET,
      wealthKeypairSecret: Array.from({ length: 64 }, () => 0),
    };

    it('retourne 400 si le body est invalide (Zod)', async () => {
      const req = mockReq({ cashWalletPublicKey: 'short' });
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 202 status:pending si non enregistre', async () => {
      (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(UNREGISTERED_USER) });
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('retourne 200 alreadyRegistered si deja enregistre', async () => {
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ alreadyRegistered: true }));
    });

    it('declenche registerWallet pour les wallets non enregistres', async () => {
      (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(UNREGISTERED_USER) });
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      // La registration se fait en arriere-plan — plusieurs cycles pour les await internes
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setImmediate(r));
      }
      expect(mockRegisterWallet).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /deposit (7.2)', () => {
    const validBody = {
      fromWallet: 'cash',
      toWallet: 'wealth',
      mint: 'So11111111111111111111111111111111111111112',
      amountLamports: 1_000_000_000,
    };

    it('retourne 503 si healthCheck echoue (req 6.5)', async () => {
      mockHealthCheck.mockResolvedValue(false);
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fallback: true, reason: 'UMBRA_UNAVAILABLE' }));
    });

    it('retourne 412 si non enregistre (req 7.8)', async () => {
      (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(UNREGISTERED_USER) });
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(412);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UMBRA_NOT_REGISTERED' }));
    });

    it('retourne 400 si le body est invalide (req 7.6)', async () => {
      const req = mockReq({ fromWallet: 'invalid', toWallet: 'wealth', mint: 'sol', amountLamports: 0 });
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 400 INSUFFICIENT_BALANCE', async () => {
      mockBuildDepositTx.mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INSUFFICIENT_BALANCE' }));
    });

    it('retourne 200 avec unsignedTxBase64 et generationIndex', async () => {
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        unsignedTxBase64: 'base64-tx==',
        generationIndex: 'gen-idx-U256',
      }));
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /submit (7.3)', () => {
    const validBody = {
      signedTxBase64: 'c2lnbmVkLXR4',
      generationIndex: 'gen-idx-U256',
      mint: 'So11111111111111111111111111111111111111112',
      amountLamports: 1_000_000_000,
      recipientWallet: 'wealth',
    };

    it('retourne 503 si healthCheck echoue', async () => {
      mockHealthCheck.mockResolvedValue(false);
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.submit(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ fallback: true }));
    });

    it('retourne 400 si le body est invalide', async () => {
      const req = mockReq({ signedTxBase64: '' });
      const res = mockRes();
      await UmbraMixerController.submit(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 200 avec txSignature', async () => {
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.submit(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ txSignature: 'on-chain-sig-abc' }));
    });
  });

  // -----------------------------------------------------------------------
  describe('GET /utxos (7.4)', () => {
    it('retourne 200 avec la liste des artifacts non claimed', async () => {
      const req = mockReq();
      const res = mockRes();
      await UmbraMixerController.getUtxos(req, res);
      expect(mockScanUtxos).toHaveBeenCalledWith('user-123');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        artifacts: expect.arrayContaining([expect.objectContaining({ artifactId: 'art-1' })]),
      }));
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /claim (7.5)', () => {
    it('retourne 400 si artifactId manquant', async () => {
      const req = mockReq({});
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 200 avec claimTxSignature', async () => {
      const req = mockReq({ artifactId: 'art-456' });
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      expect(mockManualClaim).toHaveBeenCalledWith('user-123', 'art-456');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ claimTxSignature: 'claim-sig-xyz' }));
    });
  });
});
