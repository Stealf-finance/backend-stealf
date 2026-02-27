/**
 * Tests — Modèles de données stealth
 *
 * Couvre :
 * - 2.1 : StealthPayment model (schéma, indexes, invariants)
 * - 2.2 : Extension User model (champs stealth optionnels)
 *
 * Requirements : 3.4, 3.7, 4.3, 1.3, 1.4
 */

import mongoose from 'mongoose';

// Pas de connexion DB nécessaire — on teste uniquement les schémas (validateSync)

describe('StealthPayment model (tâche 2.1)', () => {
  let StealthPayment: any;

  beforeAll(() => {
    // Import après init (évite les problèmes de chargement circulaire)
    StealthPayment = require('../../models/StealthPayment').StealthPayment;
  });

  it('should instantiate with all required fields', () => {
    const doc = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr111111111111111111111111111111111',
      amountLamports: '1000000',
      txSignature: 'tx_sig_abc123',
      ephemeralR: 'EphemeralRBase58Key11111111111111111111111111',
      viewTag: 42,
      detectedAt: new Date(),
      status: 'spendable',
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('should fail validation when userId is missing', () => {
    const doc = new StealthPayment({
      stealthAddress: 'StealthAddr111111111111111111111111111111111',
      amountLamports: '1000000',
      txSignature: 'tx_sig_abc123',
      ephemeralR: 'Ephemeral111',
      viewTag: 42,
      detectedAt: new Date(),
      status: 'spendable',
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err!.errors.userId).toBeDefined();
  });

  it('should fail validation when txSignature is missing', () => {
    const doc = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr111111111111111111111111111111111',
      amountLamports: '1000000',
      ephemeralR: 'Ephemeral111',
      viewTag: 42,
      detectedAt: new Date(),
      status: 'spendable',
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err!.errors.txSignature).toBeDefined();
  });

  it('should reject invalid status values', () => {
    const doc = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr111111111111111111111111111111111',
      amountLamports: '1000000',
      txSignature: 'tx_sig_abc123',
      ephemeralR: 'Ephemeral111',
      viewTag: 42,
      detectedAt: new Date(),
      status: 'invalid_status', // doit échouer
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err!.errors.status).toBeDefined();
  });

  it('should accept status pending, spendable, and spent', () => {
    for (const status of ['pending', 'spendable', 'spent']) {
      const doc = new StealthPayment({
        userId: new mongoose.Types.ObjectId(),
        stealthAddress: 'StealthAddr1',
        amountLamports: '500000',
        txSignature: `tx_${status}`,
        ephemeralR: 'Ephemeral111',
        viewTag: 0,
        detectedAt: new Date(),
        status,
      });
      const err = doc.validateSync();
      expect(err).toBeUndefined();
    }
  });

  it('should have optional spendTxSignature and spentAt fields', () => {
    const spentAt = new Date();
    const doc = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr111111111111111111111111111111111',
      amountLamports: '1000000',
      txSignature: 'tx_sig_abc123',
      ephemeralR: 'Ephemeral111',
      viewTag: 42,
      detectedAt: new Date(),
      status: 'spent',
      spendTxSignature: 'spend_tx_sig_xyz',
      spentAt,
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.spendTxSignature).toBe('spend_tx_sig_xyz');
    expect(doc.spentAt).toEqual(spentAt);
  });

  it('should store amountLamports as String (BigInt safe)', () => {
    const amount = '9999999999999999999'; // > Number.MAX_SAFE_INTEGER
    const doc = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr1',
      amountLamports: amount,
      txSignature: 'tx_bigint',
      ephemeralR: 'Ephemeral111',
      viewTag: 0,
      detectedAt: new Date(),
      status: 'spendable',
    });
    expect(doc.amountLamports).toBe(amount);
  });

  it('should have viewTag between 0 and 255', () => {
    const docLow = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr1',
      amountLamports: '1000',
      txSignature: 'tx_low',
      ephemeralR: 'Eph',
      viewTag: 0,
      detectedAt: new Date(),
      status: 'spendable',
    });
    expect(docLow.validateSync()).toBeUndefined();

    const docHigh = new StealthPayment({
      userId: new mongoose.Types.ObjectId(),
      stealthAddress: 'StealthAddr1',
      amountLamports: '1000',
      txSignature: 'tx_high',
      ephemeralR: 'Eph',
      viewTag: 255,
      detectedAt: new Date(),
      status: 'spendable',
    });
    expect(docHigh.validateSync()).toBeUndefined();
  });
});

