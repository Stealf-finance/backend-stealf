import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getArciumProgAddress,
  getClusterAccAddress,
} from "@arcium-hq/client";

async function initMXE() {
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
  const clusterOffset = 768109697; // v0.4.0 cluster offset for devnet
  const clusterAddress = getClusterAccAddress(clusterOffset);
  const mxeAddress = getMXEAccAddress(programId);

  console.log("Program ID:", programId.toString());
  console.log("Arcium Program:", arciumProgram.toString());
  console.log("Cluster Address:", clusterAddress.toString());
  console.log("MXE Address:", mxeAddress.toString());
  console.log("Payer:", wallet.publicKey.toString());

  // Check if MXE already exists
  const mxeInfo = await connection.getAccountInfo(mxeAddress);
  if (mxeInfo) {
    console.log("\n✅ MXE account already exists!");
    process.exit(0);
  }

  console.log("\n📝 Creating InitMXE instruction manually...");

  // We need to construct the InitMXE instruction manually
  // The instruction discriminator for InitMXE in 0.4.0
  const initMxeDiscriminator = Buffer.from([
    240, 227, 11, 166, 193, 167, 25, 79
  ]);

  // Instruction data: discriminator + cluster_offset (u32 little-endian)
  const clusterOffsetBuffer = Buffer.alloc(4);
  clusterOffsetBuffer.writeUInt32LE(clusterOffset, 0);
  const data = Buffer.concat([initMxeDiscriminator, clusterOffsetBuffer]);

  const keys = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: programId, isSigner: false, isWritable: false }, // mxe_program
    { pubkey: mxeAddress, isSigner: false, isWritable: true }, // mxe_account
    { pubkey: clusterAddress, isSigner: false, isWritable: true }, // cluster
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ];

  const instruction = new anchor.web3.TransactionInstruction({
    keys,
    programId: arciumProgram,
    data,
  });

  const tx = new Transaction().add(instruction);
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = wallet.publicKey;

  console.log("\n📤 Sending transaction...");
  try {
    const signature = await provider.sendAndConfirm(tx);
    console.log("✅ MXE initialized successfully!");
    console.log("   Signature:", signature);
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

initMXE()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
