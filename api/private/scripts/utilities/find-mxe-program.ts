import { PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";

const targetMXE = "DfjfjMjKiWTLqcZoDfHSw8qPRJfe248gpPx1DNwSqL4Y";

const knownProgramIds = [
  "9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie", // CLAUDE.md
  "4m7V1Ks2NNRoPHpfzsq7iM6es7aUuLuFLatQaQLfjNe1", // ARCIUM_BUG_REPORT
  "2utpgDyZ4jUpCWtJVzE9HYUAngzz8pDchKgEviWPf4Q5", // Current
  "5sYfyWY3TR6dU3gs9zhwz2U8DoExncFnZMGmdisgFRwM", // Previous
  "54sPrhrNpwKaqW2Y7S3xbTaSgPKePwUQZNztUYLwvAWt", // Current keypair
  "CeuEReAhX6ZXUJRSR4wm2SGMqbmQcAaR9gbMiKz8DTNE", // init-mxe.ts
  "J6u7JTUKZKZyp4XifbUgU1BsPRHB3bNszzvn8BLWTLfR", // From error
];

console.log("🔍 Searching for program ID that generates MXE:", targetMXE);
console.log("=".repeat(70));

for (const programIdStr of knownProgramIds) {
  try {
    const programId = new PublicKey(programIdStr);
    const mxeAddress = getMXEAccAddress(programId);

    const match = mxeAddress.toString() === targetMXE ? "✅ MATCH!" : "";

    console.log(`\nProgram: ${programIdStr}`);
    console.log(`MXE:     ${mxeAddress.toString()} ${match}`);
  } catch (e) {
    console.log(`\nProgram: ${programIdStr} - INVALID`);
  }
}
