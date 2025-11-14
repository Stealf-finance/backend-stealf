import { PublicKey } from "@solana/web3.js";
import { getCompDefAccAddress, getArciumProgAddress, getCompDefAccOffset } from "@arcium-hq/client";

const programId = new PublicKey("A26JcC1bfDZ1wV5Vkdo4rrwDcUzorjT55a6RGp7bAfzx");
const arciumProgId = getArciumProgAddress();
const compDefSeed = Buffer.from("computation_definition_account_seed");

const offset = getCompDefAccOffset("encrypt_pda_hash");
const offsetValue = Buffer.from(offset).readUInt32LE();
const offsetBuf = Buffer.alloc(4);
offsetBuf.writeUInt32LE(offsetValue, 0);

console.log("Program ID:", programId.toBase58());
console.log("Arcium Program ID:", arciumProgId.toBase58());
console.log("Offset:", offsetValue);
console.log("Offset buffer (hex):", offsetBuf.toString("hex"));

// Method 1: Using getCompDefAccAddress from Arcium
const pda1 = getCompDefAccAddress(programId, offsetValue);
console.log("\nMethod 1 (getCompDefAccAddress):", pda1.toBase58());

// Method 2: Manual - seeds = [COMP_DEF_SEED, programId, offset] with Arcium as authority
const [pda2] = PublicKey.findProgramAddressSync(
  [compDefSeed, programId.toBuffer(), offsetBuf],
  arciumProgId
);
console.log("Method 2 (Manual with Arcium authority):", pda2.toBase58());

// Method 3: Manual - seeds = [COMP_DEF_SEED, programId, offset] with program as authority
try {
  const [pda3] = PublicKey.findProgramAddressSync(
    [compDefSeed, programId.toBuffer(), offsetBuf],
    programId
  );
  console.log("Method 3 (Manual with Program authority):", pda3.toBase58());
} catch(e: any) {
  console.log("Method 3 failed:", e.message);
}

// Check if expected address is one of these
const expected = "ABw3kCwHhWnnMSUiiL3fWYP3U82p13ymMDPgFVFSNBCs";
const received = "6Pv7CpiiYMmrNfCn86y8nsM6dcq8ozh1bh1y8jM2ZXyY";
console.log("\nExpected from test:", expected);
console.log("Received by program:", received);
console.log("Match method 1?", pda1.toBase58() === expected);
console.log("Match method 2?", pda2.toBase58() === expected);

// Try to reverse engineer what seeds would produce the "received" address
console.log("\nTrying to figure out what produces:", received);
const receivedPubkey = new PublicKey(received);

// Maybe the local Arcium uses a different Program ID?
const arx_localhost_id1 = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"); // from getArciumProgAddress()
const arx_localhost_id2 = new PublicKey("ARCxUEkhsFBXmW54HN21kkb1PsR7QvpvdqRgRgfB5Udz"); // From docs
console.log("Testing with Arcium IDs:", arx_localhost_id1.toBase58(), arx_localhost_id2.toBase58());
