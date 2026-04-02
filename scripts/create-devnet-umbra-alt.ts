/**
 * Script one-shot : crée une Address Lookup Table (ALT) devnet
 * pour compresser la TX de registration Umbra (trop grande sans ALT).
 *
 * Usage :
 *   POOL_AUTHORITY_PRIVATE_KEY=<bs58> npx ts-node scripts/create-devnet-umbra-alt.ts
 *
 * Après exécution, copier l'adresse ALT affichée dans umbra-client.service.ts
 * (constante DEVNET_UMBRA_REG_ALT).
 */

import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  AddressLookupTableProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const UMBRA_PROGRAM_DEVNET = '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4';
const ARCIUM_PROGRAM = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const CLUSTER_OFFSET = 456;
const INSTRUCTION_NAME = 'register_user_for_anonymous_usage_v3';

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Charger le wallet depuis l'env (le pool authority a du SOL sur devnet)
  const secretKey = process.env.POOL_AUTHORITY_PRIVATE_KEY;
  if (!secretKey) throw new Error('POOL_AUTHORITY_PRIVATE_KEY env var requis');
  // Supporte le format JSON array [1,2,3,...] ou bs58
  let keyBytes: Uint8Array;
  if (secretKey.startsWith('[')) {
    keyBytes = new Uint8Array(JSON.parse(secretKey));
  } else {
    keyBytes = bs58.decode(secretKey);
  }
  const payer = Keypair.fromSecretKey(keyBytes);
  console.log('[ALT] Payer:', payer.publicKey.toBase58());

  // Dériver les PDAs constants via le SDK Umbra (chunk interne qui exporte tout)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sdkChunk = require('/home/louis/Bureau/Stealf/backend-stealf/node_modules/@umbra-privacy/sdk/dist/chunk-PG2J6V6Y.js');
  const {
    getMxeAccountAddress,
    getMempoolAccountAddress,
    getExecutingPoolAccountAddress,
    getCompDefAccountAddress,
    getClusterAccountAddress,
    getCompDefOffset,
  } = sdkChunk;

  const compDefOffset = getCompDefOffset(INSTRUCTION_NAME);
  console.log('[ALT] compDefOffset:', compDefOffset);

  const [mxeAccount, mempoolAccount, executingPool, compDefAccount, clusterAccount] =
    await Promise.all([
      getMxeAccountAddress(UMBRA_PROGRAM_DEVNET, ARCIUM_PROGRAM),
      getMempoolAccountAddress(ARCIUM_PROGRAM, CLUSTER_OFFSET),
      getExecutingPoolAccountAddress(ARCIUM_PROGRAM, CLUSTER_OFFSET),
      getCompDefAccountAddress(UMBRA_PROGRAM_DEVNET, ARCIUM_PROGRAM, compDefOffset),
      getClusterAccountAddress(ARCIUM_PROGRAM, CLUSTER_OFFSET),
    ]);

  const addresses = [
    ARCIUM_PROGRAM,
    mxeAccount,
    mempoolAccount,
    executingPool,
    compDefAccount,
    clusterAccount,
    '11111111111111111111111111111111',
    UMBRA_PROGRAM_DEVNET,
  ];

  console.log('\n[ALT] Comptes constants dérivés :');
  addresses.forEach((a, i) => console.log(`  [${i}] ${a}`));

  // Créer l'ALT (nécessite un slot récent)
  const slot = await connection.getSlot();
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses: addresses.map((a) => new PublicKey(a)),
  });

  const tx = new Transaction().add(createIx).add(extendIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

  console.log('\n✅ ALT créée avec succès !');
  console.log('Adresse ALT :', altAddress.toBase58());
  console.log('TX signature :', sig);
  console.log('\n👉 Ajouter dans umbra-client.service.ts :');
  console.log(`const DEVNET_UMBRA_REG_ALT = '${altAddress.toBase58()}';`);
  console.log(`const DEVNET_UMBRA_REG_ALT_ADDRESSES = ${JSON.stringify(addresses, null, 2)};`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
