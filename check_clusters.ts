import { Connection, PublicKey } from "@solana/web3.js";
import { getClusterAccAddress } from "@arcium-hq/client";

const DEVNET_RPC = "https://api.devnet.solana.com";
const connection = new Connection(DEVNET_RPC, "confirmed");

const clusters = [1078779259, 3726127828, 768109697];

async function checkClusters() {
  console.log("Checking public clusters on devnet...\n");

  for (const offset of clusters) {
    const clusterAddress = getClusterAccAddress(offset);
    console.log(`Cluster ${offset}:`);
    console.log(`  Address: ${clusterAddress.toBase58()}`);

    try {
      const accountInfo = await connection.getAccountInfo(clusterAddress);
      if (accountInfo) {
        console.log(`  ✅ EXISTS (${accountInfo.data.length} bytes)`);
      } else {
        console.log(`  ❌ NOT INITIALIZED`);
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error}`);
    }
    console.log();
  }
}

checkClusters().catch(console.error);
