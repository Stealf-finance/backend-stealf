/**
 * Tests d'intégration — Routes HTTP stealth (tâche 8.1)
 *
 * Requirements : 2.7, 3.1, 3.2, 3.4, 4.3
 */

// ===== Mocks avant les imports =====

process.env.VAULT_SHARES_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
// Générer un keypair de test pour l'authority (VAULT_AUTHORITY_PRIVATE_KEY)
// Doit être fait AVANT les imports (jest hoisting)
const { Keypair: _Kp } = jest.requireActual('@solana/web3.js');
const _testAuthority = _Kp.generate();
process.env.VAULT_AUTHORITY_PRIVATE_KEY = JSON.stringify(Array.from(_testAuthority.secretKey));

// Mock User model
const mockUserFindById = jest.fn();
const mockUserSave = jest.fn();
jest.mock('../../models/User', () => ({
  User: {
    findById: (...args: any[]) => mockUserFindById(...args),
  },
}));

// Mock StealthPayment model
const mockStealthPaymentFindOneAndUpdate = jest.fn();
const mockStealthPaymentFind = jest.fn();
const mockStealthPaymentFindById = jest.fn();
jest.mock('../../models/StealthPayment', () => ({
  StealthPayment: {
    findOneAndUpdate: (...args: any[]) => mockStealthPaymentFindOneAndUpdate(...args),
    find: (...args: any[]) => mockStealthPaymentFind(...args),
    findById: (...args: any[]) => mockStealthPaymentFindById(...args),
  },
}));

// Mock @solana/web3.js Connection
const mockGetLatestBlockhash = jest.fn();
const mockGetSignaturesForAddress = jest.fn();
const mockGetParsedTransaction = jest.fn();
const mockSendRawTransaction = jest.fn();
const mockConfirmTransaction = jest.fn();
const mockGetBalance = jest.fn();

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
      getSignaturesForAddress: mockGetSignaturesForAddress,
      getParsedTransaction: mockGetParsedTransaction,
      sendRawTransaction: mockSendRawTransaction,
      confirmTransaction: mockConfirmTransaction,
      getBalance: mockGetBalance,
    })),
  };
});

// Mock verifyAuth middleware — injecter un userId fictif avec une clé Solana valide
// System Program address = 32 zero bytes = toujours valide
jest.mock('../../middleware/verifyAuth', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = {
      userId: '64b5f8a2c1234567890abcde',
      publicKey: '11111111111111111111111111111111',
    };
    next();
  },
}));

import request from 'supertest';
import express from 'express';
import bs58 from 'bs58';
import stealthRoutes from '../../routes/stealth.routes';
import { StealthCryptoService } from '../../services/stealth/stealth-crypto.service';

const cryptoSvc = new StealthCryptoService();

// Construire un mini express app de test
const app = express();
app.use(express.json());
app.use('/api/stealth', stealthRoutes);

// Générer des keypairs réels pour les tests
const spendingKp = cryptoSvc.generateSpendingKeypair();
const viewingKp = cryptoSvc.generateViewingKeypair();
const metaAddress = cryptoSvc.encodeMetaAddress(spendingKp.publicKey, viewingKp.publicKey);

// ===================================================================
// Routes méta-adresse
// ===================================================================

describe('GET /api/stealth/meta-address', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 404 if stealth not registered', async () => {
    mockUserFindById.mockResolvedValue({ stealthEnabled: false });
    const res = await request(app).get('/api/stealth/meta-address');
    expect(res.status).toBe(404);
  });

  it('should return metaAddress if registered', async () => {
    mockUserFindById.mockResolvedValue({
      stealthEnabled: true,
      stealthSpendingPublic: bs58.encode(spendingKp.publicKey),
      stealthViewingPublic: bs58.encode(viewingKp.publicKey),
    });
    const res = await request(app).get('/api/stealth/meta-address');
    expect(res.status).toBe(200);
    expect(res.body.metaAddress).toBeDefined();
    // Ne doit pas contenir de clé privée
    expect(JSON.stringify(res.body)).not.toContain('PrivateKey');
  });
});

