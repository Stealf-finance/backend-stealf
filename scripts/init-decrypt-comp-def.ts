import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";

/**
 * Initialize decrypt_transfer_amount computation definition on devnet
 */
async function initDecryptCompDef() {
  console.log("\n🔧 INITIALIZING DECRYPT COMP DEF ON DEVNET");
  console.log("=".repeat(60));

  // Setup devnet connection
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie"); // Original program with working MXE
  const idl = JSON.parse(
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<AnonymeTransfer>;

  console.log("✅ Program ID:", programId.toString());
  console.log("✅ Wallet:", wallet.publicKey.toString());
  console.log("✅ MXE Account:", getMXEAccAddress(programId).toString());

  // Get comp_def PDA
  const offset = getCompDefAccOffset("decrypt_transfer_amount");
  const offsetValue = Buffer.from(offset).readUInt32LE();
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [compDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, programId.toBuffer(), offset],
    getArciumProgAddress()
  );

  console.log("\n📋 Comp Def Info:");
  console.log("  Name: decrypt_transfer_amount");
  console.log("  Offset:", offsetValue);
  console.log("  PDA:", compDefPDA.toBase58());
  console.log("  Circuit URL: https://files.catbox.moe/hjg9mo.arcis");

  // Check if already initialized
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (accountInfo) {
    console.log("\n⚠️  Comp def already initialized!");
    console.log("   Account exists with", accountInfo.lamports / 1e9, "SOL");
    return;
  }

  // Initialize comp_def
  console.log("\n⏳ Initializing comp_def...");
  try {
    const sig = await program.methods
      .initDecryptCompDef()
      .accountsPartial({
        compDefAccount: compDefPDA,
        payer: wallet.publicKey,
        mxeAccount: getMXEAccAddress(programId),
      })
      .rpc({
        commitment: "confirmed",
        skipPreflight: false,
      });

    console.log("✅ Comp def initialized!");
    console.log("   Transaction:", sig);
    console.log("   Explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

    // Verify
    const newAccountInfo = await provider.connection.getAccountInfo(compDefPDA);
    if (newAccountInfo) {
      console.log("\n✅ Verification successful!");
      console.log("   Account size:", newAccountInfo.data.length, "bytes");
      console.log("   Lamports:", newAccountInfo.lamports / 1e9, "SOL");
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

initDecryptCompDef()
  .then(() => {
    console.log("\n✨ SUCCESS! Comp def is ready on devnet!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
