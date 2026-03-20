/**
 * TDD — Task 1.2 : Gestion d'erreur 503 dans UmbraMixerController
 * Vérifie que les SDK throws retournent 503 { fallback: true } et non 500 brut.
 * Requirements: 12.3
 */

// -- Mocks modules ----------------------------------------------------------------

jest.mock('../../services/umbra/umbra-client.service', () => ({
  umbraClientService: {
    healthCheck: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../services/umbra/account-init.service', () => ({
  accountInitService: {
    registerWallet: jest.fn(),
  },
}));

jest.mock('../../services/umbra/deposit.service', () => ({
  umbraDepositService: {
    executeDeposit: jest.fn(),
  },
}));

jest.mock('../../services/umbra/claim.service', () => ({
  umbraClaimService: {
    scanUtxos: jest.fn(),
    manualClaim: jest.fn(),
    triggerClaim: jest.fn(),
  },
}));

jest.mock('../../services/umbra/keypair-signer', () => ({
  createUmbraSignerFromKeypair: jest.fn().mockResolvedValue({
    address: 'So11111111111111111111111111111111111111112',
    signMessage: jest.fn(),
    signTransaction: jest.fn(),
    signTransactions: jest.fn(),
  }),
}));

jest.mock('../../services/umbra/turnkey-umbra-signer.service', () => ({
  createTurnkeyUmbraSigner: jest.fn().mockResolvedValue({
    address: 'So11111111111111111111111111111111111111112',
    signMessage: jest.fn(),
    signTransaction: jest.fn(),
    signTransactions: jest.fn(),
  }),
}));

jest.mock('../../models/User');
jest.mock('@turnkey/sdk-server', () => ({
  Turnkey: jest.fn().mockImplementation(() => ({
    apiClient: jest.fn().mockReturnValue({}),
  })),
}));

// -- Imports ----------------------------------------------------------------------

import { Request, Response } from 'express';
import { UmbraMixerController } from '../../controllers/UmbraMixerController';
import { User } from '../../models/User';

// -- Helpers ----------------------------------------------------------------------

const VALID_WALLET = 'So11111111111111111111111111111111111111112';
const REGISTERED_USER = {
  _id: 'user-123',
  umbraRegisteredCash: true,
  umbraRegisteredWealth: true,
  cash_wallet: VALID_WALLET,
  turnkey_subOrgId: 'sub-org-789',
};

function mockReq(body: any = {}, user: any = { userId: 'user-123', mongoUserId: 'user-123' }): Request {
  return { body, user } as any;
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// -- Tests -----------------------------------------------------------------------

describe('UmbraMixerController — 503 fallback sur erreur SDK (req 12.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (User.findById as jest.Mock).mockReturnValue({
      lean: () => Promise.resolve(REGISTERED_USER),
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /register — 503 sur erreur SDK interne', () => {
    const validBody = {
      cashWalletPublicKey: VALID_WALLET,
      wealthWalletPublicKey: VALID_WALLET,
      wealthKeypairSecret: Array.from({ length: 64 }, () => 0),
    };

    it('retourne 400 si body invalide (Zod ne doit pas être masqué)', async () => {
      const req = mockReq({ cashWalletPublicKey: 'short' });
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 503 { fallback: true } si User.findById throw (erreur SDK/DB)', async () => {
      (User.findById as jest.Mock).mockReturnValue({
        lean: () => Promise.reject(new Error('MongoDB connection lost')),
      });
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: true }),
      );
    });

    it('ne retourne pas 500 lors d\'une erreur interne', async () => {
      (User.findById as jest.Mock).mockReturnValue({
        lean: () => Promise.reject(new Error('unexpected')),
      });
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.register(req, res);
      const statusArg = res.status.mock.calls[0]?.[0];
      expect(statusArg).not.toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /deposit — 503 sur erreur SDK, 400 pour INSUFFICIENT_BALANCE', () => {
    const validBody = {
      fromWallet: 'wealth',
      toWallet: 'cash',
      mint: VALID_WALLET,
      amountLamports: 1_000_000_000,
      wealthKeypairSecret: Array.from({ length: 64 }, () => 0),
    };

    it('retourne 400 si body invalide (Zod ne doit pas être masqué)', async () => {
      const req = mockReq({ fromWallet: 'invalid' });
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 400 pour INSUFFICIENT_BALANCE (doit rester 400, pas 503)', async () => {
      const { umbraDepositService } = require('../../services/umbra/deposit.service');
      umbraDepositService.executeDeposit.mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INSUFFICIENT_BALANCE' }));
    });

    it('retourne 503 { fallback: true } pour une erreur SDK générique', async () => {
      const { umbraDepositService } = require('../../services/umbra/deposit.service');
      umbraDepositService.executeDeposit.mockRejectedValue(new Error('SDK internal error'));
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: true }),
      );
    });

    it('ne retourne pas 500 lors d\'une erreur SDK générique', async () => {
      const { umbraDepositService } = require('../../services/umbra/deposit.service');
      umbraDepositService.executeDeposit.mockRejectedValue(new Error('SDK crash'));
      const req = mockReq(validBody);
      const res = mockRes();
      await UmbraMixerController.deposit(req, res);
      const statusArg = res.status.mock.calls[0]?.[0];
      expect(statusArg).not.toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  describe('GET /utxos — 503 sur erreur SDK', () => {
    it('retourne 503 { fallback: true } si scanUtxos throw', async () => {
      const { umbraClaimService } = require('../../services/umbra/claim.service');
      umbraClaimService.scanUtxos.mockRejectedValue(new Error('SDK unavailable'));
      const req = mockReq();
      const res = mockRes();
      await UmbraMixerController.getUtxos(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: true }),
      );
    });

    it('ne retourne pas 500 lors d\'une erreur SDK', async () => {
      const { umbraClaimService } = require('../../services/umbra/claim.service');
      umbraClaimService.scanUtxos.mockRejectedValue(new Error('crash'));
      const req = mockReq();
      const res = mockRes();
      await UmbraMixerController.getUtxos(req, res);
      const statusArg = res.status.mock.calls[0]?.[0];
      expect(statusArg).not.toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  describe('POST /claim — 503 sur erreur SDK générique, 409 pour conflits métier', () => {
    it('retourne 400 si artifactId manquant (Zod ne doit pas être masqué)', async () => {
      const req = mockReq({});
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('retourne 409 si artifact "not found" (doit rester 409, pas 503)', async () => {
      const { umbraClaimService } = require('../../services/umbra/claim.service');
      umbraClaimService.manualClaim.mockRejectedValue(new Error('artifact not found'));
      const req = mockReq({ artifactId: 'art-1' });
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('retourne 503 { fallback: true } pour une erreur SDK générique', async () => {
      const { umbraClaimService } = require('../../services/umbra/claim.service');
      umbraClaimService.manualClaim.mockRejectedValue(new Error('ZK proof failed'));
      const req = mockReq({ artifactId: 'art-1' });
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ fallback: true }),
      );
    });

    it('ne retourne pas 500 lors d\'une erreur SDK générique', async () => {
      const { umbraClaimService } = require('../../services/umbra/claim.service');
      umbraClaimService.manualClaim.mockRejectedValue(new Error('generic SDK error'));
      const req = mockReq({ artifactId: 'art-1' });
      const res = mockRes();
      await UmbraMixerController.manualClaim(req, res);
      const statusArg = res.status.mock.calls[0]?.[0];
      expect(statusArg).not.toBe(500);
    });
  });
});
