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
  deserializeLE,
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

async function testWrapTwoWallets() {
  console.log("\n" + "=".repeat(70));
  console.log("🔐 TEST 2 WALLETS SUR DEVNET - 0.1 SOL");
  console.log("=".repeat(70));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet1 = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const wallet2 = Keypair.generate();

  console.log("👤 Wallet 1 (sender):", wallet1.publicKey.toBase58());
  console.log("👤 Wallet 2 (receiver):", wallet2.publicKey.toBase58());

  const balance1 = await connection.getBalance(wallet1.publicKey);
  console.log("💰 Balance Wallet 1:", balance1 / 1e9, "SOL");

  // Airdrop pour wallet 2
  console.log("\n💸 Airdrop 1 SOL vers Wallet 2...");
  try {
    const airdropSig = await connection.requestAirdrop(wallet2.publicKey, 1_000_000_000);
    await connection.confirmTransaction(airdropSig, "confirmed");
    console.log("✅ Airdrop réussi");
  } catch (error) {
    console.log("⚠️  Airdrop échoué, Wallet 2 utilisera le solde existant");
  }

  const balance2 = await connection.getBalance(wallet2.publicKey);
  console.log("💰 Balance Wallet 2:", balance2 / 1e9, "SOL");

  // PDAs
  const wrapOffset = getCompDefAccOffset("wrap");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
    getArciumProgAddress()
  );

  // WRAP WALLET 1
  console.log("\n" + "=".repeat(70));
  console.log("💰 STEP 1: WRAP 0.1 SOL - WALLET 1");
  console.log("=".repeat(70));

  const [signPdaAddress1] = PublicKey.findProgramAddressSync([Buffer.from("SignerAccount")], PROGRAM_ID);
  const [poolAuthority1] = PublicKey.findProgramAddressSync([Buffer.from("pool_authority")], PROGRAM_ID);
  const [encBalance1] = PublicKey.findProgramAddressSync([Buffer.from("encrypted_balance"), wallet1.publicKey.toBuffer()], PROGRAM_ID);

  const wrapAmount1 = new anchor.BN(100_000_000); // 0.1 SOL
  const computationOffset1 = new anchor.BN(randomBytes(8), "hex");
  const ephemeralPrivateKey1 = x25519.utils.randomSecretKey();
  const ephemeralPublicKey1 = x25519.getPublicKey(ephemeralPrivateKey1);
  const nonce1 = randomBytes(16);

  const discriminator1 = getInstructionDiscriminator("wrap");
  const instructionData1 = Buffer.alloc(72);
  discriminator1.copy(instructionData1, 0);
  computationOffset1.toArrayLike(Buffer, "le", 8).copy(instructionData1, 8);
  wrapAmount1.toArrayLike(Buffer, "le", 8).copy(instructionData1, 16);
  Buffer.from(ephemeralPublicKey1).copy(instructionData1, 24);
  nonce1.copy(instructionData1, 56);

  const accounts1 = [
    { pubkey: wallet1.publicKey, isSigner: true, isWritable: true },
    { pubkey: signPdaAddress1, isSigner: false, isWritable: true },
    { pubkey: getMXEAccAddress(PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: getMempoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getExecutingPoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset1), isSigner: false, isWritable: true },
    { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false },
    { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true },
    { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: wallet1.publicKey, isSigner: true, isWritable: true },
    { pubkey: poolAuthority1, isSigner: false, isWritable: true },
    { pubkey: encBalance1, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false },
  ];

  const instruction1 = new TransactionInstruction({
    keys: accounts1,
    programId: PROGRAM_ID,
    data: instructionData1,
  });

  const transaction1 = new Transaction().add(instruction1);
  transaction1.feePayer = wallet1.publicKey;

  console.log("⏳ Envoi wrap Wallet 1...");
  try {
    const sig1 = await sendAndConfirmTransaction(connection, transaction1, [wallet1], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Wrap Wallet 1 envoyé:", sig1);
    console.log("🔗 https://solscan.io/tx/" + sig1 + "?cluster=devnet");
  } catch (error: any) {
    console.error("❌ Erreur Wallet 1:", error.message);
    return;
  }

  // WRAP WALLET 2
  console.log("\n" + "=".repeat(70));
  console.log("💰 STEP 2: WRAP 0.1 SOL - WALLET 2");
  console.log("=".repeat(70));

  const [signPdaAddress2] = PublicKey.findProgramAddressSync([Buffer.from("SignerAccount")], PROGRAM_ID);
  const [poolAuthority2] = PublicKey.findProgramAddressSync([Buffer.from("pool_authority")], PROGRAM_ID);
  const [encBalance2] = PublicKey.findProgramAddressSync([Buffer.from("encrypted_balance"), wallet2.publicKey.toBuffer()], PROGRAM_ID);

  const wrapAmount2 = new anchor.BN(100_000_000); // 0.1 SOL
  const computationOffset2 = new anchor.BN(randomBytes(8), "hex");
  const ephemeralPrivateKey2 = x25519.utils.randomSecretKey();
  const ephemeralPublicKey2 = x25519.getPublicKey(ephemeralPrivateKey2);
  const nonce2 = randomBytes(16);

  const discriminator2 = getInstructionDiscriminator("wrap");
  const instructionData2 = Buffer.alloc(72);
  discriminator2.copy(instructionData2, 0);
  computationOffset2.toArrayLike(Buffer, "le", 8).copy(instructionData2, 8);
  wrapAmount2.toArrayLike(Buffer, "le", 8).copy(instructionData2, 16);
  Buffer.from(ephemeralPublicKey2).copy(instructionData2, 24);
  nonce2.copy(instructionData2, 56);

  const accounts2 = [
    { pubkey: wallet2.publicKey, isSigner: true, isWritable: true },
    { pubkey: signPdaAddress2, isSigner: false, isWritable: true },
    { pubkey: getMXEAccAddress(PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: getMempoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getExecutingPoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    { pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset2), isSigner: false, isWritable: true },
    { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false },
    { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true },
    { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: wallet2.publicKey, isSigner: true, isWritable: true },
    { pubkey: poolAuthority2, isSigner: false, isWritable: true },
    { pubkey: encBalance2, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false },
  ];

  const instruction2 = new TransactionInstruction({
    keys: accounts2,
    programId: PROGRAM_ID,
    data: instructionData2,
  });

  const transaction2 = new Transaction().add(instruction2);
  transaction2.feePayer = wallet2.publicKey;

  console.log("⏳ Envoi wrap Wallet 2...");
  try {
    const sig2 = await sendAndConfirmTransaction(connection, transaction2, [wallet2], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("✅ Wrap Wallet 2 envoyé:", sig2);
    console.log("🔗 https://solscan.io/tx/" + sig2 + "?cluster=devnet");
  } catch (error: any) {
    console.error("❌ Erreur Wallet 2:", error.message);
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log("✨ TEST 2 WALLETS COMPLÉTÉ!");
  console.log("=".repeat(70));
  console.log("⏳ Les computations MPC prendront 30-90 secondes");
  console.log("📊 Vérifie les callbacks sur Solscan dans quelques minutes");
}

testWrapTwoWallets()
  .then(() => {
    console.log("\n✅ Script terminé");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script échoué:", error);
    process.exit(1);
  });
