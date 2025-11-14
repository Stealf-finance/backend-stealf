import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Private } from "./target/types/private";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  buildFinalizeCompDefTx,
} from "@arcium-hq/client";
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

  // Derive CompDef PDA
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("validate_transfer");
  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

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
        mxeAccount: getMXEAccAddress(programId),
      })
      .signers([wallet])
      .rpc();

    console.log("✅ Init transaction confirmed!");
    console.log("🔗 https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

    // Finalize CompDef (upload circuit)
    console.log("\n📤 Finalizing CompDef (uploading circuit)...");
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      programId
    );

    const latestBlockhash = await connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    finalizeTx.sign(wallet);

    const finalizeSig = await provider.sendAndConfirm(finalizeTx);
    console.log("✅ Finalize transaction confirmed!");
    console.log("🔗 https://explorer.solana.com/tx/" + finalizeSig + "?cluster=devnet");

    console.log("\n🎉 Computation Definition fully initialized!");
    console.log("   Ready to execute private transfers");

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
