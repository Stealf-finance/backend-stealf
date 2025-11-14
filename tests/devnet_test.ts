import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, clusterApiUrl } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
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
import { expect } from "chai";

describe("Devnet: Wrap and Transfer with Arcium", () => {
  // Configure for devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const programId = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");

  // Load IDL from file
  const idl = JSON.parse(fs.readFileSync("./target/idl/anonyme_transfer.json", "utf-8"));
  const program = new Program(idl, programId, provider);

  // Devnet cluster offset from Arcium documentation
  const CLUSTER_OFFSET = 1078779259;
  const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);

  console.log("Program ID:", programId.toBase58());
  console.log("Cluster Address:", clusterAddress.toBase58());
  console.log("Wallet:", walletKeypair.publicKey.toBase58());

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

  async function initializeCompDef(circuitName: string): Promise<PublicKey> {
    console.log(`\n🔧 Initializing ${circuitName} comp_def...`);
    const offset = getCompDefAccOffset(circuitName);
    const offsetValue = Buffer.from(offset).readUInt32LE();

    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const [compDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, programId.toBuffer(), offset],
      getArciumProgAddress()
    );

    console.log(`   ${circuitName} comp_def PDA:`, compDefPDA.toBase58());

    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

    if (!accountInfo) {
      console.log("   Initializing comp_def account...");
      const methodName =
        circuitName === "wrap" ? "initWrapCompDef" : "initTransferCompDef";

      const { blockhash, lastValidBlockHeight } =
        await provider.connection.getLatestBlockhash("confirmed");

      const initSig = await (program.methods as any)[methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: walletKeypair.publicKey,
          mxeAccount: getMXEAccAddress(programId),
          arciumProgram: getArciumProgAddress(),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([walletKeypair])
        .rpc({ skipPreflight: true });

      await provider.connection.confirmTransaction({
        signature: initSig,
        blockhash,
        lastValidBlockHeight,
      });

      console.log(`   ✅ Initialized ${circuitName} comp_def:`, initSig);

      // Upload circuit
      console.log(`   📤 Uploading ${circuitName} circuit...`);
      const circuitPath = `./artifacts/${circuitName}_raw_circuit_0.json`;
      const circuitData = fs.readFileSync(circuitPath, "utf-8");
      const circuit = JSON.parse(circuitData);

      const uploadSig = await uploadCircuit(
        provider,
        programId,
        compDefPDA,
        circuit
      );
      console.log(`   ✅ Circuit uploaded:`, uploadSig);

      // Finalize
      console.log(`   🔨 Finalizing ${circuitName} comp_def...`);
      const finalizeTx = await buildFinalizeCompDefTx(
        provider,
        programId,
        compDefPDA,
        circuit
      );
      const finalizeSig = await provider.sendAndConfirm(finalizeTx);
      console.log(`   ✅ Finalized ${circuitName} comp_def:`, finalizeSig);
    } else {
      console.log(`   ✅ ${circuitName} comp_def already initialized`);
    }

    return compDefPDA;
  }

  it("Initialize computation definitions", async () => {
    console.log("\n=== Initializing Computation Definitions ===");

    await initializeCompDef("wrap");
    await initializeCompDef("transfer");

    console.log("\n✅ All computation definitions initialized");
  });

  it("Test Wrap: Convert plaintext to encrypted balance", async () => {
    console.log("\n=== Testing Wrap Operation ===");

    const amount = 500_000_000; // 0.5 SOL in lamports
    const computationOffset = Math.floor(Math.random() * 1000000);

    console.log(`   Amount to wrap: ${amount / 1e9} SOL`);
    console.log(`   Computation offset: ${computationOffset}`);

    const baseSeed = getArciumAccountBaseSeed("SignerAccount");
    const [signPdaAccount] = PublicKey.findProgramAddressSync(
      [baseSeed],
      programId
    );

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
    const computationAccount = getComputationAccAddress(
      programId,
      computationOffset
    );

    console.log(`   Sending wrap transaction...`);

    const wrapSig = await program.methods
      .wrap(new anchor.BN(computationOffset), new anchor.BN(amount))
      .accounts({
        payer: walletKeypair.publicKey,
        signPdaAccount,
        mxeAccount,
        mempoolAccount,
        executingPool,
        computationAccount,
        compDefAccount: wrapCompDefPDA,
        clusterAccount: clusterAddress,
        poolAccount: new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3"),
        clockAccount: new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65"),
        systemProgram: anchor.web3.SystemProgram.programId,
        arciumProgram: getArciumProgAddress(),
      })
      .signers([walletKeypair])
      .rpc({ skipPreflight: false });

    console.log(`   ✅ Wrap transaction sent:`, wrapSig);

    console.log(`   ⏳ Waiting for computation to finalize...`);
    await awaitComputationFinalization(
      provider,
      programId,
      computationAccount,
      60000
    );

    console.log(`   ✅ Wrap operation completed successfully!`);
  });

  it("Test Transfer: Transfer between encrypted balances", async () => {
    console.log("\n=== Testing Transfer Operation ===");

    // For testing, we'll use dummy encrypted balances
    // In a real scenario, these would come from previous wrap operations
    const senderBalance = Buffer.alloc(32).fill(1);
    const receiverBalance = Buffer.alloc(32).fill(2);
    const transferAmount = 100_000_000; // 0.1 SOL
    const senderNonce = 1n;
    const receiverNonce = 2n;
    const computationOffset = Math.floor(Math.random() * 1000000);

    console.log(`   Transfer amount: ${transferAmount / 1e9} SOL`);
    console.log(`   Computation offset: ${computationOffset}`);

    const baseSeed = getArciumAccountBaseSeed("SignerAccount");
    const [signPdaAccount] = PublicKey.findProgramAddressSync(
      [baseSeed],
      programId
    );

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
    const computationAccount = getComputationAccAddress(
      programId,
      computationOffset
    );

    console.log(`   Sending transfer transaction...`);

    const transferSig = await program.methods
      .transfer(
        new anchor.BN(computationOffset),
        Array.from(senderBalance),
        Array.from(receiverBalance),
        new anchor.BN(transferAmount),
        senderNonce,
        receiverNonce
      )
      .accounts({
        payer: walletKeypair.publicKey,
        signPdaAccount,
        mxeAccount,
        mempoolAccount,
        executingPool,
        computationAccount,
        compDefAccount: transferCompDefPDA,
        clusterAccount: clusterAddress,
        poolAccount: new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3"),
        clockAccount: new PublicKey("FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65"),
        systemProgram: anchor.web3.SystemProgram.programId,
        arciumProgram: getArciumProgAddress(),
      })
      .signers([walletKeypair])
      .rpc({ skipPreflight: false });

    console.log(`   ✅ Transfer transaction sent:`, transferSig);

    console.log(`   ⏳ Waiting for computation to finalize...`);
    await awaitComputationFinalization(
      provider,
      programId,
      computationAccount,
      60000
    );

    console.log(`   ✅ Transfer operation completed successfully!`);
  });
});
