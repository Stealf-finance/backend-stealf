/**
 * Récupère les dernières transactions de l'adresse donnée et affiche les logs.
 * Usage: WALLET_ADDRESS=<addr> node scripts/fetch-umbra-tx-logs.js
 */
require('dotenv/config');
const { Connection, PublicKey } = require('@solana/web3.js');

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const UMBRA_PROGRAM = '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

if (!WALLET_ADDRESS) {
  console.error('Usage: WALLET_ADDRESS=<addr> node scripts/fetch-umbra-tx-logs.js');
  process.exit(1);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const pubkey = new PublicKey(WALLET_ADDRESS);

  console.log('[Fetch] Wallet:', WALLET_ADDRESS);
  
  // Récupérer les 10 dernières signatures
  const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
  console.log(`[Fetch] ${sigs.length} transactions trouvées\n`);

  for (const sigInfo of sigs) {
    const tx = await connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    
    if (!tx) continue;
    
    const hasUmbra = tx.transaction.message.staticAccountKeys?.some(
      k => k.toBase58() === UMBRA_PROGRAM
    ) ?? false;
    
    const errorInfo = tx.meta?.err;
    const status = errorInfo ? `❌ FAILED: ${JSON.stringify(errorInfo)}` : '✅ SUCCESS';
    const slot = tx.slot;
    
    console.log(`--- TX ${sigInfo.signature.slice(0, 12)}... ---`);
    console.log(`Slot: ${slot} | ${status}`);
    if (hasUmbra) console.log('→ Invoque le programme Umbra');
    
    if (tx.meta?.logMessages?.length) {
      console.log('Program logs:');
      tx.meta.logMessages.forEach(l => console.log('  ' + l));
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
