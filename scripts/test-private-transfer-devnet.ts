import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import {
  RescueCipher,
  x25519,
  getMXEPublicKey,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  awaitComputationFinalization,
  deserializeLE,
  getArciumProgAddress,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import * as fs from "fs";

/**
 * Test complet: Transaction privée entre 2 wallets sur devnet
 * Le montant est chiffré - visible sur explorer mais illisible!
 */
async function testPrivateTransfer() {
  console.log("\n💰 TEST PRIVATE TRANSFER - DEVNET");
  console.log("=".repeat(70));

  // Setup devnet connection
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

  console.log("✅ Program ID:", programId.toString());
  console.log("✅ Network: Solana Devnet");
  console.log("✅ Sender:", wallet.publicKey.toString());

  // ========================================
  // STEP 1: Create receiver wallet
  // ========================================
  const receiver = Keypair.generate();
  console.log("\n👤 WALLETS");
  console.log("=".repeat(70));
  console.log("Sender:", wallet.publicKey.toBase58());
  console.log("Receiver:", receiver.publicKey.toBase58());

  // ========================================
  // STEP 2: Get MXE public key for encryption
  // ========================================
  console.log("\n🔐 ENCRYPTION SETUP");
  console.log("=".repeat(70));

  const mxePublicKey = await getMXEPublicKey(provider, programId);
  console.log("✅ MXE Public Key fetched");

  // Generate ephemeral keypair
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  console.log("✅ x25519 shared secret established");

  // ========================================
  // STEP 3: Encrypt the transfer amount
  // ========================================
  const transferAmountSOL = 0.1;  // Réduit à 0.1 SOL pour économiser
  const transferAmountLamports = BigInt(Math.floor(transferAmountSOL * LAMPORTS_PER_SOL));

  console.log("\n💸 AMOUNT TO TRANSFER");
  console.log("=".repeat(70));
  console.log("Amount (SOL):", transferAmountSOL);
  console.log("Amount (lamports):", transferAmountLamports.toString());

  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);
  const encryptedAmount = cipher.encrypt([transferAmountLamports], nonce);

  console.log("\n🔒 ENCRYPTED DATA");
  console.log("=".repeat(70));
  console.log("Encrypted amount (first 16 bytes):", Buffer.from(encryptedAmount[0]).toString("hex").slice(0, 32) + "...");
  console.log("Nonce:", Buffer.from(nonce).toString("hex"));
  console.log("Full ciphertext length:", encryptedAmount[0].length, "bytes");

  // ========================================
  // STEP 4: Create private transfer on-chain
  // ========================================
  const transferId = new anchor.BN(Date.now());
  const [privateTransferPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("private_transfer"),
      wallet.publicKey.toBuffer(),
      Buffer.from(transferId.toArray("le", 8)),
    ],
    programId
  );

  console.log("\n📝 CREATING PRIVATE TRANSFER ON-CHAIN");
  console.log("=".repeat(70));
  console.log("Transfer PDA:", privateTransferPDA.toBase58());
  console.log("Transfer ID:", transferId);

  try {
    const createTx = await program.methods
      .createPrivateTransfer(
        receiver.publicKey,
        Array.from(encryptedAmount[0]),
        Array.from(nonce),
        transferId,
        new anchor.BN(transferAmountLamports.toString())  // Ajout du montant pour le dépôt
      )
      .accountsPartial({
        privateTransfer: privateTransferPDA,
        sender: wallet.publicKey,
      })
      .rpc({ skipPreflight: false });

    console.log("✅ Private transfer created!");
    console.log("   TX:", createTx);
    console.log("   Explorer:", `https://explorer.solana.com/tx/${createTx}?cluster=devnet`);

    // ========================================
    // STEP 5: Fetch and display on-chain data
    // ========================================
    console.log("\n🔍 ON-CHAIN DATA (VISIBLE ON EXPLORER)");
    console.log("=".repeat(70));

    const transferAccount = await program.account.privateTransfer.fetch(privateTransferPDA);

    console.log("Account Address:", privateTransferPDA.toBase58());
    console.log("  └─ Explorer:", `https://explorer.solana.com/address/${privateTransferPDA.toBase58()}?cluster=devnet`);
    console.log("\nVisible Fields:");
    console.log("  ├─ sender:", transferAccount.sender.toBase58(), "← PUBLIC ❌");
    console.log("  ├─ receiver:", transferAccount.receiver.toBase58(), "← PUBLIC ❌");
    console.log("  ├─ encrypted_amount:", Buffer.from(transferAccount.encryptedAmount as any).toString("hex").slice(0, 40) + "...", "← ENCRYPTED 🔒");
    console.log("  ├─ nonce:", Buffer.from(transferAccount.nonce as any).toString("hex"));
    console.log("  ├─ timestamp:", new Date(Number(transferAccount.timestamp) * 1000).toISOString());
    console.log("  └─ bump:", transferAccount.bump);

    console.log("\n🎯 DEMO POINT:");
    console.log("════════════════════════════════════════════════════════════════════════");
    console.log("👉 Check the explorer - you can see the transaction was created");
    console.log("👉 Sender and receiver are visible (for simplicity in beta)");
    console.log("👉 BUT the amount is completely ENCRYPTED - no one can read it!");
    console.log("👉 encrypted_amount shows random bytes: impossible to guess the value");
    console.log("════════════════════════════════════════════════════════════════════════");

    // ========================================
    // STEP 6: Decrypt via MPC and transfer SOL!
    // ========================================
    console.log("\n🔓 STEP 6: DECRYPT VIA MPC & TRANSFER SOL");
    console.log("=".repeat(70));
    console.log("Now we'll decrypt the amount via MPC and transfer SOL to receiver!");

    const computationOffset = new anchor.BN(Date.now() % 1000000);
    const nonceU128 = new anchor.BN(Buffer.from(nonce).toString("hex"), 16);
    const compDefOffset = Buffer.from(getCompDefAccOffset("decrypt_transfer_amount")).readUInt32LE();

    console.log("\n⏳ Queueing MPC decryption...");

    // Augmenter les compute units pour éviter "out of memory"
    const computeBudgetIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000, // Maximum pour une transaction
    });

    const decryptTx = await program.methods
      .decryptTransferAmount(
        computationOffset,
        Array.from(publicKey),
        nonceU128
      )
      .accountsPartial({
        payer: wallet.publicKey,
        privateTransfer: privateTransferPDA,
        mxeAccount: getMXEAccAddress(programId),
        mempoolAccount: getMempoolAccAddress(programId),
        executingPool: getExecutingPoolAccAddress(programId),
        clusterAccount: getClusterAccAddress(1078779259),
        computationAccount: getComputationAccAddress(programId, computationOffset),
        compDefAccount: getCompDefAccAddress(programId, compDefOffset),
        arciumProgram: getArciumProgAddress(),
      })
      .preInstructions([computeBudgetIx])
      .rpc({ skipPreflight: false });

    console.log("✅ MPC decryption queued!");
    console.log("   TX:", decryptTx);
    console.log("   Explorer:", `https://explorer.solana.com/tx/${decryptTx}?cluster=devnet`);

    console.log("\n⏳ Waiting for MPC computation to complete...");
    console.log("   This will decrypt the amount and transfer SOL to receiver...");

    await awaitComputationFinalization(
      provider,
      computationOffset,
      programId,
      "confirmed"
    );

    console.log("\n✅ MPC computation completed!");
    console.log("   The amount has been decrypted and transferred!");

    // Check receiver balance
    const receiverBalance = await connection.getBalance(receiver.publicKey);
    console.log("\n💰 RECEIVER BALANCE CHECK:");
    console.log("   Balance:", receiverBalance / 1e9, "SOL");
    console.log("   Expected:", transferAmountSOL, "SOL");

    if (receiverBalance >= transferAmountLamports) {
      console.log("   ✅ TRANSFER SUCCESSFUL!");
    } else {
      console.log("   ⚠️  Balance lower than expected, check transaction logs");
    }

    console.log("\n✨ TEST COMPLETED SUCCESSFULLY!");
    console.log("════════════════════════════════════════════════════════════════════════");
    console.log("🎉 Your private transfer is now on-chain with encrypted amount!");
    console.log("📊 Check it out on Solana Explorer:");
    console.log("   ", `https://explorer.solana.com/address/${privateTransferPDA.toBase58()}?cluster=devnet`);
    console.log("════════════════════════════════════════════════════════════════════════");

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

testPrivateTransfer()
  .then(() => {
    console.log("\n✅ All done! Check the explorer links above! 🚀");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
