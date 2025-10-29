import { Connection, PublicKey, Keypair, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  RescueCipher,
  x25519,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

// Configuration
const PROGRAM_ID = new PublicKey("4wArc6jm36yGscp2d9b29dLxNdHdg2pvYbYNvJxu7dEA");
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const RPC_ENDPOINT = "https://api.devnet.solana.com";
const CLUSTER_OFFSET = 1078779259;
const ARCIUM_FEE_POOL = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
const ARCIUM_CLOCK = new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65");

async function main() {
  console.log("\n");
  console.log("    TEST COMPLET: Shield → Unshield (0.05 SOL)          ");
  console.log("\n");

  // Load wallet (votre wallet principal)
  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load program
  const idlPath = path.join(__dirname, "../target/idl/private.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  console.log(` Wallet: ${payer.publicKey.toBase58()}`);

  const initialBalance = await connection.getBalance(payer.publicKey);
  console.log(` Balance initiale: ${initialBalance / 1e9} SOL\n`);

  const [poolVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault")],
    PROGRAM_ID
  );

  const [userCommitmentAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_commitment"), payer.publicKey.toBuffer()],
    PROGRAM_ID
  );

  // ========================================
  // ÉTAPE 1: SHIELD 0.05 SOL
  // ========================================

  console.log(" ÉTAPE 1: SHIELD (déposer 0.05 SOL dans la pool)");
  console.log("\n");

  const amount = BigInt(0.05 * 1e9);
  const secret = BigInt(99999);

  const MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
  const mxeAccountInfo = await connection.getAccountInfo(MXE_ACCOUNT);
  if (!mxeAccountInfo) throw new Error("MXE account not found");
  const mxePublicKey = mxeAccountInfo.data.slice(41, 73);

  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);

  const encryptedAmount = cipher.encrypt([amount], nonce)[0];
  const encryptedSecret = cipher.encrypt([secret], nonce)[0];

  const shieldOffset = Buffer.from(getCompDefAccOffset("shield")).readUInt32LE(0);
  const MEMPOOL_ACCOUNT = getMempoolAccAddress(PROGRAM_ID);
  const EXECPOOL_ACCOUNT = getExecutingPoolAccAddress(PROGRAM_ID);
  const CLUSTER_ACCOUNT = getClusterAccAddress(CLUSTER_OFFSET);
  const SHIELD_COMP_DEF = getCompDefAccAddress(PROGRAM_ID, shieldOffset);

  const [signPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    PROGRAM_ID
  );

  const shieldComputationOffset = new BN(Date.now());
  const shieldComputationPDA = getComputationAccAddress(PROGRAM_ID, shieldComputationOffset);

  try {
    const shieldTx = await program.methods
      .shield(
        shieldComputationOffset,
        Array.from(clientPublicKey),
        new BN(Buffer.from(nonce)),
        encryptedAmount,
        encryptedSecret
      )
      .accounts({
        payer: payer.publicKey,
        signPdaAccount: signPDA,
        mxeAccount: MXE_ACCOUNT,
        mempoolAccount: MEMPOOL_ACCOUNT,
        executingPool: EXECPOOL_ACCOUNT,
        computationAccount: shieldComputationPDA,
        compDefAccount: SHIELD_COMP_DEF,
        clusterAccount: CLUSTER_ACCOUNT,
        poolAccount: ARCIUM_FEE_POOL,
        clockAccount: ARCIUM_CLOCK,
        poolVault: poolVault,
        userCommitmentAccount: userCommitmentAccount,
        systemProgram: SystemProgram.programId,
        arciumProgram: ARCIUM_PROGRAM_ID,
      })
      .rpc();

    console.log(` Shield TX: ${shieldTx}`);
    console.log(` Explorer: https://explorer.solana.com/tx/${shieldTx}?cluster=devnet\n`);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const balanceAfterShield = await connection.getBalance(payer.publicKey);
    const vaultBalance = await connection.getBalance(poolVault);

    console.log(` Balance après shield: ${balanceAfterShield / 1e9} SOL`);
    console.log(` Pool Vault balance: ${vaultBalance / 1e9} SOL`);
    console.log(` Coût shield: ${(initialBalance - balanceAfterShield) / 1e9} SOL\n`);

  } catch (err: any) {
    console.log(` Shield failed: ${err.message}\n`);
    if (err.logs) err.logs.forEach((log: string) => console.log("  ", log));
    process.exit(1);
  }

  // ========================================
  // ÉTAPE 2: UNSHIELD 0.05 SOL
  // ========================================

  console.log(" ÉTAPE 2: UNSHIELD (retirer 0.05 SOL de la pool)");
  console.log("\n");

  const balanceBeforeUnshield = await connection.getBalance(payer.publicKey);
  const vaultBalanceBeforeUnshield = await connection.getBalance(poolVault);

  const unshieldAmount = 50_000_000;
  const recipient = payer.publicKey;

  const unshieldClientPrivateKey = x25519.utils.randomSecretKey();
  const unshieldClientPublicKey = x25519.getPublicKey(unshieldClientPrivateKey);
  const unshieldSharedSecret = x25519.getSharedSecret(unshieldClientPrivateKey, mxePublicKey);
  const unshieldCipher = new RescueCipher(unshieldSharedSecret);
  const unshieldNonce = randomBytes(16);

  const unshieldEncryptedSecret = unshieldCipher.encrypt([secret], unshieldNonce)[0];

  const unshieldOffset = Buffer.from(getCompDefAccOffset("unshield_v2")).readUInt32LE(0);
  const UNSHIELD_COMP_DEF = getCompDefAccAddress(PROGRAM_ID, unshieldOffset);

  const unshieldComputationOffset = new BN(Date.now() + 1000);
  const unshieldComputationPDA = getComputationAccAddress(PROGRAM_ID, unshieldComputationOffset);

  try {
    const unshieldTx = await program.methods
      .unshieldV2(
        unshieldComputationOffset,
        new BN(unshieldAmount),
        recipient,
        Array.from(unshieldClientPublicKey),
        new BN(Buffer.from(unshieldNonce)),
        unshieldEncryptedSecret
      )
      .accounts({
        payer: payer.publicKey,
        signPdaAccount: signPDA,
        mxeAccount: MXE_ACCOUNT,
        mempoolAccount: MEMPOOL_ACCOUNT,
        executingPool: EXECPOOL_ACCOUNT,
        computationAccount: unshieldComputationPDA,
        compDefAccount: UNSHIELD_COMP_DEF,
        clusterAccount: CLUSTER_ACCOUNT,
        poolAccount: ARCIUM_FEE_POOL,
        clockAccount: ARCIUM_CLOCK,
        poolVault: poolVault,
        userCommitmentAccount: userCommitmentAccount,
        systemProgram: SystemProgram.programId,
        arciumProgram: ARCIUM_PROGRAM_ID,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
      ])
      .rpc();

    console.log(` Unshield TX: ${unshieldTx}`);
    console.log(` Explorer: https://explorer.solana.com/tx/${unshieldTx}?cluster=devnet\n`);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const finalBalance = await connection.getBalance(payer.publicKey);
    const finalVaultBalance = await connection.getBalance(poolVault);

    console.log(` Balance finale: ${finalBalance / 1e9} SOL`);
    console.log(` Pool Vault finale: ${finalVaultBalance / 1e9} SOL\n`);

    console.log(" RÉSUMÉ DU FLOW COMPLET:");
    console.log(`   Balance initiale:      ${initialBalance / 1e9} SOL`);
    console.log(`   Après shield:          ${balanceBeforeUnshield / 1e9} SOL`);
    console.log(`   Balance finale:        ${finalBalance / 1e9} SOL`);
    console.log(`   `);
    console.log(`    Shield computation queueée`);
    console.log(`    Unshield computation queueée`);
    console.log(`    Attendre callbacks du cluster MPC pour voir les transferts`);
    console.log("\n");

  } catch (err: any) {
    console.log(` Unshield failed: ${err.message}\n`);
    if (err.logs) err.logs.forEach((log: string) => console.log("  ", log));
  }
}

main().catch(console.error);
