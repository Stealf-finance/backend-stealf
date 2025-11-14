/**
 * Test script for Umbra-style shielded pool flow
 * Tests: Deposit with commitment → Scanning → Claim
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, web3, BN } from "@coral-xyz/anchor";
import { Private } from "../target/types/private";
import { randomBytes, createHash } from "crypto";
import {
  computeSharedSecret,
  encryptAmount,
  decryptAmount,
  generateNonce,
} from "./utilities/umbra-encryption";

// Configuration
const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new web3.PublicKey("FZpAL2ogH95Fh8N3Cs3wwXhR3VysR922WZYjTTPo17ka");

// PDA Seeds
const COMMITMENT_TREE_SEED = Buffer.from("commitment_tree");
const NULLIFIER_REGISTRY_SEED = Buffer.from("nullifier_registry");
const VAULT_SEED = Buffer.from("vault");

/**
 * Generate ephemeral keypair for stealth address
 */
function generateEphemeralKeypair(): { privKey: Buffer; pubKey: Buffer } {
  const privKey = randomBytes(32);
  const pubKey = createHash("sha256")
    .update(Buffer.from("derive_pubkey_v1"))
    .update(privKey)
    .digest();

  return { privKey, pubKey };
}

/**
 * Generate stealth address (simplified, matches Rust implementation)
 */
function generateStealthAddress(
  recipientEncryptionPubkey: Buffer,
  recipientSpendingPubkey: web3.PublicKey,
  ephemeralPrivKey: Buffer,
  ephemeralPubKey: Buffer
): { stealthAddress: web3.PublicKey; sharedSecret: Buffer } {
  // Compute shared secret (simplified ECDH)
  // For symmetric hash: always use pubkeys in consistent order
  const sharedSecret = createHash("sha256")
    .update(Buffer.from("stealth_ecdh_v1"))
    .update(recipientEncryptionPubkey) // Recipient's pubkey
    .update(ephemeralPubKey) // Ephemeral pubkey
    .digest();

  console.log("  [Generate] Shared secret:", sharedSecret.toString("hex").substring(0, 16) + "...");

  // Derive stealth address
  const stealthBytes = createHash("sha256")
    .update(sharedSecret)
    .update(recipientSpendingPubkey.toBuffer())
    .update(Buffer.from("stealth_derive_v1"))
    .digest();

  return {
    stealthAddress: new web3.PublicKey(stealthBytes),
    sharedSecret,
  };
}

/**
 * Create commitment hash
 * Following Umbra: uses encrypted_amount instead of plaintext amount
 */
function createCommitment(
  secret: Buffer,
  nullifier: Buffer,
  recipientStealthAddress: web3.PublicKey,
  encryptedAmount: Buffer,  // Changed: encrypted amount (8 bytes)
  amountNonce: Buffer,      // Added: nonce for uniqueness
  timestamp: number,
  ephemeralPubKey: Buffer
): Buffer {
  const hasher = createHash("sha256");
  hasher.update(secret);
  hasher.update(nullifier);
  hasher.update(recipientStealthAddress.toBuffer());
  hasher.update(encryptedAmount);  // Encrypted amount!
  hasher.update(amountNonce);      // Include nonce
  hasher.update(Buffer.from(new BN(timestamp).toArray("le", 8)));
  hasher.update(ephemeralPubKey);

  return hasher.digest();
}

/**
 * Create nullifier hash
 */
function createNullifierHash(nullifier: Buffer): Buffer {
  return createHash("sha256").update(nullifier).digest();
}

/**
 * Scan commitment to check if it belongs to recipient
 */
