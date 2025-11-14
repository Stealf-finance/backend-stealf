import { Connection, PublicKey } from "@solana/web3.js";
import { getClusterAccAddress } from "@arcium-hq/client";

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const ARCIUM_PROGRAM_ID_V4 = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const ARCIUM_PROGRAM_ID_V3 = new PublicKey("Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp");
const CLUSTER_OFFSET_V4 = 768109697;
const CLUSTER_OFFSET_V3 = 1078779259;

async function main() {
  console.log("🔍 Investigating Cluster PDA derivation for v0.4.0...\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");

  // Expected address from program
  const expectedAddress = new PublicKey("AbaG7jDaUQ8rsb5CQ1K5vcXbvJ5s7izgMfyQnk4i792x");

  console.log("📍 Expected cluster address:", expectedAddress.toString());

  // Check if expected address exists
  const expectedInfo = await connection.getAccountInfo(expectedAddress);
  if (expectedInfo) {
    console.log("✅ Expected address EXISTS on devnet");
    console.log("   Owner:", expectedInfo.owner.toString());
    console.log("   Size:", expectedInfo.data.length, "bytes");
  } else {
    console.log("❌ Expected address does NOT exist on devnet");
  }

  console.log("\n🧪 Testing different derivation methods:\n");

  // Method 1: SDK with v0.4.0 offset
  console.log("1️⃣ SDK getClusterAccAddress(768109697):");
  const sdkDerivedV4 = getClusterAccAddress(CLUSTER_OFFSET_V4);
  console.log("   Result:", sdkDerivedV4.toString());
  console.log("   Match:", sdkDerivedV4.equals(expectedAddress) ? "✅ YES" : "❌ NO");

  const sdkV4Info = await connection.getAccountInfo(sdkDerivedV4);
  console.log("   Exists:", sdkV4Info ? "✅ YES" : "❌ NO");
  if (sdkV4Info) {
    console.log("   Owner:", sdkV4Info.owner.toString());
    console.log("   Size:", sdkV4Info.data.length, "bytes");
  }

  // Method 2: SDK with v0.3.0 offset
  console.log("\n2️⃣ SDK getClusterAccAddress(1078779259):");
  const sdkDerivedV3 = getClusterAccAddress(CLUSTER_OFFSET_V3);
  console.log("   Result:", sdkDerivedV3.toString());
  console.log("   Match:", sdkDerivedV3.equals(expectedAddress) ? "✅ YES" : "❌ NO");

  const sdkV3Info = await connection.getAccountInfo(sdkDerivedV3);
  console.log("   Exists:", sdkV3Info ? "✅ YES" : "❌ NO");
  if (sdkV3Info) {
    console.log("   Owner:", sdkV3Info.owner.toString());
    console.log("   Size:", sdkV3Info.data.length, "bytes");
  }

  // Method 3: Manual derivation with v0.4.0 Program ID
  console.log("\n3️⃣ Manual derivation (v0.4.0 Program ID + 'Cluster' seed):");
  const offsetBufferV4 = Buffer.alloc(4);
  offsetBufferV4.writeUInt32LE(CLUSTER_OFFSET_V4, 0);

  const [manualV4, bumpV4] = PublicKey.findProgramAddressSync(
    [Buffer.from("Cluster"), offsetBufferV4],
    ARCIUM_PROGRAM_ID_V4
  );
  console.log("   Result:", manualV4.toString());
  console.log("   Bump:", bumpV4);
  console.log("   Match:", manualV4.equals(expectedAddress) ? "✅ YES" : "❌ NO");
  console.log("   Same as SDK:", manualV4.equals(sdkDerivedV4) ? "✅ YES" : "❌ NO");

  // Method 4: Manual derivation with v0.3.0 Program ID
  console.log("\n4️⃣ Manual derivation (v0.3.0 Program ID + 'Cluster' seed):");
  const offsetBufferV3 = Buffer.alloc(4);
  offsetBufferV3.writeUInt32LE(CLUSTER_OFFSET_V4, 0);

  const [manualV3, bumpV3] = PublicKey.findProgramAddressSync(
    [Buffer.from("Cluster"), offsetBufferV3],
    ARCIUM_PROGRAM_ID_V3
  );
  console.log("   Result:", manualV3.toString());
  console.log("   Bump:", bumpV3);
  console.log("   Match:", manualV3.equals(expectedAddress) ? "✅ YES" : "❌ NO");

  // Method 5: Try with v0.3.0 offset and v0.4.0 Program ID
  console.log("\n5️⃣ Manual derivation (v0.4.0 Program ID + v0.3.0 offset):");
  const offsetBufferMixed = Buffer.alloc(4);
  offsetBufferMixed.writeUInt32LE(CLUSTER_OFFSET_V3, 0);

  const [manualMixed, bumpMixed] = PublicKey.findProgramAddressSync(
    [Buffer.from("Cluster"), offsetBufferMixed],
    ARCIUM_PROGRAM_ID_V4
  );
  console.log("   Result:", manualMixed.toString());
  console.log("   Bump:", bumpMixed);
  console.log("   Match:", manualMixed.equals(expectedAddress) ? "✅ YES" : "❌ NO");

  console.log("\n📊 Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Expected:   ", expectedAddress.toString());
  console.log("SDK v0.4.0: ", sdkDerivedV4.toString(), sdkDerivedV4.equals(expectedAddress) ? "✅" : "❌");
  console.log("SDK v0.3.0: ", sdkDerivedV3.toString(), sdkDerivedV3.equals(expectedAddress) ? "✅" : "❌");
  console.log("Manual v4:  ", manualV4.toString(), manualV4.equals(expectedAddress) ? "✅" : "❌");
  console.log("Manual v3:  ", manualV3.toString(), manualV3.equals(expectedAddress) ? "✅" : "❌");
  console.log("Mixed:      ", manualMixed.toString(), manualMixed.equals(expectedAddress) ? "✅" : "❌");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch(console.error);
