import { Connection, PublicKey } from "@solana/web3.js";
import {
  getArciumProgAddress,
  getArciumAccountBaseSeed,
} from "@arcium-hq/client";

async function findMXEAccounts() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const arciumProgram = getArciumProgAddress();

  console.log("Arcium Program:", arciumProgram.toString());
  console.log("\nSearching for MXE accounts...\n");

  // Get all accounts owned by Arcium program
  const accounts = await connection.getProgramAccounts(arciumProgram, {
    filters: [
      {
        dataSize: 10500, // Approximate size of MXE account (adjust if needed)
      }
    ]
  });

  console.log(`Found ${accounts.length} potential MXE accounts:\n`);

  for (const account of accounts) {
    console.log("Address:", account.pubkey.toString());
    console.log("  Data length:", account.account.data.length);
    console.log("  Lamports:", account.account.lamports);
    console.log("  Owner:", account.account.owner.toString());

    // Try to read the first few bytes to identify the account type
    const discriminator = account.account.data.slice(0, 8);
    console.log("  Discriminator:", Buffer.from(discriminator).toString('hex'));
    console.log("");
  }

  // Also specifically check for MXE accounts with the standard seed pattern
  console.log("\n=== Checking standard MXE derivations ===\n");

  const mxeBaseSeed = getArciumAccountBaseSeed("MXEAccount");
  console.log("MXE Base Seed:", Buffer.from(mxeBaseSeed).toString('hex'));

  // Try a few common program IDs
  const testProgramIds = [
    "J6u7JTUKZKZyp4XifbUgU1BsPRHB3bNszzvn8BLWTLfR", // Our program
    "11111111111111111111111111111111", // System program (just to test)
    "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6", // Arcium program itself
  ];

  for (const programIdStr of testProgramIds) {
    const programId = new PublicKey(programIdStr);
    const [mxePDA] = PublicKey.findProgramAddressSync(
      [mxeBaseSeed, programId.toBuffer()],
      arciumProgram
    );

    const accountInfo = await connection.getAccountInfo(mxePDA);
    console.log(`Program: ${programIdStr.slice(0, 8)}...`);
    console.log(`  MXE PDA: ${mxePDA.toString()}`);
    console.log(`  Exists: ${accountInfo ? '✅ YES' : '❌ NO'}`);
    if (accountInfo) {
      console.log(`  Data length: ${accountInfo.data.length}`);
      console.log(`  Lamports: ${accountInfo.lamports}`);
    }
    console.log("");
  }
}

findMXEAccounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
