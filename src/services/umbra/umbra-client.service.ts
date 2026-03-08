/**
 * UmbraClientService — Singleton pour les provers ZK et la configuration réseau Umbra.
 *
 * Architecture :
 * - Les ZK provers (WASM Groth16) sont coûteux à initialiser → mis en cache.
 * - Le IUmbraClient (SDK) est per-user/per-signer → créé à la demande via createClientForSigner().
 * - Ce singleton expose : provers, config réseau, factory client, healthCheck.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
import axios from 'axios';
import {
  getUmbraNetwork,
  getIndexerUrl as getIndexerUrlFromEnv,
  getUsdcMint as getUsdcMintFromEnv,
  UMBRA_PROGRAM_ID,
  type UmbraNetwork,
} from './umbra.constants';

// Imports lazy pour éviter les crashes si les packages ne sont pas encore installés
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraClient = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

export class UmbraClientService {
  private readonly _network: UmbraNetwork;
  private readonly _indexerUrl: string;
  private readonly _usdcMint: string;

  // Cache des provers ZK (lazy init)
  private _registrationProver: unknown | null = null;
  private _depositProver: unknown | null = null;
  private _claimProver: unknown | null = null;

  constructor() {
    this._network = getUmbraNetwork(); // throw si invalide
    this._indexerUrl = getIndexerUrlFromEnv();
    this._usdcMint = getUsdcMintFromEnv(this._network);

    console.log(
      `[UmbraMixer][Init] network=${this._network}, program=${UMBRA_PROGRAM_ID.slice(0, 8)}...`
    );
  }

  getNetwork(): UmbraNetwork {
    return this._network;
  }

  getUsdcMint(): string {
    return this._usdcMint;
  }

  getIndexerUrl(): string {
    return this._indexerUrl;
  }

  getProgramId(): string {
    return UMBRA_PROGRAM_ID;
  }

  /**
   * Initialise et met en cache le prover ZK pour la registration Umbra.
   * Utilise le prover Node.js (télécharge WASM/zkey depuis CDN en local).
   */
  getRegistrationProver(): unknown {
    if (!this._registrationProver) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getNodeRegistrationProver } = require('./node-zk-prover.service');
      this._registrationProver = getNodeRegistrationProver();
    }
    return this._registrationProver;
  }

  /**
   * Initialise et met en cache le prover ZK pour les dépôts.
   * Utilise @umbra-privacy/web-zk-prover avec un provider local qui
   * télécharge WASM/zkey depuis le CDN vers /tmp/umbra-zk-cache/.
   */
  getDepositProver(): unknown {
    if (!this._depositProver) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getNodeDepositProverViaWebZkProver } = require('./node-zk-prover.service');
      this._depositProver = getNodeDepositProverViaWebZkProver();
    }
    return this._depositProver;
  }

  /**
   * Initialise et met en cache le prover ZK pour les claims (UTXO → encrypted balance).
   * Utilise le web-zk-prover avec provider local.
   */
  getClaimProver(): unknown {
    if (!this._claimProver) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getNodeClaimProverViaWebZkProver } = require('./node-zk-prover.service');
      this._claimProver = getNodeClaimProverViaWebZkProver();
    }
    return this._claimProver;
  }

  /**
   * Crée un IUmbraClient lié à un signer spécifique.
   * Doit être appelé par les services métier (AccountInitService, DepositService, ClaimService).
   */
  async createClientForSigner(signer: IUmbraSigner): Promise<IUmbraClient> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getUmbraClientFromSigner } = require('@umbra-privacy/sdk');
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
    const rpcSubscriptionsUrl = rpcUrl.replace(/^https?:\/\//, (m) =>
      m === 'https://' ? 'wss://' : 'ws://'
    );

    // indexerApiEndpoint est optionnel — omis ici car non requis pour registration/deposit.
    // La doc SDK confirme : "not required for creating UTXOs - only for discovering and claiming them."
    const client = await getUmbraClientFromSigner({
      signer,
      network: this._network,
      rpcUrl,
      rpcSubscriptionsUrl,
      commitment: 'confirmed',
    });

    // Devnet : injecter l'ALT pour register_user_for_anonymous_usage_v3.
    // Le SDK livré en v1.0.0 a addressLookupTables:{} sur devnet → TX trop grande (1317 > 1232 bytes).
    // On a créé cette ALT manuellement (scripts/create-devnet-umbra-alt.ts).
    if (this._network === 'devnet') {
      client.networkConfig.addressLookupTables['register_user_for_anonymous_usage_v3'] = {
        altAddress: '2oPmjFaXCXUWL2ERtRHHjkXxqT9BRytakonKxgiUyagr',
        addresses: [
          'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',
          '49GkYq8A3TzStWkqjaDRunKktaM5DNb1ac1fFxRBwe6d',
          'Ex7BD8o8PK1y2eXDd38Jgujj93uHygrZeWXDeGAHmHtN',
          '4mcrgNZzJwwKrE3wXMHfepT8htSBmGqBzDYPJijWooog',
          '3powCjbks3inmmPCFgKtAcTtJmEdjmjFPybFBGZ7ESuC',
          'DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95',
          '11111111111111111111111111111111',
          '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4',
        ],
      };
      // ALT deposit : TX trop grande de ~13 bytes sans compression (scripts/create-devnet-umbra-deposit-alt.ts)
      client.networkConfig.addressLookupTables['create_deposit_into_mixer_tree_from_public_balance'] = {
        altAddress: 'BxGreKSRDRgKNdv7KNsNa22gCA7pARiTWA7ZN8KKryea',
        addresses: [
          '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4',
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          '11111111111111111111111111111111',
          'SysvarC1ock11111111111111111111111111111111',
          'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
          'ComputeBudget111111111111111111111111111111',
        ],
      };
    }

    return client;
  }

  /**
   * Crée un IUmbraClient avec indexer configuré — uniquement pour les opérations de claim/scan.
   */
  async createClientWithIndexerForSigner(signer: IUmbraSigner): Promise<IUmbraClient> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getUmbraClientFromSigner } = require('@umbra-privacy/sdk');
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
    const rpcSubscriptionsUrl = rpcUrl.replace(/^https?:\/\//, (m) =>
      m === 'https://' ? 'wss://' : 'ws://'
    );

    return getUmbraClientFromSigner({
      signer,
      network: this._network,
      rpcUrl,
      rpcSubscriptionsUrl,
      indexerApiEndpoint: this._indexerUrl,
      commitment: 'confirmed',
    });
  }

  /**
   * Vérifie la disponibilité de l'indexer Umbra (timeout 5s).
   * Retourne false si l'indexer est indisponible (fallback SPL/stealth possible).
   */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(this._indexerUrl, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** Singleton global — initialisé au démarrage du serveur */
export const umbraClientService = new UmbraClientService();
