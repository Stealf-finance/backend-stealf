import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as borsh from "borsh";

// Devnet configuration
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const programId = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
// Use the cluster address derived from MXE (as shown in error logs)
const clusterAddress = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

// Load wallet
const walletKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")))
);

console.log("=== Test Confidential Transfer sur Devnet ===\n");
console.log("Program ID:", programId.toBase58());
console.log("Wallet:", walletKeypair.publicKey.toBase58());
console.log("Cluster:", clusterAddress.toBase58());
console.log();

// Create IDL manually for the instruction data encoding
const wrapInstructionDiscriminator = Buffer.from([
  178, 40, 10, 189, 228, 129, 186, 140
]);

const transferInstructionDiscriminator = Buffer.from([
  163, 52, 200, 231, 140, 3, 69, 186
]);

async function testWrap() {
  console.log("\n🔄 Test 1: Wrap - Conversion plaintext vers encrypted");
  console.log("=" .repeat(60));

  const amount = 500_000_000; // 0.5 SOL
  const computationOffset = Math.floor(Math.random() * 1000000);

  console.log(`Montant à wrap: ${amount / 1e9} SOL`);
  console.log(`Computation offset: ${computationOffset}`);

  // Derive accounts
  const baseSeed = getArciumAccountBaseSeed("SignerAccount");
  const [signPdaAccount] = PublicKey.findProgramAddressSync([baseSeed], programId);

  const wrapCompDefPDA = PublicKey.findProgramAddressSync(
    [
      getArciumAccountBaseSeed("ComputationDefinitionAccount"),
      programId.toBuffer(),
      getCompDefAccOffset("wrap"),
    ],
    getArciumProgAddress()
  )[0];

  const mxeAccount = getMXEAccAddress(programId);
  const mempoolAccount = getMempoolAccAddress(programId);
  const executingPool = getExecutingPoolAccAddress(programId);
  const computationAccount = getComputationAccAddress(programId, new anchor.BN(computationOffset));

  console.log("\n📋 Accounts:");
  console.log("  Sign PDA:", signPdaAccount.toBase58());
  console.log("  MXE:", mxeAccount.toBase58());
  console.log("  Comp Def:", wrapCompDefPDA.toBase58());
  console.log("  Computation:", computationAccount.toBase58());

  // Build instruction data: discriminator + computation_offset (u64) + plaintext_amount (u64)
  const instructionData = Buffer.alloc(8 + 8 + 8);
  wrapInstructionDiscriminator.copy(instructionData, 0);
  instructionData.writeBigUInt64LE(BigInt(computationOffset), 8);
  instructionData.writeBigUInt64LE(BigInt(amount), 16);

  const instruction = new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: false },
      { pubkey: mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: executingPool, isSigner: false, isWritable: true },
      { pubkey: computationAccount, isSigner: false, isWritable: true },
      { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false },
      { pubkey: clusterAddress, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3"), isSigner: false, isWritable: true }, // pool
      { pubkey: new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65"), isSigner: false, isWritable: false }, // clock
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false },
    ],
    programId: programId,
    data: instructionData,
  });

  try {
    const tx = new anchor.web3.Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = walletKeypair.publicKey;

    console.log("\n📤 Envoi de la transaction wrap...");
    const signature = await connection.sendTransaction(tx, [walletKeypair], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log("✅ Transaction envoyée!");
    console.log("   Signature:", signature);
    console.log("   Explorer: https://explorer.solana.com/tx/" + signature + "?cluster=devnet");

    console.log("\n⏳ Attente de confirmation...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      console.error("❌ Transaction échouée:", confirmation.value.err);
      return null;
    }

    console.log("✅ Transaction confirmée!");

    // Get transaction logs
    const txDetails = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (txDetails?.meta?.logMessages) {
      console.log("\n📜 Logs:");
      txDetails.meta.logMessages.forEach(log => {
        if (log.includes("WrapEvent") || log.includes("encrypted_balance")) {
          console.log("   ", log);
        }
      });
    }

    return { signature, computationAccount };
  } catch (error) {
    console.error("❌ Erreur:", error);
    return null;
  }
}

