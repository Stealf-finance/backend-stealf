import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { Private } from "../target/types/private";
import * as crypto from "crypto";
import * as fs from "fs";

// ===================================
// CONSTANTS
// ===================================

const PROGRAM_ID = new PublicKey("4wArc6jm36yGscp2d9b29dLxNdHdg2pvYbYNvJxu7dEA");
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");

// Circuit URLs on Catbox
const CIRCUITS = {
  shield: "https://files.catbox.moe/wpvcgl.arcis",
  anonymous_transfer: "https://files.catbox.moe/4wncjr.arcis",
  unshield: "https://files.catbox.moe/ub7kas.arcis",
  unshield_v2: "https://files.catbox.moe/8mprev.arcis",
};

// ===================================
// HELPER FUNCTIONS
// ===================================

/**
 * Dérive le MXE PDA pour le programme
 */
function getMXEAccount(programId: PublicKey): PublicKey {
  const [mxeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("MXEAccount"), programId.toBuffer()],
    ARCIUM_PROGRAM_ID
  );
  return mxeAccount;
}

/**
 * Dérive le CompDef PDA pour un circuit
 */
function getCompDefAccount(
  programId: PublicKey,
  circuitName: string
): PublicKey {
  const hash = crypto.createHash("sha256").update(circuitName).digest();
  const offset = hash.readUInt32LE(0);

  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(offset);

  const [compDefAccount] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ComputationDefinitionAccount"),
      programId.toBuffer(),
      offsetBuffer,
    ],
    ARCIUM_PROGRAM_ID
  );

  return compDefAccount;
}

/**
 * Vérifie si les URLs Catbox sont accessibles
 */
async function checkCircuitUrls() {
  console.log("\n Checking circuit URLs...");

  for (const [name, url] of Object.entries(CIRCUITS)) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        console.log(`   ${name}: ${url}`);
      } else {
        console.error(`   ${name}: HTTP ${response.status}`);
        throw new Error(`Circuit URL not accessible: ${url}`);
      }
    } catch (err) {
      console.error(`   ${name}: Failed to fetch`);
      throw err;
    }
  }

  console.log(" All circuit URLs are accessible!\n");
}

/**
 * Initialise une Computation Definition
 */
async function initCompDef(
  program: Program<Private>,
  provider: AnchorProvider,
  circuitName: string,
  methodName: string
) {
  console.log(`\n Initializing ${circuitName} CompDef...`);

  const mxeAccount = getMXEAccount(PROGRAM_ID);
  const compDefAccount = getCompDefAccount(PROGRAM_ID, circuitName);

  console.log(`  Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`  MXE Account: ${mxeAccount.toBase58()}`);
  console.log(`  CompDef Account: ${compDefAccount.toBase58()}`);
  console.log(`  Circuit URL: ${CIRCUITS[circuitName as keyof typeof CIRCUITS]}`);

  try {
    // Check if already initialized
    const accountInfo = await provider.connection.getAccountInfo(compDefAccount);
    if (accountInfo) {
      console.log(`  ️  ${circuitName} CompDef already initialized, skipping...`);
      return { skipped: true };
    }

    // Call the init instruction
    const tx = await (program.methods as any)[methodName]()
      .accounts({
        payer: provider.wallet.publicKey,
        mxeAccount: mxeAccount,
        compDefAccount: compDefAccount,
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    console.log(`   ${circuitName} CompDef initialized!`);
    console.log(`  Transaction: ${tx}`);
    console.log(`  Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Wait a bit for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    return { success: true, tx };
  } catch (err: any) {
    console.error(`   Failed to initialize ${circuitName} CompDef:`);
    console.error(`  Error:`, err.message);
    if (err.logs) {
      console.error(`  Logs:`, err.logs.join("\n"));
    }
    throw err;
  }
}

/**
 * Vérifie qu'une CompDef est bien initialisée
 */
async function verifyCompDef(
  provider: AnchorProvider,
  circuitName: string
): Promise<boolean> {
  const compDefAccount = getCompDefAccount(PROGRAM_ID, circuitName);
  const accountInfo = await provider.connection.getAccountInfo(compDefAccount);

  if (accountInfo) {
    console.log(`   ${circuitName}: Initialized (${accountInfo.data.length} bytes)`);
    return true;
  } else {
    console.log(`   ${circuitName}: Not initialized`);
    return false;
  }
}

// ===================================
// MAIN
// ===================================

async function main() {
  console.log("");
  console.log("    INITIALISATION DES COMPUTATION DEFINITIONS           ");
  console.log("   Anonymous Pool - Arcium MPC                              ");
  console.log("\n");

  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Arcium Program:", ARCIUM_PROGRAM_ID.toBase58());

  // Load keypair
  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log("Wallet:", payer.publicKey.toBase58());

  // Setup provider
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.3 * 1e9) {
    console.error("\n Insufficient balance. Need at least 0.3 SOL for initialization.");
    console.error("Get SOL from: https://faucet.solana.com/");
    process.exit(1);
  }

  // Check circuit URLs
  await checkCircuitUrls();

  // Load program
  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf-8"));
  const program = new Program(idl as any, provider) as Program<Private>;

  console.log("INITIALIZING COMPUTATION DEFINITIONS");

  // Initialize all CompDefs
  const results = {
    shield: await initCompDef(program, provider, "shield", "initShieldCompDef"),
    anonymous_transfer: await initCompDef(program, provider, "anonymous_transfer", "initAnonymousTransferCompDef"),
    unshield: await initCompDef(program, provider, "unshield", "initUnshieldCompDef"),
    unshield_v2: await initCompDef(program, provider, "unshield_v2", "initUnshieldV2CompDef"),
  };

  console.log("\n");
  console.log("VERIFICATION");
  console.log("\n");

  const verified = {
    shield: await verifyCompDef(provider, "shield"),
    anonymous_transfer: await verifyCompDef(provider, "anonymous_transfer"),
    unshield: await verifyCompDef(provider, "unshield"),
    unshield_v2: await verifyCompDef(provider, "unshield_v2"),
  };

  const allVerified = Object.values(verified).every(v => v);

  console.log("\n");
  if (allVerified) {
    console.log("    SUCCESS - All CompDefs Initialized!                  ");
  } else {
    console.log("   ️  PARTIAL SUCCESS - Some CompDefs failed              ");
  }
  console.log("\n");

  console.log(" Summary:");

  if (allVerified) {
    console.log("\n Your MXE is now ready to process computations!");
    console.log("\nNext steps:");
    console.log("  1. Test shield: npm test -- --grep shield");
    console.log("  2. Test transfers via your backend API");
    console.log("  3. Monitor transactions on https://explorer.solana.com/?cluster=devnet");
  } else {
    console.log("\n️  Some CompDefs failed to initialize. Check the errors above.");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n");
    console.error("    INITIALIZATION FAILED                                 ");
    console.error("\n");
    console.error(err);
    process.exit(1);
  });
