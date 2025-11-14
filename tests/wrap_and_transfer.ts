import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
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
  getArciumEnv,
  getMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("Wrap and Transfer with Arcium", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AnonymeTransfer as Program<AnonymeTransfer>;
  const provider = anchor.getProvider();
  const arciumEnv = getArciumEnv();

  function readKpJson(path: string): anchor.web3.Keypair {
    const file = fs.readFileSync(path);
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }

  async function getMXEPublicKeyWithRetry(
    provider: anchor.AnchorProvider,
    programId: PublicKey,
    maxRetries: number = 10,
    retryDelayMs: number = 500
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const mxePublicKey = await getMXEPublicKey(provider, programId);
        if (mxePublicKey) {
          return mxePublicKey;
        }
      } catch (error) {
        console.log(`   Attempt ${attempt} failed to fetch MXE public key:`, error);
      }

      if (attempt < maxRetries) {
        console.log(
          `   Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error(
      `Failed to fetch MXE public key after ${maxRetries} attempts`
    );
  }


  async function initializeCompDef(
    circuitName: string,
    owner: Keypair
  ): Promise<PublicKey> {
    console.log(`\n🔧 Initializing ${circuitName} comp_def...`);
    const offset = getCompDefAccOffset(circuitName);
    const offsetValue = Buffer.from(offset).readUInt32LE();

    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const [compDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    );

    console.log(`   ${circuitName} comp_def PDA:`, compDefPDA.toBase58());

    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

    if (!accountInfo) {
      console.log("   Initializing comp_def account...");
      const methodName =
        circuitName === "wrap" ? "initWrapCompDef" : "initTransferCompDef";

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } =
        await provider.connection.getLatestBlockhash("confirmed");

      const initSig = await (program.methods as any)[methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          arciumProgram: getArciumProgAddress(),
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
      console.log("   ✅ Comp def initialized:", initSig);

      // Wait a bit for the transaction to settle
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      console.log("   ℹ️  Comp def account already exists");
    }

    // Upload circuit
    console.log(`   Uploading ${circuitName} circuit...`);
    const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);
    try {
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        circuitName,
        program.programId,
        rawCircuit,
        true
      );
      console.log("   ✅ Circuit uploaded and finalized");
    } catch (error) {
      console.log(
        "   ⚠️  Circuit upload failed, finalizing comp_def manually..."
      );
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        offsetValue,
        program.programId
      );

      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);

      try {
        await provider.sendAndConfirm(finalizeTx);
        console.log("   ✅ Comp def finalized");
      } catch (finalizeError: any) {
        console.log(
          "   ⚠️  Finalize failed (may already be finalized):",
          finalizeError.message
        );
      }

      // Wait for finalization to settle
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return compDefPDA;
  }

  it("Should wrap SOL and transfer between wallets", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("\n" + "=".repeat(60));
    console.log("🚀 WALLET-TO-WALLET CONFIDENTIAL TRANSFER TEST");
    console.log("=".repeat(60));

    // Setup wallets
    const user1 = owner;
    const user2 = Keypair.generate();

    console.log("\n📋 SETUP");
    console.log("-".repeat(60));
    console.log("👤 User 1 (sender):", user1.publicKey.toBase58());
    console.log("👤 User 2 (receiver):", user2.publicKey.toBase58());

    // Wait for MXE to be ready (CRITICAL: MXE is created automatically by arcium test)
    console.log("\n⏳ Waiting for MXE account to be ready...");
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
      15,   // 15 retries max
      2000  // 2 seconds between retries
    );
    console.log("✅ MXE account is ready!");
    console.log("   MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex").slice(0, 32) + "...");

    // Initialize both comp_defs (now that MXE is ready)
    const wrapCompDefPDA = await initializeCompDef("wrap", owner);
    const transferCompDefPDA = await initializeCompDef("transfer", owner);

    console.log("✅ MXE initialization complete");

    // Calculate PDAs
    const SIGN_PDA_SEED = Buffer.from("SignerAccount");
    const [signPdaAddress] = PublicKey.findProgramAddressSync(
      [SIGN_PDA_SEED],
      program.programId
    );

    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_authority")],
      program.programId
    );

    const [user1EncryptedBalance] = PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user1.publicKey.toBuffer()],
      program.programId
    );

    const [user2EncryptedBalance] = PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user2.publicKey.toBuffer()],
      program.programId
    );

    console.log("\n📦 Account PDAs:");
    console.log("   Pool Authority:", poolAuthority.toBase58());
    console.log("   User1 Encrypted Balance:", user1EncryptedBalance.toBase58());
    console.log("   User2 Encrypted Balance:", user2EncryptedBalance.toBase58());

    // ===== STEP 1: WRAP USER1 SOL =====
    console.log("\n" + "=".repeat(60));
    console.log("💰 STEP 1: WRAP USER1 SOL");
    console.log("=".repeat(60));

    const wrapAmount = 500_000_000; // 0.5 SOL
    const wrapComputationOffset = new anchor.BN(randomBytes(8), "hex");

    // Generate ephemeral key pair for encryption
    const ephemeralPrivateKey1 = x25519.utils.randomSecretKey();
    const ephemeralPublicKey1 = x25519.getPublicKey(ephemeralPrivateKey1);
    const nonce1 = randomBytes(16);
    const nonceNum1 = new anchor.BN(deserializeLE(nonce1).toString());

    console.log("🔐 Wrapping", wrapAmount / 1e9, "SOL for User1...");
    console.log("   Computation offset:", wrapComputationOffset.toString());

    let user1EncBalanceAccount;
    try {
      const wrapSig = await program.methods
        .wrap(
          wrapComputationOffset,
          new anchor.BN(wrapAmount),
          Array.from(ephemeralPublicKey1),
          nonceNum1
        )
        .accountsPartial({
          payer: user1.publicKey,
          user: user1.publicKey,
          signPdaAccount: signPdaAddress,
          poolAuthority: poolAuthority,
          encryptedBalanceAccount: user1EncryptedBalance,
          computationAccount: getComputationAccAddress(
            program.programId,
            wrapComputationOffset
          ),
          clusterAccount: arciumEnv.arciumClusterPubkey,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: wrapCompDefPDA,
          arciumProgram: getArciumProgAddress(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("✅ Wrap queued:", wrapSig);

      console.log("⏳ Waiting for MPC to process wrap...");
      const wrapFinalizeSig = await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        wrapComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("✅ Wrap computation finalized:", wrapFinalizeSig);

      // Verify encrypted balance was created
      user1EncBalanceAccount = await program.account.encryptedBalanceAccount.fetch(
        user1EncryptedBalance
      );
      console.log("✅ User1 encrypted balance created");
      console.log(
        "   Encrypted balance:",
        Buffer.from(user1EncBalanceAccount.encryptedBalance).toString("hex").slice(0, 20) + "..."
      );
    } catch (error: any) {
      console.error("❌ Error during wrap:", error);
      console.error("Error message:", error.message);
      console.error("Error logs:", error.logs);
      throw error;
    }

    // ===== STEP 2: WRAP USER2 SOL (smaller amount) =====
    console.log("\n" + "=".repeat(60));
    console.log("💰 STEP 2: WRAP USER2 SOL");
    console.log("=".repeat(60));

    // First airdrop some SOL to user2
    console.log("💸 Airdropping 1 SOL to User2...");
    const airdropSig = await provider.connection.requestAirdrop(
      user2.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");
    console.log("✅ Airdrop completed");

    const wrapAmount2 = 200_000_000; // 0.2 SOL
    const wrapComputationOffset2 = new anchor.BN(randomBytes(8), "hex");

    // Generate ephemeral key pair for encryption
    const ephemeralPrivateKey2 = x25519.utils.randomSecretKey();
    const ephemeralPublicKey2 = x25519.getPublicKey(ephemeralPrivateKey2);
    const nonce2 = randomBytes(16);
    const nonceNum2 = new anchor.BN(deserializeLE(nonce2).toString());

    console.log("🔐 Wrapping", wrapAmount2 / 1e9, "SOL for User2...");

    const wrapSig2 = await program.methods
      .wrap(
        wrapComputationOffset2,
        new anchor.BN(wrapAmount2),
        Array.from(ephemeralPublicKey2),
        nonceNum2
      )
      .accountsPartial({
        payer: user2.publicKey,
        user: user2.publicKey,
        signPdaAccount: signPdaAddress,
        poolAuthority: poolAuthority,
        encryptedBalanceAccount: user2EncryptedBalance,
        computationAccount: getComputationAccAddress(
          program.programId,
          wrapComputationOffset2
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: wrapCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Wrap queued:", wrapSig2);

    console.log("⏳ Waiting for MPC to process wrap...");
    const wrapFinalizeSig2 = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      wrapComputationOffset2,
      program.programId,
      "confirmed"
    );
    console.log("✅ Wrap computation finalized:", wrapFinalizeSig2);

    const user2EncBalanceAccount = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );
    console.log("✅ User2 encrypted balance created");

    // ===== STEP 3: TRANSFER FROM USER1 TO USER2 =====
    console.log("\n" + "=".repeat(60));
    console.log("🔀 STEP 3: CONFIDENTIAL TRANSFER USER1 → USER2");
    console.log("=".repeat(60));

    const transferAmount = 100_000_000; // 0.1 SOL
    const transferComputationOffset = new anchor.BN(randomBytes(8), "hex");

    console.log("🔐 Transferring", transferAmount / 1e9, "SOL from User1 to User2...");
    console.log("   Amount is kept confidential during transfer");

    const transferSig = await program.methods
      .transfer(transferComputationOffset, new anchor.BN(transferAmount))
      .accountsPartial({
        payer: user1.publicKey,
        sender: user1.publicKey,
        receiver: user2.publicKey,
        signPdaAccount: signPdaAddress,
        senderAccount: user1EncryptedBalance,
        receiverAccount: user2EncryptedBalance,
        computationAccount: getComputationAccAddress(
          program.programId,
          transferComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: transferCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Transfer queued:", transferSig);

    console.log("⏳ Waiting for MPC to process transfer...");
    const transferFinalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      transferComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Transfer computation finalized:", transferFinalizeSig);

    // ===== VERIFICATION =====
    console.log("\n" + "=".repeat(60));
    console.log("✅ VERIFICATION");
    console.log("=".repeat(60));

    const user1EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user1EncryptedBalance
    );
    const user2EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );

    console.log("📊 Encrypted balances updated:");
    console.log(
      "   User1 encrypted balance:",
      Buffer.from(user1EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
    console.log(
      "   User2 encrypted balance:",
      Buffer.from(user2EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );

    // Verify balances changed
    expect(
      Buffer.from(user1EncBalanceAfter.encryptedBalance).toString("hex")
    ).to.not.equal(
      Buffer.from(user1EncBalanceAccount.encryptedBalance).toString("hex")
    );
    expect(
      Buffer.from(user2EncBalanceAfter.encryptedBalance).toString("hex")
    ).to.not.equal(
      Buffer.from(user2EncBalanceAccount.encryptedBalance).toString("hex")
    );

    console.log("\n" + "=".repeat(60));
    console.log("✨ SUCCESS! CONFIDENTIAL TRANSFER COMPLETED!");
    console.log("=".repeat(60));
    console.log("📝 Summary:");
    console.log("   1. User1 wrapped:", wrapAmount / 1e9, "SOL");
    console.log("   2. User2 wrapped:", wrapAmount2 / 1e9, "SOL");
    console.log("   3. Transferred:", transferAmount / 1e9, "SOL (User1 → User2)");
    console.log("   4. All amounts kept confidential via Arcium MPC");
    console.log("=".repeat(60));
  });
});