describe('User model stealth fields (tâche 2.2)', () => {
  let User: any;

  beforeAll(() => {
    User = require('../../models/User').User;
  });

  it('should instantiate without stealth fields (backward compatible)', () => {
    const doc = new User({
      email: 'test@stealf.com',
      pseudo: 'testuser',
      cash_wallet: 'Wallet1111111111111111111111111111111111111',
      stealf_wallet: 'Wallet2222222222222222222222222222222222222',
      turnkey_subOrgId: 'org_123',
      authMethod: 'passkey',
      status: 'active',
    });
    const err = doc.validateSync();
    // Les champs stealth sont optionnels — ne doit pas causer d'erreur
    expect(err).toBeUndefined();
    expect(doc.stealthEnabled).toBe(false); // default
  });

  it('should accept stealth fields when provided', () => {
    const doc = new User({
      email: 'stealth@stealf.com',
      pseudo: 'stealthuser',
      cash_wallet: 'Wallet3333333333333333333333333333333333333',
      stealf_wallet: 'Wallet4444444444444444444444444444444444444',
      turnkey_subOrgId: 'org_456',
      stealthEnabled: true,
      stealthSpendingPublic: 'SpendingPublicKeyBase581111111111111111111',
      stealthViewingPublic: 'ViewingPublicKeyBase5811111111111111111111',
      stealthViewingPrivateEnc: 'iv_hex:tag_hex:cipher_hex',
      lastStealthScanAt: new Date(),
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.stealthEnabled).toBe(true);
    expect(doc.stealthSpendingPublic).toBe('SpendingPublicKeyBase581111111111111111111');
    expect(doc.stealthViewingPrivateEnc).toBe('iv_hex:tag_hex:cipher_hex');
  });

  it('should default stealthEnabled to false', () => {
    const doc = new User({
      email: 'default@stealf.com',
      pseudo: 'defaultuser',
      cash_wallet: 'Wallet5555555555555555555555555555555555555',
      stealf_wallet: 'Wallet6666666666666666666666666666666666666',
      turnkey_subOrgId: 'org_789',
    });
    expect(doc.stealthEnabled).toBe(false);
  });
});

// --- Tâche 1.2 : walletType dans StealthPayment ---
describe('StealthPayment model — walletType discriminant (tâche 1.2)', () => {
  let StealthPayment: any;

  beforeAll(() => {
    StealthPayment = require('../../models/StealthPayment').StealthPayment;
  });

  const basePayment = (overrides = {}) => ({
    userId: new mongoose.Types.ObjectId(),
    stealthAddress: 'StealthAddr111111111111111111111111111111111',
    amountLamports: '1000000',
    txSignature: 'tx_sig_wallet_type',
    ephemeralR: 'EphemeralRBase58Key11111111111111111111111111',
    viewTag: 42,
    detectedAt: new Date(),
    status: 'spendable',
    ...overrides,
  });

  it('should default walletType to "wealth" for backward compatibility', () => {
    const doc = new StealthPayment(basePayment());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.walletType).toBe('wealth');
  });

  it('should accept walletType "wealth" explicitly', () => {
    const doc = new StealthPayment(basePayment({ walletType: 'wealth' }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.walletType).toBe('wealth');
  });

  it('should accept walletType "cash"', () => {
    const doc = new StealthPayment(basePayment({ walletType: 'cash' }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.walletType).toBe('cash');
  });

  it('should reject invalid walletType values', () => {
    const doc = new StealthPayment(basePayment({ walletType: 'external' }));
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err!.errors.walletType).toBeDefined();
  });

  it('should remain valid without walletType (default applied)', () => {
    const { walletType: _, ...withoutType } = basePayment() as any;
    const doc = new StealthPayment(withoutType);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.walletType).toBe('wealth');
  });
});

// --- Tâche 1.1 : champs cashStealth du cash wallet ---
describe('User model — cash stealth fields (tâche 1.1)', () => {
  let User: any;

  beforeAll(() => {
    User = require('../../models/User').User;
  });

  const baseUser = () => ({
    email: 'cash@stealf.com',
    pseudo: 'cashuser',
    cash_wallet: 'CashWallet111111111111111111111111111111111',
    stealf_wallet: 'WealthWallet11111111111111111111111111111111',
    turnkey_subOrgId: 'org_cash_001',
  });

  it('should default cashStealthEnabled to false for existing documents', () => {
    const doc = new User(baseUser());
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.cashStealthEnabled).toBe(false);
  });

  it('should accept cashStealthEnabled set to true', () => {
    const doc = new User({ ...baseUser(), cashStealthEnabled: true });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.cashStealthEnabled).toBe(true);
  });

  it('should accept all cash stealth fields when provided', () => {
    const doc = new User({
      ...baseUser(),
      cashStealthEnabled: true,
      cashStealthSpendingPublic: 'CashSpendingPubKeyBase5811111111111111111',
      cashStealthViewingPublic: 'CashViewingPubKeyBase58111111111111111111',
      cashStealthViewingPrivateEnc: 'iv:tag:ciphertext_cash_hex',
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.cashStealthSpendingPublic).toBe('CashSpendingPubKeyBase5811111111111111111');
    expect(doc.cashStealthViewingPublic).toBe('CashViewingPubKeyBase58111111111111111111');
    expect(doc.cashStealthViewingPrivateEnc).toBe('iv:tag:ciphertext_cash_hex');
  });

  it('should be valid without cash stealth fields (all optional)', () => {
    const doc = new User(baseUser());
    expect(doc.cashStealthSpendingPublic).toBeUndefined();
    expect(doc.cashStealthViewingPublic).toBeUndefined();
    expect(doc.cashStealthViewingPrivateEnc).toBeUndefined();
    expect(doc.validateSync()).toBeUndefined();
  });

  it('should keep wealth stealth fields independent from cash stealth fields', () => {
    const doc = new User({
      ...baseUser(),
      stealthEnabled: true,
      stealthSpendingPublic: 'WealthSpending111',
      cashStealthEnabled: true,
      cashStealthSpendingPublic: 'CashSpending11111',
    });
    expect(doc.stealthSpendingPublic).toBe('WealthSpending111');
    expect(doc.cashStealthSpendingPublic).toBe('CashSpending11111');
    expect(doc.validateSync()).toBeUndefined();
  });
});
