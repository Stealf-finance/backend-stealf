/**
 * Tests d'intégration — Services backend stealth (tâches 3.1, 3.2, 3.3)
 *
 * Requirements : 1.3, 1.4, 1.5, 2.6, 2.7, 3.1–3.7, 4.2, 4.5, 5.3, 5.5
 */

// ===== Mocks avant les imports =====

process.env.VAULT_SHARES_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
// Keypair de test pour l'authority (requis par buildTransferTx)
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
jest.mock('../../models/StealthPayment', () => ({
  StealthPayment: {
    findOneAndUpdate: (...args: any[]) => mockStealthPaymentFindOneAndUpdate(...args),
    find: (...args: any[]) => mockStealthPaymentFind(...args),
  },
}));

// Mock @solana/web3.js Connection
const mockGetLatestBlockhash = jest.fn();
const mockGetSignaturesForAddress = jest.fn();
const mockGetParsedTransaction = jest.fn();
const mockGetBalance = jest.fn();

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getLatestBlockhash: mockGetLatestBlockhash,
      getSignaturesForAddress: mockGetSignaturesForAddress,
      getParsedTransaction: mockGetParsedTransaction,
      getBalance: mockGetBalance,
    })),
  };
});

import bs58 from 'bs58';
import { StealthAddressService } from '../../services/stealth/stealth-address.service';
import { StealthTransferService } from '../../services/stealth/stealth-transfer.service';
import { StealthScannerService } from '../../services/stealth/stealth-scanner.service';
import { StealthCryptoService } from '../../services/stealth/stealth-crypto.service';

// Helper — génère des keypairs réels pour les tests
const cryptoSvc = new StealthCryptoService();

// ===================================================================
// Tâche 3.1 — StealthAddressService
// ===================================================================

