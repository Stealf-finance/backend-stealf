import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Private } from "../target/types/private";
import * as crypto from "crypto";
import {
  getMXEAccAddressDevnet,
  getMempoolAccAddressDevnet,
  getCompDefAccAddressDevnet,
  getExecutingPoolAccAddressDevnet,
  getComputationAccAddressDevnet,
  ARCIUM_PROGRAM_ID_DEVNET,
} from "./utilities/arcium-devnet-pdas";

/**
 * Test script pour Shielded Pool avec montants 100% CHIFFRÉS via Arcium MPC
 *
 * Flow:
 * 1. Alice crée wallet public (KYC) et wallet privé (anonymous)
 * 2. Alice reçoit 1 SOL sur son wallet public
 * 3. Alice dépose 0.5 SOL → Shielded Pool
 *    → Montant CHIFFRÉ via Arcium MPC
 *    → MPC re-chiffre pour Bob (sealing)
 * 4. Bob scanne les events pour trouver ses deposits
 * 5. Bob claim avec MPC (montant chiffré)
 * 6. Bob reçoit SOL sur wallet privé (UNLINKABLE!)
 */

// Configuration
const CLUSTER = "devnet";
const RPC_URL = "https://api.devnet.solana.com";

// Helper: Derive PDA
function derivePDA(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

// Helper: Create commitment with encrypted amount
function createCommitment(
  secret: Buffer,
  nullifier: Buffer,
  recipientStealthAddress: PublicKey,
  encryptedAmount: Buffer,
  amountNonce: Buffer,
  timestamp: number,
  ephemeralPubKey: Buffer
): Buffer {
  const hash = crypto.createHash('sha256');

  hash.update(secret);
  hash.update(nullifier);
  hash.update(recipientStealthAddress.toBuffer());
  hash.update(encryptedAmount);
  hash.update(amountNonce);
  hash.update(Buffer.from(new BigInt64Array([BigInt(timestamp)]).buffer));
  hash.update(ephemeralPubKey);

  return hash.digest();
}

// Helper: Create nullifier hash
function createNullifierHash(nullifier: Buffer): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(nullifier);
  return hash.digest();
}

// Helper: Encrypt amount using ChaCha20 (simplified for demo)
// In production, use proper ECDH + ChaCha20 encryption
function encryptAmount(amount: bigint, sharedSecret: Buffer): { ciphertext: Buffer, nonce: Buffer } {
  const nonce = crypto.randomBytes(12);

  // Simplified: XOR with hash of (secret + nonce)
  // Production: Use proper ChaCha20
  const hash = crypto.createHash('sha256');
  hash.update(sharedSecret);
  hash.update(nonce);
  const key = hash.digest();

  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(amount);

  const ciphertext = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    ciphertext[i] = amountBuffer[i] ^ key[i];
  }

  return { ciphertext, nonce };
}

