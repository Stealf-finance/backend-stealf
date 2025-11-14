import { Connection, PublicKey, Keypair, SystemProgram, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as anchor from "@coral-xyz/anchor";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
const CLUSTER_OFFSET = 1078779259;
const CLUSTER_PUBKEY = getClusterAccAddress(CLUSTER_OFFSET);
const POOL_ACCOUNT = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
const CLOCK_ACCOUNT = new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65");

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

function getInstructionDiscriminator(name: string): Buffer {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256");
  hash.update(`global:${name}`);
  return Buffer.from(hash.digest()).slice(0, 8);
}

async function testTransferDevnet() {
  console.log("\n" + "=".repeat(70));
  console.log("💸 TEST TRANSFER WALLET A → WALLET B SUR DEVNET");
  console.log("=".repeat(70));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const walletA = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const walletB = Keypair.generate();

  console.log("👤 Wallet A (sender):", walletA.publicKey.toBase58());
  console.log("👤 Wallet B (receiver):", walletB.publicKey.toBase58());

  const balanceA = await connection.getBalance(walletA.publicKey);
  console.log("💰 Balance Wallet A:", balanceA / 1e9, "SOL");

  // ========================================================================
  // STEP 1: WRAP 0.1 SOL - WALLET A
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("💰 STEP 1: WRAP 0.1 SOL - WALLET A");
  console.log("=".repeat(70));

  const wrapOffset = getCompDefAccOffset("wrap");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
    getArciumProgAddress()
  );

  const [signPdaAddress] = PublicKey.findProgramAddressSync([Buffer.from("SignerAccount")], PROGRAM_ID);
  const [poolAuthority] = PublicKey.findProgramAddressSync([Buffer.from("pool_authority")], PROGRAM_ID);
  const [encBalanceA] = PublicKey.findProgramAddressSync([Buffer.from("encrypted_balance"), walletA.publicKey.toBuffer()], PROGRAM_ID);

  const wrapAmount = new anchor.BN(100_000_000); // 0.1 SOL
  const computationOffset1 = new anchor.BN(randomBytes(8), "hex");
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const nonce = randomBytes(16);

  const discriminatorWrap = getInstructionDiscriminator("wrap");
  const instructionDataWrap = Buffer.alloc(72);
  discriminatorWrap.copy(instructionDataWrap, 0);
  computationOffset1.toArrayLike(Buffer, "le", 8).copy(instructionDataWrap, 8);
  wrapAmount.toArrayLike(Buffer, "le", 8).copy(instructionDataWrap, 16);
  Buffer.from(ephemeralPublicKey).copy(instructionDataWrap, 24);
  nonce.copy(instructionDataWrap, 56);

  const accountsWrap = [
    { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
    { pubkey: signPdaAddress, isSigner: false, isWritable: true },
    { pubkey: getMXEAccAddress(PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: getMempoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getExecutingPoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset1), isSigner: false, isWritable: true },
    { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false },
    { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true },
    { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: true },
    { pubkey: encBalanceA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false },
  ];

  const instructionWrap = new TransactionInstruction({
    keys: accountsWrap,
    programId: PROGRAM_ID,
    data: instructionDataWrap,
  });

  const transactionWrap = new Transaction().add(instructionWrap);
  transactionWrap.feePayer = walletA.publicKey;

  console.log("⏳ Envoi wrap Wallet A...");
  try {
    const sigWrap = await sendAndConfirmTransaction(connection, transactionWrap, [walletA], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Wrap Wallet A envoyé:", sigWrap);
    console.log("🔗 https://solscan.io/tx/" + sigWrap + "?cluster=devnet");
  } catch (error: any) {
    console.error("❌ Erreur Wrap Wallet A:", error.message);
    return;
  }

  // Attendre que le wrap soit traité
  console.log("\n⏳ Attente traitement MPC du wrap (30-90s)...");
  await new Promise((resolve) => setTimeout(resolve, 60000)); // 60 secondes

  // ========================================================================
  // STEP 2: TRANSFER 0.01 SOL - WALLET A → WALLET B
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("💸 STEP 2: TRANSFER 0.01 SOL - WALLET A → WALLET B");
  console.log("=".repeat(70));

  const transferOffset = getCompDefAccOffset("transfer");
  const [transferCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), transferOffset],
    getArciumProgAddress()
  );

  const [encBalanceB] = PublicKey.findProgramAddressSync([Buffer.from("encrypted_balance"), walletB.publicKey.toBuffer()], PROGRAM_ID);

  const transferAmount = new anchor.BN(10_000_000); // 0.01 SOL
  const computationOffset2 = new anchor.BN(randomBytes(8), "hex");

  // Instruction transfer : discriminator(8) + computation_offset(8) + amount(8) = 24 bytes
  const discriminatorTransfer = getInstructionDiscriminator("transfer");
  const instructionDataTransfer = Buffer.alloc(24);
  discriminatorTransfer.copy(instructionDataTransfer, 0);
  computationOffset2.toArrayLike(Buffer, "le", 8).copy(instructionDataTransfer, 8);
  transferAmount.toArrayLike(Buffer, "le", 8).copy(instructionDataTransfer, 16);

  // Comptes pour transfer (15 comptes)
  const accountsTransfer = [
    { pubkey: walletA.publicKey, isSigner: true, isWritable: true }, // 0: payer
    { pubkey: signPdaAddress, isSigner: false, isWritable: true }, // 1: sign_pda_account
    { pubkey: getMXEAccAddress(PROGRAM_ID), isSigner: false, isWritable: false }, // 2: mxe_account
    { pubkey: getMempoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true }, // 3: mempool_account
    { pubkey: getExecutingPoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true }, // 4: executing_pool
    { pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset2), isSigner: false, isWritable: true }, // 5: computation_account
    { pubkey: transferCompDefPDA, isSigner: false, isWritable: false }, // 6: comp_def_account
    { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true }, // 7: cluster_account
    { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true }, // 8: pool_account
    { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false }, // 9: clock_account
    { pubkey: walletA.publicKey, isSigner: true, isWritable: true }, // 10: sender
    { pubkey: walletB.publicKey, isSigner: false, isWritable: false }, // 11: receiver
    { pubkey: encBalanceA, isSigner: false, isWritable: true }, // 12: sender_account
    { pubkey: encBalanceB, isSigner: false, isWritable: true }, // 13: receiver_account
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 14: system_program
    { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false }, // 15: arcium_program
  ];

  const instructionTransfer = new TransactionInstruction({
    keys: accountsTransfer,
    programId: PROGRAM_ID,
    data: instructionDataTransfer,
  });

  const transactionTransfer = new Transaction().add(instructionTransfer);
  transactionTransfer.feePayer = walletA.publicKey;

  console.log("⏳ Envoi transfer Wallet A → Wallet B...");
  try {
    const sigTransfer = await sendAndConfirmTransaction(connection, transactionTransfer, [walletA], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Transfer envoyé:", sigTransfer);
    console.log("🔗 https://solscan.io/tx/" + sigTransfer + "?cluster=devnet");
  } catch (error: any) {
    console.error("❌ Erreur Transfer:", error.message);
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log("✨ TEST TRANSFER COMPLÉTÉ!");
  console.log("=".repeat(70));
  console.log("⏳ Le transfer MPC prendra 30-90 secondes");
  console.log("📊 Vérifie les callbacks sur Solscan dans quelques minutes");
  console.log("\n📝 Récapitulatif:");
  console.log("   - Wallet A a wrap 0.1 SOL");
  console.log("   - Wallet A a transféré 0.01 SOL chiffré → Wallet B");
  console.log("   - Balance chiffrée A: ~0.09 SOL");
  console.log("   - Balance chiffrée B: ~0.01 SOL");
}

testTransferDevnet()
  .then(() => {
    console.log("\n✅ Script terminé");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script échoué:", error);
    process.exit(1);
  });