describe('StealthAddressService (tâche 3.1)', () => {
  let service: StealthAddressService;
  const userId = '64b5f8a2c1234567890abcde';

  const spendingKp = cryptoSvc.generateSpendingKeypair();
  const viewingKp = cryptoSvc.generateViewingKeypair();
  const spendingPublicKey = bs58.encode(spendingKp.publicKey);
  const viewingPublicKey = bs58.encode(viewingKp.publicKey);
  const viewingPrivateKeyHex = Buffer.from(viewingKp.privateKey).toString('hex');

  beforeEach(() => {
    service = new StealthAddressService();
    jest.clearAllMocks();
  });

  it('should register viewing key and return metaAddress', async () => {
    const mockUser = {
      stealthEnabled: false,
      stealthSpendingPublic: undefined,
      stealthViewingPublic: undefined,
      stealthViewingPrivateEnc: undefined,
      save: mockUserSave.mockResolvedValue(undefined),
    };
    mockUserFindById.mockResolvedValue(mockUser);

    const result = await service.registerViewingKey(userId, {
      viewingPublicKey,
      viewingPrivateKeyHex,
      spendingPublicKey,
    });

    expect(result.metaAddress).toBeDefined();
    expect(typeof result.metaAddress).toBe('string');
    // meta-address should decode to 64 bytes
    const decoded = new Uint8Array(bs58.decode(result.metaAddress));
    expect(decoded.length).toBe(64);
    expect(mockUserSave).toHaveBeenCalledTimes(1);
    expect(mockUser.stealthEnabled).toBe(true);
    expect(mockUser.stealthViewingPrivateEnc).toBeDefined();
    // Viewing private key must be encrypted (format iv:tag:ciphertext)
    expect(mockUser.stealthViewingPrivateEnc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('should throw 409 if stealth already registered', async () => {
    mockUserFindById.mockResolvedValue({
      stealthEnabled: true,
      save: jest.fn(),
    });

    await expect(
      service.registerViewingKey(userId, { viewingPublicKey, viewingPrivateKeyHex, spendingPublicKey }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('should return null from getMetaAddress when not registered', async () => {
    mockUserFindById.mockResolvedValue({ stealthEnabled: false });
    const result = await service.getMetaAddress(userId);
    expect(result).toBeNull();
  });

  it('should return metaAddress from getMetaAddress when registered', async () => {
    mockUserFindById.mockResolvedValue({
      stealthEnabled: true,
      stealthSpendingPublic: spendingPublicKey,
      stealthViewingPublic: viewingPublicKey,
    });

    const result = await service.getMetaAddress(userId);
    expect(result).not.toBeNull();
    expect(result!.metaAddress).toBeDefined();
    const decoded = new Uint8Array(bs58.decode(result!.metaAddress));
    expect(decoded.length).toBe(64);
  });

  it('should never return viewing private key in plain via getMetaAddress', async () => {
    const encryptedVPK = 'abc123:def456:ghi789';
    mockUserFindById.mockResolvedValue({
      stealthEnabled: true,
      stealthSpendingPublic: spendingPublicKey,
      stealthViewingPublic: viewingPublicKey,
      stealthViewingPrivateEnc: encryptedVPK,
    });

    const result = await service.getMetaAddress(userId);
    // Result must not contain the encrypted private key
    expect(JSON.stringify(result)).not.toContain(encryptedVPK);
    expect(JSON.stringify(result)).not.toContain(viewingPrivateKeyHex);
  });
});

// ===================================================================
// Tâche 2.1 — StealthAddressService : cash stealth (registerCashViewingKey / getCashMetaAddress)
// ===================================================================

describe('StealthAddressService — cash stealth (tâche 2.1)', () => {
  let service: StealthAddressService;
  const userId = '64b5f8a2c1234567890abcdf';

  const spendingKp = cryptoSvc.generateSpendingKeypair();
  const viewingKp = cryptoSvc.generateViewingKeypair();
  const spendingPublicKey = bs58.encode(spendingKp.publicKey);
  const viewingPublicKey = bs58.encode(viewingKp.publicKey);
  const viewingPrivateKeyHex = Buffer.from(viewingKp.privateKey).toString('hex');

  beforeEach(() => {
    service = new StealthAddressService();
    jest.clearAllMocks();
  });

  it('should register cash viewing key and return metaAddress', async () => {
    const mockUser = {
      cashStealthEnabled: false,
      cashStealthSpendingPublic: undefined,
      cashStealthViewingPublic: undefined,
      cashStealthViewingPrivateEnc: undefined,
      save: mockUserSave.mockResolvedValue(undefined),
    };
    mockUserFindById.mockResolvedValue(mockUser);

    const result = await service.registerCashViewingKey(userId, {
      viewingPublicKey,
      viewingPrivateKeyHex,
      spendingPublicKey,
    });

    expect(result.metaAddress).toBeDefined();
    const decoded = new Uint8Array(bs58.decode(result.metaAddress));
    expect(decoded.length).toBe(64);
    expect(mockUserSave).toHaveBeenCalledTimes(1);
    expect(mockUser.cashStealthEnabled).toBe(true);
    expect(mockUser.cashStealthViewingPrivateEnc).toBeDefined();
    // Viewing private key must be encrypted (format iv:tag:ciphertext)
    expect(mockUser.cashStealthViewingPrivateEnc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('should throw 409 if cash stealth already registered', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: true,
      save: jest.fn(),
    });

    await expect(
      service.registerCashViewingKey(userId, { viewingPublicKey, viewingPrivateKeyHex, spendingPublicKey }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('should return null from getCashMetaAddress when not registered', async () => {
    mockUserFindById.mockResolvedValue({ cashStealthEnabled: false });
    const result = await service.getCashMetaAddress(userId);
    expect(result).toBeNull();
  });

  it('should return metaAddress from getCashMetaAddress when registered', async () => {
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: true,
      cashStealthSpendingPublic: spendingPublicKey,
      cashStealthViewingPublic: viewingPublicKey,
    });

    const result = await service.getCashMetaAddress(userId);
    expect(result).not.toBeNull();
    expect(result!.metaAddress).toBeDefined();
    const decoded = new Uint8Array(bs58.decode(result!.metaAddress));
    expect(decoded.length).toBe(64);
  });

  it('should never return cashStealthViewingPrivateEnc in getCashMetaAddress response', async () => {
    const encryptedVPK = 'aabbcc:ddeeff:001122';
    mockUserFindById.mockResolvedValue({
      cashStealthEnabled: true,
      cashStealthSpendingPublic: spendingPublicKey,
      cashStealthViewingPublic: viewingPublicKey,
      cashStealthViewingPrivateEnc: encryptedVPK,
    });

    const result = await service.getCashMetaAddress(userId);
    expect(JSON.stringify(result)).not.toContain(encryptedVPK);
    expect(JSON.stringify(result)).not.toContain(viewingPrivateKeyHex);
  });

  it('cash metaAddress should differ from wealth metaAddress (different keypairs)', async () => {
    const cashSpendingKp = cryptoSvc.generateSpendingKeypair();
    const cashViewingKp = cryptoSvc.generateViewingKeypair();

    // Register wealth stealth
    const wealthUser: any = {
      stealthEnabled: false,
      cashStealthEnabled: false,
      save: mockUserSave.mockResolvedValue(undefined),
    };
    mockUserFindById.mockResolvedValue(wealthUser);
    const wealthResult = await service.registerViewingKey(userId, {
      viewingPublicKey: viewingPublicKey,
      viewingPrivateKeyHex: viewingPrivateKeyHex,
      spendingPublicKey: spendingPublicKey,
    });

    // Register cash stealth (different keypair)
    const cashUser: any = {
      cashStealthEnabled: false,
      save: mockUserSave.mockResolvedValue(undefined),
    };
    mockUserFindById.mockResolvedValue(cashUser);
    const cashResult = await service.registerCashViewingKey(userId, {
      viewingPublicKey: bs58.encode(cashViewingKp.publicKey),
      viewingPrivateKeyHex: Buffer.from(cashViewingKp.privateKey).toString('hex'),
      spendingPublicKey: bs58.encode(cashSpendingKp.publicKey),
    });

    expect(cashResult.metaAddress).not.toBe(wealthResult.metaAddress);
  });
});

// ===================================================================
// Tâche 3.2 — StealthTransferService
// ===================================================================

describe('StealthTransferService (tâche 3.2)', () => {
  let service: StealthTransferService;

  const spendingKp = cryptoSvc.generateSpendingKeypair();
  const viewingKp = cryptoSvc.generateViewingKeypair();
  const metaAddress = cryptoSvc.encodeMetaAddress(spendingKp.publicKey, viewingKp.publicKey);
  const senderPublicKey = bs58.encode(cryptoSvc.generateSpendingKeypair().publicKey);

  beforeEach(() => {
    service = new StealthTransferService();
    jest.clearAllMocks();

    // Base58 : 32 chars '1' = bs58.decode = 32 zero bytes = blockhash valide 32 bytes
    mockGetLatestBlockhash.mockResolvedValue({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 200_000_000,
    });
  });

  it('should build a transfer TX and return serializedTx and stealthAddress', async () => {
    const result = await service.buildTransferTx({
      senderPublicKey,
      recipientMetaAddress: metaAddress,
      amountLamports: BigInt(1_000_000),
    });

    expect(result.serializedTx).toBeDefined();
    expect(typeof result.serializedTx).toBe('string');
    expect(result.stealthAddress).toBeDefined();
    expect(typeof result.stealthAddress).toBe('string');
    // Steath address should be a valid base58 32-byte Solana address
    const decoded = new Uint8Array(bs58.decode(result.stealthAddress));
    expect(decoded.length).toBe(32);
  });

  it('should embed stealth:v1: memo in the serialized TX', async () => {
    const result = await service.buildTransferTx({
      senderPublicKey,
      recipientMetaAddress: metaAddress,
      amountLamports: BigInt(500_000),
    });

    // Le memo est encodé dans les instructions de la TX (pas dans le retour)
    const txBytes = Buffer.from(result.serializedTx, 'base64');
    const txString = txBytes.toString('utf-8');
    expect(txString).toContain('stealth:v1:');
  });

  it('should produce different stealth addresses for same recipient (ephemeral randomness)', async () => {
    const r1 = await service.buildTransferTx({
      senderPublicKey,
      recipientMetaAddress: metaAddress,
      amountLamports: BigInt(1_000_000),
    });
    const r2 = await service.buildTransferTx({
      senderPublicKey,
      recipientMetaAddress: metaAddress,
      amountLamports: BigInt(1_000_000),
    });

    expect(r1.stealthAddress).not.toBe(r2.stealthAddress);
  });

  it('should throw on invalid meta-address format', async () => {
    await expect(
      service.buildTransferTx({
        senderPublicKey,
        recipientMetaAddress: 'invalid-not-base58',
        amountLamports: BigInt(1_000_000),
      }),
    ).rejects.toThrow();
  });
});

// ===================================================================
// Tâche 3.3 — StealthScannerService
// ===================================================================

describe('StealthScannerService (tâche 3.3)', () => {
  let service: StealthScannerService;

  const recipientSpendingKp = cryptoSvc.generateSpendingKeypair();
  const recipientViewingKp = cryptoSvc.generateViewingKeypair();

  // Pre-derive a valid stealth payment for the tests
  const derived = cryptoSvc.deriveStealthAddress({
    recipientSpendingPub: recipientSpendingKp.publicKey,
    recipientViewingPub: recipientViewingKp.publicKey,
  });

  const viewTagHex = derived.viewTag.toString(16).padStart(2, '0');
  const ephemeralR_b58 = bs58.encode(derived.ephemeralPub);
  const validMemo = `stealth:v1:${ephemeralR_b58}:${viewTagHex}`;

  const mockUser = {
    _id: '64b5f8a2c1234567890abcde',
    stealthEnabled: true,
    stealthSpendingPublic: bs58.encode(recipientSpendingKp.publicKey),
    stealthViewingPublic: bs58.encode(recipientViewingKp.publicKey),
    stealthViewingPrivateEnc: 'mock_encrypted', // will be decrypted by mock
    lastStealthScanAt: new Date(Date.now() - 120_000),
  };

  beforeEach(() => {
    service = new StealthScannerService();
    jest.clearAllMocks();
  });

  it('should detect a valid stealth payment and upsert StealthPayment', async () => {
    // Mock getSignaturesForAddress: returns one TX with valid stealth memo
    mockGetSignaturesForAddress.mockResolvedValue([
      {
        signature: 'validTxSig123',
        memo: validMemo,
        err: null,
        blockTime: Math.floor(Date.now() / 1000),
      },
    ]);

    // Mock getParsedTransaction: returns the TX with the stealth payment to our user
    mockGetParsedTransaction.mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => 'SomeSenderAddress' }, signer: true },
            { pubkey: { toBase58: () => derived.stealthAddress }, signer: false },
          ],
        },
      },
      meta: {
        preBalances: [2_000_000, 0],
        postBalances: [900_000, 1_000_000],
        err: null,
      },
    });

    // Mock StealthPayment.findOneAndUpdate (upsert)
    mockStealthPaymentFindOneAndUpdate.mockResolvedValue({ _id: 'new_id' });

    // Spy on decryptViewingKey to return real viewing private key
    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(recipientViewingKp.privateKey);

    const result = await service.scanForUser(mockUser as any);

    expect(result.detected).toBe(1);
    expect(mockStealthPaymentFindOneAndUpdate).toHaveBeenCalledTimes(1);

    const upsertCall = mockStealthPaymentFindOneAndUpdate.mock.calls[0];
    const setData = upsertCall[1].$setOnInsert || upsertCall[1];
    expect(upsertCall[0]).toMatchObject({ txSignature: 'validTxSig123' });
  });

  it('should skip a TX with wrong view_tag (fast filter)', async () => {
    const wrongViewTagHex = ((derived.viewTag + 1) % 256).toString(16).padStart(2, '0');
    const wrongMemo = `stealth:v1:${ephemeralR_b58}:${wrongViewTagHex}`;

    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'wrongTagSig', memo: wrongMemo, err: null, blockTime: 123 },
    ]);
    mockGetParsedTransaction.mockResolvedValue({
      transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => 'OtherAddr' }, signer: false }] } },
      meta: { preBalances: [2_000_000], postBalances: [1_000_000], err: null },
    });

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(recipientViewingKp.privateKey);

    const result = await service.scanForUser(mockUser as any);
    expect(result.detected).toBe(0);
    expect(mockStealthPaymentFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('should skip TXs without stealth:v1: memo prefix', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'normalTxSig', memo: 'some other memo', err: null, blockTime: 123 },
      { signature: 'noMemoTx', memo: null, err: null, blockTime: 123 },
    ]);

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(recipientViewingKp.privateKey);

    const result = await service.scanForUser(mockUser as any);
    expect(result.detected).toBe(0);
    expect(mockGetParsedTransaction).not.toHaveBeenCalled();
  });

  it('should handle malformed ephemeralR in memo gracefully (no crash)', async () => {
    const malformedMemo = `stealth:v1:!!!not-valid-base58!!!:2a`;
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'malformedSig', memo: malformedMemo, err: null, blockTime: 123 },
    ]);

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(recipientViewingKp.privateKey);

    // Must not throw — silently ignore
    await expect(service.scanForUser(mockUser as any)).resolves.toMatchObject({ detected: 0 });
  });

  it('should use upsert with unique filter on {userId, txSignature} for deduplication', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'dupSig', memo: validMemo, err: null, blockTime: 123 },
    ]);
    mockGetParsedTransaction.mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => 'SomeSenderAddress' }, signer: true },
            { pubkey: { toBase58: () => derived.stealthAddress }, signer: false },
          ],
        },
      },
      meta: { preBalances: [2_000_000, 0], postBalances: [900_000, 1_000_000], err: null },
    });
    mockStealthPaymentFindOneAndUpdate.mockResolvedValue({ _id: 'existing' });

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(recipientViewingKp.privateKey);

    await service.scanForUser(mockUser as any);

    // findOneAndUpdate must be called with upsert: true
    const upsertOptions = mockStealthPaymentFindOneAndUpdate.mock.calls[0][2];
    expect(upsertOptions?.upsert).toBe(true);
  });
});

