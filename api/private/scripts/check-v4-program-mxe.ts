import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress, getClusterAccAddress } from "@arcium-hq/client";

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const PROGRAM_ID_V4 = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX");
const CLUSTER_OFFSET = 768109697;

async function main() {
  console.log("🔍 Checking v0.4.0 program MXE status...\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");

  console.log("📍 Configuration:");
  console.log("   Program ID:", PROGRAM_ID_V4.toString());
  console.log("   Cluster Offset:", CLUSTER_OFFSET);

  // Derive addresses
  const mxeAddress = getMXEAccAddress(PROGRAM_ID_V4);
  const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);

  console.log("\n📦 Derived Addresses:");
  console.log("   MXE:", mxeAddress.toString());
  console.log("   Cluster:", clusterAddress.toString());

  // Check MXE
  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("\n✅ MXE Account EXISTS:");
    console.log("   Owner:", mxeInfo.owner.toString());
    console.log("   Size:", mxeInfo.data.length, "bytes");
    console.log("   Lamports:", mxeInfo.lamports / 1e9, "SOL");
  } else {
    console.log("\n❌ MXE Account does NOT exist");
    console.log("   Need to run: arcium deploy --cluster-offset", CLUSTER_OFFSET, "--skip-deploy");
  }

  // Check Cluster
  const clusterInfo = await connection.getAccountInfo(clusterAddress);
  if (clusterInfo) {
    console.log("\n✅ Cluster Account EXISTS:");
    console.log("   Owner:", clusterInfo.owner.toString());
    console.log("   Size:", clusterInfo.data.length, "bytes");
    console.log("   Lamports:", clusterInfo.lamports / 1e9, "SOL");
  } else {
    console.log("\n❌ Cluster Account does NOT exist");
  }

  console.log("\n📋 Summary:");
  if (!mxeInfo && clusterInfo) {
    console.log("   ✅ Cluster exists");
    console.log("   ❌ MXE needs initialization");
    console.log("\n💡 Solution:");
    console.log("   The MXE can be initialized by running:");
    console.log("   arcium deploy --cluster-offset 768109697 --skip-deploy");
    console.log("\n   This will:");
    console.log("   1. Skip program deployment (already deployed)");
    console.log("   2. Initialize MXE with correct v0.4.0 layout");
    console.log("   3. Link to existing cluster");
  } else if (mxeInfo && clusterInfo) {
    console.log("   ✅ Both MXE and Cluster exist");
    console.log("   ✅ Ready for private transfers!");
  } else if (!clusterInfo) {
    console.log("   ❌ Cluster does not exist - this offset may be invalid");
  }
}

main().catch(console.error);
