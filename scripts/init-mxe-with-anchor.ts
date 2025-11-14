import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getArciumProgAddress,
  getClusterAccAddress,
  ARCIUM_IDL,
} from "@arcium-hq/client";

/**
 * Initialize MXE account using the Arcium program and IDL directly
 */
async function initMXEWithAnchor() {
  console.log("\n🔧 INITIALIZING MXE USING ANCHOR + ARCIUM IDL");
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
  const arciumProgramId = getArciumProgAddress();
  const clusterOffset = 768109697;
  const clusterAddress = getClusterAccAddress(clusterOffset);
  const mxeAddress = getMXEAccAddress(programId);

  console.log("Program ID:", programId.toString());
  console.log("Arcium Program:", arciumProgramId.toString());
  console.log("Cluster Offset:", clusterOffset);
  console.log("Cluster Address:", clusterAddress.toString());
  console.log("MXE Address:", mxeAddress.toString());
  console.log("Payer:", wallet.publicKey.toString());

  // Check if MXE already exists
  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("\n✅ MXE account already exists!");
    return;
  }

  // Get the Arcium IDL
  const arciumProgram = new Program(ARCIUM_IDL as any, provider);

  console.log("\n⏳ Calling initMxe instruction...");

  try {
    const tx = await arciumProgram.methods
      .initMxe({
        clusterOffset: clusterOffset,
        mempoolSize: { tiny: {} }, // Mempool size enum variant
      })
      .accountsPartial({
        signer: wallet.publicKey,
        mxe: mxeAddress,
        mxeProgram: programId,
        cluster: clusterAddress,
        systemProgram: SystemProgram.programId,
      })
      .rpc({
        commitment: "confirmed",
        skipPreflight: false,
      });

    console.log("✅ MXE initialized!");
    console.log("   Transaction:", tx);
    console.log("   Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");

    // Verify
    const newMxeInfo = await connection.getAccountInfo(mxeAddress);
    if (newMxeInfo) {
      console.log("\n✅ Verification successful!");
      console.log("   Owner:", newMxeInfo.owner.toString());
      console.log("   Data size:", newMxeInfo.data.length, "bytes");
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

initMXEWithAnchor()
  .then(() => {
    console.log("\n✨ SUCCESS!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