describe('POST /api/stealth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should register and return 201 with metaAddress', async () => {
    mockUserFindById.mockResolvedValue({
      stealthEnabled: false,
      save: mockUserSave.mockResolvedValue(undefined),
    });

    const res = await request(app)
      .post('/api/stealth/register')
      .send({
        viewingPublicKey: bs58.encode(viewingKp.publicKey),
        viewingPrivateKeyHex: Buffer.from(viewingKp.privateKey).toString('hex'),
        spendingPublicKey: bs58.encode(spendingKp.publicKey),
      });

    expect(res.status).toBe(201);
    expect(res.body.metaAddress).toBeDefined();
    expect(mockUserSave).toHaveBeenCalledTimes(1);
  });

  it('should return 409 if already registered', async () => {
    mockUserFindById.mockResolvedValue({ stealthEnabled: true });

    const res = await request(app)
      .post('/api/stealth/register')
      .send({
        viewingPublicKey: bs58.encode(viewingKp.publicKey),
        viewingPrivateKeyHex: Buffer.from(viewingKp.privateKey).toString('hex'),
        spendingPublicKey: bs58.encode(spendingKp.publicKey),
      });

    expect(res.status).toBe(409);
  });

  it('should return 400 if viewingPrivateKeyHex is missing', async () => {
    const res = await request(app)
      .post('/api/stealth/register')
      .send({ viewingPublicKey: bs58.encode(viewingKp.publicKey), spendingPublicKey: bs58.encode(spendingKp.publicKey) });
    expect(res.status).toBe(400);
  });
});

// ===================================================================
// POST /api/stealth/build-transfer
// ===================================================================

describe('POST /api/stealth/build-transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Blockhash valide : 32 bytes (32 '1's)
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 200_000_000,
    });
  });

  it('should return serializedTx, stealthAddress, ephemeralR, viewTag, viewingPubKeyB58 and memo', async () => {
    const res = await request(app)
      .post('/api/stealth/build-transfer')
      .send({
        recipientMetaAddress: metaAddress,
        amountLamports: '1000000',
      });

    expect(res.status).toBe(200);
    expect(res.body.serializedTx).toBeDefined();
    expect(res.body.stealthAddress).toBeDefined();
    // Nouveaux champs pour route-stealth
    expect(res.body.ephemeralR).toBeDefined();
    expect(typeof res.body.viewTag).toBe('number');
    expect(res.body.viewingPubKeyB58).toBeDefined();
    // Memo toujours retourné pour affichage
    expect(res.body.memo).toMatch(/^stealth:v1:[A-Za-z0-9]+:[0-9a-f]{2}$/);

    // stealthAddress doit être une adresse Solana valide (32 bytes en base58)
    const decoded = new Uint8Array(bs58.decode(res.body.stealthAddress));
    expect(decoded.length).toBe(32);
  });

  it('should return 400 for invalid meta-address', async () => {
    const res = await request(app)
      .post('/api/stealth/build-transfer')
      .send({
        recipientMetaAddress: 'not-a-valid-meta-address',
        amountLamports: '1000000',
      });
    expect(res.status).toBe(400);
  });

  it('should produce different stealthAddress for each call (ephemeral randomness)', async () => {
    const r1 = await request(app).post('/api/stealth/build-transfer').send({
      recipientMetaAddress: metaAddress,
      amountLamports: '1000000',
    });
    const r2 = await request(app).post('/api/stealth/build-transfer').send({
      recipientMetaAddress: metaAddress,
      amountLamports: '1000000',
    });
    expect(r1.body.stealthAddress).not.toBe(r2.body.stealthAddress);
  });
});

// ===================================================================
// GET /api/stealth/incoming
// ===================================================================