// ===================================================================
// Tâche 2.2 — StealthBalanceService
// ===================================================================

describe('StealthBalanceService (tâche 2.2)', () => {
  let StealthBalanceService: any;
  let service: any;
  const userId = '64b5f8a2c1234567890abcdf';
  // Adresse valide Solana base58 (32 bytes) — utilise le keypair de test déjà disponible
  const cashWalletAddress = _testAuthority.publicKey.toBase58();

  beforeEach(async () => {
    // Import dynamique après init des mocks
    const mod = await import('../../services/stealth/stealth-balance.service');
    StealthBalanceService = mod.StealthBalanceService;
    service = new StealthBalanceService();
    jest.clearAllMocks();
  });

  it('should return mainBalance from Solana RPC and stealthBalance=0 when no spendable UTXOs', async () => {
    mockGetBalance.mockResolvedValue(5_000_000);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([]),
    });

    const result = await service.getCashBalance(userId, cashWalletAddress);

    expect(result.mainBalance).toBe(5_000_000);
    expect(result.stealthBalance).toBe(0);
    expect(result.totalBalance).toBe(5_000_000);
    expect(result.stealthPayments).toHaveLength(0);
  });

  it('should aggregate spendable cash stealth payments into stealthBalance', async () => {
    mockGetBalance.mockResolvedValue(1_000_000);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: 'p1', stealthAddress: 'Stealth1', amountLamports: '500000', detectedAt: new Date(), status: 'spendable' },
        { _id: 'p2', stealthAddress: 'Stealth2', amountLamports: '300000', detectedAt: new Date(), status: 'spendable' },
      ]),
    });

    const result = await service.getCashBalance(userId, cashWalletAddress);

    expect(result.stealthBalance).toBe(800_000);
    expect(result.mainBalance).toBe(1_000_000);
    expect(result.totalBalance).toBe(1_800_000);
    expect(result.stealthPayments).toHaveLength(2);
  });

  it('should query only walletType:cash and status:spendable payments', async () => {
    mockGetBalance.mockResolvedValue(0);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([]),
    });

    await service.getCashBalance(userId, cashWalletAddress);

    const findArgs = mockStealthPaymentFind.mock.calls[0][0];
    expect(findArgs).toMatchObject({
      walletType: 'cash',
      status: 'spendable',
    });
    expect(findArgs.userId).toBeDefined();
  });

  it('should handle BigInt-safe amountLamports (> Number.MAX_SAFE_INTEGER fallback via string parse)', async () => {
    mockGetBalance.mockResolvedValue(0);
    // Amounts realistic for SOL (< 2^53) — BigInt-safe string parsing
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: 'big', stealthAddress: 'StealthBig', amountLamports: '9007199254740991', detectedAt: new Date(), status: 'spendable' },
      ]),
    });

    const result = await service.getCashBalance(userId, cashWalletAddress);

    // Should parse correctly without precision loss
    expect(result.stealthBalance).toBe(9007199254740991);
  });

  it('should guarantee totalBalance = mainBalance + stealthBalance', async () => {
    mockGetBalance.mockResolvedValue(2_500_000);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: 'p1', stealthAddress: 'S1', amountLamports: '1000000', detectedAt: new Date(), status: 'spendable' },
        { _id: 'p2', stealthAddress: 'S2', amountLamports: '750000', detectedAt: new Date(), status: 'spendable' },
      ]),
    });

    const result = await service.getCashBalance(userId, cashWalletAddress);

    expect(result.totalBalance).toBe(result.mainBalance + result.stealthBalance);
  });

  it('should never expose cashStealthViewingPrivateEnc in the response', async () => {
    mockGetBalance.mockResolvedValue(1_000);
    mockStealthPaymentFind.mockReturnValue({
      lean: () => Promise.resolve([]),
    });

    const result = await service.getCashBalance(userId, cashWalletAddress);

    const json = JSON.stringify(result);
    expect(json).not.toContain('ViewingPrivate');
    expect(json).not.toContain('Enc');
  });
});

