import { PublicKey } from '@solana/web3.js';
import { Connection } from '@solana/web3.js';

// Fonction pour dériver l'adresse MXE
function getMXEAccAddress(programId: PublicKey): PublicKey {
  const [mxeAcc] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_acc')],
    programId
  );
  return mxeAcc;
}

const PROGRAM_ID = new PublicKey('ETCfEycvdmHqnkTJRRnPVh7byHaQ9GBL75qJLHF14xzJ');
const ARCIUM_PROGRAM = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');

async function main() {
  const expectedMXE = getMXEAccAddress(PROGRAM_ID);
  console.log('\n=== VÉRIFICATION MXE ===');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Expected MXE Address:', expectedMXE.toBase58());
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  try {
    const mxeAccountInfo = await connection.getAccountInfo(expectedMXE);
    
    if (!mxeAccountInfo) {
      console.log('❌ MXE account not found!');
      process.exit(1);
    }
    
    console.log('✅ MXE Account exists');
    console.log('Owner:', mxeAccountInfo.owner.toBase58());
    
    if (mxeAccountInfo.owner.toBase58() === ARCIUM_PROGRAM.toBase58()) {
      console.log('✅ MXE Owner is correct (Arcium Program)');
    } else {
      console.log('❌ MXE Owner is WRONG!');
      console.log('Expected:', ARCIUM_PROGRAM.toBase58());
      console.log('Got:', mxeAccountInfo.owner.toBase58());
    }
    
    // Décoder les données MXE
    const data = mxeAccountInfo.data;
    console.log('\nMXE Data length:', data.length);
    
    // Les 8 premiers bytes sont le discriminator
    // Ensuite vient le Program ID (32 bytes)
    if (data.length >= 40) {
      const storedProgramId = new PublicKey(data.slice(8, 40));
      console.log('Stored Program ID in MXE:', storedProgramId.toBase58());
      
      if (storedProgramId.toBase58() === PROGRAM_ID.toBase58()) {
        console.log('✅ MXE pointe vers le CORRECT Program ID!');
      } else {
        console.log('❌ MXE pointe vers le MAUVAIS Program ID!');
        console.log('Expected:', PROGRAM_ID.toBase58());
        console.log('Got:', storedProgramId.toBase58());
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
