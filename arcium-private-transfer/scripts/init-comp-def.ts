/**
 * Initialize Arcium Computation Definition on Devnet
 *
 * This script initializes the encrypted_transfer computation definition
 * which is required before using the Arcium private transfer program.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

const PROGRAM_ID = "8njQJYYCqeUZ37WvNW852ALRqykiUMxqHjT6KPxUKqeq";
const RPC_URL = "https://api.devnet.solana.com";

// Read keypair from file
function readKpJson(path: string): Keypair {
  const data = readFileSync(path, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(data));
  return Keypair.fromSecretKey(secretKey);
}

async function main() {
  console.log("🔧 Initializing Arcium Computation Definition...\n");

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");
  const owner = readKpJson(`${homedir()}/.config/solana/id.json`);

  console.log(`📍 Owner: ${owner.publicKey.toBase58()}`);
  console.log(`📍 Program ID: ${PROGRAM_ID}`);
  console.log(`📍 RPC: ${RPC_URL}\n`);

  // Create provider
  const wallet = new anchor.Wallet(owner);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load IDL
  const idl = JSON.parse(
    readFileSync("./target/idl/arcium_private_transfer.json", "utf-8")
  );

  const program = new Program(
    idl,
    new PublicKey(PROGRAM_ID),
    provider
  );

  try {
    console.log("⏳ Calling init_encrypted_transfer_comp_def...");

    const tx = await program.methods
      .initEncryptedTransferCompDef()
      .rpc({ commitment: "confirmed" });

    console.log("\n✅ Computation Definition Initialized!");
    console.log(`📝 Transaction: ${tx}`);
    console.log(`🔗 Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet\n`);

  } catch (error: any) {
    if (error.message?.includes("already in use")) {
      console.log("\n⚠️  Computation definition already initialized!");
      console.log("✅ You can proceed to use the program.\n");
    } else {
      console.error("\n❌ Error:", error);
      throw error;
    }
  }
}

main()
  .then(() => {
    console.log("🎉 Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
