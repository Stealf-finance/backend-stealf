/**
 * TDD — Task 1.1 : Guard devnet dans SwapController.executeCash
 * Requirements: 3.6, 20.1
 */

// -- Mocks avant imports ----------------------------------------------------------

jest.mock('../../services/swapper/jupiterSwapService', () => ({
  jupiterSwapService: {
    getOrder: jest.fn(),
    executeSwap: jest.fn(),
  },
}));

jest.mock('../../services/auth/turnkeySign.service', () => ({
  signOnlyCashWalletTransaction: jest.fn(),
}));

jest.mock('../../models/User', () => ({
  User: {
    findById: jest.fn(),
  },
}));

// -- Imports ----------------------------------------------------------------------

import { Request, Response, NextFunction } from 'express';
import { SwapController } from '../../controllers/swapController';

// -- Helpers ----------------------------------------------------------------------

function mockReq(body: any = {}, user: any = { id: 'user-123' }): Request {
  return { body, user } as any;
}

function mockRes(): { status: jest.Mock; json: jest.Mock } {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const mockNext: NextFunction = jest.fn();

// -- Tests -----------------------------------------------------------------------

describe('SwapController.executeCash — devnet guard (req 3.6, 20.1)', () => {
  const originalRpc = process.env.SOLANA_RPC_URL;

  afterEach(() => {
    process.env.SOLANA_RPC_URL = originalRpc;
    jest.clearAllMocks();
  });

  it('retourne 400 avec message explicite si SOLANA_RPC_URL contient "devnet"', async () => {
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    const req = mockReq({ unsignedTransaction: 'base64tx', requestId: 'req-1' });
    const res = mockRes();

    await SwapController.executeCash(req as any, res as any, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('mainnet'),
      }),
    );
  });

  it('ne déclenche pas Jupiter si devnet détecté', async () => {
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    const { jupiterSwapService } = require('../../services/swapper/jupiterSwapService');
    const req = mockReq({ unsignedTransaction: 'base64tx', requestId: 'req-1' });
    const res = mockRes();

    await SwapController.executeCash(req as any, res as any, mockNext);

    expect(jupiterSwapService.executeSwap).not.toHaveBeenCalled();
  });

  it('ne bloque pas si SOLANA_RPC_URL est mainnet', async () => {
    process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
    const { User } = require('../../models/User');
    User.findById.mockResolvedValue({
      turnkey_subOrgId: 'sub-org-1',
      cash_wallet: 'wallet123',
    });
    const { signOnlyCashWalletTransaction } = require('../../services/auth/turnkeySign.service');
    signOnlyCashWalletTransaction.mockResolvedValue('signedtx');
    const { jupiterSwapService } = require('../../services/swapper/jupiterSwapService');
    jupiterSwapService.executeSwap.mockResolvedValue({ txSignature: 'sig-xyz' });

    const req = mockReq({ unsignedTransaction: 'base64tx', requestId: 'req-1' });
    const res = mockRes();

    await SwapController.executeCash(req as any, res as any, mockNext);

    // Guard ne doit pas retourner 400
    const statusCall = res.status.mock.calls[0];
    if (statusCall) {
      expect(statusCall[0]).not.toBe(400);
    }
  });

  it('retourne 400 si RPC URL contient "devnet" dans une URL custom', async () => {
    process.env.SOLANA_RPC_URL = 'https://my-devnet-node.example.com/rpc';
    const req = mockReq({ unsignedTransaction: 'base64tx', requestId: 'req-1' });
    const res = mockRes();

    await SwapController.executeCash(req as any, res as any, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
