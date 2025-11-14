import { Connection, PublicKey } from "@solana/web3.js";
import { getClusterAccAddress } from "@arcium-hq/client";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const clusterOffset = 1078779259;
const clusterAddress = getClusterAccAddress(clusterOffset);

console.log("Cluster Offset:", clusterOffset);
console.log("Cluster Address:", clusterAddress.toString());

connection.getAccountInfo(clusterAddress).then(accountInfo => {
  if (accountInfo) {
    console.log("\n✅ Cluster account EXISTS!");
    console.log("   Owner:", accountInfo.owner.toString());
    console.log("   Data length:", accountInfo.data.length);
    console.log("   Lamports:", accountInfo.lamports);
    console.log("   Executable:", accountInfo.executable);
  } else {
    console.log("\n❌ Cluster account does NOT exist");
    console.log("   This means the cluster at offset", clusterOffset, "is not deployed on devnet");
  }
  process.exit(0);
}).catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