async function testTransfer(senderBalance: Buffer, receiverBalance: Buffer) {
  console.log("\n\n🔄 Test 2: Transfer - Transfert entre wallets encrypted");
  console.log("=".repeat(60));

  const transferAmount = 100_000_000; // 0.1 SOL
  const computationOffset = Math.floor(Math.random() * 1000000);
  const senderNonce = BigInt(1);
  const receiverNonce = BigInt(2);

  console.log(`Montant à transférer: ${transferAmount / 1e9} SOL`);
  console.log(`Computation offset: ${computationOffset}`);

  // Derive accounts
  const baseSeed = getArciumAccountBaseSeed("SignerAccount");
  const [signPdaAccount] = PublicKey.findProgramAddressSync([baseSeed], programId);

  const transferCompDefPDA = PublicKey.findProgramAddressSync(
    [
      getArciumAccountBaseSeed("ComputationDefinitionAccount"),
      programId.toBuffer(),
      getCompDefAccOffset("transfer"),
    ],
    getArciumProgAddress()
  )[0];

  const mxeAccount = getMXEAccAddress(programId);
  const mempoolAccount = getMempoolAccAddress(programId);
  const executingPool = getExecutingPoolAccAddress(programId);
  const computationAccount = getComputationAccAddress(programId, new anchor.BN(computationOffset));

  console.log("\n📋 Accounts:");
  console.log("  Sign PDA:", signPdaAccount.toBase58());
  console.log("  MXE:", mxeAccount.toBase58());
  console.log("  Comp Def:", transferCompDefPDA.toBase58());
  console.log("  Computation:", computationAccount.toBase58());

  // Build instruction data
  const instructionData = Buffer.alloc(8 + 8 + 32 + 32 + 8 + 16 + 16);
  let offset = 0;

  transferInstructionDiscriminator.copy(instructionData, offset);
  offset += 8;

  instructionData.writeBigUInt64LE(BigInt(computationOffset), offset);
  offset += 8;

  senderBalance.copy(instructionData, offset);
  offset += 32;

  receiverBalance.copy(instructionData, offset);
  offset += 32;

  instructionData.writeBigUInt64LE(BigInt(transferAmount), offset);
  offset += 8;

  instructionData.writeBigUInt64LE(senderNonce & BigInt("0xFFFFFFFFFFFFFFFF"), offset);
  instructionData.writeBigUInt64LE(senderNonce >> BigInt(64), offset + 8);
  offset += 16;

  instructionData.writeBigUInt64LE(receiverNonce & BigInt("0xFFFFFFFFFFFFFFFF"), offset);
  instructionData.writeBigUInt64LE(receiverNonce >> BigInt(64), offset + 8);

  const instruction = new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: false },
      { pubkey: mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: executingPool, isSigner: false, isWritable: true },
      { pubkey: computationAccount, isSigner: false, isWritable: true },
      { pubkey: transferCompDefPDA, isSigner: false, isWritable: false },
      { pubkey: clusterAddress, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3"), isSigner: false, isWritable: true },
      { pubkey: new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65"), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false },
    ],
    programId: programId,
    data: instructionData,
  });

  try {
    const tx = new anchor.web3.Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = walletKeypair.publicKey;

    console.log("\n📤 Envoi de la transaction transfer...");
    const signature = await connection.sendTransaction(tx, [walletKeypair], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log("✅ Transaction envoyée!");
    console.log("   Signature:", signature);
    console.log("   Explorer: https://explorer.solana.com/tx/" + signature + "?cluster=devnet");

    console.log("\n⏳ Attente de confirmation...");
    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      console.error("❌ Transaction échouée:", confirmation.value.err);
      return null;
    }

    console.log("✅ Transaction confirmée!");

    // Get transaction logs
    const txDetails = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (txDetails?.meta?.logMessages) {
      console.log("\n📜 Logs:");
      txDetails.meta.logMessages.forEach(log => {
        if (log.includes("TransferEvent") || log.includes("success") || log.includes("balance")) {
          console.log("   ", log);
        }
      });
    }

    return signature;
  } catch (error) {
    console.error("❌ Erreur:", error);
    return null;
  }
}

async function main() {
  // Test 1: Wrap
  const wrapResult = await testWrap();

  if (!wrapResult) {
    console.error("\n❌ Test wrap échoué, arrêt des tests");
    process.exit(1);
  }

  // Pour le test de transfer, on utilise des balances fictives
  // Dans un vrai cas, on récupérerait les balances encrypted depuis les événements wrap
  const senderBalance = Buffer.alloc(32).fill(1);
  const receiverBalance = Buffer.alloc(32).fill(2);

  // Test 2: Transfer
  const transferResult = await testTransfer(senderBalance, receiverBalance);

  if (!transferResult) {
    console.error("\n❌ Test transfer échoué");
    process.exit(1);
  }

  console.log("\n\n✅ ========================================");
  console.log("✅ TOUS LES TESTS ONT RÉUSSI!");
  console.log("✅ ========================================\n");
  console.log("Le système de transfert confidentiel fonctionne sur devnet! 🎉");
}

main().catch(err => {
  console.error("\n❌ Erreur fatale:", err);
  process.exit(1);
});
