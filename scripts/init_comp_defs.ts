import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")))
  );

  const programId = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
  const arciumProgram = getArciumProgAddress();

  console.log("Program ID:", programId.toBase58());
  console.log("Wallet:", walletKeypair.publicKey.toBase58());
  console.log("Arcium Program:", arciumProgram.toBase58());

  // Initialize wrap comp_def
  console.log("\n=== Initializing Wrap Computation Definition ===");
  const wrapOffset = getCompDefAccOffset("wrap");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, programId.toBuffer(), wrapOffset],
    arciumProgram
  );

  console.log("Wrap comp_def PDA:", wrapCompDefPDA.toBase58());

  const wrapAccountInfo = await connection.getAccountInfo(wrapCompDefPDA);
  if (!wrapAccountInfo) {
    console.log("Wrap comp_def not initialized yet");
    // We need to call init_wrap_comp_def from the program
    // For now, let's just print the account info
  } else {
    console.log("✅ Wrap comp_def already initialized");
  }

  // Initialize transfer comp_def
  console.log("\n=== Initializing Transfer Computation Definition ===");
  const transferOffset = getCompDefAccOffset("transfer");
  const [transferCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, programId.toBuffer(), transferOffset],
    arciumProgram
  );

  console.log("Transfer comp_def PDA:", transferCompDefPDA.toBase58());

  const transferAccountInfo = await connection.getAccountInfo(transferCompDefPDA);
  if (!transferAccountInfo) {
    console.log("Transfer comp_def not initialized yet");
  } else {
    console.log("✅ Transfer comp_def already initialized");
  }

  console.log("\nDone!");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
