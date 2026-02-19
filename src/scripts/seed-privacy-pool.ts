/**
 * Seed the Privacy Pool with SOL UTXOs from the vault authority.
 * This creates UTXOs that enable private yield deposits/withdrawals.
 *
 * Usage: npx ts-node src/scripts/seed-privacy-pool.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { PrivacyCash } from "privacycash";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const DENOMINATIONS = [0.1, 0.1, 0.1, 0.5]; // Total: 0.8 SOL

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKeyJson = process.env.VAULT_PRIVATE_KEY;

  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not set");
  if (!privateKeyJson) throw new Error("VAULT_PRIVATE_KEY not set");

  const privateKey = JSON.parse(privateKeyJson) as number[];

  console.log(`RPC: ${rpcUrl}`);
  console.log(`Creating PrivacyCash client...`);

  const client = new PrivacyCash({
    RPC_url: rpcUrl,
    owner: privateKey,
    enableDebug: true,
  });

  console.log(`\nSeeding Privacy Pool with ${DENOMINATIONS.length} deposits:`);
  console.log(`Denominations: ${DENOMINATIONS.join(", ")} SOL`);
  console.log(`Total: ${DENOMINATIONS.reduce((a, b) => a + b, 0)} SOL\n`);

  for (let i = 0; i < DENOMINATIONS.length; i++) {
    const amount = DENOMINATIONS[i];
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

    console.log(`[${i + 1}/${DENOMINATIONS.length}] Depositing ${amount} SOL (${lamports} lamports)...`);

    try {
      const result = await client.deposit({ lamports });
      console.log(`  ✅ TX: ${result.tx}`);
    } catch (err: any) {
      console.error(`  ❌ Failed: ${err.message}`);
      // Continue with next deposit
    }

    // Small delay between deposits
    if (i < DENOMINATIONS.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\nChecking private balance...");
  try {
    const balance = await client.getPrivateBalance();
    console.log(`Private balance: ${balance.lamports / LAMPORTS_PER_SOL} SOL (${balance.lamports} lamports)`);
  } catch (err: any) {
    console.error(`Failed to get balance: ${err.message}`);
  }

  console.log("\nDone! Privacy Pool is now seeded.");
}

main().catch(console.error);
