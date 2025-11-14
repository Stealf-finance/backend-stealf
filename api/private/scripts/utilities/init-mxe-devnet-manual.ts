import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  getArciumProgram,
  getArciumProgramId,
  getMXEAccAddress,
  getMempoolAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
} from "@arcium-hq/client";
import fs from "fs";

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const PROGRAM_ID = new PublicKey("GsCDpUaJnLSzBTrtu5ApjCMnpPMXUMTXMkmJUZ4RuVQd"); // From Anchor.toml
const CLUSTER_OFFSET = 1078779259; // v0.3.0 cluster (compatible v0.4.0 per docs)

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🚀 Initializing MXE manually on devnet...\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = readKpJson("/home/louis/.config/solana/id.json");

  const arciumProgramId = getArciumProgramId();

  console.log("📍 Configuration:");
  console.log("- Program ID:", PROGRAM_ID.toString());
  console.log("- Arcium Program ID:", arciumProgramId.toString());
  console.log("- Payer:", payer.publicKey.toString());
  console.log("- Cluster Offset:", CLUSTER_OFFSET);

  // Get addresses
  const mxeAddress = getMXEAccAddress(PROGRAM_ID);
  const mempoolAddress = getMempoolAccAddress(PROGRAM_ID);
  const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);
  const feePoolAddress = getFeePoolAccAddress();

  console.log("\n📦 Derived Addresses:");
  console.log("- MXE:", mxeAddress.toString());
  console.log("- Mempool:", mempoolAddress.toString());
  console.log("- Cluster:", clusterAddress.toString());
  console.log("- FeePool:", feePoolAddress.toString());

  // Check if MXE already exists
  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("\n✅ MXE already exists!");
    console.log("   Owner:", mxeInfo.owner.toString());
    console.log("   Size:", mxeInfo.data.length, "bytes");
    return;
  }

  console.log("\n🔧 Creating MXE...");

  try {
    // Setup provider
    const wallet = new Wallet(payer);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    // Get Arcium program
    const arciumProgram = getArciumProgram(provider);

    // Call initMxe instruction
    // v0.4.0 requires 2 params: clusterOffset and mempoolSize (tiny/small/medium/large)
    // Anchor v0.32+ auto-resolves PDAs
    const tx = await arciumProgram.methods
      .initMxe(CLUSTER_OFFSET, { medium: {} })
      .accounts({
        mxeProgram: PROGRAM_ID,
        mxeAuthority: payer.publicKey, // Optional but required by Anchor
      })
      .signers([payer])
      .rpc();

    console.log("✅ MXE initialized successfully!");
    console.log("   Signature:", tx);
    console.log("   Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Verify creation
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    const newMxeInfo = await connection.getAccountInfo(mxeAddress);
    if (newMxeInfo) {
      console.log("\n✅ Verification passed:");
      console.log("   MXE Address:", mxeAddress.toString());
      console.log("   Owner:", newMxeInfo.owner.toString());
      console.log("   Size:", newMxeInfo.data.length, "bytes");
    }
  } catch (error: any) {
    console.error("\n❌ Error initializing MXE:", error);
    if (error.logs) {
      console.error("\nProgram logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

main().catch(console.error);
