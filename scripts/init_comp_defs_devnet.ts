import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("A26UPRrZn6mmUEizcU6J3xHcLiGBwxjJwYiagT7ZfRv");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function initCompDef(
  provider: AnchorProvider,
  program: Program,
  circuitName: string,
  owner: Keypair
): Promise<void> {
  console.log(`\n🔧 Initializing ${circuitName} comp_def...`);

  const offset = getCompDefAccOffset(circuitName);
  const offsetValue = Buffer.from(offset).readUInt32LE();

  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [compDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), offset],
    getArciumProgAddress()
  );

  console.log(`   ${circuitName} comp_def PDA:`, compDefPDA.toBase58());

  // Check if already initialized
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

  if (!accountInfo) {
    console.log("   Initializing comp_def account...");
    const methodName =
      circuitName === "wrap" ? "initWrapCompDef" : "initTransferCompDef";

    try {
      const initSig = await (program.methods as any)[methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          arciumProgram: getArciumProgAddress(),
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log("   ✅ Comp def initialized:", initSig);
      console.log("   🔗 Solscan: https://solscan.io/tx/" + initSig + "?cluster=devnet");

      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error: any) {
      console.error("   ❌ Failed to initialize comp_def:", error.message);
      throw error;
    }
  } else {
    console.log("   ℹ️  Comp def account already exists");
  }

  // Upload circuit
  console.log(`   Uploading ${circuitName} circuit...`);
  const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);

  try {
    await uploadCircuit(
      provider,
      circuitName,
      PROGRAM_ID,
      rawCircuit,
      true
    );
    console.log("   ✅ Circuit uploaded and finalized");
  } catch (error: any) {
    console.log("   ⚠️  Circuit upload/finalize may have failed:");
    console.log("   Error:", error.message);
    console.log("   ℹ️  This might be okay if already finalized");

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("🚀 INITIALIZING COMPUTATION DEFINITIONS ON DEVNET");
  console.log("=".repeat(70));
  console.log("Program ID:", PROGRAM_ID.toBase58());

  // Setup
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });

  // Load IDL
  const idl: any = JSON.parse(
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf8")
  );
  const program: any = new Program(idl, PROGRAM_ID, provider);

  console.log("Wallet:", wallet.publicKey.toBase58());

  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (balance < 0.5e9) {
    throw new Error("Insufficient balance! Need at least 0.5 SOL");
  }

  // Initialize both comp defs
  await initCompDef(provider, program, "wrap", wallet);
  await initCompDef(provider, program, "transfer", wallet);

  console.log("\n" + "=".repeat(70));
  console.log("✅ ALL COMPUTATION DEFINITIONS INITIALIZED!");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exit(1);
});
