/**
 * StealthController — Routes HTTP pour les stealth addresses.
 *
 * Requirements : 1.5, 2.7, 3.6, 4.2, 4.3, 4.5, 5.5
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { stripProdError } from '../utils/logger';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { StealthAddressService } from '../services/stealth/stealth-address.service';
import { stealthCryptoService } from '../services/stealth/stealth-crypto.service';
import { StealthTransferService } from '../services/stealth/stealth-transfer.service';
import { StealthScannerService } from '../services/stealth/stealth-scanner.service';
import { StealthBalanceService } from '../services/stealth/stealth-balance.service';
import { StealthPayment } from '../models/StealthPayment';
import { User } from '../models/User';
import { signAndSendCashWalletTransaction } from '../services/auth/turnkeySign.service';
import { awardPoints } from '../services/points.service';

const POOL_PDA = new PublicKey('25MjNuRJiMhRgnGobfndBQQqehu5GhdZ1Ts4xyPYfTWj');

const stealthAddressService = new StealthAddressService();
const stealthTransferService = new StealthTransferService();
const stealthScannerService = new StealthScannerService();
const stealthBalanceService = new StealthBalanceService();

// --- Schemas Zod ---

const registerSchema = z.object({
  viewingPublicKey: z.string().min(32),
  viewingPrivateKeyHex: z.string().min(64).max(64),
  spendingPublicKey: z.string().min(32),
});

const buildTransferSchema = z.object({
  recipientMetaAddress: z.string().min(64),
  amountLamports: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  senderPublicKey: z.string().min(32).optional(), // override JWT default (ex: cash_wallet)
});

const registerPaymentSchema = z.object({
  stealthAddress: z.string().min(32),
  amountLamports: z.string().regex(/^\d+$/),
  txSignature: z.string().min(64),
  ephemeralR: z.string().min(32),
  viewTag: z.number().int().min(0).max(255),
  walletType: z.enum(['wealth', 'cash']).optional().default('wealth'),
});


const poolMooveSchema = z.object({
  fromWallet: z.string().min(32),
  toWallet: z.string().min(32),
  lamports: z.number().int().positive(),
});

const spendPrepareSchema = z.object({
  paymentId: z.string().min(1),
  destinationAddress: z.string().min(32),
});

const spendConfirmSchema = z.object({
  paymentId: z.string().min(1),
  txSignature: z.string().min(64),
});

const routeStealthSchema = z.object({
  tx1Signature: z.string().min(64),
  stealthAddress: z.string().min(32),
  ephemeralR: z.string().min(32),
  viewTag: z.number().int().min(0).max(255),
  viewingPubKeyB58: z.string().min(32),
});

// Schema partagé pour l'enregistrement wealth et cash (mêmes champs)
const registerCashSchema = z.object({
  viewingPublicKey: z.string().min(32),
  viewingPrivateKeyHex: z.string().min(64).max(64),
  spendingPublicKey: z.string().min(32),
});

// --- Handlers ---

export class StealthController {
  /**
   * POST /api/stealth/register-cash
   * Enregistre la viewing key et la spending key du cash wallet.
   */
  static async registerCash(req: Request, res: Response) {
    try {
      const parsed = registerCashSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const userId = req.user!.userId;
      const result = await stealthAddressService.registerCashViewingKey(userId, parsed.data);
      return res.status(201).json({ metaAddress: result.metaAddress });
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(409).json({ error: 'Cash stealth already registered' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stealth/cash/meta-address
   * Retourne la meta-adresse publique du cash wallet de l'utilisateur.
   */
  static async getCashMetaAddress(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const result = await stealthAddressService.getCashMetaAddress(userId);
      if (!result) {
        return res.status(404).json({ error: 'Cash stealth address not registered' });
      }
      return res.json({ metaAddress: result.metaAddress });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stealth/meta-address
   * Retourne la meta-adresse publique de l'utilisateur authentifié.
   */
  static async getMetaAddress(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const result = await stealthAddressService.getMetaAddress(userId);
      if (!result) {
        return res.status(404).json({ error: 'Stealth address not registered' });
      }
      // Ne jamais retourner la viewing private key
      return res.json({ metaAddress: result.metaAddress });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stealth/cash/balance
   * Retourne le solde cash unifié : adresse principale + UTXOs stealth spendable.
   */
  static async getCashBalance(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const result = await stealthBalanceService.getCashBalance(userId, user.cash_wallet);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/cash/scan
   * Déclenche un scan immédiat des UTXOs stealth cash pour l'utilisateur.
   */
  static async scanCash(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const user = await User.findById(userId);
      if (!user || !user.cashStealthEnabled) {
        return res.status(404).json({ error: 'Cash stealth not registered' });
      }
      const result = await stealthScannerService.scanCashForUser(user as any);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/register
   * Enregistre la viewing key et la spending key pour l'utilisateur.
   */
  static async register(req: Request, res: Response) {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const userId = req.user!.userId;
      const result = await stealthAddressService.registerViewingKey(userId, parsed.data);
      return res.status(201).json({ metaAddress: result.metaAddress });
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(409).json({ error: 'Stealth already registered' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stealth/wealth/balance
   * Returns spendable stealth UTXOs for the wealth wallet.
   */
  static async getWealthBalance(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const spendablePayments = await StealthPayment.find({
        userId,
        walletType: 'wealth',
        status: 'spendable',
      }).lean();

      let stealthBalance = 0;
      for (const p of spendablePayments) {
        stealthBalance += Number.parseInt(p.amountLamports, 10);
      }

      return res.json({
        stealthBalance,
        stealthPayments: spendablePayments.map((p) => ({
          _id: String(p._id),
          stealthAddress: p.stealthAddress,
          amountLamports: p.amountLamports,
          txSignature: p.txSignature,
          ephemeralR: p.ephemeralR,
          status: 'spendable' as const,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stealth/incoming
   * Retourne les paiements stealth entrants de l'utilisateur, triés par detectedAt desc.
   */
  static async getIncoming(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const payments = await StealthPayment.find({ userId })
        .sort({ detectedAt: -1 })
        .lean();
      // Ne jamais exposer ephemeralR ou viewTag en clair dans la liste publique
      const sanitized = payments.map((p) => ({
        _id: p._id,
        stealthAddress: p.stealthAddress,
        amountLamports: p.amountLamports,
        txSignature: p.txSignature,
        detectedAt: p.detectedAt,
        status: p.status,
        spentAt: p.spentAt,
      }));
      return res.json({ payments: sanitized });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/build-transfer
   * Construit une TX de transfert stealth non-signée.
   */
  static async buildTransfer(req: Request, res: Response) {
    console.log('[StealthController] buildTransfer called, userId:', req.user?.userId, 'body keys:', Object.keys(req.body));
    try {
      const parsed = buildTransferSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log('[StealthController] buildTransfer validation error:', parsed.error.flatten().fieldErrors);
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const senderPublicKey = parsed.data.senderPublicKey || (req.user!.publicKey as string);
      const amountLamports = BigInt(parsed.data.amountLamports);

      const result = await stealthTransferService.buildTransferTx({
        senderPublicKey,
        recipientMetaAddress: parsed.data.recipientMetaAddress,
        amountLamports,
      });

      const { viewingPub } = stealthCryptoService.parseMetaAddress(parsed.data.recipientMetaAddress);
      const viewingPubKeyB58 = bs58.encode(viewingPub);
      const viewTagHex = result.viewTag.toString(16).padStart(2, '0');
      const memo = `stealth:v1:${result.ephemeralR}:${viewTagHex}`;

      const pointsEarned = await awardPoints(req.user!.userId, 'private transfer');
      return res.json({
        serializedTx: result.serializedTx,
        stealthAddress: result.stealthAddress,
        ephemeralR: result.ephemeralR,
        viewTag: result.viewTag,
        viewingPubKeyB58,
        memo,
        pointsEarned,
      });
    } catch (err: any) {
      if (err?.message?.includes('parseMetaAddress') || err?.message?.includes('base58')) {
        return res.status(400).json({ error: 'Invalid meta-address format' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/build-and-send-cash
   * Construit, signe (Turnkey) et envoie la TX stealth en un seul appel.
   * Réservé au Cash wallet — évite 1 round-trip HTTP vs build-transfer + sign-and-send.
   */
  static async buildAndSendCash(req: Request, res: Response) {
    try {
      const parsed = buildTransferSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      }

      const mongoUserId = (req as any).user?.mongoUserId;
      const user = await User.findById(mongoUserId);
      if (!user?.turnkey_subOrgId) {
        return res.status(400).json({ error: 'No Turnkey sub-organization found' });
      }

      const senderPublicKey = parsed.data.senderPublicKey || user.cash_wallet || (req.user!.publicKey as string);
      const amountLamports = BigInt(parsed.data.amountLamports);

      const { serializedTx, stealthAddress, ephemeralR, viewTag } = await stealthTransferService.buildTransferTx({
        senderPublicKey,
        recipientMetaAddress: parsed.data.recipientMetaAddress,
        amountLamports,
      });

      const txHex = Buffer.from(serializedTx, 'base64').toString('hex');
      const txSignature = await signAndSendCashWalletTransaction(
        user.turnkey_subOrgId,
        txHex,
        user.cash_wallet || undefined
      );

      const pointsEarned = await awardPoints(req.user!.userId, 'private transfer');
      return res.json({ txSignature, stealthAddress, ephemeralR, viewTag, pointsEarned });
    } catch (err: any) {
      if (err?.message?.includes('parseMetaAddress') || err?.message?.includes('base58')) {
        return res.status(400).json({ error: 'Invalid meta-address format' });
      }
      return res.status(500).json({ error: stripProdError(err?.message) || 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/spend/prepare
   * Prépare une TX de dépense stealth non-signée.
   */
  static async spendPrepare(req: Request, res: Response) {
    console.log('[StealthController] spendPrepare called, userId:', req.user?.userId, 'paymentId:', req.body?.paymentId);
    try {
      const parsed = spendPrepareSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const result = await stealthTransferService.buildSpendTx({
        paymentId: parsed.data.paymentId,
        destinationAddress: parsed.data.destinationAddress,
      });
      return res.json({
        serializedUnsignedTx: result.serializedUnsignedTx,
        ephemeralR: result.ephemeralR,
        stealthAddress: result.stealthAddress,
      });
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      if (err?.statusCode === 422) {
        return res.status(422).json({ error: 'Payment already spent' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }


  /**
   * POST /api/stealth/register-payment
   * Enregistre directement un paiement stealth après envoi de la TX.
   * Évite d'attendre le scanner blockchain — le paiement est immédiatement claimable.
   */
  static async registerPayment(req: Request, res: Response) {
    console.log('[StealthController] registerPayment called, userId:', req.user?.userId, 'stealthAddress:', req.body?.stealthAddress?.slice(0, 8));
    try {
      const parsed = registerPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const userId = req.user!.userId;
      const { stealthAddress, amountLamports, txSignature, ephemeralR, viewTag, walletType } = parsed.data;

      // Upsert : si la TX a déjà été détectée par le scanner, ne pas dupliquer
      const existing = await StealthPayment.findOne({ userId, txSignature });
      if (existing) {
        return res.json({ paymentId: existing._id, alreadyExists: true });
      }

      const payment = await StealthPayment.create({
        userId,
        stealthAddress,
        amountLamports,
        txSignature,
        ephemeralR,
        viewTag,
        walletType,
        detectedAt: new Date(),
        status: 'spendable',
      });

      return res.status(201).json({ paymentId: payment._id });
    } catch (err: any) {
      if (err?.code === 11000) {
        // Duplicate key (userId + txSignature) — la TX est déjà enregistrée
        const existing = await StealthPayment.findOne({ userId: req.user!.userId, txSignature: req.body.txSignature });
        return res.json({ paymentId: existing?._id, alreadyExists: true });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/pool-moove
   * Transfère SOL entre wallets via le Privacy Pool — casse le lien on-chain.
   * TX1: fromWallet → Pool PDA (signé Turnkey)
   * TX2: Pool PDA → toWallet (signé pool authority)
   * Aucun compte commun visible entre les deux TX.
   */
  static async poolMoove(req: Request, res: Response) {
    try {
      const parsed = poolMooveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      }

      const mongoUserId = (req as any).user?.mongoUserId;
      const user = await User.findById(mongoUserId);
      if (!user?.turnkey_subOrgId) {
        return res.status(400).json({ error: 'No Turnkey sub-organization found' });
      }

      const { fromWallet, toWallet, lamports } = parsed.data;
      const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

      // TX1 : fromWallet → Pool PDA
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const depositTx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: new PublicKey(fromWallet),
      }).add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(fromWallet),
          toPubkey: POOL_PDA,
          lamports,
        })
      );

      const txHex = depositTx.serialize({ requireAllSignatures: false }).toString('hex');
      const depositSig = await signAndSendCashWalletTransaction(user.turnkey_subOrgId, txHex, fromWallet);
      console.log(`[PoolMoove] TX1 deposit: ${depositSig}`);

      // Attendre confirmation TX1 avant de lancer TX2
      await connection.confirmTransaction(depositSig, 'confirmed');

      // TX2 : Pool Authority → toWallet (SystemProgram.transfer signé par la pool authority)
      // Note : le lien on-chain est cassé car Pool Authority ≠ Pool PDA ≠ fromWallet
      const poolAuthorityPrivKey = process.env.POOL_AUTHORITY_PRIVATE_KEY!;
      let authorityKeypair: Keypair;
      try {
        authorityKeypair = Keypair.fromSecretKey(bs58.decode(poolAuthorityPrivKey));
      } catch {
        authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(poolAuthorityPrivKey)));
      }

      const { blockhash: blockhash2 } = await connection.getLatestBlockhash('confirmed');
      const withdrawTx = new Transaction({
        recentBlockhash: blockhash2,
        feePayer: authorityKeypair.publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: authorityKeypair.publicKey,
          toPubkey: new PublicKey(toWallet),
          lamports,
        })
      );
      withdrawTx.sign(authorityKeypair);
      const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize());
      await connection.confirmTransaction(withdrawSig, 'confirmed');
      console.log(`[PoolMoove] TX2 withdraw: ${withdrawSig}`);

      return res.json({
        depositTxSignature: depositSig,
        withdrawTxSignature: withdrawSig,
      });
    } catch (err: any) {
      console.error('[PoolMoove] Error:', err?.message);
      return res.status(500).json({ error: stripProdError(err?.message) || 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/scan
   * Déclenche un scan immédiat pour l'utilisateur authentifié.
   * Utile pour détecter les paiements sans attendre le job 60s.
   */
  static async scan(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const user = await User.findById(userId).lean();
      if (!user || !user.stealthEnabled || !user.stealthViewingPrivateEnc) {
        return res.json({ detected: 0, scanned: 0 });
      }
      const result = await stealthScannerService.scanForUser(user as any);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Scan failed' });
    }
  }

  /**
   * POST /api/stealth/spend/confirm
   * Confirme qu'une TX de dépense a été soumise on-chain.
   */
  static async spendConfirm(req: Request, res: Response) {
    try {
      const parsed = spendConfirmSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      await stealthTransferService.confirmSpend(parsed.data.paymentId, parsed.data.txSignature);
      return res.json({ success: true });
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      if (err?.statusCode === 422) {
        return res.status(422).json({ error: 'Payment already spent' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/stealth/route-stealth
   * Étape 2 de l'authority-indirection stealth :
   *   - Vérifie que TX1 (user → authority) est confirmée on-chain
   *   - Envoie TX2 (authority → stealthAddress)
   */
  static async routeStealth(req: Request, res: Response) {
    try {
      const parsed = routeStealthSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      }

      const { tx1Signature, stealthAddress } = parsed.data;
      const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');

      // Vérifier TX1 confirmée
      const tx1 = await connection.getParsedTransaction(tx1Signature, { commitment: 'confirmed' });
      if (!tx1) {
        return res.status(400).json({ error: 'TX1 not confirmed or not found' });
      }
      if (tx1.meta?.err) {
        return res.status(400).json({ error: 'TX1 failed on-chain' });
      }

      // Calculer le montant reçu par l'authority (postBalance - preBalance)
      const authority = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.VAULT_AUTHORITY_PRIVATE_KEY!))
      );
      const authorityPubkey = authority.publicKey.toBase58();
      const keys = tx1.transaction.message.accountKeys;
      const authorityIdx = keys.findIndex((k: any) => k.pubkey.toBase58() === authorityPubkey);
      if (authorityIdx < 0) {
        return res.status(400).json({ error: 'Authority not found in TX1 accounts' });
      }
      const lamports =
        (tx1.meta?.postBalances?.[authorityIdx] ?? 0) -
        (tx1.meta?.preBalances?.[authorityIdx] ?? 0);
      if (lamports <= 0) {
        return res.status(400).json({ error: 'No lamports received by authority in TX1' });
      }

      // Construire et envoyer TX2 : authority → stealthAddress
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx2 = new Transaction({ recentBlockhash: blockhash, feePayer: authority.publicKey });
      tx2.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: new PublicKey(stealthAddress),
          lamports,
        })
      );
      tx2.sign(authority);
      const txSignature = await connection.sendRawTransaction(tx2.serialize());
      await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight });

      return res.json({ success: true, txSignature });
    } catch (err: any) {
      return res.status(500).json({ error: stripProdError(err?.message) || 'Internal server error' });
    }
  }
}
