import { PublicKey } from "@solana/web3.js";
import { getClusterAccAddress } from "@arcium-hq/client";

// Cluster connu sur devnet
const TARGET_CLUSTER = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

console.log("🔍 Searching for cluster offset...");
console.log("Target cluster:", TARGET_CLUSTER.toString());
console.log("");

// Bruteforce les offsets (0 à 1 million devrait suffire)
for (let offset = 0; offset < 1000000; offset++) {
  const derived = getClusterAccAddress(offset);

  if (derived.equals(TARGET_CLUSTER)) {
    console.log("✅ FOUND!");
    console.log("Cluster Offset:", offset);
    console.log("Derived Address:", derived.toString());
    process.exit(0);
  }

  if (offset % 10000 === 0) {
    console.log(`Checked ${offset}...`);
  }
}

console.log("❌ Offset not found in range 0-1000000");
