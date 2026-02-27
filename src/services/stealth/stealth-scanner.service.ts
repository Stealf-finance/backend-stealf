/**
 * StealthScannerService — Job périodique de scanning Solana.
 *
 * Algorithme en 2 passes (v2 — viewing pub key comme relay unique par user) :
 *   1. Récupère les TXs récentes via getSignaturesForAddress(viewingPubKey)
 *      → chaque user a son propre canal — pas de relay global Stealf
 *   2. Filtre par memo stealth:v1: prefix
 *   3. Pour chaque TX : parse R + viewTag, appelle verifyStealthOwnership
 *   4. Si match : upsert StealthPayment (status spendable)
 *
 * Requirements : 3.1–3.7, 5.3, 5.5
 */

import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { stealthCryptoService } from './stealth-crypto.service';
import { StealthPayment } from '../../models/StealthPayment';
import { decryptToBytes } from '../../utils/encryption';
import { STEALTH_MEMO_PREFIX, getConnection } from './stealth.config';

interface ScanResult {
  detected: number;
  scanned: number;
  errors: number;
}

export class StealthScannerService {
  private scanInterval: NodeJS.Timeout | null = null;

  private getConnection(): Connection {
    return getConnection();
  }

  /**
   * Scanne les transactions stealth pour un utilisateur.
   * Retourne le nombre de paiements détectés.
   */
  async scanForUser(user: {
    _id: string | any;
    stealthSpendingPublic: string;
    stealthViewingPublic: string;
    stealthViewingPrivateEnc: string;
    lastStealthScanAt?: Date;
  }): Promise<ScanResult> {
    const result: ScanResult = { detected: 0, scanned: 0, errors: 0 };

    // Déchiffrer la viewing private key
    const viewingPriv = await this.decryptViewingKey(user.stealthViewingPrivateEnc);
    const spendingPub = new Uint8Array(bs58.decode(user.stealthSpendingPublic));

    // Récupérer les signatures via la viewing pub key de l'utilisateur (unique par user)
    let signatures: any[];
    try {
      const viewingPubKey = new PublicKey(bs58.decode(user.stealthViewingPublic));
      const connection = this.getConnection();
      signatures = await connection.getSignaturesForAddress(viewingPubKey, {
        limit: 100,
        // TODO: utiliser lastStealthScanAt pour la pagination incrémentale (V2)
      });
    } catch (err) {
      console.error('[Stealth] getSignaturesForAddress failed:', err);
      return result;
    }

    // Filtrer uniquement les TXs avec memo stealth:v1:
    const stealthSigs = signatures.filter(
      (sig) => sig.memo && sig.memo.startsWith(STEALTH_MEMO_PREFIX) && !sig.err,
    );

    for (const sig of stealthSigs) {
      result.scanned++;
      try {
        await this.processSignature(sig, user._id.toString(), spendingPub, viewingPriv);
        result.detected++; // incrémenté seulement si un paiement est détecté
      } catch (err) {
        // Erreur silencieuse par TX — log sans crash
        if ((err as any)?.isStealth !== true) {
          // Erreur inattendue
          result.errors++;
          console.error('[Stealth] processSignature error:', err);
        }
        // Si isStealth = true, c'est juste un "not matched" — pas une erreur
        // result.detected n'a PAS été incrémenté (incrémentation après processSignature réussie uniquement)
      }
    }

    return result;
  }

  /**
   * Traite une signature Solana : parse le memo, vérifie la propriété, upsert.
   * Lance une erreur marquée isStealth:true si ce n'est pas un paiement de l'utilisateur.
   */
  private async processSignature(
    sig: { signature: string; memo: string; blockTime: number | null },
    userId: string,
    spendingPub: Uint8Array,
    viewingPriv: Uint8Array,
    walletType: 'wealth' | 'cash' = 'wealth',
  ): Promise<void> {
    // Parse le memo : stealth:v1:<base58(R)>:<hex(viewTag)>
    const parts = sig.memo.replace(STEALTH_MEMO_PREFIX, '').split(':');
    if (parts.length < 2) {
      throw Object.assign(new Error('malformed memo'), { isStealth: true });
    }

    const [ephemeralR_b58, viewTagHex] = parts;
    const viewTag = parseInt(viewTagHex, 16);

    // Décoder la clé éphémère — erreur silencieuse si invalide (req 5.3)
    let ephemeralPub: Uint8Array;
    try {
      ephemeralPub = new Uint8Array(bs58.decode(ephemeralR_b58));
      if (ephemeralPub.length !== 32) throw new Error('bad length');
    } catch {
      // Memo malformé — ignorer sans crash (req 5.3)
      throw Object.assign(new Error('invalid ephemeral key'), { isStealth: true });
    }

    // Récupérer la TX pour obtenir l'adresse de destination et le montant
    const connection = this.getConnection();
    const parsedTx = await connection.getParsedTransaction(sig.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!parsedTx || parsedTx.meta?.err) {
      throw Object.assign(new Error('tx failed or not found'), { isStealth: true });
    }

    // Trouver la destination (non-signer avec balance croissante)
    const accountKeys: string[] = (parsedTx.transaction.message as any).accountKeys.map(
      (k: any) => (typeof k.pubkey?.toBase58 === 'function' ? k.pubkey.toBase58() : k.pubkey?.toString() ?? k),
    );
    const preBalances: number[] = parsedTx.meta!.preBalances;
    const postBalances: number[] = parsedTx.meta!.postBalances;

    let txDestination = '';
    let amountLamports = 0;
    for (let i = 0; i < accountKeys.length; i++) {
      const diff = postBalances[i] - preBalances[i];
      if (diff > 0) {
        txDestination = accountKeys[i];
        amountLamports = diff;
        break;
      }
    }

    if (!txDestination) {
      throw Object.assign(new Error('no destination found'), { isStealth: true });
    }

    // Vérifier la propriété stealth
    const isOwner = stealthCryptoService.verifyStealthOwnership({
      txDestination,
      ephemeralPub,
      viewTag,
      viewingPriv,
      spendingPub,
    });

    if (!isOwner) {
      throw Object.assign(new Error('not owner'), { isStealth: true });
    }

    // Upsert StealthPayment (déduplication par userId + txSignature)
    await StealthPayment.findOneAndUpdate(
      { userId, txSignature: sig.signature },
      {
        $setOnInsert: {
          userId,
          stealthAddress: txDestination,
          amountLamports: amountLamports.toString(),
          txSignature: sig.signature,
          ephemeralR: ephemeralR_b58,
          viewTag,
          detectedAt: sig.blockTime ? new Date(sig.blockTime * 1000) : new Date(),
          status: 'spendable',
          walletType,
        },
      },
      { upsert: true, new: false },
    );
  }

