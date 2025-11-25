import express, { Request, Response } from 'express';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { x25519 } from '@noble/curves/ed25519.js';
import { encryptedTransferService } from '../services/arcium/encrypted-transfer.service.js';
import { privacyPoolService } from '../services/privacy-pool.service.js';
import { ArciumTransfer } from '../models/arcium-transfer.model.js';

const router = express.Router();

/**
 * GET /arcium/info
 *
 * Get Arcium service information
 */
router.get('/info', async (req: Request, res: Response): Promise<void> => {
  try {
    const info = encryptedTransferService.getInfo();
    res.json({
      success: true,
      ...info,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /arcium/init
 *
 * Initialize Arcium CompDef (one-time setup required before any transfers)
 *
 * Body:
 * - payerPrivateKey: Base58-encoded private key of account that will pay for initialization
 */
router.post('/init', async (req: Request, res: Response): Promise<void> => {
  try {
    const { payerPrivateKey } = req.body;

    if (!payerPrivateKey) {
      res.status(400).json({ error: 'payerPrivateKey is required' });
      return;
    }

    let payerKeypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(payerPrivateKey);
      payerKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      res.status(400).json({ error: 'Invalid private key format' });
      return;
    }

    console.log(`🔧 Initializing Arcium CompDef from: ${payerKeypair.publicKey.toBase58()}`);

    const signature = await encryptedTransferService.initializeCompDef(payerKeypair);

    res.json({
      success: true,
      signature,
      message: signature === 'already_initialized'
        ? 'Arcium CompDef already initialized'
        : 'Arcium CompDef initialized successfully',
    });
  } catch (error: any) {
    console.error('❌ Init error:', error);
    res.status(500).json({
      error: error.message || 'Failed to initialize Arcium',
    });
  }
});

/**
 * POST /arcium/transfer/encrypted
 *
 * Create an encrypted private transfer where the amount is hidden via Arcium MPC
 *
 * Body:
 * - fromPrivateKey: Base58-encoded sender's private key
 * - toAddress: Recipient's Solana address
 * - amount: Amount in SOL (will be encrypted)
 * - userId: Optional user ID for tracking
 */
router.post('/transfer/encrypted', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromPrivateKey, toAddress, amount, userId } = req.body;

    // Validation
    if (!fromPrivateKey) {
      res.status(400).json({ error: 'fromPrivateKey is required' });
      return;
    }
    if (!toAddress) {
      res.status(400).json({ error: 'toAddress is required' });
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'Valid positive amount is required' });
      return;
    }

    // Check service is ready
    if (!encryptedTransferService.isReady()) {
      res.status(503).json({ error: 'Encrypted transfer service not ready' });
      return;
    }

    // Parse sender keypair
    let fromKeypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(fromPrivateKey);
      fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      res.status(400).json({ error: 'Invalid private key format' });
      return;
    }

    // Parse recipient address
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(toAddress);
    } catch (error) {
      res.status(400).json({ error: 'Invalid recipient address' });
      return;
    }

    // Convert SOL to lamports
    const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));

    console.log(`🔐 Encrypted transfer request: ${amount} SOL`);

    // Create encrypted transfer
    const result = await encryptedTransferService.createEncryptedTransfer({
      fromKeypair,
      toAddress: recipientPubkey,
      amount: amountLamports,
      userId,
    });

    res.json({
      success: true,
      message: '🔐 Transfer queued to Arcium MPC - amount is encrypted',
      transfer: {
        signature: result.signature,
        sender: fromKeypair.publicKey.toBase58(),
        recipient: recipientPubkey.toBase58(),
        computationOffset: result.computationOffset,
      },
      encryption: {
        encryptedAmount: Buffer.from(result.encryptedAmount).toString('hex'),
        nonce: Buffer.from(result.nonce).toString('hex'),
        publicKey: Buffer.from(result.publicKey).toString('hex'),
      },
      privacy: {
        amountVisible: false,
        amountEncrypted: true,
        mpcProcessing: true,
      },
      explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
    });
  } catch (error: any) {
    console.error('❌ Encrypted transfer error:', error);
    res.status(500).json({
      error: error.message || 'Failed to create encrypted transfer',
    });
  }
});

