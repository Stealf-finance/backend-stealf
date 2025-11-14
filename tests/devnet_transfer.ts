import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
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
  deserializeLE,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

describe("Devnet Wallet-to-Wallet Transfer Test", () => {
  const DEVNET_RPC = "https://api.devnet.solana.com";
  const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
  const CLUSTER_PUBKEY = new PublicKey("J27vR6rte1iZfhGj8RvsBfkaAjJH9HRLjcJVc4wLEzkL"); // Cluster 1078779259

  function readKpJson(path: string): Keypair {
    const file = fs.readFileSync(path);
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
  }

  async function getMXEPublicKeyWithRetry(
    provider: anchor.AnchorProvider,
    programId: PublicKey,
    maxRetries: number = 10,
    retryDelayMs: number = 1000
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

  it("Should transfer 0.1 SOL between 2 wallets on devnet", async () => {
    // Setup connection and provider
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const wallet = new anchor.Wallet(
      readKpJson(`${os.homedir()}/.config/solana/id.json`)
    );
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load program manually from IDL
    const idl = JSON.parse(
      fs.readFileSync("target/idl/anonyme_transfer.json", "utf8")
    );
    const program = new Program(
      idl,
      PROGRAM_ID,
      provider
    ) as Program<AnonymeTransfer>;

    console.log("\n" + "=".repeat(70));
    console.log("🌐 DEVNET CONFIDENTIAL TRANSFER TEST");
    console.log("=".repeat(70));

    // Setup wallets
    const user1 = wallet.payer;
    const user2 = Keypair.generate();

    console.log("\n📋 SETUP");
    console.log("-".repeat(70));
    console.log("🌐 Network: DEVNET");
    console.log("📦 Program ID:", PROGRAM_ID.toBase58());
    console.log("🔗 Cluster:", CLUSTER_PUBKEY.toBase58());
    console.log("👤 User 1 (sender):", user1.publicKey.toBase58());
    console.log("👤 User 2 (receiver):", user2.publicKey.toBase58());

    // Check user1 balance
    const user1Balance = await connection.getBalance(user1.publicKey);
    console.log("💰 User1 balance:", user1Balance / 1e9, "SOL");

    if (user1Balance < 1e9) {
      throw new Error("Insufficient balance! Need at least 1 SOL for testing.");
    }

    // Wait for MXE
    console.log("\n⏳ Waiting for MXE account...");
    const mxePublicKey = await getMXEPublicKeyWithRetry(provider, PROGRAM_ID);
    console.log("✅ MXE ready!");

    // Calculate PDAs
    const [signPdaAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("SignerAccount")],
      PROGRAM_ID
    );

    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_authority")],
      PROGRAM_ID
    );

    const [user1EncryptedBalance] = PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user1.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const [user2EncryptedBalance] = PublicKey.findProgramAddressSync(
      [Buffer.from("encrypted_balance"), user2.publicKey.toBuffer()],
      PROGRAM_ID
    );

    // Comp def PDAs
    const wrapOffset = getCompDefAccOffset("wrap");
    const transferOffset = getCompDefAccOffset("transfer");
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

    const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
      getArciumProgAddress()
    );

    const [transferCompDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), transferOffset],
      getArciumProgAddress()
    );

    console.log("\n📦 Account PDAs:");
    console.log("   Wrap CompDef:", wrapCompDefPDA.toBase58());
    console.log("   Transfer CompDef:", transferCompDefPDA.toBase58());
    console.log("   User1 Encrypted Balance:", user1EncryptedBalance.toBase58());
    console.log("   User2 Encrypted Balance:", user2EncryptedBalance.toBase58());

    // ===== STEP 1: WRAP USER1 SOL =====
    console.log("\n" + "=".repeat(70));
    console.log("💰 STEP 1: WRAP USER1 SOL (0.5 SOL)");
    console.log("=".repeat(70));

    const wrapAmount = 500_000_000; // 0.5 SOL
    const wrapComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const ephemeralPrivateKey1 = x25519.utils.randomSecretKey();
    const ephemeralPublicKey1 = x25519.getPublicKey(ephemeralPrivateKey1);
    const nonce1 = randomBytes(16);
    const nonceNum1 = new anchor.BN(deserializeLE(nonce1).toString());

    console.log("🔐 Wrapping", wrapAmount / 1e9, "SOL for User1...");

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
        computationAccount: getComputationAccAddress(PROGRAM_ID, wrapComputationOffset),
        clusterAccount: CLUSTER_PUBKEY,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
        executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
        compDefAccount: wrapCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Wrap queued:", wrapSig);
    console.log("🔗 View on Solscan: https://solscan.io/tx/" + wrapSig + "?cluster=devnet");

    console.log("⏳ Waiting for MPC to process wrap (this may take 30-60 seconds)...");
    const wrapFinalizeSig = await awaitComputationFinalization(
      provider,
      wrapComputationOffset,
      PROGRAM_ID,
      "confirmed"
    );
    console.log("✅ Wrap finalized:", wrapFinalizeSig);
    console.log("🔗 View callback: https://solscan.io/tx/" + wrapFinalizeSig + "?cluster=devnet");

    const user1EncBalanceBefore = await program.account.encryptedBalanceAccount.fetch(
      user1EncryptedBalance
    );
    console.log("✅ User1 encrypted balance created");

    // ===== STEP 2: WRAP USER2 SOL =====
    console.log("\n" + "=".repeat(70));
    console.log("💰 STEP 2: WRAP USER2 SOL (0.2 SOL)");
    console.log("=".repeat(70));

    console.log("💸 Airdropping 1 SOL to User2...");
    const airdropSig = await connection.requestAirdrop(user2.publicKey, 1_000_000_000);
    await connection.confirmTransaction(airdropSig, "confirmed");
    console.log("✅ Airdrop completed:", airdropSig);

    const wrapAmount2 = 200_000_000; // 0.2 SOL
    const wrapComputationOffset2 = new anchor.BN(randomBytes(8), "hex");

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
        computationAccount: getComputationAccAddress(PROGRAM_ID, wrapComputationOffset2),
        clusterAccount: CLUSTER_PUBKEY,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
        executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
        compDefAccount: wrapCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Wrap queued:", wrapSig2);
    console.log("🔗 View on Solscan: https://solscan.io/tx/" + wrapSig2 + "?cluster=devnet");

    console.log("⏳ Waiting for MPC to process wrap...");
    const wrapFinalizeSig2 = await awaitComputationFinalization(
      provider,
      wrapComputationOffset2,
      PROGRAM_ID,
      "confirmed"
    );
    console.log("✅ Wrap finalized:", wrapFinalizeSig2);

    const user2EncBalanceBefore = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );
    console.log("✅ User2 encrypted balance created");

    // ===== STEP 3: TRANSFER 0.1 SOL FROM USER1 TO USER2 =====
    console.log("\n" + "=".repeat(70));
    console.log("🔀 STEP 3: CONFIDENTIAL TRANSFER USER1 → USER2 (0.1 SOL)");
    console.log("=".repeat(70));

    const transferAmount = 100_000_000; // 0.1 SOL
    const transferComputationOffset = new anchor.BN(randomBytes(8), "hex");

    console.log("🔐 Transferring", transferAmount / 1e9, "SOL from User1 to User2...");
    console.log("   💡 Amount is CONFIDENTIAL - encrypted via Arcium MPC");

    const transferSig = await program.methods
      .transfer(transferComputationOffset, new anchor.BN(transferAmount))
      .accountsPartial({
        payer: user1.publicKey,
        sender: user1.publicKey,
        receiver: user2.publicKey,
        signPdaAccount: signPdaAddress,
        senderAccount: user1EncryptedBalance,
        receiverAccount: user2EncryptedBalance,
        computationAccount: getComputationAccAddress(PROGRAM_ID, transferComputationOffset),
        clusterAccount: CLUSTER_PUBKEY,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
        executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
        compDefAccount: transferCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("✅ Transfer queued:", transferSig);
    console.log("🔗 View on Solscan: https://solscan.io/tx/" + transferSig + "?cluster=devnet");

    console.log("⏳ Waiting for MPC to process transfer...");
    const transferFinalizeSig = await awaitComputationFinalization(
      provider,
      transferComputationOffset,
      PROGRAM_ID,
      "confirmed"
    );
    console.log("✅ Transfer finalized:", transferFinalizeSig);
    console.log("🔗 View callback: https://solscan.io/tx/" + transferFinalizeSig + "?cluster=devnet");

    // ===== VERIFICATION =====
    console.log("\n" + "=".repeat(70));
    console.log("✅ VERIFICATION");
    console.log("=".repeat(70));

    const user1EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user1EncryptedBalance
    );
    const user2EncBalanceAfter = await program.account.encryptedBalanceAccount.fetch(
      user2EncryptedBalance
    );

    console.log("📊 Encrypted balances updated:");
    console.log(
      "   User1 before:",
      Buffer.from(user1EncBalanceBefore.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
    console.log(
      "   User1 after: ",
      Buffer.from(user1EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
    console.log(
      "   User2 before:",
      Buffer.from(user2EncBalanceBefore.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );
    console.log(
      "   User2 after: ",
      Buffer.from(user2EncBalanceAfter.encryptedBalance).toString("hex").slice(0, 20) + "..."
    );

    // Verify balances changed
    const user1Changed =
      Buffer.from(user1EncBalanceAfter.encryptedBalance).toString("hex") !==
      Buffer.from(user1EncBalanceBefore.encryptedBalance).toString("hex");

    const user2Changed =
      Buffer.from(user2EncBalanceAfter.encryptedBalance).toString("hex") !==
      Buffer.from(user2EncBalanceBefore.encryptedBalance).toString("hex");

    if (user1Changed && user2Changed) {
      console.log("✅ Both encrypted balances changed - transfer successful!");
    } else {
      throw new Error("Encrypted balances did not change!");
    }

    console.log("\n" + "=".repeat(70));
    console.log("✨ SUCCESS! CONFIDENTIAL TRANSFER COMPLETED ON DEVNET!");
    console.log("=".repeat(70));
    console.log("📝 Summary:");
    console.log("   1. User1 wrapped: 0.5 SOL");
    console.log("   2. User2 wrapped: 0.2 SOL");
    console.log("   3. Transferred: 0.1 SOL (User1 → User2) - CONFIDENTIAL");
    console.log("   4. All amounts encrypted via Arcium MPC on devnet");
    console.log("   5. View transactions on Solscan (links above)");
    console.log("=".repeat(70));
  });
});