describe('GET /api/stealth/incoming', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return payments list without ephemeralR', async () => {
    const mockPayments = [
      {
        _id: 'pay1',
        stealthAddress: 'StealthAddr1',
        amountLamports: '1000000',
        txSignature: 'sig1',
        detectedAt: new Date().toISOString(),
        status: 'spendable',
        ephemeralR: 'SHOULD_NOT_BE_EXPOSED', // doit être filtré
        viewTag: 42,
      },
    ];
    mockStealthPaymentFind.mockReturnValue({ sort: () => ({ lean: () => mockPayments }) });

    const res = await request(app).get('/api/stealth/incoming');
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    // ephemeralR et viewTag ne doivent pas être retournés
    expect(JSON.stringify(res.body)).not.toContain('SHOULD_NOT_BE_EXPOSED');
    expect(JSON.stringify(res.body)).not.toContain('ephemeralR');
    expect(JSON.stringify(res.body)).not.toContain('viewTag');
  });
});

// ===================================================================
// POST /api/stealth/spend/confirm
// ===================================================================

describe('POST /api/stealth/spend/confirm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update status to spent and return 200', async () => {
    const mockPayment = {
      _id: 'pay1',
      status: 'spendable',
      save: jest.fn().mockResolvedValue(undefined),
    };
    // Le service fait `await StealthPayment.findById(paymentId)` directement
    mockStealthPaymentFindById.mockResolvedValue(mockPayment);

    const res = await request(app)
      .post('/api/stealth/spend/confirm')
      .send({ paymentId: 'pay1', txSignature: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPayment.save).toHaveBeenCalledTimes(1);
  });

  it('should return 404 if payment not found', async () => {
    mockStealthPaymentFindById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/stealth/spend/confirm')
      .send({ paymentId: 'nonexistent', txSignature: 'a'.repeat(64) });

    expect(res.status).toBe(404);
  });
});

// ===================================================================
// POST /api/stealth/route-stealth
// ===================================================================

describe('POST /api/stealth/route-stealth', () => {
  const validRouteBody = {
    tx1Signature: 'a'.repeat(88),
    stealthAddress: '11111111111111111111111111111111',
    ephemeralR: bs58.encode(new Uint8Array(32).fill(1)),
    viewTag: 42,
    viewingPubKeyB58: bs58.encode(new Uint8Array(32).fill(2)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 200_000_000,
    });
    mockSendRawTransaction.mockResolvedValue('tx2sig' + 'b'.repeat(82));
    mockConfirmTransaction.mockResolvedValue({ value: { err: null } });
  });

  it('should return 400 if TX1 not confirmed', async () => {
    mockGetParsedTransaction.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/stealth/route-stealth')
      .send(validRouteBody);

    expect(res.status).toBe(400);
  });

  it('should return 400 if TX1 failed on-chain', async () => {
    mockGetParsedTransaction.mockResolvedValue({ meta: { err: { InstructionError: [0, 'InsufficientFunds'] } } });

    const res = await request(app)
      .post('/api/stealth/route-stealth')
      .send(validRouteBody);

    expect(res.status).toBe(400);
  });

  it('should return 200 with txSignature when TX1 is valid', async () => {
    // TX1 parsé valide : authority a reçu des lamports
    const authorityPubkey = _testAuthority.publicKey.toBase58();
    mockGetParsedTransaction.mockResolvedValue({
      meta: {
        err: null,
        preBalances: [2_000_000_000, 0],
        postBalances: [1_000_000_000, 1_000_000_000],
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => '11111111111111111111111111111111' } },
            { pubkey: { toBase58: () => authorityPubkey } },
          ],
        },
      },
    });

    const res = await request(app)
      .post('/api/stealth/route-stealth')
      .send(validRouteBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txSignature).toBeDefined();
    expect(mockSendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('should return 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/stealth/route-stealth')
      .send({ tx1Signature: 'short' });

    expect(res.status).toBe(400);
  });
});

