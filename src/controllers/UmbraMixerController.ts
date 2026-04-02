/**
 * UmbraMixerController — Endpoints REST pour le Mixer Umbra.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { stripProdError } from '../utils/logger';
import { umbraClientService } from '../services/umbra/umbra-client.service';
import { accountInitService } from '../services/umbra/account-init.service';
import { umbraDepositService } from '../services/umbra/deposit.service';
import { umbraClaimService } from '../services/umbra/claim.service';
import { createUmbraSignerFromKeypair } from '../services/umbra/keypair-signer';
import { createTurnkeyUmbraSigner } from '../services/umbra/turnkey-umbra-signer.service';
import { Turnkey } from '@turnkey/sdk-server';
import { User } from '../models/User';

/**
 * Devnet uniquement : finance le wealth wallet depuis le pool authority (0.01 SOL)
 * pour qu'il puisse payer les TX fees de registration Umbra.
 */
async function ensureWealthWalletFunded(wealthAddress: string): Promise<void> {
  const network = process.env.UMBRA_NETWORK ?? 'devnet';
  if (network !== 'devnet') return;

  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(new PublicKey(wealthAddress));
  if (balance > 80_000_000) return; // déjà > 0.08 SOL

  const authoritySecret = process.env.POOL_AUTHORITY_PRIVATE_KEY;
  if (!authoritySecret) {
    console.warn('[UmbraMixer] POOL_AUTHORITY_PRIVATE_KEY absent — impossible de financer wealth wallet devnet');
    return;
  }

  let keyBytes: Uint8Array;
  if (authoritySecret.startsWith('[')) {
    keyBytes = new Uint8Array(JSON.parse(authoritySecret) as number[]);
  } else {
    keyBytes = bs58.decode(authoritySecret);
  }
  const authority = Keypair.fromSecretKey(keyBytes);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: new PublicKey(wealthAddress),
      lamports: 100_000_000, // 0.1 SOL
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`[UmbraMixer] Wealth wallet ${wealthAddress} financé (devnet): ${sig}`);
}

// -- Schemas Zod -----------------------------------------------------------------

const registerSchema = z.object({
  cashWalletPublicKey: z.string().min(32).max(44),
  wealthWalletPublicKey: z.string().min(32).max(44),
  wealthKeypairSecret: z.array(z.number().int().min(0).max(255)).length(64),
});

const depositSchema = z.object({
  fromWallet: z.enum(['cash', 'wealth']),
  toWallet: z.enum(['cash', 'wealth']),
  mint: z.string().min(32).max(44),
  amountLamports: z.number().int().positive(),
  // Obligatoire quand fromWallet='wealth' : SDK appelle signMessage pour dériver le master seed ZK
  wealthKeypairSecret: z.array(z.number().int().min(0).max(255)).length(64).optional(),
});

const submitSchema = z.object({
  signedTxBase64: z.string().min(1),
  generationIndex: z.string().min(1),
  mint: z.string().min(32).max(44),
  amountLamports: z.number().int().positive(),
  recipientWallet: z.enum(['cash', 'wealth']),
});

const claimSchema = z.object({
  artifactId: z.string().min(1),
});

// -- Helpers ---------------------------------------------------------------------

function getUserId(req: Request): string {
  return (req as any).user?.mongoUserId || req.user!.userId;
}

async function rejectIfUnavailable(res: Response): Promise<boolean> {
  const healthy = await umbraClientService.healthCheck();
  if (!healthy) {
    res.status(503).json({ fallback: true, reason: 'UMBRA_UNAVAILABLE' });
    return true;
  }
  return false;
}

async function rejectIfNotRegistered(userId: string, res: Response): Promise<boolean> {
  const user = await User.findById(userId).lean() as any;
  if (!user?.umbraRegisteredCash || !user?.umbraRegisteredWealth) {
    res.status(412).json({ error: 'UMBRA_NOT_REGISTERED' });
    return true;
  }
  return false;
}

// -- Controller ------------------------------------------------------------------

export class UmbraMixerController {
  /**
   * POST /api/umbra/mixer/register
   * Enregistre les wallets Cash et Wealth sur le programme Umbra.
   * Idempotent : retourne 200 si deja enregistre, 202 sinon.
   */
  static async register(req: Request, res: Response): Promise<void> {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
      return;
    }

