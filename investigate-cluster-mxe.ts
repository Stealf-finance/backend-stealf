import { PublicKey } from '@solana/web3.js';

// Fonction standard pour dériver MXE depuis Program ID
function getMXEFromProgramId(programId: PublicKey): PublicKey {
  const [mxeAcc] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_acc')],
    programId
  );
  return mxeAcc;
}

// Fonction pour dériver MXE depuis cluster (si c'est comme ça qu'Arcium le fait)
function getMXEFromCluster(clusterOffset: number): PublicKey | null {
  try {
    const ARCIUM_PROGRAM = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');

    // Essayer différentes méthodes de dérivation
    const methods = [
      // Méthode 1: Utiliser cluster_offset comme seed
      () => {
        const [addr] = PublicKey.findProgramAddressSync(
          [Buffer.from('cluster'), Buffer.from(clusterOffset.toString())],
          ARCIUM_PROGRAM
        );
        return addr;
      },
      // Méthode 2: Utiliser cluster_offset comme u32
      () => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(clusterOffset, 0);
        const [addr] = PublicKey.findProgramAddressSync(
          [Buffer.from('cluster'), buf],
          ARCIUM_PROGRAM
        );
        return addr;
      },
      // Méthode 3: Utiliser cluster_offset comme u64
      () => {
        const buf = Buffer.alloc(8);
        buf.writeUInt32LE(clusterOffset, 0);
        const [addr] = PublicKey.findProgramAddressSync(
          [Buffer.from('cluster'), buf],
          ARCIUM_PROGRAM
        );
        return addr;
      }
    ];

    console.log('\n=== TENTATIVES DE DÉRIVATION DEPUIS CLUSTER ===');
    methods.forEach((method, i) => {
      try {
        const addr = method();
        console.log(`Méthode ${i + 1}: ${addr.toBase58()}`);
      } catch (e) {
        console.log(`Méthode ${i + 1}: Erreur`);
      }
    });

    return null;
  } catch (e) {
    return null;
  }
}

const CLUSTER_OFFSET = 1078779259;
const NEW_PROGRAM_ID = new PublicKey('ETCfEycvdmHqnkTJRRnPVh7byHaQ9GBL75qJLHF14xzJ');
const MYSTERIOUS_MXE = new PublicKey('FwvDBkdAeVSeTupFxCNtf7UbMRAwTzrBoTGXAVwFrp8c');
const MYSTERIOUS_PROGRAM = new PublicKey('7jzqtpfbubS2WwRehTJ79axFBYghhdL8spTzWs3AzNh');

console.log('\n=== ANALYSE DES ADRESSES ===\n');

console.log('Notre nouveau Program ID:', NEW_PROGRAM_ID.toBase58());
console.log('MXE attendu pour ce programme:', getMXEFromProgramId(NEW_PROGRAM_ID).toBase58());
console.log('');

console.log('MXE mystérieux que arcium essaie de créer:', MYSTERIOUS_MXE.toBase58());
console.log('Programme stocké dans ce MXE:', MYSTERIOUS_PROGRAM.toBase58());
console.log('MXE calculé pour ce programme:', getMXEFromProgramId(MYSTERIOUS_PROGRAM).toBase58());
console.log('');

console.log('Cluster offset utilisé:', CLUSTER_OFFSET);

// Vérifier si le MXE mystérieux correspond au programme mystérieux
const mxeForMysterious = getMXEFromProgramId(MYSTERIOUS_PROGRAM);
if (mxeForMysterious.toBase58() === MYSTERIOUS_MXE.toBase58()) {
  console.log('✅ Le MXE mystérieux CORRESPOND au Programme mystérieux!');
  console.log('   Donc arcium deploy lit le Program ID:', MYSTERIOUS_PROGRAM.toBase58());
} else {
  console.log('❌ Le MXE mystérieux NE CORRESPOND PAS au Programme mystérieux!');
}

// Essayer de dériver depuis le cluster
getMXEFromCluster(CLUSTER_OFFSET);

// Cherchons d'où vient ce Program ID 7jzqtpfbubS2WwRehTJ79axFBYghhdL8spTzWs3AzNh
console.log('\n=== RECHERCHE DU PROGRAMME MYSTÉRIEUX ===');
console.log('Program ID à chercher:', MYSTERIOUS_PROGRAM.toBase58());
