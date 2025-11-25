import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const PROGRAM_ID = new PublicKey("55RNcHf6ktm89ko4vraLGHhdkAvpuykzKP2Kosyci62E");
const RPC_URL = "https://api.devnet.solana.com";

async function main() {
  console.log("🚀 Initializing Privacy Pool...\n");

  // Load wallet
  const walletPath = `${os.homedir()}/.config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Authority:", authority.publicKey.toBase58());

  // Setup connection and provider
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load the program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/stealf_pool.json", "utf8")
  );
  const program = new Program(idl, provider);

  console.log("Program ID:", program.programId.toBase58());

  // Derive pool PDA
  const [poolPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("privacy_pool")],
    PROGRAM_ID
  );
  console.log("Pool PDA:", poolPda.toBase58());

  // Check if already initialized
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log("✅ Pool already initialized!");
    console.log("   Data length:", poolInfo.data.length);
    return;
  }

  // Initialize pool
  console.log("\n📝 Initializing pool...");
  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        pool: poolPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    console.log("✅ Pool initialized!");
    console.log("   Transaction:", tx);
    console.log("   Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  } catch (error: any) {
    console.error("❌ Failed to initialize pool:", error.message);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
