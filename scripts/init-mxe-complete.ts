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
 * Initialize MXE account with all required accounts for 0.4.0
 */
async function initMXEComplete() {
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

  const programId = new PublicKey("BxJrXXPyZfhd79jHKSoWxBWLcAEm4XFU6GZBV1pfiPgQ"); // V3 program
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

  // Derive all required PDAs
  const mempoolSeed = Buffer.from("Mempool");
  const [mempoolAddress] = PublicKey.findProgramAddressSync(
    [mempoolSeed, programId.toBuffer()],
    arciumProgramId
  );

  const execpoolSeed = Buffer.from("Execpool");
  const [execpoolAddress] = PublicKey.findProgramAddressSync(
    [execpoolSeed, programId.toBuffer()],
    arciumProgramId
  );

  const compDefSeed = Buffer.from("ComputationDefinitionAccount");
  const compDefVersion = Buffer.from([1, 0, 0, 0]);
  const [keygenCompDefAddress] = PublicKey.findProgramAddressSync(
    [compDefSeed, programId.toBuffer(), compDefVersion],
    arciumProgramId
  );

  const compSeed = Buffer.from("ComputationAccount");
  const compOffset = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
  const [keygenCompAddress] = PublicKey.findProgramAddressSync(
    [compSeed, programId.toBuffer(), compOffset],
    arciumProgramId
  );

  console.log("\n📋 Derived PDAs:");
  console.log("  Mempool:", mempoolAddress.toString());
  console.log("  Execpool:", execpoolAddress.toString());
  console.log("  Keygen CompDef:", keygenCompDefAddress.toString());
  console.log("  Keygen Comp:", keygenCompAddress.toString());

  // Create Arcium program instance
  const arciumProgram = new Program(ARCIUM_IDL as any, provider);

  console.log("\n⏳ Calling init_mxe instruction...");

  try {
    const tx = await arciumProgram.methods
      .initMxe(
        clusterOffset,
        { tiny: {} } // MempoolSize enum - Tiny variant
      )
      .accounts({
        signer: wallet.publicKey,
        mxe: mxeAddress,
        mempool: mempoolAddress,
        execpool: execpoolAddress,
        cluster: clusterAddress,
        mxeKeygenComputationDefinition: keygenCompDefAddress,
        mxeKeygenComputation: keygenCompAddress,
        mxeAuthority: null, // No authority - open to anyone
        mxeProgram: programId,
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

initMXEComplete()
  .then(() => {
    console.log("\n✨ SUCCESS!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
