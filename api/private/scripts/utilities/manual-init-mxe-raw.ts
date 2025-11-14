import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getMXEAccAddress, getArciumProgAddress } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as borsh from "borsh";

const DEVNET_RPC = "https://api.devnet.solana.com";
const CLUSTER_OFFSET = 1078779259; // v0.3.0 cluster (compatible v0.4.0 per docs)
const ARCIUM_CLUSTER_DEVNET = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🔧 Manually Initializing MXE via Raw Instruction");
  console.log("=".repeat(60));

  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  const programId = new PublicKey(idl.address);

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  console.log("\n📋 Configuration:");
  console.log("- Program ID:", programId.toString());
  console.log("- Wallet:", wallet.publicKey.toString());
  console.log("- Cluster:", ARCIUM_CLUSTER_DEVNET.toString());

  const mxeAddress = getMXEAccAddress(programId);
  console.log("\n🔑 MXE Address:", mxeAddress.toString());

  // Check if exists
  const existingAccount = await connection.getAccountInfo(mxeAddress);
  if (existingAccount) {
    console.log("✅ MXE already exists!");
    return;
  }

  console.log("\n📤 Creating init_mxe instruction...");

  const arciumProgramId = getArciumProgAddress();

  // init_mxe discriminator (8 bytes) calculated from sha256("global:init_mxe")[0..8]
  const discriminator = Buffer.from([0xd4, 0x6f, 0x9c, 0x8a, 0x9f, 0x6a, 0x2a, 0xe8]);

  // Program ID (32 bytes)
  const programIdBytes = programId.toBytes();

  // Backends vector: 1 element (Cerberus = 0)
  const backends = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00]); // Vec<u8> with one element (0)

  const data = Buffer.concat([discriminator, programIdBytes, backends]);

  const initMxeIx = new TransactionInstruction({
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: mxeAddress, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_CLUSTER_DEVNET, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: arciumProgramId,
    data,
  });

  console.log("\n📤 Sending transaction...");

  const tx = new Transaction().add(initMxeIx);
  tx.feePayer = wallet.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

  tx.sign(wallet);

  try {
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log("⏳ Confirming transaction...");

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
