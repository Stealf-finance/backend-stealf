/**
 * UmbraDepositService — Exécution des dépôts Mixer via SDK Umbra.
 *
 * Le SDK @umbra-privacy/sdk signe ET soumet la TX automatiquement (via client.signer.signTransaction
 * + transactionForwarder). Il retourne [txSignature] — PAS une unsigned TX.
 *
 * executeDeposit() : vérifie le solde, génère la preuve ZK, SDK signe+soumet, crée MixerArtifact.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { User } from '../../models/User';
import { MixerArtifact } from '../../models/MixerArtifact';
import { encryptString } from '../../utils/umbra-encryption';
import { umbraClientService, UmbraClientService } from './umbra-client.service';
import { umbraWalletService, UmbraWalletService } from './umbra-wallet.service';
import { NATIVE_SOL_MINT } from './umbra.constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

export interface DepositParams {
  fromWallet: 'cash' | 'wealth';
  toWallet: 'cash' | 'wealth';
  mint: string;
  amountLamports: bigint;
}

export interface DepositResult {
  txSignature: string;
}

export class UmbraDepositService {
  constructor(
    private readonly _clientService: UmbraClientService = umbraClientService,
    private readonly _walletService: UmbraWalletService = umbraWalletService
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Exécuter un dépôt Mixer — SDK signe + soumet automatiquement
  // ────────────────────────────────────────────────────────────────────────────

  async executeDeposit(
    userId: string,
    params: DepositParams,
    signer: IUmbraSigner,
    onClaimTrigger?: (userId: string, artifactId: string) => void
  ): Promise<DepositResult> {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');

    const fromWalletAddress =
      params.fromWallet === 'cash'
        ? (user as any).cash_wallet
        : (user as any).umbraWealthSignerAddress ?? (user as any).stealf_wallet;

    const toWalletAddress =
      params.toWallet === 'cash'
        ? (user as any).cash_wallet
        : (user as any).umbraWealthSignerAddress ?? (user as any).stealf_wallet;

    // 1. Vérifier le solde avant tout appel SDK (req 2.7)
    await this.checkBalance(fromWalletAddress, params.mint, params.amountLamports);

    // 2. Créer le client SDK avec le signer fourni (le SDK utilise signer.signTransaction)
    const client = await this._clientService.createClientForSigner(signer);
    const prover = this._clientService.getDepositProver();

    // 3. Appeler la fonction deposit SDK
    // Le SDK génère la preuve ZK Groth16, signe la TX, la soumet, et retourne [txSignature]
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCreateReceiverClaimableUtxoFromPublicBalanceFunction } = require('@umbra-privacy/sdk');
    const depositFn = getCreateReceiverClaimableUtxoFromPublicBalanceFunction(
      { client },
      { zkProver: prover }
    );

    console.log(`[UmbraDeposit] Executing deposit: ${fromWalletAddress} → ${toWalletAddress}, amount=${params.amountLamports}`);

    const sdkResult = await depositFn({
      destinationAddress: toWalletAddress,
      mint: params.mint,
      amount: params.amountLamports, // BigInt
    });

    // SDK retourne [txSignature] (array)
    const txSignature = Array.isArray(sdkResult) ? sdkResult[0] : sdkResult;
    console.log(`[UmbraDeposit] TX confirmed on-chain: ${txSignature}`);

    // 4. Persister MixerArtifact
    let artifactId: string | null = null;
    try {
      const artifact = await MixerArtifact.create({
        userId,
        txSignature,
        generationIndexEnc: encryptString('sdk-v1'),
        mint: params.mint,
        claimableBalanceEnc: encryptString(params.amountLamports.toString()),
        recipientWallet: params.toWallet,
        claimed: false,
        claimStatus: 'pending',
      });
      artifactId = (artifact as any)._id?.toString() ?? null;
    } catch (err) {
      console.error('[UmbraDeposit][CRITICAL] MongoDB persist failed after on-chain confirm', {
        txSignature, userId, mint: params.mint, amountLamports: params.amountLamports.toString(),
      });
    }

    // 5. Fire-and-forget claim
    if (artifactId && onClaimTrigger) {
      setImmediate(() => onClaimTrigger(userId, artifactId!));
    }

    return { txSignature };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Balance check (SOL natif ou SPL token)
  // ────────────────────────────────────────────────────────────────────────────

  async checkBalance(walletAddress: string, mint: string, amountLamports: bigint): Promise<void> {
    const connection = this._getConnection();

    if (mint === NATIVE_SOL_MINT) {
      const balance = await connection.getBalance(new PublicKey(walletAddress));
      if (BigInt(balance) < amountLamports) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
    } else {
      // SPL token (USDC, etc.)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAssociatedTokenAddress } = require('@solana/spl-token');
      const ata = await getAssociatedTokenAddress(
        new PublicKey(mint),
        new PublicKey(walletAddress)
      );
      const { value } = await connection.getTokenAccountBalance(ata);
      if (BigInt(value.amount) < amountLamports) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
    }
  }

  private _getConnection(): Connection {
    return new Connection(
      process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
      'confirmed'
    );
  }
}

/** Singleton global — le onClaimTrigger sera câblé après init de UmbraClaimService */
export const umbraDepositService = new UmbraDepositService();