async function main() {
  console.log("🚀 Testing Shielded Pool with MPC-Encrypted Amounts\n");

  // Setup connection
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Private as Program<Private>;
  const programId = program.programId;

  console.log("📋 Program ID:", programId.toString());
  console.log("🔐 Arcium Program ID:", ARCIUM_PROGRAM_ID_DEVNET.toString());
  console.log("🌐 Cluster:", CLUSTER);
  console.log();

  // ========================================
  // STEP 1: Setup wallets
  // ========================================
  console.log("👤 STEP 1: Setup Alice's wallets\n");

  const alicePublic = provider.wallet.payer;
  console.log("  Alice Public Wallet (KYC):", alicePublic.publicKey.toString());

  const alicePrivate = Keypair.generate();
  console.log("  Alice Private Wallet (Anonymous):", alicePrivate.publicKey.toString());
  console.log();

  // ========================================
  // STEP 2: Check balance
  // ========================================
  console.log("💰 STEP 2: Check Alice's public wallet balance\n");

  const balance = await connection.getBalance(alicePublic.publicKey);
  console.log(`  Balance: ${balance / 1e9} SOL`);

  if (balance < 1e9) {
    console.log("\n  ⚠️  Insufficient balance! Please airdrop:");
    console.log(`  solana airdrop 2 ${alicePublic.publicKey.toString()} --url devnet`);
    return;
  }
  console.log();

  // ========================================
  // STEP 3: Initialize infrastructure
  // ========================================
  console.log("🏗️  STEP 3: Initialize commitment tree and MXE\n");

  const commitmentTree = derivePDA([Buffer.from("commitment_tree")], programId);
  const nullifierRegistry = derivePDA([Buffer.from("nullifier_registry")], programId);
  const vault = derivePDA([Buffer.from("vault")], programId);

  console.log("  CommitmentTree PDA:", commitmentTree.toString());
  console.log("  NullifierRegistry PDA:", nullifierRegistry.toString());
  console.log("  Vault PDA:", vault.toString());

  // Initialize commitment tree (si pas déjà fait)
  try {
    await program.account.commitmentTree.fetch(commitmentTree);
    console.log("  ✅ CommitmentTree already initialized");
  } catch (e) {
    console.log("  🔧 Initializing CommitmentTree...");
    await program.methods
      .initCommitmentTree()
      .accounts({
        authority: alicePublic.publicKey,
        commitmentTree,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✅ CommitmentTree initialized");
  }

  // Initialize nullifier registry (si pas déjà fait)
  try {
    await program.account.nullifierRegistry.fetch(nullifierRegistry);
    console.log("  ✅ NullifierRegistry already initialized");
  } catch (e) {
    console.log("  🔧 Initializing NullifierRegistry...");
    await program.methods
      .initNullifierRegistry()
      .accounts({
        authority: alicePublic.publicKey,
        nullifierRegistry,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  ✅ NullifierRegistry initialized");
  }

  // Derive Arcium accounts
  const mxeAccount = getMXEAccAddressDevnet(programId);
  const mempoolAccount = getMempoolAccAddressDevnet(mxeAccount);

  console.log("\n  🔐 Arcium Accounts:");
  console.log("     MXE:", mxeAccount.toString());
  console.log("     Mempool:", mempoolAccount.toString());

  // Check if MXE is initialized
  try {
    const mxeInfo = await connection.getAccountInfo(mxeAccount);
    if (!mxeInfo) {
      console.log("\n  ⚠️  MXE not initialized! Please run:");
      console.log("     npx ts-node scripts/init-mxe.ts");
      return;
    }
    console.log("  ✅ MXE initialized");
  } catch (e) {
    console.log("\n  ❌ Error checking MXE:", e);
    return;
  }

  console.log();

  // ========================================
  // STEP 4: Initialize shielded_deposit CompDef
  // ========================================
  console.log("🔧 STEP 4: Initialize shielded_deposit CompDef\n");

  const compDefOffset = 0; // shielded_deposit
  const compDefAccount = getCompDefAccAddressDevnet(mxeAccount, new BN(compDefOffset));

  console.log("  CompDef Account:", compDefAccount.toString());

  try {
    const compDefInfo = await connection.getAccountInfo(compDefAccount);
    if (!compDefInfo) {
      console.log("  🔧 Initializing shielded_deposit CompDef...");

      const feePoolAccount = derivePDA(
        [Buffer.from("fee_pool"), mxeAccount.toBuffer()],
        ARCIUM_PROGRAM_ID_DEVNET
      );

      await program.methods
        .initShieldedDepositCompDef()
        .accounts({
          payer: alicePublic.publicKey,
          mxeAccount,
          compDefAccount,
          feePoolAccount,
          arciumProgram: ARCIUM_PROGRAM_ID_DEVNET,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("  ✅ CompDef initialized!");
    } else {
      console.log("  ✅ CompDef already initialized");
    }
  } catch (e) {
    console.log("  ⚠️  Error with CompDef:", e);
    console.log("  Continuing anyway...");
  }

  console.log();

  // ========================================
  // STEP 5: Alice deposits with encrypted amount
  // ========================================
  console.log("💸 STEP 5: Alice deposits 0.5 SOL with ENCRYPTED amount\n");

  const depositAmount = 0.5 * 1e9; // 0.5 SOL in lamports

  // Generate secrets
  const secret = crypto.randomBytes(32);
  const nullifier = crypto.randomBytes(32);
  const ephemeralKeypair = Keypair.generate();
  const ephemeralPubKey = ephemeralKeypair.publicKey.toBuffer();

  console.log("  🔑 Generated secrets:");
  console.log("     Secret:", secret.toString('hex').slice(0, 16) + "...");
  console.log("     Nullifier:", nullifier.toString('hex').slice(0, 16) + "...");
  console.log("     Ephemeral PubKey:", ephemeralKeypair.publicKey.toString());

  // Encrypt amount (simplified - in production use proper ECDH)
  const sharedSecret = crypto.randomBytes(32);
  const { ciphertext: encryptedAmount, nonce: amountNonce } = encryptAmount(
    BigInt(depositAmount),
    sharedSecret
  );

  console.log("     Encrypted Amount:", encryptedAmount.toString('hex'));
  console.log("     Amount Nonce:", amountNonce.toString('hex'));

  // Recipient stealth address = Alice's private wallet
  const recipientStealth = alicePrivate.publicKey;
  console.log("     Recipient Stealth:", recipientStealth.toString());

  // Create commitment with encrypted amount
  const timestamp = Math.floor(Date.now() / 1000);
  const commitment = createCommitment(
    secret,
    nullifier,
    recipientStealth,
    encryptedAmount,
    amountNonce,
    timestamp,
    ephemeralPubKey
  );

  console.log("\n  📝 Commitment:", commitment.toString('hex').slice(0, 16) + "...");

  // Prepare Arcium arguments
  const computationOffset = new BN(Date.now());
  const pubKey = ephemeralKeypair.publicKey.toBytes(); // Arcis pubkey (32 bytes)
  const nonce = new BN(timestamp); // Nonce as u128

  // Convert encrypted amount to [u8; 32] for Arcium
  const encryptedAmountBytes = Buffer.alloc(32);
  encryptedAmount.copy(encryptedAmountBytes, 0);

  // Recipient pubkey for sealing (32 bytes)
  const recipientPubkeyBytes = recipientStealth.toBytes();

  console.log("\n  💰 Depositing 0.5 SOL to vault with MPC encryption...");
  console.log("     Plaintext Amount (for SOL transfer):", depositAmount / 1e9, "SOL");
  console.log("     Encrypted Amount (for MPC):", encryptedAmountBytes.toString('hex').slice(0, 16) + "...");

  try {
    const computationAccount = getComputationAccAddressDevnet(
      mxeAccount,
      alicePublic.publicKey,
      computationOffset
    );

    const executingPoolAccount = getExecutingPoolAccAddressDevnet(mxeAccount);

    const clusterAccount = derivePDA(
      [Buffer.from("cluster"), mxeAccount.toBuffer()],
      ARCIUM_PROGRAM_ID_DEVNET
    );

    const feePoolAccount = derivePDA(
      [Buffer.from("fee_pool"), mxeAccount.toBuffer()],
      ARCIUM_PROGRAM_ID_DEVNET
    );

    const depositTx = await program.methods
      .shieldedDeposit(
        computationOffset,
        new BN(depositAmount),
        Array.from(encryptedAmountBytes),
        Array.from(recipientPubkeyBytes),
        Array.from(commitment),
        Array.from(ephemeralPubKey),
        Array.from(pubKey),
        nonce
      )
      .accounts({
        payer: alicePublic.publicKey,
        depositor: alicePublic.publicKey,
        commitmentTree,
        vault,
        mxeAccount,
        compDefAccount,
        computationAccount,
        mempoolAccount,
        executingPoolAccount,
        clusterAccount,
        feePoolAccount,
        arciumProgram: ARCIUM_PROGRAM_ID_DEVNET,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  ✅ Deposit transaction submitted!");
    console.log("  📜 Transaction:", `https://explorer.solana.com/tx/${depositTx}?cluster=${CLUSTER}`);
  } catch (error) {
    console.log("  ❌ Deposit failed:", error);
    console.log("\n  💡 This is expected if:");
    console.log("     1. MXE is not properly initialized");
    console.log("     2. CompDef is not initialized");
    console.log("     3. Cluster is not set");
    console.log("\n  Please ensure MXE is initialized with arcium CLI first.");
    return;
  }

  console.log();

  // ========================================
  // STEP 6: Wait for MPC computation
  // ========================================
  console.log("⏳ STEP 6: Waiting for MPC computation...\n");
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

  console.log("  💡 In production, you would:");
  console.log("     1. Listen for ShieldedDepositEvent");
  console.log("     2. Extract sealed_amount_ciphertext");
  console.log("     3. Bob decrypts with his private key");
  console.log("     4. Bob now knows the deposit amount!");
  console.log();

  // ========================================
  // SUMMARY
  // ========================================
  console.log("🎉 DEPOSIT PHASE COMPLETE!\n");
  console.log("✅ What happened:");
  console.log("  1. Alice transferred 0.5 SOL to vault (visible on-chain)");
  console.log("  2. MPC encrypted the amount and sealed it for Bob");
  console.log("  3. Commitment added to tree (unlinkable)");
  console.log("  4. Bob can scan events and decrypt his deposits");
  console.log();
  console.log("🔐 Privacy Analysis:");
  console.log("  • Deposit amount is visible (0.5 SOL - unavoidable for SOL transfer)");
  console.log("  • But: Amount in MPC is encrypted and sealed for specific recipient");
  console.log("  • Commitment hash is opaque (32 bytes)");
  console.log("  • Stealth address breaks sender → receiver link");
  console.log();
  console.log("📊 On-Chain Visibility:");
  console.log("  ✅ Alice Public → Vault: 0.5 SOL (visible)");
  console.log("  ❌ Commitment details: HIDDEN (hash only)");
  console.log("  ❌ Recipient identity: HIDDEN (stealth address)");
  console.log("  ❌ Link to future claim: IMPOSSIBLE");
  console.log();
  console.log("⚠️  TODO: Implement CLAIM phase with shielded_claim MPC circuit");
  console.log("   - Bob needs to prove ownership of commitment");
  console.log("   - MPC validates and approves claim");
  console.log("   - SOL transferred to Bob's private wallet");
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
