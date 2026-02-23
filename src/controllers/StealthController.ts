/**
 * StealthController — Routes HTTP pour les stealth addresses.
 *
 * Requirements : 1.5, 2.7, 3.6, 4.2, 4.3, 4.5, 5.5
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { StealthAddressService } from '../services/stealth/stealth-address.service';
import { StealthTransferService } from '../services/stealth/stealth-transfer.service';
import { StealthScannerService } from '../services/stealth/stealth-scanner.service';
import { StealthPayment } from '../models/StealthPayment';
import { User } from '../models/User';
import { signAndSendCashWalletTransaction } from '../services/auth/turnkeySign.service';

const stealthAddressService = new StealthAddressService();
const stealthTransferService = new StealthTransferService();
const stealthScannerService = new StealthScannerService();

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
});


const spendPrepareSchema = z.object({
  paymentId: z.string().min(1),
  destinationAddress: z.string().min(32),
});

const spendConfirmSchema = z.object({
  paymentId: z.string().min(1),
  txSignature: z.string().min(64),
});

// --- Handlers ---

export class StealthController {
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

      return res.json({
        serializedTx: result.serializedTx,
        stealthAddress: result.stealthAddress,
        ephemeralR: result.ephemeralR,
        viewTag: result.viewTag,
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

      return res.json({ txSignature, stealthAddress, ephemeralR, viewTag });
    } catch (err: any) {
      if (err?.message?.includes('parseMetaAddress') || err?.message?.includes('base58')) {
        return res.status(400).json({ error: 'Invalid meta-address format' });
      }
      return res.status(500).json({ error: err?.message || 'Internal server error' });
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
      const { stealthAddress, amountLamports, txSignature, ephemeralR, viewTag } = parsed.data;

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
}
