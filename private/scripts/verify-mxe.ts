import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress, getClusterAccAddress } from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
const CLUSTER_OFFSET = 1078779259;
const RPC_ENDPOINT = "https://api.devnet.solana.com";

async function main() {
  console.log(" VÉRIFICATION MXE ACCOUNT\n");

  const connection = new Connection(RPC_ENDPOINT, "confirmed");

  const MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
  console.log(`MXE Account: ${MXE_ACCOUNT.toString()}\n`);

  const mxeAccountInfo = await connection.getAccountInfo(MXE_ACCOUNT);

  if (!mxeAccountInfo) {
    console.log(" ERREUR: MXE account n'existe PAS!\n");
    return;
  }

  console.log(" MXE account existe");
  console.log(`   - Owner: ${mxeAccountInfo.owner.toString()}`);
  console.log(`   - Data length: ${mxeAccountInfo.data.length} bytes\n`);

  // Extraire les données du MXE
  const data = mxeAccountInfo.data;

  // Structure MXE:
  // discriminator: 8 bytes
  // cluster_pubkey: 32 bytes (offset 9)
  // x25519_pubkey: 32 bytes (offset 41)
  // program_id: 32 bytes (offset 73)
  // bump: 1 byte (offset 105)

  const clusterPubkey = new PublicKey(data.slice(9, 41));
  const x25519Pubkey = data.slice(41, 73);
  const programId = new PublicKey(data.slice(73, 105));
  const bump = data[105];

  console.log(" MXE Configuration:");
  console.log(`   - Cluster Pubkey: ${clusterPubkey.toString()}`);
  console.log(`   - x25519 Pubkey: ${Buffer.from(x25519Pubkey).toString('hex')}`);
  console.log(`   - Program ID: ${programId.toString()}`);
  console.log(`   - Bump: ${bump}\n`);

  // Vérifier que le cluster correspond au CLUSTER_OFFSET attendu
  const expectedCluster = getClusterAccAddress(CLUSTER_OFFSET);

  console.log(" Vérification du Cluster:");
  console.log(`   - Expected Cluster: ${expectedCluster.toString()}`);
  console.log(`   - MXE Cluster: ${clusterPubkey.toString()}`);

  if (clusterPubkey.toString() === expectedCluster.toString()) {
    console.log("    Cluster MATCH!\n");
  } else {
    console.log("    ERREUR: MXE pointe vers un AUTRE cluster!\n");
  }

  // Vérifier que le program_id correspond
  console.log(" Vérification du Program ID:");
  console.log(`   - Expected: ${PROGRAM_ID.toString()}`);
  console.log(`   - MXE: ${programId.toString()}`);

  if (programId.toString() === PROGRAM_ID.toString()) {
    console.log("    Program ID MATCH!\n");
  } else {
    console.log("    ERREUR: Program ID ne correspond pas!\n");
  }

  // Vérifier que le cluster existe et est actif
  console.log(" Vérification du Cluster Account:");
  const clusterAccountInfo = await connection.getAccountInfo(expectedCluster);

  if (!clusterAccountInfo) {
    console.log("    ERREUR: Cluster account n'existe PAS!\n");
    return;
  }

  console.log("    Cluster account existe");
  console.log(`   - Data length: ${clusterAccountInfo.data.length} bytes\n`);

  // Décoder quelques infos du cluster
  const clusterData = clusterAccountInfo.data;

  // Offset 32 (après discriminator 8 + pubkey 32 = 40) → num_nodes (u32)
  const numNodes = clusterData.readUInt32LE(44);

  console.log(" Cluster Info:");
  console.log(`   - Cluster Address: ${expectedCluster.toString()}`);
  console.log(`   - Data size: ${clusterData.length} bytes`);
  console.log(`   - Estimated num nodes: ${numNodes}\n`);

  if (numNodes < 2) {
    console.log("   ️  WARNING: Cluster a moins de 2 nœuds!");
    console.log("   MPC requiert minimum 2 nœuds pour fonctionner.\n");
  } else {
    console.log(`    Cluster a ${numNodes} nœuds (suffisant pour MPC)\n`);
  }

  console.log("\n");
  console.log(" RÉSUMÉ:");

  if (clusterPubkey.toString() === expectedCluster.toString() &&
      programId.toString() === PROGRAM_ID.toString() &&
      numNodes >= 2) {
    console.log(" MXE correctement configuré et cluster actif!");
  } else {
    console.log(" Problème de configuration MXE ou cluster!");
  }

  console.log("\n");
}

main().catch(console.error);
