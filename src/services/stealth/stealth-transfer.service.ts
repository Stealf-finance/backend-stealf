/**
 * StealthTransferService — Construction des transactions Solana stealth.
 *
 * Flux smesh (1 TX directe) :
 *   TX : sender → stealthAddress  (+ memo stealth:v1:R:vt, référence = viewing pub key)
 *
 * Avantages :
 *   - 1 seule TX signée par l'user, pas d'authority à financer
 *   - Viewing pub key comme référence → scanning ciblé sans relay global
 *   - stealthAddress unlinkable au wallet principal du destinataire
 *
 * Requirements : 2.6, 2.7, 4.2, 4.5
 */

import {
  Transaction,
  TransactionInstruction,
  SystemProgram,
  PublicKey,
  Connection,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { stealthCryptoService } from './stealth-crypto.service';
import { MEMO_PROGRAM_ID, STEALTH_MEMO_PREFIX, getConnection } from './stealth.config';
import { StealthPayment } from '../../models/StealthPayment';

export class StealthTransferService {
  private getConnection(): Connection {
    return getConnection();
  }

  /**
   * Construit la TX stealth directe : sender → stealthAddress (approche smesh).
   *
   * La TX contient 2 instructions :
   *   1. SystemProgram.transfer : sender → stealthAddress
   *   2. MemoProgram : "stealth:v1:R:vt" avec viewing pub key comme référence
   *      → permet au scanner de trouver la TX via getSignaturesForAddress(viewingPubKey)
   *
   * L'user signe et soumet lui-même — pas d'authority, pas de 2ème TX.
   */
  async buildTransferTx(params: {
    senderPublicKey: string;
    recipientMetaAddress: string;
    amountLamports: bigint;
  }): Promise<{
    serializedTx: string;
    stealthAddress: string;
    ephemeralR: string;
    viewTag: number;
  }> {
    const { spendingPub, viewingPub } = stealthCryptoService.parseMetaAddress(
      params.recipientMetaAddress,
    );

    const { stealthAddress, ephemeralPub, viewTag } = stealthCryptoService.deriveStealthAddress({
      recipientSpendingPub: spendingPub,
      recipientViewingPub: viewingPub,
    });

    const ephemeralR = bs58.encode(ephemeralPub);
    const viewTagHex = viewTag.toString(16).padStart(2, '0');
    const memoData = `${STEALTH_MEMO_PREFIX}${ephemeralR}:${viewTagHex}`;

    const sender = new PublicKey(params.senderPublicKey);
    const stealthPubkey = new PublicKey(stealthAddress);
    const viewingRefKey = new PublicKey(viewingPub);
    const connection = this.getConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = sender;

    // 1. Transfert SOL vers l'adresse stealth
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: stealthPubkey,
        lamports: Number(params.amountLamports),
      }),
    );

    // 2. Mémo + viewing pub key comme référence — scanner trouve la TX via viewingPubKey
    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: viewingRefKey, isSigner: false, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memoData, 'utf-8'),
      }),
    );

    const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return { serializedTx, stealthAddress, ephemeralR, viewTag };
  }

  /**
   * Construit la transaction de dépense non-signée depuis une adresse stealth.
   * Le frontend signera avec p_stealth.
   */
  async buildSpendTx(params: {
    paymentId: string;
    destinationAddress: string;
  }): Promise<{ serializedUnsignedTx: string; ephemeralR: string; stealthAddress: string; amountLamports: string }> {
    const payment = await StealthPayment.findById(params.paymentId);
    if (!payment) {
      throw Object.assign(new Error('StealthPayment not found'), { statusCode: 404 });
    }
    if (payment.status === 'spent') {
      throw Object.assign(new Error('Payment already spent'), { statusCode: 422 });
    }
    if (payment.status !== 'spendable') {
      throw Object.assign(new Error('Payment not yet spendable'), { statusCode: 422 });
    }

    const stealthPubkey = new PublicKey(payment.stealthAddress);
    const destination = new PublicKey(params.destinationAddress);

    const connection = this.getConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = stealthPubkey;

    // Réserver ~5000 lamports pour les frais (feePayer = stealthPubkey)
    const FEE_BUFFER = 5000n;
    const amountRaw = BigInt(payment.amountLamports);
    const transferLamports = amountRaw > FEE_BUFFER ? amountRaw - FEE_BUFFER : amountRaw;

    tx.add(
      SystemProgram.transfer({
        fromPubkey: stealthPubkey,
        toPubkey: destination,
        lamports: Number(transferLamports),
      }),
    );

    const serializedUnsignedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      serializedUnsignedTx,
      ephemeralR: payment.ephemeralR,
      stealthAddress: payment.stealthAddress,
      amountLamports: payment.amountLamports,
    };
  }

  /**
   * Confirme une dépense en mettant à jour le statut du paiement.
   */
  async confirmSpend(paymentId: string, txSignature: string): Promise<void> {
    const payment = await StealthPayment.findById(paymentId);
    if (!payment) throw Object.assign(new Error('StealthPayment not found'), { statusCode: 404 });
    if (payment.status === 'spent') throw Object.assign(new Error('Payment already spent'), { statusCode: 422 });

    payment.status = 'spent';
    payment.spendTxSignature = txSignature;
    payment.spentAt = new Date();
    await payment.save();
  }
}

let instance: StealthTransferService | null = null;

export function getStealthTransferService(): StealthTransferService {
  if (!instance) instance = new StealthTransferService();
  return instance;
}
