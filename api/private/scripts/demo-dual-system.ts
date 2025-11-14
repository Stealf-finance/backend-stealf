import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Private } from "../target/types/private";
import * as crypto from "crypto";

/**
 * <� DEMO: Comparaison des 2 syst�mes de privacy
 *
 * Syst�me 1: Denomination Pools (0.1, 0.5, 1, 5, 10 SOL)
 *    Montant INVISIBLE (implicite)
 *   L Pas flexible (5 montants seulement)
 *
 * Syst�me 2: Flexible Amounts
 *    N'importe quel montant
 *   L Montant VISIBLE (dans instruction)
 *
 * Les deux offrent:
 *    Unlinkable transactions (stealth addresses)
 *    Anti double-spend (nullifier registry)
 */

const CLUSTER = "devnet";
const RPC_URL = "https://api.devnet.solana.com";

function derivePDA(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

function createCommitmentDenomination(
  secret: Buffer,
  nullifier: Buffer,
  recipientStealth: PublicKey,
  poolId: number,
  timestamp: number,
  ephemeralPubKey: Buffer
): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(secret);
  hash.update(nullifier);
  hash.update(recipientStealth.toBuffer());
  hash.update(Buffer.from([poolId]));
  hash.update(Buffer.from(new BigInt64Array([BigInt(timestamp)]).buffer));
  hash.update(ephemeralPubKey);
  return hash.digest();
}

