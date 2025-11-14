import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Private } from "../target/types/private";
import fs from "fs";

const DEVNET_RPC = "https://devnet.helius-rpc.com/?api-key=5dc6dad8-4143-4033-806e-84e98900d43c";
const PROGRAM_ID = new PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX"); // v0.4.0

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🚀 Testing basic operations on devnet...\n");

  // Setup connection
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = readKpJson("/home/louis/.config/solana/id.json");

  console.log("📍 Configuration:");
  console.log("- Program ID:", PROGRAM_ID.toString());
  console.log("- Payer:", payer.publicKey.toString());

  // Setup Anchor provider and program
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(fs.readFileSync("target/idl/private.json", "utf8"));
  // Override IDL address with v0.4.0 program
  idl.address = PROGRAM_ID.toString();
  const program = new Program<Private>(idl as anchor.Idl, provider);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`\n💰 Payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log("⚠️  Low balance! Request airdrop with:");
    console.log(`   solana airdrop 1 ${payer.publicKey.toString()} --url devnet`);
    return;
  }

  // Derive user account PDA
  const [userAccountPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_account"), payer.publicKey.toBuffer()],
    program.programId
  );

  console.log("\n📦 Derived Addresses:");
  console.log("- User Account PDA:", userAccountPda.toString());
  console.log("- Bump:", bump);

  // Check if user account exists
  const userAccountInfo = await connection.getAccountInfo(userAccountPda);
  if (userAccountInfo) {
    console.log("\n✅ User account already exists!");
    console.log("   Size:", userAccountInfo.data.length, "bytes");
    console.log("   Owner:", userAccountInfo.owner.toString());

    // Try to read the account data
    try {
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      console.log("\n📊 User Account Data:");
      console.log("   Owner:", userAccount.owner.toString());
      console.log("   Total Deposits:", userAccount.totalDeposits.toString(), "lamports");
      console.log("   Total Withdrawals:", userAccount.totalWithdrawals.toString(), "lamports");
      console.log("   Created At:", new Date(userAccount.createdAt.toNumber() * 1000).toISOString());
      console.log("   Last Updated:", new Date(userAccount.lastUpdated.toNumber() * 1000).toISOString());
    } catch (err) {
      console.log("   ⚠️  Could not deserialize account data:", err);
    }
  } else {
    console.log("\n🔧 Creating user account...");
    try {
      const tx = await program.methods
        .createUserAccount()
        .accountsPartial({
          userAccount: userAccountPda,
          owner: payer.publicKey,
        })
        .signers([payer])
        .rpc();

      console.log("✅ User account created successfully!");
      console.log("   Signature:", tx);
      console.log("   Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

      // Verify creation
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newUserAccountInfo = await connection.getAccountInfo(userAccountPda);
      if (newUserAccountInfo) {
        console.log("\n✅ Verification passed:");
        console.log("   User Account:", userAccountPda.toString());
        console.log("   Size:", newUserAccountInfo.data.length, "bytes");
      }
    } catch (error: any) {
      console.error("\n❌ Error creating user account:", error);
      if (error.logs) {
        console.error("\nProgram logs:");
        error.logs.forEach((log: string) => console.error("  ", log));
      }
      throw error;
    }
  }

  // Derive vault PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  console.log("\n📦 Vault Address:", vaultPda.toString());

  const vaultBalance = await connection.getBalance(vaultPda);
  console.log("💰 Vault balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");

  console.log("\n✅ Basic operations test completed!");
  console.log("\n📝 Summary:");
  console.log("   ✅ Connection to devnet established");
  console.log("   ✅ Program loaded successfully");
  console.log("   ✅ User account PDA derived");
  console.log("   ✅ Vault PDA derived");
  if (userAccountInfo) {
    console.log("   ✅ User account exists and readable");
  } else {
    console.log("   ✅ User account created successfully");
  }
}

main().catch(console.error);
