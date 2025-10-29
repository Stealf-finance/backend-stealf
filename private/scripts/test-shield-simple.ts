import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
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
const PROGRAM_ID = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const RPC_ENDPOINT = "https://api.devnet.solana.com";
const CLUSTER_OFFSET = 1078779259;
const ARCIUM_FEE_POOL = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
const ARCIUM_CLOCK = new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65");

async function main() {
  console.log("\n TEST SHIELD SIMPLE - Vérification transaction complète\n");

  // Load keypair
  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log(" Wallet:", payer.publicKey.toBase58());

  // Setup
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  console.log(" Balance:", balance / 1e9, "SOL\n");

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load program
  const idlPath = path.join(process.cwd(), "target/idl/private.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  console.log(" Program ID:", PROGRAM_ID.toBase58());

  // Get MXE public key
  const MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
  console.log(" MXE Account:", MXE_ACCOUNT.toBase58());

  const mxeAccountInfo = await connection.getAccountInfo(MXE_ACCOUNT);
  if (!mxeAccountInfo) {
    console.log(" MXE account not found!");
    process.exit(1);
  }

  const mxePublicKey = mxeAccountInfo.data.slice(41, 73);
  console.log(" MXE public key retrieved");

  // Encrypt data
  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);

  const amount = BigInt(1_000_000_000); // 1 SOL
  const secret = BigInt(12345);

  const encryptedAmount = cipher.encrypt([amount], nonce)[0];
  const encryptedSecret = cipher.encrypt([secret], nonce)[0];

  console.log(" Data encrypted");

  // Prepare accounts
  const computationOffset = new BN(Date.now());
  const [signPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    PROGRAM_ID
  );

  const shieldOffsetBuffer = getCompDefAccOffset("shield");
  const shieldOffset = Buffer.from(shieldOffsetBuffer).readUInt32LE(0);

  const MEMPOOL_ACCOUNT = getMempoolAccAddress(PROGRAM_ID);
  const EXECPOOL_ACCOUNT = getExecutingPoolAccAddress(PROGRAM_ID);
  const CLUSTER_ACCOUNT = getClusterAccAddress(CLUSTER_OFFSET);
  const COMP_DEF_ACCOUNT = getCompDefAccAddress(PROGRAM_ID, shieldOffset);
  const computationPDA = getComputationAccAddress(PROGRAM_ID, computationOffset);

  console.log(" CompDef Account:", COMP_DEF_ACCOUNT.toBase58());

  // Verify CompDef exists
  const compDefInfo = await connection.getAccountInfo(COMP_DEF_ACCOUNT);
  if (!compDefInfo) {
    console.log(" CompDef not initialized!");
    process.exit(1);
  }
  console.log(" CompDef exists:", compDefInfo.data.length, "bytes\n");

  // Call shield
  console.log(" Calling shield instruction...\n");

  try {
    const tx = await program.methods
      .shield(
        computationOffset,
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
        computationAccount: computationPDA,
        compDefAccount: COMP_DEF_ACCOUNT,
        clusterAccount: CLUSTER_ACCOUNT,
        poolAccount: ARCIUM_FEE_POOL,
        clockAccount: ARCIUM_CLOCK,
        systemProgram: SystemProgram.programId,
        arciumProgram: ARCIUM_PROGRAM_ID,
      })
      .rpc();

    console.log(" SHIELD SUCCESSFUL!");
    console.log(" Transaction:", tx);
    console.log(" Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    console.log("\n TRANSACTION SHOWS FULL ARCIUM STRUCTURE!\n");

  } catch (err: any) {
    console.log(" Shield failed:");
    console.log(err.message);

    if (err.logs) {
      console.log("\n Transaction Logs:");
      err.logs.forEach((log: string) => console.log("   ", log));
    }

    if (err.message.includes("InvalidCallbackInstructions")) {
      console.log("\n️  Error 6209: InvalidCallbackInstructions");
      console.log("    The circuit returns Enc<Shared, T> but no callbacks configured");
      console.log("    Fix: Add callback instructions to queue_computation() in lib.rs:118");
    }
  }
}

main().catch((err) => {
  console.error("\n Test failed:", err.message);
  process.exit(1);
});
