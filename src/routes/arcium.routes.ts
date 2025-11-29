import express, { Request, Response } from 'express';
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { privacyPoolService } from '../services/privacy-pool.service.js';

const router = express.Router();

// ==========================================
// PRIVACY POOL ROUTES (Beta)
// ==========================================

/**
 * POST /arcium/pool/transfer
 *
 * Execute a private transfer via the privacy pool
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
 * POST /arcium/airdrop
 *
 * Request devnet airdrop for any wallet address
 */
router.post('/airdrop', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(walletAddress);
    } catch (error) {
      res.status(400).json({ error: 'Invalid wallet address' });
      return;
    }

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    console.log(`Requesting airdrop for: ${walletAddress}`);

    // Request 2 SOL airdrop
    const signature = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);

    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    // Get new balance
    const balance = await connection.getBalance(pubkey);

    console.log(`Airdrop successful! New balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    res.json({
      success: true,
      signature,
      balance: balance / LAMPORTS_PER_SOL,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (error: any) {
    console.error('Airdrop error:', error);

    let errorMessage = 'Airdrop failed';
    if (error.message?.includes('429') || error.message?.includes('rate')) {
      errorMessage = 'Rate limit reached. Try again in a few minutes.';
    } else if (error.message?.includes('airdrop')) {
      errorMessage = 'Airdrop limit reached for this address. Try again later.';
    }

    res.status(500).json({ error: errorMessage });
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