// ===================================================================
// Tâche 3.1 — POST /api/stealth/register-cash
// ===================================================================

describe('POST /api/stealth/register-cash (tâche 3.1)', () => {
  const cashSpendingKp = cryptoSvc.generateSpendingKeypair();
  const cashViewingKp = cryptoSvc.generateViewingKeypair();

  beforeEach(() => jest.clearAllMocks());

  it('should register cash stealth keys and return 201 with metaAddress', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: false,
      save: mockUserSave.mockResolvedValue(undefined),
    });

    const res = await request(app)
      .post('/api/stealth/register-cash')
      .send({
        viewingPublicKey: bs58.encode(cashViewingKp.publicKey),
        viewingPrivateKeyHex: Buffer.from(cashViewingKp.privateKey).toString('hex'),
        spendingPublicKey: bs58.encode(cashSpendingKp.publicKey),
      });

    expect(res.status).toBe(201);
    expect(res.body.metaAddress).toBeDefined();
    expect(mockUserSave).toHaveBeenCalledTimes(1);
  });

  it('should return 409 if cash stealth already registered', async () => {
    mockUserFindById.mockResolvedValue({ cashStealthEnabled: true });

    const res = await request(app)
      .post('/api/stealth/register-cash')
      .send({
        viewingPublicKey: bs58.encode(cashViewingKp.publicKey),
        viewingPrivateKeyHex: Buffer.from(cashViewingKp.privateKey).toString('hex'),
        spendingPublicKey: bs58.encode(cashSpendingKp.publicKey),
      });

    expect(res.status).toBe(409);
  });

  it('should return 400 if viewingPrivateKeyHex is missing', async () => {
    const res = await request(app)
      .post('/api/stealth/register-cash')
      .send({
        viewingPublicKey: bs58.encode(cashViewingKp.publicKey),
        spendingPublicKey: bs58.encode(cashSpendingKp.publicKey),
      });

    expect(res.status).toBe(400);
  });

  it('should never return viewingPrivateKey in the response', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: false,
      save: mockUserSave.mockResolvedValue(undefined),
    });

    const res = await request(app)
      .post('/api/stealth/register-cash')
      .send({
        viewingPublicKey: bs58.encode(cashViewingKp.publicKey),
        viewingPrivateKeyHex: Buffer.from(cashViewingKp.privateKey).toString('hex'),
        spendingPublicKey: bs58.encode(cashSpendingKp.publicKey),
      });

    expect(JSON.stringify(res.body)).not.toContain('viewingPrivate');
    expect(JSON.stringify(res.body)).not.toContain('Enc');
  });
});

// ===================================================================
// Tâche 3.1 — GET /api/stealth/cash/meta-address
// ===================================================================

describe('GET /api/stealth/cash/meta-address (tâche 3.1)', () => {
  const cashSpendingKp = cryptoSvc.generateSpendingKeypair();
  const cashViewingKp = cryptoSvc.generateViewingKeypair();

  beforeEach(() => jest.clearAllMocks());

  it('should return 404 if cash stealth not registered', async () => {
    mockUserFindById.mockResolvedValue({ cashStealthEnabled: false });

    const res = await request(app).get('/api/stealth/cash/meta-address');

    expect(res.status).toBe(404);
  });

  it('should return metaAddress if cash stealth is registered', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: true,
      cashStealthSpendingPublic: bs58.encode(cashSpendingKp.publicKey),
      cashStealthViewingPublic: bs58.encode(cashViewingKp.publicKey),
    });

    const res = await request(app).get('/api/stealth/cash/meta-address');

    expect(res.status).toBe(200);
    expect(res.body.metaAddress).toBeDefined();
    expect(typeof res.body.metaAddress).toBe('string');
  });

  it('should never return cashStealthViewingPrivateEnc in the response', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: true,
      cashStealthSpendingPublic: bs58.encode(cashSpendingKp.publicKey),
      cashStealthViewingPublic: bs58.encode(cashViewingKp.publicKey),
      cashStealthViewingPrivateEnc: 'should_not_appear',
    });

    const res = await request(app).get('/api/stealth/cash/meta-address');

    expect(JSON.stringify(res.body)).not.toContain('should_not_appear');
    expect(JSON.stringify(res.body)).not.toContain('PrivateEnc');
  });
});

