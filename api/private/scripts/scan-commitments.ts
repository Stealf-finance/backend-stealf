/**
 * Scan blockchain for commitments belonging to a user
 * Umbra-style commitment scanning
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Private } from "../target/types/private";
import { scanCommitment } from "./utilities/umbra-crypto";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new web3.PublicKey("6McrLX4R1GwWngZUuLfPSoQufiMiacf9H2WRjkS68QCX");

interface DepositCommitmentEvent {
  commitment: number[];
  ephemeralPublicKey: number[];
  index: string;
  timestamp: string;
}

interface ScannedCommitment {
  commitment: Buffer;
  ephemeralPublicKey: Buffer;
  index: number;
  timestamp: number;
  belongsToUser: boolean;
}

/**
 * Fetch all DepositCommitmentEvent from blockchain
 */
async function fetchDepositEvents(
  program: Program<Private>,
  fromSlot?: number
): Promise<DepositCommitmentEvent[]> {
  console.log("📡 Fetching deposit events from blockchain...");

  try {
    // Subscribe to DepositCommitmentEvent
    // Note: This requires the event to be properly indexed

    // For now: Fetch transaction signatures and parse logs
    const signatures = await program.provider.connection.getSignaturesForAddress(
      PROGRAM_ID,
      {
        limit: 100,
      }
    );

    console.log(`  Found ${signatures.length} transactions`);

    const events: DepositCommitmentEvent[] = [];

    for (const sig of signatures) {
      try {
        const tx = await program.provider.connection.getTransaction(sig.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) continue;

        // Parse logs for DepositCommitmentEvent
        const logs = tx.meta.logMessages || [];

        for (const log of logs) {
          if (log.includes("DepositCommitmentEvent")) {
            // Extract event data from logs
            // In production: Use proper event parsing from Anchor
            console.log("  ℹ️  Found DepositCommitmentEvent in tx:", sig.signature);
            // events.push(...); // Parse and add
          }
        }
      } catch (err) {
        // Skip failed transactions
        continue;
      }
    }

    return events;
  } catch (err: any) {
    console.error("❌ Error fetching events:", err.message);
    return [];
  }
}

/**
 * Scan commitments to find which belong to the user
 */
function scanCommitmentsForUser(
  events: DepositCommitmentEvent[],
  userEncryptionPrivKey: Buffer,
  userSpendingPubkey: web3.PublicKey
): ScannedCommitment[] {
  console.log(`\n🔍 Scanning ${events.length} commitments...`);

  const results: ScannedCommitment[] = [];

  for (const event of events) {
    const commitment = Buffer.from(event.commitment);
    const ephemeralPublicKey = Buffer.from(event.ephemeralPublicKey);
    const index = parseInt(event.index);
    const timestamp = parseInt(event.timestamp);

    // Derive stealth address and check if it matches
    // Note: We need to recompute the stealth address to compare
    // This requires knowing the commitment structure

    // For now: Use scanCommitment helper
    // In production: Extract stealth address from commitment or event

    const belongsToUser = false; // Placeholder
    // const belongsToUser = scanCommitment(
    //   userEncryptionPrivKey,
    //   userSpendingPubkey,
    //   ephemeralPublicKey,
    //   stealthAddress // Need to extract this
    // );

    results.push({
      commitment,
      ephemeralPublicKey,
      index,
      timestamp,
      belongsToUser,
    });

    if (belongsToUser) {
      console.log(`  ✅ Found commitment belonging to user! Index: ${index}`);
    }
  }

  return results;
}

/**
 * Main scanning function
 */
async function main() {
  console.log("\n🔍 Umbra-Style Commitment Scanner\n");

  // Setup
  const connection = new web3.Connection(DEVNET_RPC, "confirmed");

  // User would provide their keys (from wallet)
  // For demo: Use placeholder
  const userEncryptionPrivKey = Buffer.from(
    "0000000000000000000000000000000000000000000000000000000000000000",
    "hex"
  );
  const userSpendingPubkey = web3.Keypair.generate().publicKey;

  console.log("👤 User Info:");
  console.log("  - Spending Key:", userSpendingPubkey.toString());
  console.log("  - Encryption Key: [PRIVATE]\n");

  // Initialize provider
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;

  // Fetch deposit events
  const events = await fetchDepositEvents(program);

  if (events.length === 0) {
    console.log("\n❌ No deposit events found");
    console.log("ℹ️  Make sure you've run test-umbra-flow.ts first");
    return;
  }

  // Scan commitments
  const scannedResults = scanCommitmentsForUser(
    events,
    userEncryptionPrivKey,
    userSpendingPubkey
  );

  // Display results
  console.log("\n📊 Scanning Results:");
  console.log(`  - Total commitments: ${scannedResults.length}`);
  console.log(
    `  - Belonging to user: ${scannedResults.filter((r) => r.belongsToUser).length}`
  );

  const userCommitments = scannedResults.filter((r) => r.belongsToUser);

  if (userCommitments.length > 0) {
    console.log("\n✅ Your Commitments:");
    for (const c of userCommitments) {
      console.log(`  - Index ${c.index}:`);
      console.log(`    Commitment: ${c.commitment.toString("hex").slice(0, 16)}...`);
      console.log(`    Timestamp: ${new Date(c.timestamp * 1000).toISOString()}`);
    }

    console.log("\n💡 Next Step:");
    console.log("  Use the commitment data to generate a ZK proof and claim your funds!");
  } else {
    console.log("\n❌ No commitments found for this user");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
