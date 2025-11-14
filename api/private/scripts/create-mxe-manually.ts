import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

const DEVNET_RPC = "https://api.devnet.solana.com";
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const PROGRAM_ID = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX");
const CLUSTER_OFFSET = 1078779259; // v0.3.0 cluster (compatible v0.4.0 per docs)

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = readKpJson("/home/louis/.config/solana/id.json");

  console.log("🔧 Checking MXE status...");
  console.log("- Program ID:", PROGRAM_ID.toString());
  console.log("- Arcium Program:", ARCIUM_PROGRAM_ID.toString());
  console.log("- Payer:", payer.publicKey.toString());

  // Calculate MXE address
  const [mxeAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()],
    ARCIUM_PROGRAM_ID
  );

  console.log("\n📍 MXE Address:", mxeAddress.toString());

  // Check if already exists
  const accountInfo = await connection.getAccountInfo(mxeAddress);
  if (accountInfo) {
    console.log("✅ MXE already exists!");
    console.log("   Owner:", accountInfo.owner.toString());
    console.log("   Size:", accountInfo.data.length, "bytes");
    return;
  }

  console.log("\n❌ MXE does not exist.");
  console.log("\n🔍 The problem: arcium CLI v0.4.0 has a bug - it uses the wrong Arcium Program ID");
  console.log("   CLI expects:", "Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp");
  console.log("   Should use:", ARCIUM_PROGRAM_ID.toString());
}

main().catch(console.error);
