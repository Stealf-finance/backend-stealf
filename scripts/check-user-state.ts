import { Connection } from "@solana/web3.js";
import { getUserIdHash, getUserStatePDA } from "../src/services/yield/constant";

const userId = BigInt(process.argv[2] || "1");
const hash = getUserIdHash(userId);
const pda = getUserStatePDA(hash);

console.log("userId:", userId.toString());
console.log("userIdHash:", hash.toString("hex"));
console.log("UserState PDA:", pda.toBase58());

const conn = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed",
);

async function main() {
  const acc = await conn.getAccountInfo(pda);
  if (!acc) {
    console.log("\nAccount not found (no deposit for this userId yet)");
    return;
  }

  console.log("\nAccount exists!");
  console.log("  Owner:", acc.owner.toBase58());
  console.log("  Data length:", acc.data.length, "bytes");

  const data = acc.data;
  // UserState: 8 discriminator + 32 user_id_hash + 16 nonce + 32 ct_user_id + 32 ct_shares
  console.log("  user_id_hash:", data.subarray(8, 40).toString("hex"));
  console.log("  nonce (u128 LE):", data.subarray(40, 56).toString("hex"));
  console.log("  ct_user_id:", data.subarray(56, 88).toString("hex"));
  console.log("  ct_shares:", data.subarray(88, 120).toString("hex"));
}

main().catch(console.error);