// ===================================================================
// Tâche 3.2 — GET /api/stealth/cash/balance
// ===================================================================

describe('GET /api/stealth/cash/balance (tâche 3.2)', () => {
  const cashWalletPubkey = _testAuthority.publicKey.toBase58();

  beforeEach(() => jest.clearAllMocks());

  it('should return 200 with mainBalance, stealthBalance, totalBalance', async () => {
    mockUserFindById.mockResolvedValue({
      cash_wallet: cashWalletPubkey,
      cashStealthEnabled: true,
    });
    mockGetBalance.mockResolvedValue(2_000_000);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: 'sp1', stealthAddress: 'SA1', amountLamports: '500000', detectedAt: new Date(), status: 'spendable' },
      ]),
    });

    const res = await request(app).get('/api/stealth/cash/balance');

    expect(res.status).toBe(200);
    expect(res.body.mainBalance).toBe(2_000_000);
    expect(res.body.stealthBalance).toBe(500_000);
    expect(res.body.totalBalance).toBe(2_500_000);
    expect(res.body.stealthPayments).toHaveLength(1);
  });

  it('should return totalBalance = mainBalance when no stealth payments', async () => {
    mockUserFindById.mockResolvedValue({ cash_wallet: cashWalletPubkey });
    mockGetBalance.mockResolvedValue(1_000_000);
    mockStealthPaymentFind.mockReturnValue({ lean: () => Promise.resolve([]) });

    const res = await request(app).get('/api/stealth/cash/balance');

    expect(res.status).toBe(200);
    expect(res.body.totalBalance).toBe(1_000_000);
    expect(res.body.stealthBalance).toBe(0);
  });

  it('should never expose cashStealthViewingPrivateEnc in response', async () => {
    mockUserFindById.mockResolvedValue({
      cash_wallet: cashWalletPubkey,
      cashStealthViewingPrivateEnc: 'secret_key_data',
    });
    mockGetBalance.mockResolvedValue(0);
    mockStealthPaymentFind.mockReturnValue({ lean: () => Promise.resolve([]) });

    const res = await request(app).get('/api/stealth/cash/balance');

    expect(JSON.stringify(res.body)).not.toContain('secret_key_data');
    expect(JSON.stringify(res.body)).not.toContain('ViewingPrivateEnc');
  });
});

// ===================================================================
// Tâche 3.2 — POST /api/stealth/cash/scan
// ===================================================================

describe('POST /api/stealth/cash/scan (tâche 3.2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 200 with detected, scanned, errors on success', async () => {
    mockUserFindById.mockResolvedValue({
      _id: '64b5f8a2c1234567890abcde',
      cashStealthEnabled: true,
      cashStealthSpendingPublic: bs58.encode(_testAuthority.publicKey.toBytes()),
      cashStealthViewingPublic: bs58.encode(_testAuthority.publicKey.toBytes()),
      cashStealthViewingPrivateEnc: 'encrypted_data',
    });
    mockGetSignaturesForAddress.mockResolvedValue([]);

    const res = await request(app).post('/api/stealth/cash/scan');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      detected: expect.any(Number),
      scanned: expect.any(Number),
      errors: expect.any(Number),
    });
  });

  it('should return 404 if cash stealth not registered for user', async () => {
    mockUserFindById.mockResolvedValue({ cashStealthEnabled: false });

    const res = await request(app).post('/api/stealth/cash/scan');

    expect(res.status).toBe(404);
  });
});
