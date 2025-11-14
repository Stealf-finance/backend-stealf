import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
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

describe("Devnet Working Wrap Test", () => {
  const DEVNET_RPC = "https://api.devnet.solana.com";
  const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");
  const CLUSTER_PUBKEY = new PublicKey("J27vR6rte1iZfhGj8RvsBfkaAjJH9HRLjcJVc4wLEzkL");

  function readKpJson(path: string) {
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
        console.log(`   Attempt ${attempt} failed`);
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
  }

  it("Should wrap 0.1 SOL on devnet", async () => {
    // Setup connection with devnet explicitly
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    // Load the program using workspace but with devnet provider
    const idl = JSON.parse(
      fs.readFileSync("target/idl/anonyme_transfer.json", "utf8")
    );

    // Create program instance with devnet provider
    const program = new anchor.Program(
      idl,
      PROGRAM_ID,
      provider
    ) as Program<AnonymeTransfer>;

    console.log("\n" + "=".repeat(70));
    console.log("🌐 DEVNET WRAP TEST - 0.1 SOL");
    console.log("=".repeat(70));
    console.log("Program ID:", PROGRAM_ID.toBase58());
    console.log("Wallet:", wallet.publicKey.toBase58());

    const balance = await connection.getBalance(wallet.publicKey);
    console.log("Balance:", balance / 1e9, "SOL");

    // Wait for MXE
    console.log("\n⏳ Waiting for MXE...");
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

    console.log("\n📦 PDAs:");
    console.log("   Wrap CompDef:", wrapCompDefPDA.toBase58());
    console.log("   Encrypted Balance:", userEncryptedBalance.toBase58());

    // Wrap parameters
    const wrapAmount = new anchor.BN(100_000_000); // 0.1 SOL
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const nonce = randomBytes(16);
    const nonceNum = new anchor.BN(deserializeLE(nonce).toString());

    console.log("\n🔐 Wrapping 0.1 SOL...");

    try {
      const wrapSig = await program.methods
        .wrap(computationOffset, wrapAmount, Array.from(ephemeralPublicKey), nonceNum)
        .accountsPartial({
          payer: wallet.publicKey,
          user: wallet.publicKey,
          signPdaAccount: signPdaAddress,
          poolAuthority: poolAuthority,
          encryptedBalanceAccount: userEncryptedBalance,
          computationAccount: getComputationAccAddress(PROGRAM_ID, computationOffset),
          clusterAccount: CLUSTER_PUBKEY,
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          mempoolAccount: getMempoolAccAddress(PROGRAM_ID),
          executingPool: getExecutingPoolAccAddress(PROGRAM_ID),
          compDefAccount: wrapCompDefPDA,
          arciumProgram: getArciumProgAddress(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([wallet])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      console.log("✅ Wrap queued:", wrapSig);
      console.log("🔗 Solscan: https://solscan.io/tx/" + wrapSig + "?cluster=devnet");

      console.log("\n⏳ Waiting for MPC computation (30-90 seconds)...");

      const finalizeSig = await awaitComputationFinalization(
        provider,
        computationOffset,
        PROGRAM_ID,
        "confirmed"
      );

      console.log("✅ Computation finalized:", finalizeSig);
      console.log("🔗 Callback: https://solscan.io/tx/" + finalizeSig + "?cluster=devnet");

      // Verify balance account
      const encBalanceAccount = await program.account.encryptedBalanceAccount.fetch(
        userEncryptedBalance
      );

      console.log("\n✅ ENCRYPTED BALANCE CREATED!");
      console.log(
        "   Encrypted data:",
        Buffer.from(encBalanceAccount.encryptedBalance).toString("hex").slice(0, 40) + "..."
      );

      console.log("\n" + "=".repeat(70));
      console.log("✨ SUCCESS! 0.1 SOL WRAPPED ON DEVNET!");
      console.log("=".repeat(70));
    } catch (error: any) {
      console.error("\n❌ Error:", error.message);
      if (error.logs) {
        console.error("Logs:", error.logs);
      }
      throw error;
    }
  });
});
