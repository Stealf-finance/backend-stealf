import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Private } from "../target/types/private";
import fs from "fs";
import {
  getCompDefAccOffset,
} from "@arcium-hq/client";

// DEVNET v0.4.0 Configuration
const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const PROGRAM_ID = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX"); // v0.4.0
const ARCIUM_PROGRAM_ID_DEVNET = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"); // Arcium devnet v0.4.0
const CLUSTER_OFFSET = 768109697; // v0.4.0 native cluster
const CIRCUIT_NAME = "private_transfer";

// Custom derivation functions with correct Arcium Program ID
function getMXEAccAddressDevnet(mxeProgramId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("MXEAccount"), mxeProgramId.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getClusterAccAddressDevnet(clusterOffset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(clusterOffset, 0);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("Cluster"), offsetBuffer],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getCompDefAccAddressDevnet(mxeProgramId: PublicKey, compDefOffset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(compDefOffset, 0);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("CompDefAccount"), mxeProgramId.toBuffer(), offsetBuffer],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🚀 Initializing CompDef for private_transfer on devnet...\n");

  // Setup connection
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = readKpJson("/home/louis/.config/solana/id.json");

  console.log("📍 Configuration:");
  console.log("- Program ID:", PROGRAM_ID.toString());
  console.log("- Payer:", payer.publicKey.toString());
  console.log("- Cluster Offset:", CLUSTER_OFFSET);
  console.log("- Circuit Name:", CIRCUIT_NAME);

  // Setup Anchor provider and program
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(
    fs.readFileSync("target/idl/private.json", "utf8")
  );
  // Override IDL address with v0.4.0 program
  idl.address = PROGRAM_ID.toString();
  const program = new Program<Private>(
    idl as anchor.Idl,
    provider
  );

  // Derive addresses using custom functions
  const mxeAddress = getMXEAccAddressDevnet(PROGRAM_ID);
  const clusterAddress = getClusterAccAddressDevnet(CLUSTER_OFFSET);
  const compDefOffsetBytes = getCompDefAccOffset(CIRCUIT_NAME);
  const compDefOffset = Buffer.from(compDefOffsetBytes).readUInt32LE(0);
  const compDefAddress = getCompDefAccAddressDevnet(PROGRAM_ID, compDefOffset);

  console.log("\n📦 Derived Addresses:");
  console.log("- MXE:", mxeAddress.toString());
  console.log("- Cluster:", clusterAddress.toString());
  console.log("- CompDef Offset:", compDefOffset);
  console.log("- CompDef Address:", compDefAddress.toString());

  // Check if CompDef already exists
  const compDefInfo = await connection.getAccountInfo(compDefAddress);
  if (compDefInfo) {
    console.log("\n✅ CompDef already initialized!");
    console.log("   Owner:", compDefInfo.owner.toString());
    console.log("   Size:", compDefInfo.data.length, "bytes");
    return;
  }

  console.log("\n🔧 Initializing CompDef...");

  try {
    // Call init_private_transfer_comp_def instruction
    const tx = await program.methods
      .initPrivateTransferCompDef()
      .accountsPartial({
        payer: payer.publicKey,
        mxeAccount: mxeAddress,
        compDefAccount: compDefAddress,
      })
      .signers([payer])
      .rpc();

    console.log("✅ CompDef initialized successfully!");
    console.log("   Signature:", tx);
    console.log("   Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Verify creation
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    const newCompDefInfo = await connection.getAccountInfo(compDefAddress);
    if (newCompDefInfo) {
      console.log("\n✅ Verification passed:");
      console.log("   CompDef Address:", compDefAddress.toString());
      console.log("   Owner:", newCompDefInfo.owner.toString());
      console.log("   Size:", newCompDefInfo.data.length, "bytes");
    }
  } catch (error: any) {
    console.error("\n❌ Error initializing CompDef:", error);
    if (error.logs) {
      console.error("\nProgram logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

main().catch(console.error);
