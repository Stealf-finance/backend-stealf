import { PublicKey } from '@solana/web3.js';

const ARCIUM_PROGRAM = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');
const CLUSTER_OFFSET = 1078779259;

console.log('\n=== HYPOTHÈSE: Cluster Offset → MXE ===\n');

// Peut-être que l'adresse MXE est dérivée depuis le cluster_address
// Le cluster_address est probablement dérivé depuis le cluster_offset

function getClusterAddress(clusterOffset: number): PublicKey {
  const [clusterAcc] = PublicKey.findProgramAddressSync(
    [Buffer.from('cluster_acc'), Buffer.from(clusterOffset.toString())],
    ARCIUM_PROGRAM
  );
  return clusterAcc;
}

function getClusterAddressU32(clusterOffset: number): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(clusterOffset, 0);
  const [clusterAcc] = PublicKey.findProgramAddressSync(
    [Buffer.from('cluster_acc'), buf],
    ARCIUM_PROGRAM
  );
  return clusterAcc;
}

try {
  const clusterAddr1 = getClusterAddress(CLUSTER_OFFSET);
  console.log('Cluster Address (string seed):', clusterAddr1.toBase58());

  // Maintenant dériver MXE depuis cluster address
  const [mxeFromCluster1] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_acc')],
    clusterAddr1
  );
  console.log('MXE depuis ce cluster:', mxeFromCluster1.toBase58());
} catch (e) {
  console.log('Erreur méthode 1:', e);
}

console.log('');

try {
  const clusterAddr2 = getClusterAddressU32(CLUSTER_OFFSET);
  console.log('Cluster Address (u32 seed):', clusterAddr2.toBase58());

  const [mxeFromCluster2] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_acc')],
    clusterAddr2
  );
  console.log('MXE depuis ce cluster:', mxeFromCluster2.toBase58());
} catch (e) {
  console.log('Erreur méthode 2:', e);
}

console.log('\n=== COMPARAISON ===');
console.log('MXE que arcium essaie de créer:', 'FwvDBkdAeVSeTupFxCNtf7UbMRAwTzrBoTGXAVwFrp8c');
console.log('Cluster offset:', CLUSTER_OFFSET);

// Vérifions ce qui existe on-chain pour ce cluster
console.log('\n=== VÉRIFICATION: Existe-t-il un cluster account? ===');

import { Connection } from '@solana/web3.js';
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function checkClusterAccount() {
  try {
    const clusterAddr = getClusterAddressU32(CLUSTER_OFFSET);
    const account = await connection.getAccountInfo(clusterAddr);

    if (account) {
      console.log('✅ Cluster Account existe:', clusterAddr.toBase58());
      console.log('Owner:', account.owner.toBase58());
      console.log('Data length:', account.data.length);

      // Le cluster account peut contenir le MXE address
      if (account.data.length >= 40) {
        // Essayer de lire un pubkey aux différents offsets
        for (let offset = 0; offset < Math.min(100, account.data.length - 32); offset += 8) {
          try {
            const possiblePubkey = new PublicKey(account.data.slice(offset, offset + 32));
            if (possiblePubkey.toBase58() === 'FwvDBkdAeVSeTupFxCNtf7UbMRAwTzrBoTGXAVwFrp8c') {
              console.log(`✅ TROUVÉ! MXE address est à l'offset ${offset} dans cluster account!`);
            }
          } catch (e) {
            // Pas une pubkey valide
          }
        }
      }
    } else {
      console.log('Cluster Account n\'existe pas');
    }
  } catch (e) {
    console.log('Erreur:', e);
  }
}

checkClusterAccount();
