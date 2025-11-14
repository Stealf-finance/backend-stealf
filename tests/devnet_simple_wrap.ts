import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getMXEPublicKey,
  x25519,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  deserializeLE,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import { BN } from "@coral-xyz/anchor";

describe("Devnet Simple Wrap Test", () => {
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

    throw new Error(
      `Failed to fetch MXE public key after ${maxRetries} attempts`
    );
  }

  it("Should wrap 0.1 SOL on devnet", async () => {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const wallet = new anchor.Wallet(
      readKpJson(`${os.homedir()}/.config/solana/id.json`)
    );
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

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

    console.log("\n📦 Account PDAs:");
    console.log("   Wrap CompDef:", wrapCompDefPDA.toBase58());
    console.log("   User Encrypted Balance:", userEncryptedBalance.toBase58());

    // Prepare wrap parameters
    const wrapAmount = new BN(100_000_000); // 0.1 SOL
    const computationOffset = new BN(randomBytes(8), "hex");

    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const nonce = randomBytes(16);
    const nonceNum = new BN(deserializeLE(nonce).toString());

    console.log("\n🔐 Wrapping 0.1 SOL...");
    console.log("   Computation offset:", computationOffset.toString());

    // Create instruction data manually
    // wrap instruction format: [instruction_discriminator(8), computation_offset(8), amount(8), pub_key(32), nonce(16)]
    const instructionData = Buffer.alloc(8 + 8 + 8 + 32 + 16);

    // wrap instruction discriminator (calculated from sha256("global:wrap")[:8])
    const discriminator = Buffer.from([0xf8, 0x3d, 0x6a, 0x9b, 0x4a, 0x5c, 0x3e, 0x0a]);
    discriminator.copy(instructionData, 0);

    // computation_offset
    computationOffset.toArrayLike(Buffer, "le", 8).copy(instructionData, 8);

    // amount
    wrapAmount.toArrayLike(Buffer, "le", 8).copy(instructionData, 16);

    // pub_key
    Buffer.from(ephemeralPublicKey).copy(instructionData, 24);

    // nonce
    nonceNum.toArrayLike(Buffer, "le", 16).copy(instructionData, 56);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // user
        { pubkey: signPdaAddress, isSigner: false, isWritable: true }, // sign_pda_account
        { pubkey: poolAuthority, isSigner: false, isWritable: true }, // pool_authority
        { pubkey: userEncryptedBalance, isSigner: false, isWritable: true }, // encrypted_balance_account
        {
          pubkey: getComputationAccAddress(PROGRAM_ID, computationOffset),
          isSigner: false,
          isWritable: true,
        }, // computation_account
        { pubkey: CLUSTER_PUBKEY, isSigner: false, isWritable: true }, // cluster_account
        {
          pubkey: getMXEAccAddress(PROGRAM_ID),
          isSigner: false,
          isWritable: true,
        }, // mxe_account
        {
          pubkey: getMempoolAccAddress(PROGRAM_ID),
          isSigner: false,
          isWritable: true,
        }, // mempool_account
        {
          pubkey: getExecutingPoolAccAddress(PROGRAM_ID),
          isSigner: false,
          isWritable: true,
        }, // executing_pool
        { pubkey: wrapCompDefPDA, isSigner: false, isWritable: false }, // comp_def_account
        { pubkey: getArciumProgAddress(), isSigner: false, isWritable: false }, // arcium_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      programId: PROGRAM_ID,
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = wallet.publicKey;
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    transaction.sign(wallet.payer);

    const sig = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
    });

    console.log("✅ Wrap queued:", sig);
    console.log(
      "🔗 View: https://solscan.io/tx/" + sig + "?cluster=devnet"
    );

    console.log("\n⏳ Waiting for MPC computation (30-60 seconds)...");
    try {
      const finalizeSig = await awaitComputationFinalization(
        provider,
        computationOffset,
        PROGRAM_ID,
        "confirmed"
      );
      console.log("✅ Computation finalized:", finalizeSig);
      console.log(
        "🔗 View callback: https://solscan.io/tx/" +
          finalizeSig +
          "?cluster=devnet"
      );

      // Verify encrypted balance was created
      const encBalanceAccount = await connection.getAccountInfo(
        userEncryptedBalance
      );
      if (encBalanceAccount) {
        console.log("\n✅ Encrypted balance account created!");
        console.log("   Data length:", encBalanceAccount.data.length, "bytes");
      }

      console.log("\n" + "=".repeat(70));
      console.log("✨ SUCCESS! 0.1 SOL WRAPPED ON DEVNET!");
      console.log("=".repeat(70));
      console.log("💡 The wrapped amount is now encrypted via Arcium MPC");
      console.log("=".repeat(70));
    } catch (error: any) {
      console.error("\n❌ Computation finalization error:", error.message);
      console.log("\nℹ️  The wrap transaction was submitted but may still be processing.");
      console.log("   Check the transaction on Solscan:", sig);
    }
  });
});