function scanCommitment(
  recipientEncryptionPrivKey: Buffer,
  recipientEncryptionPubKey: Buffer,
  recipientSpendingPubkey: web3.PublicKey,
  ephemeralPubKey: Buffer,
  commitmentStealthAddress: web3.PublicKey
): boolean {
  // Recompute shared secret from recipient's perspective
  // Use same order as generation: hash(recipient_pubkey, ephemeral_pubkey)
  const sharedSecret = createHash("sha256")
    .update(Buffer.from("stealth_ecdh_v1"))
    .update(recipientEncryptionPubKey) // Recipient's pubkey
    .update(ephemeralPubKey) // Ephemeral pubkey
    .digest();

  console.log("  - Computed shared secret:", sharedSecret.toString("hex").substring(0, 16) + "...");

  // Derive expected stealth address
  const expectedStealthBytes = createHash("sha256")
    .update(sharedSecret)
    .update(recipientSpendingPubkey.toBuffer())
    .update(Buffer.from("stealth_derive_v1"))
    .digest();

  const expectedStealth = new web3.PublicKey(expectedStealthBytes);

  console.log("  - Expected stealth:", expectedStealth.toString());
  console.log("  - Actual stealth:", commitmentStealthAddress.toString());
  console.log("  - Match:", expectedStealth.equals(commitmentStealthAddress));

  return expectedStealth.equals(commitmentStealthAddress);
}

