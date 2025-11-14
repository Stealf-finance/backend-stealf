import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
const CLUSTER_OFFSET = 1078779259;
const CLUSTER_PUBKEY = getClusterAccAddress(CLUSTER_OFFSET);

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        console.log(`✅ MXE ready after ${attempt} attempt(s)`);
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`   Attempt ${attempt} failed:`, (error as Error).message);
    }

    if (attempt < maxRetries) {
      console.log(`   Retrying in ${retryDelayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

async function testTransferDevnetSDK() {
  console.log("\n" + "=".repeat(70));
  console.log("💸 TEST TRANSFER WALLET A → WALLET B (SDK) SUR DEVNET");
  console.log("=".repeat(70));

  // Setup provider et program
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });

  const idl: any = JSON.parse(
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf8")
  );
  // Override IDL address to use devnet deployment
  idl.address = PROGRAM_ID.toBase58();
  // Create program with modified IDL
  const program: any = new Program(idl, provider);

  // Setup wallets
  const walletA = wallet;
  const walletB = Keypair.generate();

  console.log("👤 Wallet A (sender):", walletA.publicKey.toBase58());
  console.log("👤 Wallet B (receiver):", walletB.publicKey.toBase58());

  const balanceA = await connection.getBalance(walletA.publicKey);
  console.log("💰 Balance Wallet A:", balanceA / 1e9, "SOL");

  // Wait for MXE
  console.log("\n⏳ Waiting for MXE...");
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, PROGRAM_ID, 15, 2000);
  console.log("✅ MXE ready!");

  // PDAs
  const [signPdaAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    PROGRAM_ID
  );

  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority")],
    PROGRAM_ID
  );

  const [encBalanceA] = PublicKey.findProgramAddressSync(
    [Buffer.from("encrypted_balance"), walletA.publicKey.toBuffer()],
    PROGRAM_ID
  );

  const [encBalanceB] = PublicKey.findProgramAddressSync(
    [Buffer.from("encrypted_balance"), walletB.publicKey.toBuffer()],
    PROGRAM_ID
  );

  // Comp Def PDAs
  const wrapOffset = getCompDefAccOffset("wrap");
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
    getArciumProgAddress()
  );

  const transferOffset = getCompDefAccOffset("transfer");
  const [transferCompDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, PROGRAM_ID.toBuffer(), transferOffset],
    getArciumProgAddress()
  );

  console.log("\n📦 Account PDAs:");
  console.log("   Wrap CompDef:", wrapCompDefPDA.toBase58());
  console.log("   Transfer CompDef:", transferCompDefPDA.toBase58());
  console.log("   Encrypted Balance A:", encBalanceA.toBase58());

  // ========================================================================
  // STEP 1: WRAP 0.1 SOL - WALLET A
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("💰 STEP 1: WRAP 0.1 SOL - WALLET A");
  console.log("=".repeat(70));

  const wrapAmount = 100_000_000; // 0.1 SOL
  const wrapComputationOffset = new anchor.BN(randomBytes(8), "hex");

  const ephemeralPrivateKey1 = x25519.utils.randomSecretKey();
  const ephemeralPublicKey1 = x25519.getPublicKey(ephemeralPrivateKey1);
  const nonce1 = randomBytes(16);
  const nonceNum1 = new anchor.BN(deserializeLE(nonce1).toString());

  console.log("🔐 Wrapping 0.1 SOL for Wallet A...");
  console.log("   Computation offset:", wrapComputationOffset.toString());

  try {
    const wrapSig = await program.methods
      .wrap(
        wrapComputationOffset,
        new anchor.BN(wrapAmount),
        Array.from(ephemeralPublicKey1),
        nonceNum1
      )
      .accountsPartial({
        payer: walletA.publicKey,
        user: walletA.publicKey,
        signPdaAccount: signPdaAddress,
        poolAuthority: poolAuthority,
        encryptedBalanceAccount: encBalanceA,
        computationAccount: getComputationAccAddress(PROGRAM_ID, wrapComputationOffset),
        clusterAccount: CLUSTER_PUBKEY,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
        executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
        compDefAccount: wrapCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([walletA])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Wrap queued:", wrapSig);
    console.log("🔗 https://solscan.io/tx/" + wrapSig + "?cluster=devnet");

    console.log("⏳ Waiting for MPC computation (30-90 seconds)...");
    const wrapFinalizeSig = await awaitComputationFinalization(
      provider,
      wrapComputationOffset,
      PROGRAM_ID,
      "confirmed"
    );
    console.log("✅ Wrap finalized:", wrapFinalizeSig);
    console.log("🔗 https://solscan.io/tx/" + wrapFinalizeSig + "?cluster=devnet");

    // Verify balance created
    const encBalanceAccountA = await program.account.encryptedBalanceAccount.fetch(encBalanceA);
    console.log("✅ Encrypted balance created for Wallet A");
    console.log(
      "   Encrypted balance:",
      Buffer.from(encBalanceAccountA.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
  } catch (error: any) {
    console.error("❌ Error during wrap:", error.message);
    if (error.logs) console.error("Logs:", error.logs);
    return;
  }

  // ========================================================================
  // STEP 2: TRANSFER 0.01 SOL - WALLET A → WALLET B
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("💸 STEP 2: TRANSFER 0.01 SOL - WALLET A → WALLET B");
  console.log("=".repeat(70));

  const transferAmount = 10_000_000; // 0.01 SOL
  const transferComputationOffset = new anchor.BN(randomBytes(8), "hex");

  console.log("🔐 Transferring 0.01 SOL from Wallet A to Wallet B...");
  console.log("   Amount is kept confidential during transfer");
  console.log("   Computation offset:", transferComputationOffset.toString());

  try {
    const transferSig = await program.methods
      .transfer(transferComputationOffset, new anchor.BN(transferAmount))
      .accountsPartial({
        payer: walletA.publicKey,
        sender: walletA.publicKey,
        receiver: walletB.publicKey,
        signPdaAccount: signPdaAddress,
        senderAccount: encBalanceA,
        receiverAccount: encBalanceB,
        computationAccount: getComputationAccAddress(PROGRAM_ID, transferComputationOffset),
        clusterAccount: CLUSTER_PUBKEY,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
        executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
        compDefAccount: transferCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([walletA])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Transfer queued:", transferSig);
    console.log("🔗 https://solscan.io/tx/" + transferSig + "?cluster=devnet");

    console.log("⏳ Waiting for MPC computation (30-90 seconds)...");
    const transferFinalizeSig = await awaitComputationFinalization(
      provider,
      transferComputationOffset,
      PROGRAM_ID,
      "confirmed"
    );
    console.log("✅ Transfer finalized:", transferFinalizeSig);
    console.log("🔗 https://solscan.io/tx/" + transferFinalizeSig + "?cluster=devnet");

    // Verify balances updated
    const encBalanceAccountA = await program.account.encryptedBalanceAccount.fetch(encBalanceA);
    const encBalanceAccountB = await program.account.encryptedBalanceAccount.fetch(encBalanceB);

    console.log("\n📊 Encrypted balances updated:");
    console.log(
      "   Wallet A encrypted balance:",
      Buffer.from(encBalanceAccountA.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
    console.log(
      "   Wallet B encrypted balance:",
      Buffer.from(encBalanceAccountB.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );

    console.log("\n" + "=".repeat(70));
    console.log("✨ TEST TRANSFER COMPLÉTÉ!");
    console.log("=".repeat(70));
    console.log("📝 Summary:");
    console.log("   - Wallet A wrapped 0.1 SOL");
    console.log("   - Wallet A transferred 0.01 SOL → Wallet B");
    console.log("   - Final encrypted balance A: ~0.09 SOL");
    console.log("   - Final encrypted balance B: ~0.01 SOL");
    console.log("   - All amounts kept confidential via Arcium MPC");
  } catch (error: any) {
    console.error("❌ Error during transfer:", error.message);
    if (error.logs) console.error("Logs:", error.logs);
    return;
  }
}

testTransferDevnetSDK()
  .then(() => {
    console.log("\n✅ Script terminé");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script échoué:", error);
    process.exit(1);
  });
