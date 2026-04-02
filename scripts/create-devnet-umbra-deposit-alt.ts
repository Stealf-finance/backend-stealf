/**
 * Script one-shot : crée une ALT pour compresser la TX deposit Umbra.
 *
 * La TX dépôt dépasse de ~13 bytes (1245 vs 1232 max raw).
 * Chaque compte dans l'ALT : 32 bytes → 2 bytes = -30 bytes raw.
 * Il suffit de 1 compte pour passer sous la limite.
 *
 * On inclut les programmes constants (tokenProgram, systemProgram, clock,
 * ATAProgram, Umbra program) qui apparaissent dans chaque TX deposit.
 *
 * Usage :
 *   POOL_AUTHORITY_PRIVATE_KEY=<bs58> npx ts-node scripts/create-devnet-umbra-deposit-alt.ts
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
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const SYSVAR_CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const secretKey = process.env.POOL_AUTHORITY_PRIVATE_KEY;
  if (!secretKey) throw new Error('POOL_AUTHORITY_PRIVATE_KEY requis');
  let keyBytes: Uint8Array;
  if (secretKey.startsWith('[')) {
    keyBytes = new Uint8Array(JSON.parse(secretKey));
  } else {
    keyBytes = bs58.decode(secretKey);
  }
  const payer = Keypair.fromSecretKey(keyBytes);
  console.log('[DepositALT] Payer:', payer.publicKey.toBase58());

  // Programmes constants présents dans chaque TX deposit
  // Chaque entrée ALT : 32 bytes → 2 bytes = économise 30 bytes raw par compte
  // On a besoin d'économiser ~13 bytes → 1 compte suffit, on en met 6 par sécurité
  const addresses = [
    UMBRA_PROGRAM_DEVNET,
    TOKEN_PROGRAM,
    SYSTEM_PROGRAM,
    SYSVAR_CLOCK,
    ASSOCIATED_TOKEN_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
  ];

  console.log('\n[DepositALT] Comptes :');
  addresses.forEach((a, i) => console.log(`  [${i}] ${a}`));

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

  console.log('\n✅ ALT deposit créée !');
  console.log('Adresse ALT:', altAddress.toBase58());
  console.log('TX:', sig);
  console.log('\n👉 Ajouter dans umbra-client.service.ts (bloc devnet) :');
  console.log(`      client.networkConfig.addressLookupTables['create_deposit_into_mixer_tree_from_public_balance'] = {`);
  console.log(`        altAddress: '${altAddress.toBase58()}',`);
  console.log(`        addresses: ${JSON.stringify(addresses, null, 2)},`);
  console.log(`      };`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
