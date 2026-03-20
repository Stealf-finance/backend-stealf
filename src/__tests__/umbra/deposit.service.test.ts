/**
 * Tests TDD pour UmbraDepositService
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3
 */

// ─── Mocks SDK (virtual: true) ──────────────────────────────────────────────
const mockDepositFn = jest.fn();
const mockGetDepositFunction = jest.fn().mockReturnValue(mockDepositFn);

jest.mock(
  '@umbra-privacy/sdk',
  () => ({ getCreateReceiverClaimableUtxoFromPublicBalanceFunction: mockGetDepositFunction }),
  { virtual: true }
);

// ─── Mock @solana/web3.js Connection ────────────────────────────────────────
const mockGetBalance = jest.fn();
const mockGetTokenAccountBalance = jest.fn();
const mockSendRawTransaction = jest.fn();
const mockConfirmTransaction = jest.fn();

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getBalance: mockGetBalance,
      getTokenAccountBalance: mockGetTokenAccountBalance,
      sendRawTransaction: mockSendRawTransaction,
      confirmTransaction: mockConfirmTransaction,
    })),
  };
});

// ─── Mock @solana/spl-token ──────────────────────────────────────────────────
jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: jest.fn().mockResolvedValue({ toBase58: () => 'mock-ata' }),
}));

// ─── Mock modèles ────────────────────────────────────────────────────────────
jest.mock('../../models/User');
jest.mock('../../models/MixerArtifact');

// ─── Mock encryption ─────────────────────────────────────────────────────────
jest.mock('../../utils/umbra-encryption', () => ({
  encryptString: jest.fn().mockImplementation((v: string) => `enc(${v})`),
}));

// ─── Mock UmbraClientService ─────────────────────────────────────────────────
const mockCreateClientForSigner = jest.fn().mockResolvedValue({ mockClient: true });
const mockGetDepositProver = jest.fn().mockReturnValue({ type: 'deposit-prover' });
jest.mock('../../services/umbra/umbra-client.service', () => ({
  umbraClientService: {
    createClientForSigner: mockCreateClientForSigner,
    getDepositProver: mockGetDepositProver,
  },
}));

