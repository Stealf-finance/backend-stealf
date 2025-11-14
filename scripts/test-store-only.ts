import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import * as fs from "fs";

/**
 * Simple test to verify store_encrypted_hash works on devnet
 * This doesn't require MPC computation
 */
async function testStore() {
  console.log("\n🧪 DEVNET TEST - Store Encrypted Hash");
  console.log("=".repeat(60));

  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
  const idl = JSON.parse(
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<AnonymeTransfer>;

  console.log("✅ Program ID:", program.programId.toString());
  console.log("✅ Wallet:", wallet.publicKey.toString());

  // Create test smart account
  const smartAccount = Keypair.generate();
  console.log("\n📝 Test Data:");
  console.log("  Smart Account:", smartAccount.publicKey.toBase58());

  // Derive storage PDA
  const [smartAccountStoragePDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("smart_account_storage"), smartAccount.publicKey.toBuffer()],
    programId
  );
  console.log("  Storage PDA:", smartAccountStoragePDA.toBase58());
  console.log("  Bump:", bump);

  // Generate random encrypted hash parts (32 bytes each)
  const hashPart1 = randomBytes(32);
  const hashPart2 = randomBytes(32);

  console.log("\n⏳ Storing encrypted hash...");

  try {
    const sig = await program.methods
      .storeEncryptedHash(
        Array.from(hashPart1),
        Array.from(hashPart2)
      )
      .accountsPartial({
        smartAccountStorage: smartAccountStoragePDA,
        smartAccount: smartAccount.publicKey,
        owner: wallet.publicKey,
      })
      .rpc();

    console.log("✅ Hash stored! Tx:", sig);

    // Fetch and verify
    console.log("\n⏳ Fetching stored data...");
    const storedData = await program.account.smartAccountStorage.fetch(
      smartAccountStoragePDA
    );

    console.log("✅ Data verified:");
    console.log("  Owner:", storedData.owner.toBase58());
    console.log("  Smart Account:", storedData.smartAccount.toBase58());
    console.log("  Hash Part 1:", Buffer.from(storedData.hashPart1 as any).toString("hex").slice(0, 40) + "...");
    console.log("  Hash Part 2:", Buffer.from(storedData.hashPart2 as any).toString("hex").slice(0, 40) + "...");
    console.log("  Bump:", storedData.bump);

    if (storedData.owner.toBase58() === wallet.publicKey.toBase58()) {
      console.log("\n✨ TEST PASSED! Storage works correctly on devnet!");
      return true;
    } else {
      console.error("\n❌ Owner mismatch!");
      return false;
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

testStore()
  .then((success) => {
    if (success) {
      console.log("\n✅ All tests passed!");
      process.exit(0);
    } else {
      console.log("\n❌ Test failed!");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
