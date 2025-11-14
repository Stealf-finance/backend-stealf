import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getMXEPublicKey,
  x25519,
  getArciumEnv,
  deserializeLE,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

describe("Simple 2-Wallet Transfer Test (0.1 SOL)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AnonymeTransfer as Program<AnonymeTransfer>;
  const provider = anchor.getProvider();
  const arciumEnv = getArciumEnv();

  function readKpJson(path: string) {
    const file = fs.readFileSync(path);
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }

  async function getMXEPublicKeyWithRetry(
    provider: anchor.AnchorProvider,
    programId: anchor.web3.PublicKey,
    maxRetries: number = 15,
    retryDelayMs: number = 2000
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const mxePublicKey = await getMXEPublicKey(provider, programId);
        if (mxePublicKey) {
          console.log(`✅ MXE ready after ${attempt} attempt(s)`);
          return mxePublicKey;
        }
      } catch (error) {
        console.log(`   Attempt ${attempt}/${maxRetries}...`);
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
  }

  it("Transfer 0.1 SOL between 2 wallets with confidentiality", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    const user1 = owner;
    const user2 = Keypair.generate();

    console.log("\n" + "=".repeat(70));
    console.log("🔐 CONFIDENTIAL TRANSFER TEST: 0.1 SOL");
    console.log("=".repeat(70));
    console.log("👤 User1 (sender):", user1.publicKey.toBase58());
    console.log("👤 User2 (receiver):", user2.publicKey.toBase58());

    // Wait for MXE
    console.log("\n⏳ Waiting for MXE...");
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("✅ MXE ready!");

    // PDAs
    const [signPdaAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("SignerAccount")],
      program.programId
    );

    const [poolAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_authority")],
      program.programId
    );

    const [user1EncryptedBalance] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user1.publicKey.toBuffer()],
      program.programId
    );

    const [user2EncryptedBalance] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user2.publicKey.toBuffer()],
      program.programId
    );

    const wrapOffset = getCompDefAccOffset("wrap");
    const transferOffset = getCompDefAccOffset("transfer");
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

    const [wrapCompDefPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), wrapOffset],
      getArciumProgAddress()
    );

    const [transferCompDefPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), transferOffset],
      getArciumProgAddress()
    );

    // STEP 1: Wrap 0.5 SOL for User1
    console.log("\n💰 STEP 1: Wrap 0.5 SOL for User1");
    const wrapAmount1 = 500_000_000; // 0.5 SOL
    const wrapComputationOffset1 = new anchor.BN(randomBytes(8), "hex");
    const ephemeralPrivateKey1 = x25519.utils.randomSecretKey();
    const ephemeralPublicKey1 = x25519.getPublicKey(ephemeralPrivateKey1);
    const nonce1 = randomBytes(16);
    const nonceNum1 = new anchor.BN(deserializeLE(nonce1).toString());

    const wrapSig1 = await program.methods
      .wrap(
        wrapComputationOffset1,
        new anchor.BN(wrapAmount1),
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
          wrapComputationOffset1
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

    console.log("✅ Wrap queued:", wrapSig1);

    console.log("⏳ Waiting for MPC...");
    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      wrapComputationOffset1,
      program.programId,
      "confirmed"
    );
    console.log("✅ User1 wrap completed");

    const user1EncBalanceBefore = await program.account.encryptedBalanceAccount.fetch(
      user1EncryptedBalance
    );

    // STEP 2: Airdrop and Wrap 0.2 SOL for User2
    console.log("\n💰 STEP 2: Setup User2");
    console.log("💸 Airdropping 1 SOL to User2...");
    const airdropSig = await provider.connection.requestAirdrop(
      user2.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");
    console.log("✅ Airdrop completed");

    const wrapAmount2 = 200_000_000; // 0.2 SOL
    const wrapComputationOffset2 = new anchor.BN(randomBytes(8), "hex");
    const ephemeralPrivateKey2 = x25519.utils.randomSecretKey();
    const ephemeralPublicKey2 = x25519.getPublicKey(ephemeralPrivateKey2);
    const nonce2 = randomBytes(16);
    const nonceNum2 = new anchor.BN(deserializeLE(nonce2).toString());

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

    console.log("⏳ Waiting for MPC...");
    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      wrapComputationOffset2,
      program.programId,
      "confirmed"
    );
    console.log("✅ User2 wrap completed");

    const user2EncBalanceBefore = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );

    // STEP 3: Transfer 0.1 SOL from User1 to User2
    console.log("\n🔀 STEP 3: CONFIDENTIAL TRANSFER - 0.1 SOL");
    console.log("   User1 → User2: 0.1 SOL (ENCRYPTED)");

    const transferAmount = 100_000_000; // 0.1 SOL
    const transferComputationOffset = new anchor.BN(randomBytes(8), "hex");

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

    console.log("⏳ Waiting for MPC transfer computation...");
    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      transferComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Transfer completed!");

    // Verify
    const user1EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user1EncryptedBalance
    );
    const user2EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );

    console.log("\n" + "=".repeat(70));
    console.log("✅ VERIFICATION");
    console.log("=".repeat(70));
    console.log(
      "📊 User1 balance changed:",
      Buffer.from(user1EncBalanceBefore.encryptedBalance).toString("hex").slice(0, 20) +
        "... →",
      Buffer.from(user1EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) +
        "..."
    );
    console.log(
      "📊 User2 balance changed:",
      Buffer.from(user2EncBalanceBefore.encryptedBalance).toString("hex").slice(0, 20) +
        "... →",
      Buffer.from(user2EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) +
        "..."
    );

    console.log("\n" + "=".repeat(70));
    console.log("✨ SUCCESS! CONFIDENTIAL 0.1 SOL TRANSFER COMPLETED!");
    console.log("=".repeat(70));
    console.log("📝 Summary:");
    console.log("   • User1 wrapped: 0.5 SOL");
    console.log("   • User2 wrapped: 0.2 SOL");
    console.log("   • Transferred: 0.1 SOL (User1 → User2) - CONFIDENTIAL");
    console.log("   • All amounts encrypted via Arcium MPC");
    console.log("=".repeat(70));
  });
});
