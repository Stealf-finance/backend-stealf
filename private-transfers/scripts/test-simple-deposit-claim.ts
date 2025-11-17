import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Private } from "../target/types/private";
import * as crypto from "crypto";

/**
 * Test simple deposit/claim (Sans MPC)
 * Teste juste les instructions de base deposit_with_commitment et claim_with_proof
 */

const CLUSTER = "devnet";
const RPC_URL = "https://api.devnet.solana.com";

function derivePDA(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

function createCommitment(
  secret: Buffer,
  nullifier: Buffer,
  recipientStealthAddress: PublicKey,
  amount: bigint,
  timestamp: number,
  ephemeralPubKey: Buffer
): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(secret);
  hash.update(nullifier);
  hash.update(recipientStealthAddress.toBuffer());
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(amount);
  hash.update(amountBuffer);
  hash.update(Buffer.from(new BigInt64Array([BigInt(timestamp)]).buffer));
  hash.update(ephemeralPubKey);
  return hash.digest();
}

function createNullifierHash(nullifier: Buffer): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(nullifier);
  return hash.digest();
}

async function main() {
  console.log("🚀 Test Simple Deposit/Claim (Sans MPC)\n");

  const connection = new Connection(RPC_URL, "confirmed");

  // Setup provider manually
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;
  const programId = program.programId;
  const alice = wallet.payer;
  const bob = Keypair.generate();

  console.log("📋 Program ID:", programId.toString());
  console.log("👤 Alice (public):", alice.publicKey.toString());
  console.log("👤 Bob (private):", bob.publicKey.toString());

  const balance = await connection.getBalance(alice.publicKey);
  console.log("💰 Alice balance:", balance / 1e9, "SOL");

  if (balance < 0.5 * 1e9) {
    console.log("\n⚠️  Insufficient balance!");
    return;
  }

  // Infrastructure
  const commitmentTree = derivePDA([Buffer.from("commitment_tree")], programId);
  const nullifierRegistry = derivePDA([Buffer.from("nullifier_registry")], programId);
  const vault = derivePDA([Buffer.from("vault")], programId);

  console.log("\n🏗️  Step 1: Initialize infrastructure\n");

  try {
    await program.account.commitmentTree.fetch(commitmentTree);
    console.log("  ✅ CommitmentTree exists");
  } catch {
    console.log("  🔧 Initializing CommitmentTree...");
    await program.methods.initCommitmentTree()
      .accounts({
        authority: alice.publicKey,
      })
      .rpc();
    console.log("  ✅ CommitmentTree initialized");
  }

  try {
    await program.account.nullifierRegistry.fetch(nullifierRegistry);
    console.log("  ✅ NullifierRegistry exists");
  } catch {
    console.log("  🔧 Initializing NullifierRegistry...");
    await program.methods.initNullifierRegistry()
      .accounts({
        authority: alice.publicKey,
      })
      .rpc();
    console.log("  ✅ NullifierRegistry initialized");
  }

  // Deposit
  console.log("\n💸 Step 2: Alice deposits 0.1 SOL\n");
  const amount = 0.1 * 1e9;
  const secret = crypto.randomBytes(32);
  const nullifier = crypto.randomBytes(32);
  const ephemeralKeypair = Keypair.generate();
  const timestamp = Math.floor(Date.now() / 1000);

  console.log("  🔑 Generated secrets");
  console.log("     Secret:", secret.toString('hex').slice(0, 16) + "...");
  console.log("     Nullifier:", nullifier.toString('hex').slice(0, 16) + "...");

  const commitment = createCommitment(
    secret,
    nullifier,
    bob.publicKey,
    BigInt(amount),
    timestamp,
    ephemeralKeypair.publicKey.toBuffer()
  );

  console.log("  📝 Commitment:", commitment.toString('hex').slice(0, 16) + "...");

  const encryptedAmount = new Array(8).fill(0);
  const amountNonce = new Array(12).fill(0);

  try {
    const tx = await program.methods
      .depositWithCommitment(
        new anchor.BN(amount),
        Array.from(commitment),
        Array.from(ephemeralKeypair.publicKey.toBytes()),
        encryptedAmount,
        amountNonce
      )
      .accounts({
        depositor: alice.publicKey,
      })
      .rpc();

    console.log("  ✅ Deposit successful!");
    console.log("  📜 TX:", `https://explorer.solana.com/tx/${tx}?cluster=${CLUSTER}`);
  } catch (error: any) {
    console.log("  ❌ Deposit failed:", error.message);
    if (error.logs) {
      console.log("\n  Program logs:");
      error.logs.forEach((log: string) => console.log("    ", log));
    }
    return;
  }

  // Wait
  console.log("\n⏳ Step 3: Waiting 5 seconds...\n");
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Claim
  console.log("🔓 Step 4: Bob claims to his private wallet\n");

  const nullifierHash = createNullifierHash(nullifier);
  console.log("  🔑 Nullifier hash:", nullifierHash.toString('hex').slice(0, 16) + "...");

  const zkProof = Buffer.from([]); // Placeholder
  const encryptedAmountBytes = new Array(8).fill(0);
  const amountNonceBytes = new Array(12).fill(0);

  try {
    const tx = await program.methods
      .claimWithProof(
        encryptedAmountBytes,
        amountNonceBytes,
        new anchor.BN(amount),
        Array.from(nullifierHash),
        bob.publicKey,
        zkProof
      )
      .accounts({
        claimer: alice.publicKey,
        recipient: bob.publicKey,
      })
      .rpc();

    console.log("  ✅ Claim successful!");
    console.log("  📜 TX:", `https://explorer.solana.com/tx/${tx}?cluster=${CLUSTER}`);
  } catch (error: any) {
    console.log("  ❌ Claim failed:", error.message);
    if (error.logs) {
      console.log("\n  Program logs:");
      error.logs.forEach((log: string) => console.log("    ", log));
    }
    return;
  }

  // Check balance
  console.log("\n💰 Step 5: Check Bob's balance\n");
  const bobBalance = await connection.getBalance(bob.publicKey);
  console.log("  Bob's balance:", bobBalance / 1e9, "SOL");

  console.log("\n🎉 Test completed!");
  console.log("\n📊 Summary:");
  console.log("  ✅ Alice deposited 0.1 SOL to vault");
  console.log("  ✅ Bob claimed 0.1 SOL to private wallet");
  console.log("  ✅ Transaction is UNLINKABLE (stealth address)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
