import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getCompDefAccOffset,
  deserializeLE,
  x25519,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import * as fs from "fs";

/**
 * Simple test for devnet deployment
 * Tests the encrypt_pda function with the actual deployed interface
 */
async function testDevnet() {
  console.log("\n🧪 DEVNET TEST - Encrypt PDA");
  console.log("=".repeat(60));

  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
  const idl = JSON.parse(
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<AnonymeTransfer>;

  console.log("✅ Program ID:", program.programId.toString());
  console.log("✅ Wallet:", wallet.publicKey.toString());
  console.log("✅ MXE Account:", getMXEAccAddress(programId).toString());

  // Create test private wallet PDA
  const privateWallet = Keypair.generate();
  const [privateWalletPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("private_wallet"), privateWallet.publicKey.toBuffer()],
    programId
  );

  console.log("\n📝 Test Data:");
  console.log("  Private Wallet:", privateWallet.publicKey.toBase58());
  console.log("  Private Wallet PDA:", privateWalletPDA.toBase58());

  // Prepare encryption parameters
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const nonceBytes = randomBytes(16);
  const nonce = deserializeLE(nonceBytes);

  console.log("\n🔐 Encryption Parameters:");
  console.log("  Public Key:", Buffer.from(publicKey).toString("hex").slice(0, 20) + "...");
  console.log("  Nonce:", nonce.toString());

  // For the ciphertext parameter, we'll use a dummy encrypted value
  // In a real scenario, this would be properly encrypted data
  const dummyCiphertext = new Uint8Array(32);
  randomBytes(32).copy(dummyCiphertext);

  console.log("\n⏳ Queueing encryption computation...");

  const computationOffset = new anchor.BN(randomBytes(8).toString("hex"), 16);
  const compDefOffset = Buffer.from(getCompDefAccOffset("encrypt_pda_hash")).readUInt32LE();

  try {
    const sig = await program.methods
      .encryptPda(
        computationOffset,
        Array.from(dummyCiphertext),
        Array.from(publicKey),
        new anchor.BN(nonce.toString())
      )
      .accountsPartial({
        payer: wallet.publicKey,
        computationAccount: getComputationAccAddress(
          programId,
          computationOffset
        ),
        clusterAccount: getClusterAccAddress(1078779259), // Use actual cluster offset from devnet
        mxeAccount: getMXEAccAddress(programId),
        mempoolAccount: getMempoolAccAddress(programId),
        executingPool: getExecutingPoolAccAddress(programId),
        compDefAccount: getCompDefAccAddress(programId, compDefOffset),
      })
      .signers([wallet.payer])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Computation queued! Tx:", sig);

    // Wait for computation to finalize
    console.log("\n⏳ Waiting for MPC computation to finalize...");
    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      programId,
      "confirmed"
    );
    console.log("✅ Computation finalized! Tx:", finalizeSig);

    // Listen for the callback event
    console.log("\n⏳ Listening for encryptedPdaEvent...");
    const eventListener = program.addEventListener("encryptedPdaEvent", (event, slot) => {
      console.log("✅ Event received at slot", slot);
      console.log("  Event data:", event);
    });

    // Wait a bit for event
    await new Promise((resolve) => setTimeout(resolve, 5000));

    await program.removeEventListener(eventListener);

    console.log("\n✨ TEST COMPLETED SUCCESSFULLY!");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

testDevnet()
  .then(() => {
    console.log("\n✅ All tests passed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
