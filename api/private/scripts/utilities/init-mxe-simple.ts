import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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
  console.log("🔧 Initializing MXE for Current Program");
  console.log("=".repeat(60));

  // Load program ID
  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  const programId = new PublicKey(idl.address);

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );

  console.log("\n📋 Configuration:");
  console.log("- Program ID:", programId.toString());
  console.log("- Wallet:", wallet.publicKey.toString());
  console.log("- Cluster:", ARCIUM_CLUSTER_DEVNET.toString());

  const mxeAddress = getMXEAccAddress(programId);
  console.log("\n🔑 MXE Address:", mxeAddress.toString());

  // Check if exists
  const existingAccount = await connection.getAccountInfo(mxeAddress);
  if (existingAccount) {
    console.log("✅ MXE already exists with", existingAccount.data.length, "bytes");
    return;
  }

  console.log("\n📤 Initializing MXE account...");

  // Load Arcium Program IDL
  const arciumProgramId = getArciumProgAddress();
  const arciumIdl = await anchor.Program.fetchIdl(arciumProgramId, provider);

  if (!arciumIdl) {
    throw new Error("Could not fetch Arcium Program IDL");
  }

  const arciumProgram = new anchor.Program(arciumIdl, provider);

  try {
    const tx = await arciumProgram.methods
      .initMxe(programId, [0]) // [0] = Cerberus backend
      .accounts({
        payer: wallet.publicKey,
        mxeAccount: mxeAddress,
        cluster: ARCIUM_CLUSTER_DEVNET,
      })
      .rpc();

    console.log("✅ MXE initialized!");
    console.log("🔗 https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
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
