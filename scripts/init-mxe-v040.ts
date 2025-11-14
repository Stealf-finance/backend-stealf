import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getArciumProgAddress,
  getClusterAccAddress,
  getArciumAccountBaseSeed,
} from "@arcium-hq/client";

/**
 * Initialize MXE account for our program on Arcium 0.4.0 devnet cluster
 */
async function initMXEv040() {
  console.log("\n🔧 INITIALIZING MXE FOR ARCIUM 0.4.0");
  console.log("=".repeat(60));

  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
  const arciumProgram = getArciumProgAddress();
  const clusterOffset = 768109697; // v0.4.0 cluster for devnet
  const clusterAddress = getClusterAccAddress(clusterOffset);
  const mxeAddress = getMXEAccAddress(programId);

  console.log("Program ID:", programId.toString());
  console.log("Arcium Program:", arciumProgram.toString());
  console.log("Cluster Offset:", clusterOffset);
  console.log("Cluster Address:", clusterAddress.toString());
  console.log("MXE Address:", mxeAddress.toString());
  console.log("Payer:", wallet.publicKey.toString());

  // Check if MXE already exists
  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("\n✅ MXE account already exists!");
    console.log("   Owner:", mxeInfo.owner.toString());
    console.log("   Lamports:", mxeInfo.lamports / 1e9, "SOL");
    console.log("   Data size:", mxeInfo.data.length, "bytes");
    return;
  }

  // Check if cluster exists
  const clusterInfo = await connection.getAccountInfo(clusterAddress);
  if (!clusterInfo) {
    console.error("\n❌ Cluster account doesn't exist!");
    console.error("   Make sure the cluster", clusterOffset, "is deployed on devnet");
    process.exit(1);
  }
  console.log("\n✅ Cluster exists:");
  console.log("   Owner:", clusterInfo.owner.toString());
  console.log("   Lamports:", clusterInfo.lamports / 1e9, "SOL");

  // Derive the mempool PDA
  const mempoolSeed = Buffer.from("Mempool");
  const [mempoolAddress] = PublicKey.findProgramAddressSync(
    [mempoolSeed, programId.toBuffer()],
    arciumProgram
  );
  console.log("   Mempool Address:", mempoolAddress.toString());

  // Derive the executing_pool PDA
  const execpoolSeed = Buffer.from("ExecutingPool");
  const [execpoolAddress] = PublicKey.findProgramAddressSync(
    [execpoolSeed, programId.toBuffer()],
    arciumProgram
  );
  console.log("   Execpool Address:", execpoolAddress.toString());

  // For 0.4.0, we need to derive more accounts
  // Let me check what accounts init_mxe needs by looking at the IDL
  const keysCompDefSeed = Buffer.from("ComputationDefinitionAccount");
  const keysCompDefVersion = Buffer.from([1, 0, 0, 0]);
  const [keysCompDefAddress] = PublicKey.findProgramAddressSync(
    [keysCompDefSeed, programId.toBuffer(), keysCompDefVersion],
    arciumProgram
  );
  console.log("   Keys CompDef Address:", keysCompDefAddress.toString());

  const keygenCompSeed = Buffer.from("Computation");
  const keygenCompOffset = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]); // offset 0 for keygen
  const [keygenCompAddress] = PublicKey.findProgramAddressSync(
    [keygenCompSeed, programId.toBuffer(), keygenCompOffset],
    arciumProgram
  );
  console.log("   Keygen Comp Address:", keygenCompAddress.toString());

  console.log("\n⏳ This script identified the required accounts.");
  console.log("\n⚠️  For Arcium 0.4.0, MXE initialization may require using the Arcium");
  console.log("   infrastructure directly or waiting for the cluster operators to");
  console.log("   initialize MXE accounts for registered programs.");
  console.log("\n💡 ALTERNATIVE: Try initializing comp_def directly. If the cluster");
  console.log("   is configured properly, the comp_def initialization might work");
  console.log("   without needing a pre-initialized MXE account.");
}

initMXEv040()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
