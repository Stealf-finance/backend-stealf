import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Private } from "../target/types/private";
import { getMXEAccAddress, getCompDefAccAddress, getCompDefAccOffset } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { createHash } from "crypto";

// ===================================
// CONFIGURATION
// ===================================

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const CIRCUIT_URL = "https://files.catbox.moe/rdbwrw.arcis"; // Circuit uploadé sur catbox.moe
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"); // Arcium devnet v0.4.0
const PROGRAM_ID = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX"); // v0.4.0

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🚀 Initializing private_transfer CompDef on Devnet...\n");

  // Setup connection
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const walletPath = `${os.homedir()}/.config/solana/id.json`;
  const wallet = readKpJson(walletPath);

  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load program
  console.log(`📋 Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}\n`);

  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  // Override IDL address with v0.4.0 program
  idl.address = PROGRAM_ID.toString();
  const program = new Program(idl, provider) as Program<Private>;

  // MXE v0.4.0 address
  const mxeAddress = new PublicKey("B2ngQLYTa5jn4UNP3Ut42rSDDU3qp5Hs6VXpChxHUPRW");
  console.log(`🔑 MXE Address: ${mxeAddress.toBase58()}`);
  console.log(`🔑 Arcium Program ID: ${ARCIUM_PROGRAM_ID.toBase58()}`);

  // CompDef PDA - The program expects this specific address
  // This is derived by the Arcium program using internal logic
  const compDefPDA = new PublicKey("DqmiBVbveGzsBmeUkDAg7kmjJXS6TjNuw5VsnpvGJGNr");

  console.log(`🔑 CompDef PDA: ${compDefPDA.toBase58()}`);

  // Check if already initialized
  try {
    const compDefAccount = await connection.getAccountInfo(compDefPDA);
    if (compDefAccount) {
      console.log("⚠️  CompDef already initialized!");
      console.log("✅ You can proceed to testing.\n");
      return;
    }
  } catch (err) {
    // CompDef not initialized, continue
  }

  console.log(`🌐 Circuit URL: ${CIRCUIT_URL}\n`);

  // Initialize CompDef
  try {
    console.log("⏳ Calling init_private_transfer_comp_def...");

    const tx = await program.methods
      .initPrivateTransferCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: wallet.publicKey,
        mxeAccount: mxeAddress,
      })
      .signers([wallet])
      .rpc();

    console.log(`✅ CompDef initialized!`);
    console.log(`📝 Transaction: ${tx}\n`);
    console.log(`🔗 Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  } catch (err: any) {
    console.error("❌ Error initializing CompDef:");
    console.error(err);
    throw err;
  }
}

main()
  .then(() => {
    console.log("\n✅ CompDef initialization complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
