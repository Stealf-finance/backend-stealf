import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
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

// Configuration devnet
const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
const CLUSTER_OFFSET = 1078779259; // Public cluster on devnet
const CLUSTER_PUBKEY = getClusterAccAddress(CLUSTER_OFFSET);

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

// Calculer le discriminateur d'instruction à partir du nom
function getInstructionDiscriminator(name: string): Buffer {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256");
  hash.update(`global:${name}`);
  return Buffer.from(hash.digest()).slice(0, 8);
}

async function testWrapDevnet() {
  console.log("\n" + "=".repeat(70));
  console.log("🌐 TEST DIRECT WRAP SUR DEVNET");
  console.log("=".repeat(70));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Wallet:", wallet.publicKey.toBase58());

  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  // PDAs
  const [signPdaAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    PROGRAM_ID
  );

  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority")],
    PROGRAM_ID
  );

  const [userEncryptedBalance] = PublicKey.findProgramAddressSync(
    [Buffer.from("encrypted_balance"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );

  const wrapOffset = getCompDefAccOffset("wrap");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
    getArciumProgAddress()
  );

  console.log("📦 PDAs calculés:");
  console.log("   Sign PDA:", signPdaAddress.toBase58());
  console.log("   Pool Authority:", poolAuthority.toBase58());
  console.log("   Encrypted Balance:", userEncryptedBalance.toBase58());
  console.log("   Wrap CompDef:", wrapCompDefPDA.toBase58());

  // Paramètres wrap
  const wrapAmount = new anchor.BN(100_000_000); // 0.1 SOL
  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const nonce = randomBytes(16);

  console.log("\n🔐 Préparation wrap de 0.1 SOL...");
  console.log("   Computation offset:", computationOffset.toString());

  // Construire l'instruction data
  // Format: [discriminator(8), computation_offset(8), amount(8), pub_key(32), nonce(16)]
  const discriminator = getInstructionDiscriminator("wrap");
  const instructionData = Buffer.alloc(8 + 8 + 8 + 32 + 16);

  discriminator.copy(instructionData, 0);
  computationOffset.toArrayLike(Buffer, "le", 8).copy(instructionData, 8);
  wrapAmount.toArrayLike(Buffer, "le", 8).copy(instructionData, 16);
  Buffer.from(ephemeralPublicKey).copy(instructionData, 24);
  nonce.copy(instructionData, 56);

  console.log("   Discriminator:", discriminator.toString("hex"));
  console.log("   Instruction data length:", instructionData.length, "bytes");

  // Comptes Arcium requis (hardcodés dans l'IDL)
  const POOL_ACCOUNT = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
  const CLOCK_ACCOUNT = new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65");

  // Comptes pour l'instruction (ordre exact de l'IDL)
  const accounts = [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // 0: payer
    { pubkey: signPdaAddress, isSigner: false, isWritable: true }, // 1: sign_pda_account
    { pubkey: getMXEAccAddress(PROGRAM_ID), isSigner: false, isWritable: false }, // 2: mxe_account
    { pubkey: getMempoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true }, // 3: mempool_account
    { pubkey: getExecutingPoolAccAddress(PROGRAM_ID), isSigner: false, isWritable: true }, // 4: executing_pool
    { pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset), isSigner: false, isWritable: true }, // 5: computation_account
    { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false }, // 6: comp_def_account
    { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true }, // 7: cluster_account
    { pubkey: POOL_ACCOUNT, isSigner: false, isWritable: true }, // 8: pool_account
    { pubkey: CLOCK_ACCOUNT, isSigner: false, isWritable: false }, // 9: clock_account
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // 10: user
    { pubkey: poolAuthority, isSigner: false, isWritable: true }, // 11: pool_authority
    { pubkey: userEncryptedBalance, isSigner: false, isWritable: true }, // 12: encrypted_balance_account
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 13: system_program
    { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false }, // 14: arcium_program
  ];

  console.log("\n📋 Comptes (", accounts.length, "):");
  accounts.forEach((acc, i) => {
    console.log(
      `   ${i}: ${acc.pubkey.toBase58().slice(0, 8)}... ${
        acc.isSigner ? "signer" : ""
      } ${acc.isWritable ? "writable" : "readonly"}`
    );
  });

  // Créer l'instruction
  const instruction = new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: instructionData,
  });

  // Créer et envoyer la transaction
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = wallet.publicKey;

  console.log("\n⏳ Envoi de la transaction...");

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      {
        skipPreflight: false,
        commitment: "confirmed",
      }
    );

    console.log("✅ Transaction envoyée avec succès!");
    console.log("   Signature:", signature);
    console.log(
      "   🔗 Solscan: https://solscan.io/tx/" + signature + "?cluster=devnet"
    );

    console.log("\n⏳ Attente de la confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const txInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
    });

    if (txInfo?.meta?.err) {
      console.error("❌ Transaction échouée:", txInfo.meta.err);
    } else {
      console.log("✅ Transaction confirmée sur devnet!");
      console.log(
        "\n💡 Le wrap de 0.1 SOL a été soumis au cluster MPC Arcium"
      );
      console.log(
        "   Le calcul MPC prendra 30-90 secondes pour se finaliser"
      );
      console.log(
        "   Tu peux voir le callback sur Solscan dans quelques minutes"
      );
    }

    console.log("\n" + "=".repeat(70));
    console.log("✨ TEST WRAP SUR DEVNET RÉUSSI!");
    console.log("=".repeat(70));
  } catch (error: any) {
    console.error("\n❌ Erreur:", error.message);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
    throw error;
  }
}

// Exécuter le test
testWrapDevnet()
  .then(() => {
    console.log("\n✅ Test terminé avec succès");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test échoué:", error);
    process.exit(1);
  });