  /**
   * Scanne les transactions stealth pour le cash wallet d'un utilisateur.
   * Symétrique à scanForUser mais utilise les clés cashStealth* et upsert walletType:'cash'.
   */
  async scanCashForUser(user: {
    _id: string | any;
    cashStealthSpendingPublic: string;
    cashStealthViewingPublic: string;
    cashStealthViewingPrivateEnc: string;
  }): Promise<ScanResult> {
    const result: ScanResult = { detected: 0, scanned: 0, errors: 0 };

    // Récupérer les signatures d'abord — déchiffrement uniquement si nécessaire
    let signatures: any[];
    try {
      const viewingPubKey = new PublicKey(bs58.decode(user.cashStealthViewingPublic));
      const connection = this.getConnection();
      signatures = await connection.getSignaturesForAddress(viewingPubKey, { limit: 100 });
    } catch (err) {
      console.error('[CashStealth] getSignaturesForAddress failed:', err);
      return result;
    }

    const stealthSigs = signatures.filter(
      (sig) => sig.memo && sig.memo.startsWith(STEALTH_MEMO_PREFIX) && !sig.err,
    );

    if (stealthSigs.length === 0) return result;

    // Déchiffrer seulement si des TXs stealth sont trouvées
    const viewingPriv = await this.decryptViewingKey(user.cashStealthViewingPrivateEnc);
    const spendingPub = new Uint8Array(bs58.decode(user.cashStealthSpendingPublic));

    for (const sig of stealthSigs) {
      result.scanned++;
      try {
        await this.processSignature(sig, user._id.toString(), spendingPub, viewingPriv, 'cash');
        result.detected++;
      } catch (err) {
        if ((err as any)?.isStealth !== true) {
          result.errors++;
          console.error('[CashStealth] processSignature error:', err);
        }
      }
    }

    return result;
  }

  /**
   * Déchiffre la viewing private key depuis le format AES-256-GCM stocké en DB.
   * Protected pour pouvoir être mockée dans les tests.
   */
  protected async decryptViewingKey(encryptedViewingPrivateEnc: string): Promise<Uint8Array> {
    const decrypted = decryptToBytes(encryptedViewingPrivateEnc);
    return new Uint8Array(decrypted);
  }

  /**
   * Démarre le job périodique de scanning (tâche 3.4).
   * Appelle scanForUser pour tous les utilisateurs avec stealthEnabled: true.
   */
  startScanningJob(): void {
    if (this.scanInterval) return; // éviter les doublons

    this.scanInterval = setInterval(async () => {
      await this.runScanCycle();
    }, 60_000); // 60 secondes

    console.log('[Stealth] Scanner job démarré (60s interval)');
  }

  stopScanningJob(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  private async runScanCycle(): Promise<void> {
    const { User } = await import('../../models/User');
    try {
      // Passe 1 — wealth stealth
      const wealthUsers = await User.find({ stealthEnabled: true, stealthViewingPrivateEnc: { $exists: true } }).lean();
      const wealthResults = await Promise.allSettled(wealthUsers.map((u) => this.scanForUser(u as any)));
      const wealthDetected = wealthResults.reduce((sum, r) => {
        if (r.status === 'fulfilled') return sum + r.value.detected;
        console.error('[Stealth] scan cycle error:', r.reason);
        return sum;
      }, 0);

      // Passe 2 — cash stealth
      const cashUsers = await User.find({ cashStealthEnabled: true, cashStealthViewingPrivateEnc: { $exists: true } }).lean();
      const cashResults = await Promise.allSettled(cashUsers.map((u) => this.scanCashForUser(u as any)));
      const cashDetected = cashResults.reduce((sum, r) => {
        if (r.status === 'fulfilled') return sum + r.value.detected;
        console.error('[CashStealth] scan cycle error:', r.reason);
        return sum;
      }, 0);

      const totalDetected = wealthDetected + cashDetected;
      if (totalDetected > 0) {
        console.log(`[Stealth] Scanner: ${totalDetected} nouveaux paiements détectés (wealth:${wealthDetected} cash:${cashDetected})`);
      }
    } catch (err) {
      console.error('[Stealth] runScanCycle error:', err);
    }
  }
}

let instance: StealthScannerService | null = null;

export function getStealthScannerService(): StealthScannerService {
  if (!instance) instance = new StealthScannerService();
  return instance;
}
