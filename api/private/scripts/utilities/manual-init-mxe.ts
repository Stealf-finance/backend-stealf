import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getMXEAccAddress, getArciumProgAddress } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const DEVNET_RPC = "https://api.devnet.solana.com";
const CLUSTER_OFFSET = 1078779259; // v0.3.0 cluster (compatible v0.4.0 per docs)
const ARCIUM_CLUSTER_DEVNET = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🔧 Manually Initializing MXE Account");
  console.log("=".repeat(60));

  // Load current program ID from IDL
  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  const programId = new PublicKey(idl.address);

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  console.log("\n📋 Configuration:");
  console.log("- Program ID:", programId.toString());
  console.log("- Wallet:", wallet.publicKey.toString());
  console.log("- Cluster Offset:", CLUSTER_OFFSET);
  console.log("- Cluster:", ARCIUM_CLUSTER_DEVNET.toString());

  const mxeAddress = getMXEAccAddress(programId);
  console.log("\n🔑 MXE Account:", mxeAddress.toString());

  // Check if already exists
  const existingAccount = await connection.getAccountInfo(mxeAddress);
  if (existingAccount) {
    console.log("✅ MXE already exists!");
    return;
  }

  // Initialize MXE using Arcium SDK
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );

  const arciumProgramId = getArciumProgAddress();
  console.log("\n📤 Initializing MXE...");
  console.log("- Arcium Program:", arciumProgramId.toString());

  // Build init_mxe instruction
  const initMxeIx = {
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeAddress, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_CLUSTER_DEVNET, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: arciumProgramId,
    data: Buffer.from([
      0xd4, 0x6f, 0x9c, 0x8a, 0x9f, 0x6a, 0x2a, 0xe8, // init_mxe discriminator
      ...Buffer.from(programId.toBytes()),
      0x01, // backends count
      0x00, // Cerberus backend
    ]),
  };

  const tx = new Transaction().add(initMxeIx);
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);

  try {
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    console.log("✅ MXE initialized!");
    console.log("🔗 https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
    if (error.logs) {
      console.error("\n📜 Logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