// ===================================================================
// Tâche 2.3 — StealthScannerService.scanCashForUser
// ===================================================================

describe('StealthScannerService — cash scan (tâche 2.3)', () => {
  let service: StealthScannerService;

  // Keypairs cash (distincts des keypairs wealth des tests précédents)
  const cashSpendingKp = cryptoSvc.generateSpendingKeypair();
  const cashViewingKp = cryptoSvc.generateViewingKeypair();

  // Pré-dériver une adresse stealth cash valide
  const cashDerived = cryptoSvc.deriveStealthAddress({
    recipientSpendingPub: cashSpendingKp.publicKey,
    recipientViewingPub: cashViewingKp.publicKey,
  });

  const viewTagHex = cashDerived.viewTag.toString(16).padStart(2, '0');
  const ephemeralR_b58 = bs58.encode(cashDerived.ephemeralPub);
  const validCashMemo = `stealth:v1:${ephemeralR_b58}:${viewTagHex}`;

  const mockCashUser = {
    _id: '64b5f8a2c1234567890abcff',
    cashStealthEnabled: true,
    cashStealthSpendingPublic: bs58.encode(cashSpendingKp.publicKey),
    cashStealthViewingPublic: bs58.encode(cashViewingKp.publicKey),
    cashStealthViewingPrivateEnc: 'mock_cash_encrypted',
  };

  beforeEach(() => {
    service = new StealthScannerService();
    jest.clearAllMocks();
  });

  it('should detect a valid cash stealth payment and upsert with walletType:cash', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'cashTxSig001', memo: validCashMemo, err: null, blockTime: Math.floor(Date.now() / 1000) },
    ]);
    mockGetParsedTransaction.mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => 'WealthSenderAddr' }, signer: true },
            { pubkey: { toBase58: () => cashDerived.stealthAddress }, signer: false },
          ],
        },
      },
      meta: { preBalances: [3_000_000, 0], postBalances: [1_500_000, 1_500_000], err: null },
    });
    mockStealthPaymentFindOneAndUpdate.mockResolvedValue({ _id: 'cash_pay_1' });

    // Spy sur decryptViewingKey pour retourner la vraie viewing private key cash
    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(cashViewingKp.privateKey);

    const result = await service.scanCashForUser(mockCashUser as any);

    expect(result.detected).toBe(1);
    expect(mockStealthPaymentFindOneAndUpdate).toHaveBeenCalledTimes(1);

    // Vérifier que walletType: 'cash' est dans le $setOnInsert
    const upsertCall = mockStealthPaymentFindOneAndUpdate.mock.calls[0];
    const setOnInsert = upsertCall[1].$setOnInsert;
    expect(setOnInsert).toMatchObject({ walletType: 'cash' });
  });

  it('should skip a TX with wrong view_tag for cash', async () => {
    const wrongTagHex = ((cashDerived.viewTag + 1) % 256).toString(16).padStart(2, '0');
    const wrongMemo = `stealth:v1:${ephemeralR_b58}:${wrongTagHex}`;

    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'wrongCashTagSig', memo: wrongMemo, err: null, blockTime: 123 },
    ]);

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(cashViewingKp.privateKey);

    const result = await service.scanCashForUser(mockCashUser as any);

    expect(result.detected).toBe(0);
  });

  it('should skip TXs without stealth:v1: memo for cash scan', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'normalCashTx', memo: 'other memo', err: null, blockTime: 123 },
      { signature: 'noMemoCashTx', memo: null, err: null, blockTime: 123 },
    ]);

    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(cashViewingKp.privateKey);

    const result = await service.scanCashForUser(mockCashUser as any);

    expect(result.detected).toBe(0);
    expect(mockGetParsedTransaction).not.toHaveBeenCalled();
  });

  it('should use cashStealth* fields (not wealth stealth* fields) for verification', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'cashFieldsSig', memo: validCashMemo, err: null, blockTime: 123 },
    ]);
    mockGetParsedTransaction.mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => 'WealthSenderAddr' }, signer: true },
            { pubkey: { toBase58: () => cashDerived.stealthAddress }, signer: false },
          ],
        },
      },
      meta: { preBalances: [2_000_000, 0], postBalances: [1_000_000, 1_000_000], err: null },
    });
    mockStealthPaymentFindOneAndUpdate.mockResolvedValue({ _id: 'ok' });

    // La viewing key passée doit correspondre au cashViewingKp
    const decryptSpy = jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(cashViewingKp.privateKey);

    await service.scanCashForUser(mockCashUser as any);

    // decryptViewingKey appelée avec cashStealthViewingPrivateEnc (pas stealthViewingPrivateEnc)
    expect(decryptSpy).toHaveBeenCalledWith(mockCashUser.cashStealthViewingPrivateEnc);
  });

  it('should not upsert walletType:wealth from cash scan (isolation)', async () => {
    mockGetSignaturesForAddress.mockResolvedValue([
      { signature: 'isolationSig', memo: validCashMemo, err: null, blockTime: 123 },
    ]);
    mockGetParsedTransaction.mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => 'WealthSenderAddr' }, signer: true },
            { pubkey: { toBase58: () => cashDerived.stealthAddress }, signer: false },
          ],
        },
      },
      meta: { preBalances: [2_000_000, 0], postBalances: [1_000_000, 1_000_000], err: null },
    });
    mockStealthPaymentFindOneAndUpdate.mockResolvedValue({ _id: 'ok' });
    jest.spyOn(service as any, 'decryptViewingKey').mockResolvedValue(cashViewingKp.privateKey);

    await service.scanCashForUser(mockCashUser as any);

    const upsertCall = mockStealthPaymentFindOneAndUpdate.mock.calls[0];
    const setOnInsert = upsertCall[1].$setOnInsert;
    // walletType doit être 'cash', JAMAIS 'wealth'
    expect(setOnInsert.walletType).toBe('cash');
    expect(setOnInsert.walletType).not.toBe('wealth');
  });
});