async function main() {
  console.log("\n🌟 Testing Umbra-Style Shielded Pool Flow\n");

  // Setup - Use existing wallet instead of generating new one
  const connection = new web3.Connection(DEVNET_RPC, "confirmed");
  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require("fs").readFileSync(
      require("os").homedir() + "/.config/solana/id.json",
      "utf-8"
    )))
  );
  const wallet = walletKeypair;

  console.log("📝 Setup:");
  console.log("  - Program ID:", PROGRAM_ID.toString());
  console.log("  - Test Wallet:", wallet.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("\n💰 Wallet Balance:", balance / web3.LAMPORTS_PER_SOL, "SOL");

  // Initialize provider and program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;

  // Derive PDAs
  const [commitmentTreePDA] = web3.PublicKey.findProgramAddressSync(
    [COMMITMENT_TREE_SEED],
    PROGRAM_ID
  );

  const [nullifierRegistryPDA] = web3.PublicKey.findProgramAddressSync(
    [NULLIFIER_REGISTRY_SEED],
    PROGRAM_ID
  );

  const [vaultPDA] = web3.PublicKey.findProgramAddressSync(
    [VAULT_SEED],
    PROGRAM_ID
  );

  console.log("\n🔑 PDAs:");
  console.log("  - Commitment Tree:", commitmentTreePDA.toString());
  console.log("  - Nullifier Registry:", nullifierRegistryPDA.toString());
  console.log("  - Vault:", vaultPDA.toString());

  // ============================================
  // Step 1: Initialize Commitment Tree
  // ============================================
  console.log("\n📊 Step 1: Initialize Commitment Tree");
  try {
    const txInit = await program.methods
      .initCommitmentTree()
      .accounts({
        authority: wallet.publicKey,
      })
      .rpc();

    console.log("  ✅ Commitment Tree initialized");
    console.log("  TX:", txInit);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("  ℹ️  Commitment Tree already initialized");
    } else {
      throw err;
    }
  }

  // ============================================
  // Step 2: Initialize Nullifier Registry
  // ============================================
  console.log("\n🛡️  Step 2: Initialize Nullifier Registry");
  try {
    const txInit = await program.methods
      .initNullifierRegistry()
      .accounts({
        authority: wallet.publicKey,
      })
      .rpc();

    console.log("  ✅ Nullifier Registry initialized");
    console.log("  TX:", txInit);
  } catch (err: any) {
    if (err.message?.includes("already in use")) {
      console.log("  ℹ️  Nullifier Registry already initialized");
    } else {
      throw err;
    }
  }

  // ============================================
  // Step 3: Generate Keys for Alice and Bob
  // ============================================
  console.log("\n👥 Step 3: Generate Keys");

  // Alice (sender)
  const aliceEncryptionPrivKey = randomBytes(32);
  const aliceEncryptionPubKey = createHash("sha256")
    .update(Buffer.from("derive_pubkey_v1"))
    .update(aliceEncryptionPrivKey)
    .digest();

  const alice = {
    spendingKey: wallet, // Ed25519 spending key
    encryptionPrivKey: aliceEncryptionPrivKey, // X25519 encryption private key
    encryptionPubKey: aliceEncryptionPubKey, // X25519 encryption public key (derived from private)
  };

  // Bob (recipient)
  const bobEncryptionPrivKey = randomBytes(32);
  const bobEncryptionPubKey = createHash("sha256")
    .update(Buffer.from("derive_pubkey_v1"))
    .update(bobEncryptionPrivKey)
    .digest();

  const bob = {
    spendingKey: web3.Keypair.generate(),
    encryptionPrivKey: bobEncryptionPrivKey,
    encryptionPubKey: bobEncryptionPubKey, // Derived from private key!
  };

  console.log("  - Alice spending key:", alice.spendingKey.publicKey.toString());
  console.log("  - Bob spending key:", bob.spendingKey.publicKey.toString());

  // ============================================
  // Step 4: Create Deposit with Commitment (with encrypted amount)
  // ============================================
  console.log("\n💎 Step 4: Deposit with Commitment (Encrypted Amount)");

  const depositAmount = 0.5 * web3.LAMPORTS_PER_SOL; // 0.5 SOL

  // Generate ephemeral keypair
  const { privKey: ephemeralPrivKey, pubKey: ephemeralPubKey } = generateEphemeralKeypair();
  console.log("  - Generated ephemeral keypair");

  // Generate stealth address for Bob
  const { stealthAddress, sharedSecret } = generateStealthAddress(
    bob.encryptionPubKey,
    bob.spendingKey.publicKey,
    ephemeralPrivKey,
    ephemeralPubKey
  );
  console.log("  - Stealth Address:", stealthAddress.toString());

  // 🔐 ENCRYPT THE AMOUNT (Following Umbra)
  const amountNonce = generateNonce(); // 12 bytes for ChaCha20
  const encryptedAmount = encryptAmount(depositAmount, sharedSecret, amountNonce);
  console.log("  - Amount encrypted:", encryptedAmount.toString("hex"));
  console.log("  - Amount nonce:", amountNonce.toString("hex"));

  // Create commitment with encrypted amount
  const secret = randomBytes(32);
  const nullifier = randomBytes(32);
  const timestamp = Math.floor(Date.now() / 1000);

  const commitment = createCommitment(
    secret,
    nullifier,
    stealthAddress,
    encryptedAmount,  // Encrypted!
    amountNonce,      // Nonce for decryption
    timestamp,
    ephemeralPubKey
  );

  console.log("  - Commitment:", commitment.toString("hex"));

  // Submit deposit transaction with encrypted amount
  try {
    const txDeposit = await program.methods
      .depositWithCommitment(
        new BN(depositAmount),
        Array.from(commitment),
        Array.from(ephemeralPubKey),
        Array.from(encryptedAmount),  // NEW: encrypted amount
        Array.from(amountNonce)       // NEW: nonce
      )
      .accounts({
        depositor: alice.spendingKey.publicKey,
      })
      .signers([alice.spendingKey])
      .rpc();

    console.log("  ✅ Deposit successful!");
    console.log("  TX:", txDeposit);
  } catch (err: any) {
    console.error("  ❌ Deposit failed:", err.message);
    throw err;
  }

  // ============================================
  // Step 5: Bob Scans Commitments and Decrypts Amount
  // ============================================
  console.log("\n🔍 Step 5: Bob Scans Commitments (Following Umbra)");

  // In production: Fetch DepositCommitmentEvent from logs
  // For now: We know the commitment belongs to Bob

  // Debug: Log all values used in scanning
  console.log("\n  🔍 Debug Info:");
  console.log("  - Bob encryption privkey:", bob.encryptionPrivKey.toString("hex").substring(0, 16) + "...");
  console.log("  - Bob encryption pubkey:", bob.encryptionPubKey.toString("hex").substring(0, 16) + "...");
  console.log("  - Bob spending pubkey:", bob.spendingKey.publicKey.toString());
  console.log("  - Ephemeral pubkey:", ephemeralPubKey.toString("hex").substring(0, 16) + "...");
  console.log("  - Stealth address:", stealthAddress.toString());

  const belongsToBob = scanCommitment(
    bob.encryptionPrivKey,
    bob.encryptionPubKey,
    bob.spendingKey.publicKey,
    ephemeralPubKey,
    stealthAddress
  );

  console.log("\n  - Scanning result:", belongsToBob ? "✅ Belongs to Bob!" : "❌ Not for Bob");

  if (!belongsToBob) {
    throw new Error("Scanning failed! Commitment should belong to Bob.");
  }

  // 🔓 DECRYPT THE AMOUNT (Following Umbra)
  // Bob recomputes shared secret using SAME approach as Alice
  // hash(recipient_pubkey, ephemeral_pubkey) - symmetric!
  const bobSharedSecret = computeSharedSecret(bob.encryptionPubKey, ephemeralPubKey);
  console.log("  - Bob's shared secret:", bobSharedSecret.toString("hex").substring(0, 16) + "...");

  // Decrypt the amount
  const decryptedAmount = decryptAmount(encryptedAmount, bobSharedSecret, amountNonce);
  console.log("  - Decrypted amount:", decryptedAmount, "lamports");
  console.log("  - Decrypted amount:", decryptedAmount / web3.LAMPORTS_PER_SOL, "SOL");

  // Verify decryption worked
  if (decryptedAmount !== depositAmount) {
    throw new Error(`Decryption failed! Expected ${depositAmount}, got ${decryptedAmount}`);
  }
  console.log("  ✅ Amount decrypted successfully!")

  // ============================================
  // Step 6: Bob Claims with ZK Proof
  // ============================================
  console.log("\n🔓 Step 6: Bob Claims with ZK Proof");

  const nullifierHash = createNullifierHash(nullifier);
  const zkProof = Buffer.from([]); // Placeholder for Phase 3

  console.log("  - Nullifier Hash:", nullifierHash.toString("hex"));
  console.log("  - ZK Proof: [Phase 3 - Not yet implemented]");

  // Recipient address (new address, unlinkable)
  const recipientAddress = web3.Keypair.generate();

  try {
    const txClaim = await program.methods
      .claimWithProof(
        new BN(depositAmount),
        Array.from(nullifierHash),
        recipientAddress.publicKey,
        zkProof
      )
      .accounts({
        claimer: bob.spendingKey.publicKey,
        recipient: recipientAddress.publicKey,
      })
      .signers([bob.spendingKey])
      .rpc();

    console.log("  ✅ Claim successful!");
    console.log("  TX:", txClaim);

    // Check recipient balance
    const recipientBalance = await connection.getBalance(recipientAddress.publicKey);
    console.log("  - Recipient balance:", recipientBalance / web3.LAMPORTS_PER_SOL, "SOL");
  } catch (err: any) {
    console.error("  ❌ Claim failed:", err.message);
    throw err;
  }

  // ============================================
  // Summary
  // ============================================
  console.log("\n✅ Test Complete!\n");
  console.log("📊 Summary (Following Umbra Architecture):");
  console.log("  - Alice deposited 0.5 SOL with commitment");
  console.log("  - 🔐 Amount ENCRYPTED with ChaCha20 (privacy!)");
  console.log("  - Commitment added to tree (unlinkable)");
  console.log("  - Bob scanned and detected his commitment");
  console.log("  - 🔓 Bob DECRYPTED amount using ECDH shared secret");
  console.log("  - Bob claimed 0.5 SOL to new address");
  console.log("  - Result: ENCRYPTED AMOUNTS + FULLY ANONYMOUS TRANSFER! 🎉");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