// ─── Mock UmbraWalletService ─────────────────────────────────────────────────
const mockGetX25519PublicKey = jest.fn().mockResolvedValue('RecipientX25519PubkeyBase58');
jest.mock('../../services/umbra/umbra-wallet.service', () => ({
  umbraWalletService: { getX25519PublicKey: mockGetX25519PublicKey },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
import { UmbraDepositService } from '../../services/umbra/deposit.service';
import { User } from '../../models/User';
import { MixerArtifact } from '../../models/MixerArtifact';
import { encryptString } from '../../utils/umbra-encryption';
import { NATIVE_SOL_MINT, USDC_MINT_DEVNET } from '../../services/umbra/umbra.constants';

// Adresses Solana valides (32 bytes base58)
const MOCK_USER = {
  _id: 'user-123',
  cash_wallet: 'So11111111111111111111111111111111111111112',    // SOL mint — valid base58 44 chars
  stealf_wallet: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program — valid base58
};

const MOCK_ARTIFACT = { _id: 'artifact-456', toHexString: () => 'artifact-456' };

describe('UmbraDepositService', () => {
  let service: UmbraDepositService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UmbraDepositService();

    // User lookup
    (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(MOCK_USER) });

    // SDK deposit function retourne [txSignature] (auto-sign+submit)
    mockDepositFn.mockResolvedValue(['on-chain-tx-sig-abc']);

    // Balance SOL suffisante (10 SOL)
    mockGetBalance.mockResolvedValue(10_000_000_000);
    // Balance USDC suffisante (100 USDC = 100_000_000 µUSDC)
    mockGetTokenAccountBalance.mockResolvedValue({ value: { amount: '100000000' } });

    // Submit TX
    mockSendRawTransaction.mockResolvedValue('on-chain-tx-sig-abc');
    mockConfirmTransaction.mockResolvedValue({ value: { err: null } });

    // MixerArtifact.create
    (MixerArtifact.create as jest.Mock).mockResolvedValue(MOCK_ARTIFACT);
  });

  const MOCK_SIGNER = { address: MOCK_USER.cash_wallet, signMessage: jest.fn(), signTransaction: jest.fn() };

  // ──────────────────────────────────────────────────────────────────────────
  describe('executeDeposit() — 5.1 + 5.2', () => {
    const depositParams = {
      fromWallet: 'cash' as const,
      toWallet: 'wealth' as const,
      mint: NATIVE_SOL_MINT,
      amountLamports: BigInt(1_000_000_000), // 1 SOL
    };

    it('retourne txSignature après SDK auto-sign+submit', async () => {
      const result = await service.executeDeposit('user-123', depositParams, MOCK_SIGNER);
      expect(result.txSignature).toBe('on-chain-tx-sig-abc');
    });

    it('appelle le SDK avec destinationAddress + amount (BigInt)', async () => {
      await service.executeDeposit('user-123', depositParams, MOCK_SIGNER);
      expect(mockGetDepositFunction).toHaveBeenCalledWith(
        { client: { mockClient: true } },
        { zkProver: { type: 'deposit-prover' } }
      );
      expect(mockDepositFn).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: NATIVE_SOL_MINT,
          amount: BigInt(1_000_000_000),
          destinationAddress: MOCK_USER.stealf_wallet, // toWallet='wealth'
        })
      );
    });

    it('vérifie le solde SOL avant appel SDK (req 2.7)', async () => {
      await service.executeDeposit('user-123', depositParams, MOCK_SIGNER);
      expect(mockGetBalance).toHaveBeenCalled();
    });

    it('throw INSUFFICIENT_BALANCE si solde SOL insuffisant', async () => {
      mockGetBalance.mockResolvedValue(500_000); // 0.0005 SOL
      await expect(service.executeDeposit('user-123', depositParams, MOCK_SIGNER)).rejects.toThrow(
        'INSUFFICIENT_BALANCE'
      );
      expect(mockDepositFn).not.toHaveBeenCalled();
    });

    it('vérifie le solde USDC pour un dépôt USDC (req 2.6)', async () => {
      await service.executeDeposit('user-123', {
        ...depositParams,
        mint: USDC_MINT_DEVNET,
        amountLamports: BigInt(1_000_000),
      }, MOCK_SIGNER);
      expect(mockGetTokenAccountBalance).toHaveBeenCalled();
    });

    it('throw INSUFFICIENT_BALANCE si solde USDC insuffisant', async () => {
      mockGetTokenAccountBalance.mockResolvedValue({ value: { amount: '100' } });
      await expect(
        service.executeDeposit('user-123', {
          ...depositParams,
          mint: USDC_MINT_DEVNET,
          amountLamports: BigInt(1_000_000),
        }, MOCK_SIGNER)
      ).rejects.toThrow('INSUFFICIENT_BALANCE');
    });

    it('crée MixerArtifact avec les champs chiffrés (req 3.1, 3.2)', async () => {
      await service.executeDeposit('user-123', depositParams, MOCK_SIGNER);
      expect(encryptString).toHaveBeenCalledWith('1000000000');
      expect(MixerArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          txSignature: 'on-chain-tx-sig-abc',
          mint: NATIVE_SOL_MINT,
          claimableBalanceEnc: 'enc(1000000000)',
          recipientWallet: 'wealth',
          claimed: false,
          claimStatus: 'pending',
        })
      );
    });

    it('log [CRITICAL] si MongoDB échoue mais retourne txSignature (TX confirmée on-chain)', async () => {
      (MixerArtifact.create as jest.Mock).mockRejectedValue(new Error('MongoDB timeout'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await service.executeDeposit('user-123', depositParams, MOCK_SIGNER);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CRITICAL]'),
        expect.any(Object)
      );
      expect(result.txSignature).toBe('on-chain-tx-sig-abc');
      consoleSpy.mockRestore();
    });

    it('déclenche le claim en fire-and-forget', async () => {
      const mockOnClaim = jest.fn().mockResolvedValue(undefined);
      await service.executeDeposit('user-123', depositParams, MOCK_SIGNER, mockOnClaim);
      await new Promise(r => setImmediate(r));
      expect(mockOnClaim).toHaveBeenCalledWith('user-123', expect.any(String));
    });

    it('throw User not found si userId inconnu', async () => {
      (User.findById as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(null) });
      await expect(service.executeDeposit('unknown', depositParams, MOCK_SIGNER)).rejects.toThrow('User not found');
    });
  });
});
