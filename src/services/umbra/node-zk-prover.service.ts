/**
 * NodeZkProverService — Provers ZK compatibles Node.js pour @umbra-privacy/sdk.
 *
 * Le package @umbra-privacy/web-zk-prover utilise fastfile (snarkjs) qui en Node.js
 * traite les URLs comme des chemins fichiers locaux → ENOENT.
 * Solution : télécharger WASM + zkey depuis le CDN et passer des chemins locaux.
 *
 * Cache dans /tmp/umbra-zk-cache/ (persistant pendant la durée du process).
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const CACHE_DIR = path.join('/tmp', 'umbra-zk-cache');
const CDN_BASE = 'https://d1hi11upkav2nq.cloudfront.net/zk/v0';

// Fichiers connus accessibles publiquement sur le CDN
const ZK_FILES = {
  registration: {
    wasm: `${CDN_BASE}/userregistration.wasm`,
    zkey: `${CDN_BASE}/userregistration.zkey`,
  },
  deposit: {
    wasm: `${CDN_BASE}/createdepositwithpublicamount.wasm`,
    zkey: `${CDN_BASE}/createdepositwithpublicamount.zkey`,
  },
} as const;

type ProverType = keyof typeof ZK_FILES;

// Cache en mémoire des chemins locaux déjà téléchargés
const _localPaths: Partial<Record<ProverType, { wasm: string; zkey: string }>> = {};

/**
 * Télécharge un fichier depuis une URL HTTPS vers un chemin local.
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      resolve();
      return;
    }
    const file = fs.createWriteStream(dest);
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    }, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`CDN returned ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Télécharge et met en cache les fichiers ZK pour un type de prover.
 * Idempotent : skip si déjà en cache.
 */
async function ensureLocalFiles(type: ProverType): Promise<{ wasm: string; zkey: string }> {
  if (_localPaths[type]) return _localPaths[type]!;

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const urls = ZK_FILES[type];
  const wasmDest = path.join(CACHE_DIR, path.basename(urls.wasm));
  const zkeyDest = path.join(CACHE_DIR, path.basename(urls.zkey));

  console.log(`[NodeZkProver] Downloading ${type} ZK files...`);
  await Promise.all([
    downloadFile(urls.wasm, wasmDest),
    downloadFile(urls.zkey, zkeyDest),
  ]);
  console.log(`[NodeZkProver] ${type} ZK files ready: ${wasmDest}`);

  _localPaths[type] = { wasm: wasmDest, zkey: zkeyDest };
  return _localPaths[type]!;
}

/**
 * Crée un prover Node.js pour la registration utilisateur.
 */
export function getNodeRegistrationProver() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { convertSnarkjsProofToBytes } = require('@umbra-privacy/web-zk-prover');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const snarkjs = require('snarkjs');

  return {
    async prove(inputs: unknown) {
      const { wasm, zkey } = await ensureLocalFiles('registration');
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasm, zkey);
      return convertSnarkjsProofToBytes(proof, publicSignals);
    },
  };
}

/**
 * Crée un IZkAssetProvider Node.js compatible avec @umbra-privacy/web-zk-prover.
 * Télécharge WASM + zkey en local (/tmp/umbra-zk-cache/) et retourne les chemins absolus
 * pour que snarkjs (fastfile) puisse ouvrir les fichiers — évite l'ENOENT en Node.js.
 *
 * @param proverType - Type de prover ('deposit' | 'registration') → sélectionne les bons fichiers
 */
export function createNodeZkAssetProvider(proverType: ProverType) {
  return {
    async getAssetUrls(_type: string, _variant?: string): Promise<{ zkeyUrl: string; wasmUrl: string }> {
      const { wasm, zkey } = await ensureLocalFiles(proverType);
      console.log(`[NodeZkProver] Local ZK paths for ${proverType}: wasm=${wasm}, zkey=${zkey}`);
      return { wasmUrl: wasm, zkeyUrl: zkey };
    },
  };
}

/**
 * Crée le prover deposit Node.js en utilisant @umbra-privacy/web-zk-prover avec un provider local.
 * Le web-zk-prover gère la préparation des inputs ZK (senderMvkBlindingFactor, etc.)
 * mais délègue le chargement des fichiers à notre provider qui télécharge en local.
 */
export function getNodeDepositProverViaWebZkProver() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getCreateReceiverClaimableUtxoFromPublicBalanceProver } = require('@umbra-privacy/web-zk-prover');
  const provider = createNodeZkAssetProvider('deposit');
  return getCreateReceiverClaimableUtxoFromPublicBalanceProver(provider);
}

/**
 * Crée le prover claim Node.js via @umbra-privacy/web-zk-prover.
 * Le circuit claim n'est pas sur le CDN public — utilise le provider interne du web-zk-prover.
 */
export function getNodeClaimProverViaWebZkProver() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver } = require('@umbra-privacy/web-zk-prover');
  return getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver();
}