/**
 * GET /arcium/transfer/status
 *
 * Get status of an encrypted transfer (check if MPC computation completed)
 *
 * Query:
 * - sender: Sender's public key
 * - computationOffset: Computation offset from transfer
 */
router.get('/transfer/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sender, computationOffset } = req.query;

    if (!sender || !computationOffset) {
      res.status(400).json({ error: 'sender and computationOffset are required' });
      return;
    }

    const senderPubkey = new PublicKey(sender as string);
    const offset = new BN(computationOffset as string);

    const status = await encryptedTransferService.getTransferStatus(senderPubkey, offset);

    res.json({
      success: true,
      ...status,
    });
  } catch (error: any) {
    console.error('❌ Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /arcium/transfer/wait
 *
 * Wait for MPC computation to complete
 *
 * Body:
 * - sender: Sender's public key
 * - computationOffset: Computation offset
 * - timeout: Optional timeout in ms (default 60000)
 */
router.post('/transfer/wait', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sender, computationOffset, timeout = 60000 } = req.body;

    if (!sender || !computationOffset) {
      res.status(400).json({ error: 'sender and computationOffset are required' });
      return;
    }

    const senderPubkey = new PublicKey(sender);
    const offset = new BN(computationOffset);

    console.log(`⏳ Waiting for MPC computation...`);

    const result = await encryptedTransferService.waitForCompletion(senderPubkey, offset, timeout);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('❌ Wait error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /arcium/transfer/decrypt
 *
 * Decrypt a received encrypted transfer amount
 *
 * Body:
 * - encryptedAmount: Hex-encoded encrypted amount
 * - nonce: Hex-encoded nonce
 * - senderPublicKey: Hex-encoded sender's x25519 public key
 * - recipientPrivateKey: Hex-encoded recipient's x25519 private key
 */
router.post('/transfer/decrypt', async (req: Request, res: Response): Promise<void> => {
  try {
    const { encryptedAmount, nonce, senderPublicKey, recipientPrivateKey } = req.body;

    if (!encryptedAmount || !nonce || !senderPublicKey || !recipientPrivateKey) {
      res.status(400).json({
        error: 'encryptedAmount, nonce, senderPublicKey, and recipientPrivateKey are required',
      });
      return;
    }

    const encryptedAmountBytes = new Uint8Array(Buffer.from(encryptedAmount, 'hex'));
    const nonceBytes = new Uint8Array(Buffer.from(nonce, 'hex'));
    const senderPubkeyBytes = new Uint8Array(Buffer.from(senderPublicKey, 'hex'));
    const recipientPrivateKeyBytes = new Uint8Array(Buffer.from(recipientPrivateKey, 'hex'));

    const decryptedAmount = encryptedTransferService.decryptAmount({
      encryptedAmount: encryptedAmountBytes,
      nonce: nonceBytes,
      senderPublicKey: senderPubkeyBytes,
      recipientPrivateKey: recipientPrivateKeyBytes,
    });

    const amountSOL = Number(decryptedAmount) / LAMPORTS_PER_SOL;

    res.json({
      success: true,
      decrypted: {
        amountLamports: decryptedAmount.toString(),
        amountSOL,
      },
    });
  } catch (error: any) {
    console.error('❌ Decryption error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /arcium/transfers/:userId
 *
 * Get all encrypted transfers for a user (from database)
 */
router.get('/transfers/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const transfers = await ArciumTransfer.find({ userId }).sort({ timestamp: -1 });

    res.json({
      success: true,
      count: transfers.length,
      transfers: transfers.map((t) => ({
        id: t._id,
        sender: t.sender,
        recipient: t.recipient,
        status: t.status,
        timestamp: t.timestamp,
        computationOffset: t.computationOffset,
        signature: t.computationSignature,
      })),
    });
  } catch (error: any) {
    console.error('❌ Get transfers error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /arcium/received/:address
 *
 * Get all encrypted transfers received by an address
 */
router.get('/received/:address', async (req: Request, res: Response): Promise<void> => {
  try {
    const { address } = req.params;

    const transfers = await ArciumTransfer.find({ recipient: address }).sort({ timestamp: -1 });

    res.json({
      success: true,
      count: transfers.length,
      transfers: transfers.map((t) => ({
        id: t._id,
        sender: t.sender,
        status: t.status,
        timestamp: t.timestamp,
        encryption: {
          encryptedAmount: t.encryptedAmount.toString('hex'),
          nonce: t.nonce.toString('hex'),
          senderPublicKey: t.senderPublicKey.toString('hex'),
        },
      })),
    });
  } catch (error: any) {
    console.error('❌ Get received transfers error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /arcium/stats
 *
 * Get encrypted transfers statistics
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await encryptedTransferService.getStats();

    res.json({
      success: true,
      ...stats,
      privacy: {
        amountsEncrypted: true,
        totalVolumeHidden: true,
      },
    });
  } catch (error: any) {
    console.error('❌ Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /arcium/keypair/generate
 *
 * Generate a new x25519 keypair for encryption
 */
router.post('/keypair/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const privateKey = x25519.utils.randomPrivateKey();
    const publicKey = x25519.getPublicKey(privateKey);

    res.json({
      success: true,
      keypair: {
        privateKey: Buffer.from(privateKey).toString('hex'),
        publicKey: Buffer.from(publicKey).toString('hex'),
      },
      warning: '⚠️ Keep your private key secret! It\'s needed to decrypt amounts.',
    });
  } catch (error: any) {
    console.error('❌ Keypair generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PRIVACY POOL ROUTES (Fallback)
// ==========================================

/**
 * POST /arcium/pool/transfer
 *
 * Execute a private transfer via the privacy pool (fallback if Arcium unavailable)
 */
router.post('/pool/transfer', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromPrivateKey, toAddress, amount } = req.body;

    if (!fromPrivateKey || !toAddress || !amount || amount <= 0) {
      res.status(400).json({ error: 'fromPrivateKey, toAddress, and valid amount are required' });
      return;
    }

    let senderKeypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(fromPrivateKey);
      senderKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      res.status(400).json({ error: 'Invalid private key format' });
      return;
    }

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(toAddress);
    } catch (error) {
      res.status(400).json({ error: 'Invalid recipient address' });
      return;
    }

    if (!privacyPoolService.isReady()) {
      res.status(503).json({ error: 'Privacy pool service not ready' });
      return;
    }

    const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));

    const result = await privacyPoolService.createPrivateTransfer({
      senderKeypair,
      recipientPubkey,
      amount: amountLamports,
    });

    res.json({
      success: true,
      privacy: {
        method: 'pool',
        linkBroken: true,
        description: 'No direct on-chain link between sender and recipient',
      },
      transactions: {
        deposit: {
          signature: result.depositSignature,
          explorer: `https://explorer.solana.com/tx/${result.depositSignature}?cluster=devnet`,
        },
        withdraw: {
          signature: result.withdrawSignature,
          explorer: `https://explorer.solana.com/tx/${result.withdrawSignature}?cluster=devnet`,
        },
      },
      pool: result.poolAddress,
    });
  } catch (error: any) {
    console.error('❌ Pool transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /arcium/pool/info
 */
router.get('/pool/info', async (req: Request, res: Response): Promise<void> => {
  try {
    const info = privacyPoolService.getPoolInfo();
    const balance = privacyPoolService.isReady()
      ? await privacyPoolService.getPoolBalance()
      : 0;

    res.json({
      success: true,
      pool: info,
      balance: {
        lamports: balance,
        sol: balance / LAMPORTS_PER_SOL,
      },
      status: privacyPoolService.isReady() ? 'ready' : 'not_initialized',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
