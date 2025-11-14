import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const PROGRAM_ID = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX"); // v0.4.0

async function main() {
  console.log("🔍 Debugging MXE account structure...\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mxeAddress = getMXEAccAddress(PROGRAM_ID);

  console.log("📍 MXE Address:", mxeAddress.toString());

  const accountInfo = await connection.getAccountInfo(mxeAddress);

  if (!accountInfo) {
    console.log("❌ MXE account does not exist");
    return;
  }

  console.log("\n📊 MXE Account Info:");
  console.log("   Owner:", accountInfo.owner.toString());
  console.log("   Size:", accountInfo.data.length, "bytes");
  console.log("   Executable:", accountInfo.executable);
  console.log("   Rent Epoch:", accountInfo.rentEpoch);

  console.log("\n🔍 Raw data analysis:");
  const data = accountInfo.data;

  // Try to parse structure
  console.log("\n   First 16 bytes (discriminator + start):");
  console.log("   ", Buffer.from(data.slice(0, 16)).toString("hex"));

  console.log("\n   Bytes 0-8 (discriminator):");
  console.log("   ", Buffer.from(data.slice(0, 8)).toString("hex"));

  console.log("\n   Bytes 8-40 (potential program_id):");
  const programIdBytes = data.slice(8, 40);
  try {
    const programId = new PublicKey(programIdBytes);
    console.log("   ", programId.toString());
  } catch (e) {
    console.log("    ❌ Invalid public key");
  }

  console.log("\n   Bytes 40-72 (potential cluster_id):");
  const clusterIdBytes = data.slice(40, 72);
  try {
    const clusterId = new PublicKey(clusterIdBytes);
    console.log("   ", clusterId.toString());
  } catch (e) {
    console.log("    ❌ Invalid public key");
  }

  console.log("\n   Bytes 72-104 (potential public_key for encryption):");
  const publicKeyBytes = data.slice(72, 104);
  console.log("   ", Buffer.from(publicKeyBytes).toString("hex"));

  console.log("\n   Remaining bytes (104 onwards):");
  if (data.length > 104) {
    console.log("   ", Buffer.from(data.slice(104)).toString("hex"));
  } else {
    console.log("    (none)");
  }

  // Check what SDK expects
  console.log("\n📋 SDK Expectations:");
  console.log("   Trying to read at offset 94 suggests:");
  console.log("   - Discriminator (8) + program_id (32) + cluster_id (32) = 72 bytes");
  console.log("   - Then trying to read public_key at offset 72");
  console.log("   - But offset 94 error means it's trying to read beyond byte 93");
  console.log("   - Account has", data.length, "bytes, so should be enough");

  console.log("\n🔬 Possible explanations:");
  console.log("   1. Different field ordering in v0.3.0 vs v0.4.0");
  console.log("   2. Additional padding or alignment bytes");
  console.log("   3. Versioning byte that shifts all fields");
  console.log("   4. Variable-length fields before public_key");

  console.log("\n💡 Recommendation:");
  console.log("   The MXE was initialized with cluster offset", 1078779259);
  console.log("   This is v0.3.0 compatible but SDK v0.4.0 expects different layout");
  console.log("   Need to either:");
  console.log("   - Re-initialize MXE with arcium deploy (using correct v0.4.0 layout)");
  console.log("   - OR test on localnet where SDK matches MXE layout");
}

main().catch(console.error);
