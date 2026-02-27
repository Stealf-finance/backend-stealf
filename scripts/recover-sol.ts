/**
 * recover-sol.ts
 *
 * Exporte la clé privée du cash wallet Turnkey (ancien compte quota épuisé)
 * et transfère tout le SOL vers le SeedVault (wealth wallet).
 *
 * Usage: npx ts-node scripts/recover-sol.ts
 */

import { Turnkey } from '@turnkey/sdk-server';
import { generateP256KeyPair, decryptExportBundle } from '@turnkey/crypto';
import { p256 } from '@noble/curves/p256';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

// Ancien compte Turnkey (quota épuisé)
const OLD_TURNKEY_ORG_ID   = 'ef950225-53a8-4138-bf24-47f0d7a86820';
const OLD_TURNKEY_API_PUB  = '039502b2640d239360d8e6c6e192a93b39dc0210c7b214cdd61333d741dce0dbb6';
const OLD_TURNKEY_API_PRIV = '362bf569feb2d494b59efcac1117ac90e7bd0525350a7ba77268ecc604d4d02a';

// Sub-org du compte test (trouvé dans les logs)
const SUB_ORG_ID = '1acbe2e7-0744-47a4-8b2b-f041e5cde549';

// Destination = SeedVault (wealth wallet)
const DESTINATION = 'GuLm4C6XqxGtijt67a9P1iCBtw4d6mgTJc6SHAeUFheV';

const RPC_URL = 'https://api.devnet.solana.com';
const FEE_BUFFER = 10_000; // lamports pour les frais TX

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  // 1. Init client Turnkey ancien compte
  console.log('Connecting to old Turnkey org...');
  const turnkey = new Turnkey({
    apiBaseUrl: 'https://api.turnkey.com',
    apiPrivateKey: OLD_TURNKEY_API_PRIV,
    apiPublicKey: OLD_TURNKEY_API_PUB,
    defaultOrganizationId: OLD_TURNKEY_ORG_ID,
  });
  const client = turnkey.apiClient();

  // 2. Récupérer le wallet de la sub-org
  console.log('Fetching wallet from sub-org:', SUB_ORG_ID);
  const walletsResp = await client.getWallets({ organizationId: SUB_ORG_ID });
  const wallet = walletsResp.wallets?.[0];
  if (!wallet) throw new Error('No wallet found in sub-org');
  console.log('Wallet ID:', wallet.walletId);

  // 3. Récupérer l'adresse Solana
  const accountsResp = await client.getWalletAccounts({
    organizationId: SUB_ORG_ID,
    walletId: wallet.walletId,
  });
  const account = accountsResp.accounts?.[0];
  if (!account) throw new Error('No wallet account found');
  console.log('Cash wallet address:', account.address);

  // 4. Générer une clé P256 locale (TEK = Target Embedded Key) pour l'export
  // generateP256KeyPair() retourne publicKey/privateKey en ASCII hex bytes (pas des raw bytes)
  const tek = generateP256KeyPair();
  const compressedKeyHex = Buffer.from(tek.publicKey).toString(); // ASCII → hex string "03xxxx"
  const point = p256.ProjectivePoint.fromHex(compressedKeyHex);
  const tekPublicKeyHex = Buffer.from(point.toRawBytes(false)).toString('hex'); // uncompressed 65 bytes
  console.log('TEK public key generated (uncompressed, 65 bytes, length:', tekPublicKeyHex.length / 2, ')');

  // 5. Appeler exportWalletAccount — différent de signTransaction, pas soumis au quota signing
  console.log('Exporting wallet from Turnkey...');
  const exportResp = await client.exportWalletAccount({
    organizationId: SUB_ORG_ID,
    address: account.address,
    targetPublicKey: tekPublicKeyHex,
  });

  const exportBundle = (exportResp as any).exportBundle;
  if (!exportBundle) throw new Error('No exportBundle in response: ' + JSON.stringify(exportResp));
  console.log('Export bundle received ✓');

  // 6. Déchiffrer le bundle avec la clé TEK privée
  console.log('Decrypting export bundle...');
  const privateKeyHex = await decryptExportBundle({
    exportBundle,
    embeddedKey: tek.privateKey,
    organizationId: SUB_ORG_ID,
    keyFormat: 'SOLANA',
    returnMnemonic: false,
  });
  console.log('Private key decrypted ✓, type:', typeof privateKeyHex, 'length:', privateKeyHex?.length, 'value:', String(privateKeyHex).slice(0, 20));

  // 7. Créer le Keypair Solana
  // keyFormat:'SOLANA' retourne la secret key en base58 (64 bytes = 88 chars base58)
  const secretKeyBytes = bs58.decode(privateKeyHex);
  const keypair = secretKeyBytes.length === 64
    ? Keypair.fromSecretKey(secretKeyBytes)
    : Keypair.fromSeed(secretKeyBytes);
  console.log('Keypair address:', keypair.publicKey.toBase58());
  if (keypair.publicKey.toBase58() !== account.address) {
    throw new Error(`Address mismatch! Expected ${account.address}, got ${keypair.publicKey.toBase58()}`);
  }

  // 8. Vérifier le solde
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL (${balance} lamports)`);
  if (balance <= FEE_BUFFER) {
    console.log('Balance too low to transfer. Nothing to recover.');
    return;
  }

  // 9. Construire la TX pour calculer les frais réels puis envoyer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(DESTINATION),
      lamports: 1, // placeholder pour calculer le fee
    })
  );

  const feeCalc = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
  const txFee = feeCalc.value ?? 5000;
  console.log(`TX fee: ${txFee} lamports`);

  // Envoyer balance - txFee pour drainer le compte à 0 exactement
  const transferAmount = balance - txFee;
  if (transferAmount <= 0) {
    console.log('Balance too low to transfer. Nothing to recover.');
    return;
  }
  console.log(`Transferring ${transferAmount / LAMPORTS_PER_SOL} SOL to ${DESTINATION}...`);

  // Reconstruire la TX avec le bon montant
  const finalTx = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(DESTINATION),
      lamports: transferAmount,
    })
  );

  finalTx.sign(keypair);
  const sig = await connection.sendRawTransaction(finalTx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');

  console.log('✅ SOL recovered!');
  console.log('TX signature:', sig);
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log(`Transferred ${transferAmount / LAMPORTS_PER_SOL} SOL to ${DESTINATION}`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
