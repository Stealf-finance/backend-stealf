/**
 * Tests TDD pour UmbraClientService singleton
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

// Mock @umbra-privacy/sdk et @umbra-privacy/web-zk-prover
// virtual: true permet de moquer des modules non encore installés dans node_modules
jest.mock(
  '@umbra-privacy/sdk',
  () => ({
    getUmbraClientFromSigner: jest.fn().mockResolvedValue({ mockClient: true }),
  }),
  { virtual: true }
);

jest.mock(
  '@umbra-privacy/web-zk-prover',
  () => ({
    getUserRegistrationProver: jest.fn().mockReturnValue({ type: 'registration-prover' }),
    getCreateReceiverClaimableUtxoFromPublicBalanceProver: jest
      .fn()
      .mockReturnValue({ type: 'deposit-prover' }),
    getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver: jest
      .fn()
      .mockReturnValue({ type: 'claim-prover' }),
  }),
  { virtual: true }
);

// Mock axios pour healthCheck
jest.mock('axios', () => ({
  default: {
    get: jest.fn(),
  },
  get: jest.fn(),
}));

import axios from 'axios';
import { UmbraClientService } from '../../services/umbra/umbra-client.service';
import { UMBRA_PROGRAM_ID, USDC_MINT_DEVNET, USDC_MINT_MAINNET } from '../../services/umbra/umbra.constants';

describe('UmbraClientService', () => {
  let service: UmbraClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UMBRA_NETWORK = 'devnet';
    process.env.UMBRA_INDEXER_URL = 'https://test-indexer.example.com';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    // Créer une nouvelle instance par test (pas le singleton global)
    service = new UmbraClientService();
  });

  afterEach(() => {
    delete process.env.UMBRA_NETWORK;
    delete process.env.UMBRA_INDEXER_URL;
    delete process.env.SOLANA_RPC_URL;
  });

  describe('getNetwork()', () => {
    it('retourne "devnet" quand UMBRA_NETWORK=devnet', () => {
      expect(service.getNetwork()).toBe('devnet');
    });

    it('retourne "mainnet" quand UMBRA_NETWORK=mainnet', () => {
      process.env.UMBRA_NETWORK = 'mainnet';
      const svc = new UmbraClientService();
      expect(svc.getNetwork()).toBe('mainnet');
    });

    it('throw si UMBRA_NETWORK est invalide', () => {
      process.env.UMBRA_NETWORK = 'testnet';
      expect(() => new UmbraClientService()).toThrow(/Invalid UMBRA_NETWORK/);
    });
  });

  describe('getUsdcMint()', () => {
    it('retourne le mint USDC devnet sur devnet', () => {
      expect(service.getUsdcMint()).toBe(USDC_MINT_DEVNET);
    });

    it('retourne le mint USDC mainnet sur mainnet', () => {
      process.env.UMBRA_NETWORK = 'mainnet';
      const svc = new UmbraClientService();
      expect(svc.getUsdcMint()).toBe(USDC_MINT_MAINNET);
    });
  });

  describe('getIndexerUrl()', () => {
    it("retourne UMBRA_INDEXER_URL depuis l'environnement", () => {
      expect(service.getIndexerUrl()).toBe('https://test-indexer.example.com');
    });

    it("utilise l'URL par défaut si UMBRA_INDEXER_URL est absent", () => {
      delete process.env.UMBRA_INDEXER_URL;
      const svc = new UmbraClientService();
      expect(svc.getIndexerUrl()).toContain('acqzie0a1h');
    });
  });

  describe('getProgramId()', () => {
    it("retourne l'adresse du programme Umbra", () => {
      expect(service.getProgramId()).toBe(UMBRA_PROGRAM_ID);
    });
  });

  describe('healthCheck()', () => {
    it("retourne true quand l'indexer répond", async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200 });
      const result = await service.healthCheck();
      expect(result).toBe(true);
    });

    it("retourne false quand l'indexer est indisponible (timeout)", async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });

    it("retourne false quand l'indexer répond avec une erreur HTTP", async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce({ response: { status: 503 } });
      const result = await service.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('provers (req 8.4 — ZK provers initialisés)', () => {
    it('getRegistrationProver() retourne un objet prover', () => {
      const prover = service.getRegistrationProver();
      expect(prover).toBeDefined();
    });

    it('getDepositProver() retourne un objet prover', () => {
      const prover = service.getDepositProver();
      expect(prover).toBeDefined();
    });

    it('getClaimProver() retourne un objet prover', () => {
      const prover = service.getClaimProver();
      expect(prover).toBeDefined();
    });

    it('getRegistrationProver() retourne le même objet en cache (singleton pattern)', () => {
      const p1 = service.getRegistrationProver();
      const p2 = service.getRegistrationProver();
      expect(p1).toBe(p2);
    });
  });
});
