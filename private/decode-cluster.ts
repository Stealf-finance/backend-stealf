import { PublicKey, Connection } from '@solana/web3.js';

async function main() {
  const clusterAddress = new PublicKey('CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  const account = await connection.getAccountInfo(clusterAddress);

  if (!account) {
    console.log('Cluster account not found');
    return;
  }

  console.log('\n=== CLUSTER ACCOUNT ===');
  console.log('Address:', clusterAddress.toBase58());
  console.log('Owner:', account.owner.toBase58());
  console.log('Data length:', account.data.length);

  console.log('\n=== RECHERCHE DE PUBKEYS DANS LES DONNÉES ===');

  const mysterousMXE = 'FwvDBkdAeVSeTupFxCNtf7UbMRAwTzrBoTGXAVwFrp8c';
  let found = false;

  for (let offset = 0; offset <= account.data.length - 32; offset++) {
    try {
      const pubkey = new PublicKey(account.data.slice(offset, offset + 32));
      const pubkeyStr = pubkey.toBase58();

     
      if (pubkeyStr === mysterousMXE) {
        console.log(`✅ TROUVÉ! MXE ${mysterousMXE} à l'offset ${offset}`);
        found = true;
      }

      if (offset >= 8 && offset <= 100 && offset % 32 === 8) {
        console.log(`Offset ${offset}: ${pubkeyStr}`);
      }
    } catch (e) {
    }
  }

  if (!found) {
    console.log(`\n❌ MXE ${mysterousMXE} PAS trouvé dans le cluster account`);
  }

  console.log('\n=== ANALYSE DE LA STRUCTURE ===');

  console.log('Discriminator (8 bytes):', account.data.slice(0, 8).toString('hex'));

  const possibleOffset = account.data.readUInt32LE(8);
  console.log('Possible cluster_offset à offset 8:', possibleOffset);

  try {
    const pubkeyAt12 = new PublicKey(account.data.slice(12, 44));
    console.log('Pubkey à offset 12:', pubkeyAt12.toBase58());
  } catch (e) {}

  try {
    const pubkeyAt40 = new PublicKey(account.data.slice(40, 72));
    console.log('Pubkey à offset 40:', pubkeyAt40.toBase58());
  } catch (e) {}
}

main();