    try {
      const userId = getUserId(req);
      const user = await User.findById(userId).lean() as any;

      // Idempotence : deja enregistre
      if (user?.umbraRegisteredCash && user?.umbraRegisteredWealth) {
        res.json({ alreadyRegistered: true });
        return;
      }

      const { cashWalletPublicKey, wealthWalletPublicKey, wealthKeypairSecret } = parsed.data;

      // Declencher la registration en arriere-plan (req 1.5 — 202 immediat)
      setImmediate(async () => {
        try {
          const wealthSigner = await createUmbraSignerFromKeypair(new Uint8Array(wealthKeypairSecret));

          let cashSigner;
          if (user?.turnkey_subOrgId) {
            const turnkey = new Turnkey({
              apiBaseUrl: 'https://api.turnkey.com',
              apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
              apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
              defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
            });
            cashSigner = await createTurnkeyUmbraSigner(
              turnkey.apiClient(),
              user.turnkey_subOrgId,
              cashWalletPublicKey,
            );
          } else {
            // Fallback lecture seule si pas de Turnkey (devrait pas arriver)
            cashSigner = { address: cashWalletPublicKey, signMessage: async () => { throw new Error('No Turnkey config'); }, signTransaction: async (tx: unknown) => tx, signTransactions: async (txs: unknown[]) => txs };
          }

          if (!user?.umbraRegisteredCash) {
            await accountInitService.registerWallet(userId, cashSigner, 'cash');
          }
          if (!user?.umbraRegisteredWealth) {
            // Debug : vérifier que l'adresse dérivée du keypair correspond au wallet stocké en DB
            const dbWealthWallet = (user as any)?.stealf_wallet ?? (user as any)?.privateWalletAddress;
            console.log('[UmbraMixer] wealth signer.address:', wealthSigner.address);
            console.log('[UmbraMixer] wealthWalletPublicKey (request):', wealthWalletPublicKey);
            console.log('[UmbraMixer] stealf_wallet (DB):', dbWealthWallet);
            if (wealthSigner.address !== wealthWalletPublicKey) {
              console.error('[UmbraMixer][MISMATCH] signer.address !== wealthWalletPublicKey — keypair wrong!');
            }
            // Devnet : s'assurer que le wealth wallet a du SOL pour payer les fees
            await ensureWealthWalletFunded(wealthSigner.address);
            await accountInitService.registerWallet(userId, wealthSigner, 'wealth');
          }
        } catch (e) {
          console.error('[UmbraMixer][RegisterFailed]', { userId, error: (e as Error).message });
        }
      });

      res.status(202).json({ status: 'pending' });
    } catch (err: any) {
      res.status(503).json({ error: 'Umbra SDK unavailable. Pending npm update.', fallback: true, reason: 'UMBRA_UNAVAILABLE' });
    }
  }

  /**
   * POST /api/umbra/mixer/deposit
   * Exécute le dépôt Mixer complet (ZK proof + sign + submit) via SDK Umbra.
   * Le SDK signe et soumet automatiquement — retourne directement txSignature.
   * Pour wealth: wealthKeypairSecret obligatoire (SDK appelle signMessage + signTransaction).
   */
  static async deposit(req: Request, res: Response): Promise<void> {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
      return;
    }

    try {
      const userId = getUserId(req);

      if (await rejectIfNotRegistered(userId, res)) return;

      const { fromWallet, toWallet, mint, amountLamports, wealthKeypairSecret } = parsed.data;

      let signer: any;
      if (fromWallet === 'wealth') {
        if (!wealthKeypairSecret) {
          res.status(400).json({ error: 'wealthKeypairSecret required for wealth deposit' });
          return;
        }
        signer = await createUmbraSignerFromKeypair(new Uint8Array(wealthKeypairSecret));
      } else {
        // Cash wallet : Turnkey signer
        const user = await User.findById(userId).lean() as any;
        if (!user?.turnkey_subOrgId) {
          res.status(400).json({ error: 'Turnkey not configured for this user' });
          return;
        }
        const turnkey = new Turnkey({
          apiBaseUrl: 'https://api.turnkey.com',
          apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
          apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
          defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
        });
        signer = await createTurnkeyUmbraSigner(
          turnkey.apiClient(),
          user.turnkey_subOrgId,
          user.cash_wallet,
        );
      }

      const result = await umbraDepositService.executeDeposit(
        userId,
        { fromWallet, toWallet, mint, amountLamports: BigInt(amountLamports) },
        signer,
        (uid, artifactId) => umbraClaimService.triggerClaim(uid, artifactId),
      );

      res.json({ txSignature: result.txSignature });
    } catch (err: any) {
      if (err?.message?.includes('INSUFFICIENT_BALANCE')) {
        res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });
        return;
      }
      res.status(503).json({ error: 'Umbra SDK unavailable. Pending npm update.', fallback: true, reason: 'UMBRA_UNAVAILABLE' });
    }
  }

  /**
   * POST /api/umbra/mixer/submit — DEPRECATED
   * Le SDK v1.0.0 signe+soumet automatiquement via /deposit.
   */
  static async submit(req: Request, res: Response): Promise<void> {
    res.status(410).json({ error: 'DEPRECATED: use /deposit directly — SDK auto-signs and submits' });
  }

  /**
   * GET /api/umbra/mixer/utxos
   * Retourne les UTXOs non claimed de l'utilisateur (artifacts + balances dechiffrees).
   */
  static async getUtxos(req: Request, res: Response): Promise<void> {
    try {
      const userId = getUserId(req);
      const artifacts = await umbraClaimService.scanUtxos(userId);
      res.json({ artifacts });
    } catch (err: any) {
      res.status(503).json({ error: 'Umbra SDK unavailable. Pending npm update.', fallback: true, reason: 'UMBRA_UNAVAILABLE' });
    }
  }

  /**
   * POST /api/umbra/mixer/cash-deposit-submit
   * Dépôt Cash wallet via Turnkey signer — SDK signe+soumet automatiquement.
   * Délègue vers /deposit avec Turnkey signer (req 5.3).
   */
  static async cashDepositSubmit(req: Request, res: Response): Promise<void> {
    // Le /deposit endpoint gère maintenant cash ET wealth via le bon signer
    return UmbraMixerController.deposit(req, res);
  }

  /**
   * POST /api/umbra/mixer/claim
   * Declenche un claim manuel sur un artifact en pending_retry.
   */
  static async manualClaim(req: Request, res: Response): Promise<void> {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
      return;
    }

    try {
      const userId = getUserId(req);
      const result = await umbraClaimService.manualClaim(userId, parsed.data.artifactId);
      res.json({ claimTxSignature: result.claimTxSignature });
    } catch (err: any) {
      if (err?.message?.includes('not found') || err?.message?.includes('processing')) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(503).json({ error: 'Umbra SDK unavailable. Pending npm update.', fallback: true, reason: 'UMBRA_UNAVAILABLE' });
    }
  }
}
