/**
 * AccountInitService — enregistrement Umbra pour les wallets Cash et Wealth.
 * - Vérifie l'idempotence (skip si déjà enregistré en DB)
 * - Appelle getUserRegistrationFunction() du SDK
 * - Chiffre et persiste masterViewingKey, wealthKeypairEnc, clés X25519
 * - Réessaie jusqu'à 3 fois en cas d'échec (req 1.6)
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Connection, PublicKey } = require('@solana/web3.js');
import { User } from '../../models/User';
import { encryptString } from '../../utils/umbra-encryption';
import { umbraClientService, UmbraClientService } from './umbra-client.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

interface RegistrationResult {
  masterViewingKey: string;         // hex — clé privée Umbra
  wealthKeypairBytes?: string;      // hex 64 bytes — keypair Wealth (optionnel selon SDK)
  x25519CashPublic?: string;        // base58 — clé publique X25519 cash
  x25519WealthPublic?: string;      // base58 — clé publique X25519 wealth
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class AccountInitService {
  private readonly _clientService: UmbraClientService;

  constructor(clientService: UmbraClientService = umbraClientService) {
    this._clientService = clientService;
  }

  /**
   * Enregistre un wallet (cash ou wealth) dans le programme Umbra.
   * Idempotent : ne fait rien si le wallet est déjà enregistré.
   * Retour : void (le statut HTTP 202 est géré par le contrôleur).
   */
  async registerWallet(
    userId: string,
    signer: IUmbraSigner,
    walletType: 'cash' | 'wealth'
  ): Promise<void> {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');

    // Idempotence check
    const registeredField = walletType === 'cash' ? 'umbraRegisteredCash' : 'umbraRegisteredWealth';
    if ((user as any)[registeredField]) {
      console.log(`[UmbraMixer] ${walletType} wallet already registered for user ${userId} — skip`);
      return;
    }

    // Debug : afficher l'adresse dérivée du signer pour détecter un mismatch
    console.log(`[UmbraMixer] Registering ${walletType} wallet: signer.address=${signer.address}`);

    // Créer le client Umbra lié au signer
    const client = await this._clientService.createClientForSigner(signer);
    const prover = this._clientService.getRegistrationProver();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getUserRegistrationFunction } = require('@umbra-privacy/sdk');
    const registerFn = getUserRegistrationFunction({ client }, { zkProver: prover });

    // Exécuter avec retry.
    // confidential: true → enregistre la clé X25519 (encrypted balances)
    // anonymous: true   → enregistre le user commitment Poseidon (mixer UTXO)
    const result: RegistrationResult = await this._withRetry(
      () => registerFn({ confidential: true, anonymous: true }),
      walletType,
      userId,
      signer.address
    );

    // Le SDK retourne [] vide — les clés X25519 doivent être dérivées client-side
    // via getMintX25519KeypairGenerator après registration (seul moment où on a le signer).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMintX25519KeypairGenerator } = require('@umbra-privacy/sdk');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { address: kitAddress } = require('@solana/kit');
    // Native SOL mint (wrapped SOL = So111...)
    const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
    const mintKeyGen = getMintX25519KeypairGenerator({ client });
    const { x25519Keypair } = await mintKeyGen(kitAddress(NATIVE_SOL_MINT));
    // x25519Keypair.publicKey est un Uint8Array 32 bytes
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58Lib = require('bs58').default ?? require('bs58');
    const x25519PubBase58: string = bs58Lib.encode(Buffer.from(x25519Keypair.publicKey as Uint8Array));
    console.log(`[UmbraMixer] Derived X25519 public key (${walletType}):`, x25519PubBase58);

    // Préparer les updates MongoDB
    const updates: Record<string, unknown> = {
      [registeredField]: true,
    };

    if (walletType === 'cash') {
      updates.umbraX25519CashPublic = x25519PubBase58;
    }

    if (walletType === 'wealth') {
      updates.umbraX25519WealthPublic = x25519PubBase58;
      // Persiste l'adresse Solana du signer Umbra wealth (≠ stealf_wallet pour MWA users)
      updates.umbraWealthSignerAddress = signer.address;
    }

    await User.findByIdAndUpdate(userId, updates);

    console.log(`[UmbraMixer] ${walletType} wallet registered for user ${userId}`);
  }

  private async _withRetry<T>(
    fn: () => Promise<T>,
    walletType: string,
    userId: string,
    signerAddress?: string
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        // Tenter de récupérer les logs depuis plusieurs niveaux de cause
        const logs =
          (e as any)?.cause?.context?.logs ??
          (e as any)?.cause?.cause?.context?.logs ??
          (e as any)?.context?.logs;
        console.warn(
          `[UmbraMixer] Registration attempt ${attempt}/${MAX_RETRIES} failed for ${walletType} wallet user=${userId}:`,
          (e as Error)?.message ?? e
        );
        if (logs?.length) {
          console.warn('[UmbraMixer] Program logs:', logs);
        } else {
          // Logs non disponibles dans l'erreur — tenter de les récupérer via RPC
          if (signerAddress) {
            await this._fetchAndLogTxLogs(signerAddress, walletType).catch(() => {});
          }
        }
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
      }
    }
    throw lastError;
  }

  /** Récupère les logs de la dernière TX Umbra échouée pour le signer donné */
  private async _fetchAndLogTxLogs(signerAddress: string, walletType: string): Promise<void> {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(signerAddress),
      { limit: 3 }
    );
    for (const sigInfo of sigs) {
      if (!sigInfo.err) continue; // skip les TX réussies
      const tx = await connection.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx?.meta?.logMessages?.length) continue;
      console.warn(`[UmbraMixer][TX Logs] ${walletType} — TX ${sigInfo.signature}:`);
      tx.meta.logMessages.forEach((l: string) => console.warn('  ', l));
      break; // Afficher les logs de la 1ère TX échouée seulement
    }
  }
}

/** Singleton global */
export const accountInitService = new AccountInitService();
