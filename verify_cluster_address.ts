import { PublicKey } from "@solana/web3.js";
import { getClusterAccAddress } from "@arcium-hq/client";

const CLUSTER_OFFSET = 1078779259;
const USED_IN_TEST = new PublicKey("J27vR6rte1iZfhGj8RvsBfkaAjJH9HRLjcJVc4wLEzkL");
const CORRECT = getClusterAccAddress(CLUSTER_OFFSET);

console.log("Cluster offset:", CLUSTER_OFFSET);
console.log("Address used in test:", USED_IN_TEST.toBase58());
console.log("Correct address:    ", CORRECT.toBase58());
console.log("Match:", USED_IN_TEST.equals(CORRECT) ? "✅ YES" : "❌ NO");
