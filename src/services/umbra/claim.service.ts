/**
 * UmbraClaimService — claim des UTXOs Umbra (Cash via Turnkey, Wealth via keypair).
 * Requirements: 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */
import { MixerArtifact } from '../../models/MixerArtifact';
import { User } from '../../models/User';
import { decryptString } from '../../utils/umbra-encryption';
import { signAndSendCashWalletTransaction } from '../auth/turnkeySign.service';
import { umbraClientService } from './umbra-client.service';
import { umbraWalletService } from './umbra-wallet.service';
import { createUmbraSignerFromKeypair } from './keypair-signer';
import { NATIVE_SOL_MINT } from './umbra.constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

interface ClaimResult {
  claimTxSignature: string;
}

interface ClaimableUtxo {
  artifactId: string;
  generationIndex: string;
  claimableBalance: string;
  mint: string;
  recipientWallet: string;
  claimStatus: string;
}

export class UmbraClaimService {
  /**
   * Declenche le claim en fire-and-forget via setImmediate (req 4.1).
   * Retourne void immediatement sans bloquer.
   */
  triggerClaim(userId: string, artifactId: string): void {
    setImmediate(() => {
      this._executeClaim(userId, artifactId).catch((e) => {
        console.error('[UmbraMixer][ClaimFailed]', { artifactId, userId, error: e });
      });
    });
  }

  /**
   * Claim manuel (expose pour tests et retry manuels).
   */
  async manualClaim(userId: string, artifactId: string): Promise<ClaimResult> {
    return this._executeClaim(userId, artifactId);
  }

  /**
   * Scan des UTXOs non claimed depuis MongoDB (req 3.5, 4.6).
   * Dechiffre generationIndex et claimableBalance avant retour.
   */
  async scanUtxos(userId: string): Promise<ClaimableUtxo[]> {
    const artifacts = await MixerArtifact.find({ userId, claimed: false }).lean();
    return (artifacts as any[]).map((a) => ({
      artifactId: String(a._id),
      generationIndex: decryptString(a.generationIndexEnc),
      claimableBalance: decryptString(a.claimableBalanceEnc),
      mint: a.mint,
      recipientWallet: a.recipientWallet,
      claimStatus: a.claimStatus,
    }));
  }

  /**
   * Logique principale du claim :
   * 1. Double-claim guard atomique (req 4.7)
   * 2. Fetch UTXOs + preuve ZK (req 4.2, 4.3)
   * 3. Signature : Wealth via keypair, Cash via Turnkey
   * 4. Mise a jour artifact (req 4.4)
   * 5. Rollback vers pending_retry si echec (req 4.5)
   */
  private async _executeClaim(userId: string, artifactId: string): Promise<ClaimResult> {
    // -- Double-claim guard (req 4.7) --
    const artifact = await MixerArtifact.findOneAndUpdate(
      { _id: artifactId, claimStatus: { $in: ['pending', 'pending_retry'] } },
      { claimStatus: 'processing' },
      { new: true }
    );
    if (!artifact) {
      throw new Error('Artifact not found or already processing');
    }

    try {
      const a = artifact as any;
      const mint: string = a.mint ?? NATIVE_SOL_MINT;
      const recipientWallet: string = a.recipientWallet;
      const generationIndex: string = decryptString(a.generationIndexEnc);

      const user = await User.findById(userId).lean() as any;

      const {
        getFetchClaimableUtxosFunction,
        getClaimReceiverClaimableUtxoIntoEncryptedBalanceFunction,
      } = require('@umbra-privacy/sdk');

      let signer: IUmbraSigner;

      if (recipientWallet === 'wealth') {
        // Wealth : decrypte le keypair et cree un signer Umbra (req 4.3)
        const keypairBytes = await umbraWalletService.decryptWealthKeypair(userId);
        signer = await createUmbraSignerFromKeypair(keypairBytes);
      } else {
        // Cash : signer read-only — la TX sera signee par Turnkey apres
        signer = { address: user.cash_wallet };
      }

      const client = await umbraClientService.createClientForSigner(signer);
      const prover = umbraClientService.getClaimProver();

      // -- Fetch UTXOs claimables (req 4.2) --
      const fetchFn = getFetchClaimableUtxosFunction({ client });
      const utxos: any[] = await fetchFn({ mint });

      // Trouver l'UTXO correspondant au generationIndex de l'artifact
      const utxo = utxos.find((u: any) => u.generationIndex === generationIndex) ?? utxos[0];

      // -- Preuve ZK + claim (req 4.3) --
      const claimFn = getClaimReceiverClaimableUtxoIntoEncryptedBalanceFunction(
        { client },
        { zkProver: prover }
      );
      const claimResult = await claimFn(utxo);

      let claimTxSignature: string;

      if (recipientWallet === 'wealth') {
        // Wealth : le signer Umbra a signe en interne
        claimTxSignature = claimResult.txSignature;
      } else {
        // Cash : soumettre l'unsigned TX a Turnkey
        const unsignedTxBase64: string = claimResult.unsignedTransaction;
        const unsignedTxHex = Buffer.from(unsignedTxBase64, 'base64').toString('hex');
        claimTxSignature = await signAndSendCashWalletTransaction(
          user.turnkey_subOrgId,
          unsignedTxHex,
          user.cash_wallet
        );
      }

      // -- Persister le resultat (req 4.4) --
      await MixerArtifact.findByIdAndUpdate(artifactId, {
        claimed: true,
        claimStatus: 'claimed',
        claimTxSignature,
      });

      return { claimTxSignature };
    } catch (e) {
      // -- Rollback vers pending_retry (req 4.5) --
      await MixerArtifact.findByIdAndUpdate(artifactId, { claimStatus: 'pending_retry' });
      console.error('[UmbraMixer][ClaimFailed]', { artifactId, userId });
      throw e;
    }
  }
}

/** Singleton global */
export const umbraClaimService = new UmbraClaimService();