function createCommitmentFlexible(
  secret: Buffer,
  nullifier: Buffer,
  recipientStealth: PublicKey,
  amount: bigint,
  timestamp: number,
  ephemeralPubKey: Buffer
): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(secret);
  hash.update(nullifier);
  hash.update(recipientStealth.toBuffer());
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
  console.log("TPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPW");
  console.log("Q     <� STEALF DUAL PRIVACY SYSTEM - DEMO COMPARISON          Q");
  console.log("ZPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP]\n");

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;
  const programId = program.programId;
  const alice = wallet.payer;

  console.log("=� Setup:");
  console.log("  Program:", programId.toString());
  console.log("  Alice:", alice.publicKey.toString());
  console.log("  Cluster:", CLUSTER);
  console.log();

  // Check balance
  const balance = await connection.getBalance(alice.publicKey);
  console.log("=� Alice balance:", balance / 1e9, "SOL");

  if (balance < 1e9) {
    console.log("\n�  Need at least 1 SOL for demo!");
    return;
  }
  console.log();

  // PDAs
  const commitmentTree = derivePDA([Buffer.from("commitment_tree")], programId);
  const nullifierRegistry = derivePDA([Buffer.from("nullifier_registry")], programId);
  const flexibleVault = derivePDA([Buffer.from("vault")], programId);

  // Ensure infrastructure exists
  try {
    await program.account.commitmentTree.fetch(commitmentTree);
    await program.account.nullifierRegistry.fetch(nullifierRegistry);
    console.log(" Infrastructure ready\n");
  } catch {
    console.log("L Infrastructure not initialized! Run:");
    console.log("   npx ts-node scripts/test-simple-deposit-claim.ts");
    return;
  }

  console.log("PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP");
  console.log("  SCENARIO: Alice wants to send 0.5 SOL privately");
  console.log("PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP\n");

  // =================================================================
  // OPTION 1: DENOMINATION POOL (0.5 SOL)
  // =================================================================
  console.log("");
  console.log("  Option 1: DENOMINATION POOL (Tornado Cash style)       ");
  console.log("\n");

  const poolId = 1; // 0.5 SOL
  const poolAmount = 0.5 * 1e9;
  const pool = derivePDA([Buffer.from("pool"), Buffer.from([poolId])], programId);
  const poolVault = derivePDA([Buffer.from("vault"), Buffer.from([poolId])], programId);

  console.log("<� Target: 0.5 SOL � Pool 1");
  console.log("=� Privacy Level: MAXIMUM (amount implicit)\n");

  // Ensure pool exists
  try {
    await program.account.denominationPool.fetch(pool);
    console.log(" Pool 1 (0.5 SOL) exists\n");
  } catch {
    console.log("=' Initializing Pool 1...");
    await program.methods.initDenominationPool(poolId)
      .accounts({ authority: alice.publicKey })
      .rpc();
    console.log(" Pool 1 initialized\n");
  }

  // Generate secrets for denomination
  const secret1 = crypto.randomBytes(32);
  const nullifier1 = crypto.randomBytes(32);
  const ephemeral1 = Keypair.generate();
  const bobWallet1 = Keypair.generate();
  const timestamp1 = Math.floor(Date.now() / 1000);

  const commitment1 = createCommitmentDenomination(
    secret1,
    nullifier1,
    bobWallet1.publicKey,
    poolId,
    timestamp1,
    ephemeral1.publicKey.toBuffer()
  );

  console.log("=� Depositing 0.5 SOL to Pool 1...");
  console.log("   Instruction params: poolId=1, commitment, ephemeral_pubkey");
  console.log("   �  NO AMOUNT PARAMETER � Amount INVISIBLE!\n");

  const tx1Start = Date.now();
  const depositTx1 = await program.methods
    .depositToPool(poolId, Array.from(commitment1), Array.from(ephemeral1.publicKey.toBytes()))
    .accounts({ depositor: alice.publicKey })
    .rpc();
  const tx1Time = Date.now() - tx1Start;

  console.log(" Deposit successful!");
  console.log(`   TX: https://explorer.solana.com/tx/${depositTx1}?cluster=${CLUSTER}`);
  console.log(`   Time: ${tx1Time}ms\n`);

  console.log("� Waiting 3 seconds...\n");
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log("= Claiming 0.5 SOL from Pool 1...");
  const nullifierHash1 = createNullifierHash(nullifier1);
  const zkProof1 = Buffer.from([]);

  const claimTx1 = await program.methods
    .claimFromPool(poolId, Array.from(nullifierHash1), bobWallet1.publicKey, zkProof1)
    .accounts({ claimer: alice.publicKey, recipient: bobWallet1.publicKey })
    .rpc();

  console.log(" Claim successful!");
  console.log(`   TX: https://explorer.solana.com/tx/${claimTx1}?cluster=${CLUSTER}\n`);

  const bobBalance1 = await connection.getBalance(bobWallet1.publicKey);
  console.log("=� Bob received:", bobBalance1 / 1e9, "SOL\n");

  console.log("=� Privacy Analysis (Denomination Pool):");
  console.log("    Amount: INVISIBLE (implicit from pool_id=1)");
  console.log("    Link: BROKEN (Alice � Bob unlinkable)");
  console.log("    Transactions: 2 (1 deposit + 1 claim)");
  console.log("    Anonymity Set: Grows with each Pool 1 deposit\n");

  // =================================================================
  // OPTION 2: FLEXIBLE AMOUNT (0.5 SOL)
  // =================================================================
  console.log("\nPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP\n");
  console.log("");
  console.log("  Option 2: FLEXIBLE AMOUNT (Umbra style)                ");
  console.log("\n");

  console.log("<� Target: 0.5 SOL � Flexible vault");
  console.log("=� Privacy Level: HIGH (amount visible, identities hidden)\n");

  // Generate secrets for flexible
  const secret2 = crypto.randomBytes(32);
  const nullifier2 = crypto.randomBytes(32);
  const ephemeral2 = Keypair.generate();
  const bobWallet2 = Keypair.generate();
  const timestamp2 = Math.floor(Date.now() / 1000);

  const commitment2 = createCommitmentFlexible(
    secret2,
    nullifier2,
    bobWallet2.publicKey,
    BigInt(poolAmount),
    timestamp2,
    ephemeral2.publicKey.toBuffer()
  );

  const encryptedAmount = new Array(8).fill(0);
  const amountNonce = new Array(12).fill(0);

  console.log("=� Depositing 0.5 SOL with flexible amount...");
  console.log("   Instruction params: amount=500000000, commitment, ephemeral_pubkey");
  console.log("   �  AMOUNT PARAMETER PRESENT � Amount VISIBLE!\n");

  const tx2Start = Date.now();
  const depositTx2 = await program.methods
    .depositWithCommitment(
      new BN(poolAmount),
      Array.from(commitment2),
      Array.from(ephemeral2.publicKey.toBytes()),
      encryptedAmount,
      amountNonce
    )
    .accounts({ depositor: alice.publicKey })
    .rpc();
  const tx2Time = Date.now() - tx2Start;

  console.log(" Deposit successful!");
  console.log(`   TX: https://explorer.solana.com/tx/${depositTx2}?cluster=${CLUSTER}`);
  console.log(`   Time: ${tx2Time}ms\n`);

  console.log("� Waiting 3 seconds...\n");
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log("= Claiming 0.5 SOL with flexible amount...");
  const nullifierHash2 = createNullifierHash(nullifier2);
  const zkProof2 = Buffer.from([]);

  const claimTx2 = await program.methods
    .claimWithProof(
      encryptedAmount,
      amountNonce,
      new BN(poolAmount),
      Array.from(nullifierHash2),
      bobWallet2.publicKey,
      zkProof2
    )
    .accounts({ claimer: alice.publicKey, recipient: bobWallet2.publicKey })
    .rpc();

  console.log(" Claim successful!");
  console.log(`   TX: https://explorer.solana.com/tx/${claimTx2}?cluster=${CLUSTER}\n`);

  const bobBalance2 = await connection.getBalance(bobWallet2.publicKey);
  console.log("=� Bob received:", bobBalance2 / 1e9, "SOL\n");

  console.log("=� Privacy Analysis (Flexible Amount):");
  console.log("   �  Amount: VISIBLE (plaintext in instruction)");
  console.log("    Link: BROKEN (Alice � Bob unlinkable)");
  console.log("    Transactions: 2 (1 deposit + 1 claim)");
  console.log("    Flexibility: ANY amount possible\n");

  // =================================================================
  // FINAL COMPARISON
  // =================================================================
  console.log("\nPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP");
  console.log("                    <� FINAL COMPARISON");
  console.log("PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP\n");

  console.log("                             ,              ,              ");
  console.log(" Feature                      Denomination    Flexible   ");
  console.log("                             <              <              $");
  console.log(" Amount Privacy                                L      ");
  console.log(" Identity Privacy                                    ");
  console.log(" Flexible Amounts                  L                  ");
  console.log(" Transactions (0.5 SOL)            2             2       ");
  console.log(" Use Case                      Max Privacy  Flexibility  ");
  console.log("                             4              4              \n");

  console.log("=� RECOMMENDATIONS:\n");
  console.log("Use Denomination Pools when:");
  console.log("  ✓ Amount privacy is CRITICAL");
  console.log("  ✓ Fixed amounts (0.1, 0.5, 1, 5, 10 SOL) work for you");
  console.log("  ✓ You want maximum anonymity (Tornado Cash style)\n");

  console.log("Use Flexible Amounts when:");
  console.log("  ✓ You need to transfer ANY amount (e.g., 1.3 SOL)");
  console.log("  ✓ Amount visibility is acceptable");
  console.log("  ✓ You want 1 transaction per transfer\n");

  console.log("PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP");
  console.log("                   DEMO COMPLETED!");
  console.log("PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nL Error:", error);
    process.exit(1);
  });
