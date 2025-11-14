import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Private } from "./target/types/private";
import * as fs from "fs";
import * as os from "os";

async function main() {
  console.log("🔧 Initializing Computation Definition on Devnet");
  console.log("=".repeat(60));

  // Setup
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  const programId = new PublicKey(idl.address);
  const program = new Program(idl, provider) as Program<Private>;

  console.log("📋 Configuration:");
  console.log("- Program ID:", programId.toString());
  console.log("- Wallet:", wallet.publicKey.toString());

  // MANUAL MXE ADDRESS for new program
  const mxeAccount = new PublicKey("2TjSeR3PsyfdekqaMc8wydtKHfN72MB7jVaySrC8MM27");
  console.log("- MXE Account:", mxeAccount.toString());

  // Derive CompDef PDA (using Anchor's method)
  const [compDefPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("comp_def"), programId.toBuffer(), Buffer.from("validate_transfer")],
    new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6") // Arcium program Devnet
  );

  console.log("\n🔑 Computation Definition:");
  console.log("- Name: validate_transfer");
  console.log("- PDA:", compDefPDA.toString());

  // Check if already initialized
  try {
    const account = await connection.getAccountInfo(compDefPDA);
    if (account) {
      console.log("\n✅ CompDef already initialized!");
      console.log("   Account exists with", account.data.length, "bytes");
      return;
    }
  } catch (e) {
    // Account doesn't exist, continue with init
  }

  console.log("\n📤 Initializing CompDef...");

  try {
    const sig = await program.methods
      .initValidateTransferCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: wallet.publicKey,
        mxeAccount: mxeAccount,
      })
      .signers([wallet])
      .rpc();

    console.log("✅ Init transaction confirmed!");
    console.log("🔗 https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

    console.log("\n🎉 Computation Definition initialized!");
    console.log("   Ready to finalize with circuit upload");

  } catch (error: any) {
    console.error("\n❌ Error:");
    console.error(error.message || error);
    if (error.logs) {
      console.error("\n📜 Program logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
