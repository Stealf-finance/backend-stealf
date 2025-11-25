import express, { Request, Response } from 'express';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

const x25519 = ed25519.x25519;
import { encryptedTransferService } from '../services/arcium/encrypted-transfer.service.js';
import { privacyPoolService } from '../services/privacy-pool.service.js';
import { ARCIUM_CONFIG } from '../config/arcium.config.js';

const router = express.Router();


// ==========================================
// PRIVACY POOL ROUTES (Beta - Link Breaking)
// ==========================================

/**
 * POST /arcium/pool/transfer
 *
 * Execute a private transfer via the privacy pool.
 * This breaks the on-chain link between sender and recipient.
 *
 * Body:
 * - fromPrivateKey: Base58-encoded sender's private key (public wallet)
 * - toAddress: Recipient's Solana address (private wallet)
 * - amount: Amount in SOL
 *
 * Returns:
 * - Two transaction signatures (deposit + withdraw)
 * - No on-chain link between sender and recipient!
 */
router.post('/pool/transfer', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromPrivateKey, toAddress, amount } = req.body;

    // Validation
    if (!fromPrivateKey) {
      res.status(400).json({ error: 'fromPrivateKey is required' });
      return;
    }
    if (!toAddress) {
      res.status(400).json({ error: 'toAddress is required' });
      return;
    }
    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Valid amount is required' });
      return;
    }

    // Parse sender keypair
    let senderKeypair: Keypair;
    try {
      const privateKeyBytes = bs58.decode(fromPrivateKey);
      senderKeypair = Keypair.fromSecretKey(privateKeyBytes);
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

    const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));

    console.log(`\n🔒 Private pool transfer request: ${amount} SOL`);
    console.log(`   From (public): ${senderKeypair.publicKey.toBase58()}`);
    console.log(`   To (private): ${recipientPubkey.toBase58()}`);

    // Check if service is ready
    if (!privacyPoolService.isReady()) {
      res.status(503).json({ error: 'Privacy pool service not ready' });
      return;
    }

    // Execute private transfer
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
          visible: 'Sender → Pool',
        },
        withdraw: {
          signature: result.withdrawSignature,
          explorer: `https://explorer.solana.com/tx/${result.withdrawSignature}?cluster=devnet`,
          visible: 'Pool → Recipient',
        },
      },
      pool: result.poolAddress,
      amount: {
        sol: amount,
        lamports: amountLamports.toString(),
      },
    });
  } catch (error: any) {
    console.error('❌ Pool transfer error:', error);
    res.status(500).json({
      error: error.message || 'Failed to execute private transfer',
    });
  }
});

/**
 * GET /arcium/pool/info
 *
 * Get privacy pool information
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
    console.error('❌ Pool info error:', error);
    res.status(500).json({
      error: error.message || 'Failed to get pool info',
    });
  }
});

/**
 * POST /arcium/pool/deposit
 *
 * Build a deposit instruction (for client-side signing)
 */
router.post('/pool/deposit/build', async (req: Request, res: Response): Promise<void> => {
  try {
    const { senderAddress, amount } = req.body;

    if (!senderAddress || !amount) {
      res.status(400).json({ error: 'senderAddress and amount are required' });
      return;
    }

    const senderPubkey = new PublicKey(senderAddress);
    const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));

    const instruction = privacyPoolService.buildDepositInstruction(senderPubkey, amountLamports);

    res.json({
      success: true,
      instruction: {
        programId: instruction.programId.toBase58(),
        keys: instruction.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: instruction.data.toString('base64'),
      },
    });
  } catch (error: any) {
    console.error('❌ Build deposit error:', error);
    res.status(500).json({
      error: error.message || 'Failed to build deposit instruction',
    });
  }
});

export default router;
