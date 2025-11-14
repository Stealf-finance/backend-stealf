import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("Private Transfer with MPC Decryption", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AnonymeTransfer as Program<AnonymeTransfer>;
  const provider = anchor.getProvider();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);

    return event;
  };

  const arciumEnv = getArciumEnv();

  it("Full flow: Create encrypted transfer -> MPC decrypt -> Execute transfer", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("\n🔧 SETUP");
    console.log("=".repeat(50));

    // 1. Create sender and receiver
    const sender = owner;
    const receiver = Keypair.generate();
    console.log("✅ Sender:", sender.publicKey.toBase58());
    console.log("✅ Receiver:", receiver.publicKey.toBase58());

    // 2. Get initial balances
    const initialSenderBalance = await provider.connection.getBalance(sender.publicKey);
    const initialReceiverBalance = await provider.connection.getBalance(receiver.publicKey);
    console.log("📊 Initial balances:");
    console.log("   Sender:", initialSenderBalance / 1e9, "SOL");
    console.log("   Receiver:", initialReceiverBalance / 1e9, "SOL");

    console.log("\n🔐 INITIALIZATION");
    console.log("=".repeat(50));

    // 3. Initialize decrypt comp def
    console.log("Initializing decrypt_transfer_amount computation definition...");
    const initDecryptSig = await initDecryptCompDef(
      program,
      owner,
      true, // uploadRawCircuit: true for localnet
      false // offchainSource: false
    );
    console.log("✅ Decrypt comp def initialized:", initDecryptSig);

    // 4. Get MXE public key for encryption
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("✅ MXE x25519 pubkey retrieved");

    console.log("\n💰 CREATE PRIVATE TRANSFER");
    console.log("=".repeat(50));

    // 5. Prepare transfer parameters
    const transferAmount = 100_000_000; // 0.1 SOL
    const transferId = new anchor.BN(randomBytes(8), "hex").toNumber();

    // Generate ephemeral key pair and nonce
    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const nonce = randomBytes(16);

    // Encrypt the amount using RescueCipher (client-side encryption)
    const cipher = new RescueCipher(mxePublicKey, ephemeralPrivateKey);
    const encryptedAmount = cipher.encryptLE(BigInt(transferAmount), nonce);

    console.log("Transfer parameters:");
    console.log("   Amount:", transferAmount, "lamports (0.1 SOL)");
    console.log("   Transfer ID:", transferId);
    console.log("   Encrypted amount:", Buffer.from(encryptedAmount).toString("hex").slice(0, 20) + "...");

    // 6. Calculate private transfer PDA
    const [privateTransferPDA, privateTransferBump] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("private_transfer"),
          sender.publicKey.toBuffer(),
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(transferId)]).buffer)),
        ],
        program.programId
      );
    console.log("✅ Private Transfer PDA:", privateTransferPDA.toBase58());

    // 7. Create private transfer
    const createTransferSig = await program.methods
      .createPrivateTransfer(
        receiver.publicKey,
        Array.from(encryptedAmount),
        Array.from(nonce),
        transferId,
        transferAmount
      )
      .accounts({
        privateTransfer: privateTransferPDA,
        sender: sender.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc({ commitment: "confirmed" });
    console.log("✅ Private transfer created:", createTransferSig);

    // 8. Verify transfer account
    const transferAccount = await program.account.privateTransfer.fetch(privateTransferPDA);
    console.log("📋 Transfer account:");
    console.log("   Sender:", transferAccount.sender.toBase58());
    console.log("   Receiver:", transferAccount.receiver.toBase58());
    console.log("   Encrypted amount:", Buffer.from(transferAccount.encryptedAmount).toString("hex").slice(0, 20) + "...");
    console.log("   Executed:", transferAccount.executed);

    expect(transferAccount.sender.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(transferAccount.receiver.toBase58()).to.equal(receiver.publicKey.toBase58());
    expect(transferAccount.executed).to.be.false;

    console.log("\n🔓 MPC DECRYPTION");
    console.log("=".repeat(50));

    // 9. Queue decryption computation
    const decryptComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const transferAmountRevealedEventPromise = awaitEvent("transferAmountRevealed");

    const queueDecryptSig = await program.methods
      .decryptTransferAmount(
        decryptComputationOffset,
        Array.from(ephemeralPublicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        payer: sender.publicKey,
        computationAccount: getComputationAccAddress(
          program.programId,
          decryptComputationOffset
        ),
        clusterAccount: getClusterAccAddress(0),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("decrypt_transfer_amount")).readUInt32LE()
        ),
        privateTransfer: privateTransferPDA,
      })
      .signers([sender])
      .rpc({ skipPreflight: false, commitment: "confirmed" });
    console.log("✅ Decrypt computation queued:", queueDecryptSig);

    // 10. Wait for computation finalization
    const finalizeDecryptSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      decryptComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Decrypt computation finalized:", finalizeDecryptSig);

    // 11. Wait for callback event
    const transferAmountRevealedEvent = await transferAmountRevealedEventPromise;
    console.log("✅ Transfer executed! Decrypted amount:", transferAmountRevealedEvent.decryptedAmount.toString(), "lamports");

    console.log("\n✅ VERIFICATION");
    console.log("=".repeat(50));

    // 12. Check final balances
    const finalReceiverBalance = await provider.connection.getBalance(receiver.publicKey);
    console.log("📊 Final receiver balance:", finalReceiverBalance / 1e9, "SOL");
    console.log("📊 Balance increase:", (finalReceiverBalance - initialReceiverBalance) / 1e9, "SOL");

    // 13. Verify transfer was executed
    const finalTransferAccount = await program.account.privateTransfer.fetch(privateTransferPDA);
    console.log("📋 Transfer status:");
    console.log("   Executed:", finalTransferAccount.executed);

    expect(finalTransferAccount.executed).to.be.true;
    expect(finalReceiverBalance - initialReceiverBalance).to.equal(transferAmount);
    expect(transferAmountRevealedEvent.decryptedAmount.toNumber()).to.equal(transferAmount);

    console.log("\n✨ SUCCESS! Private transfer completed successfully!");
    console.log("   Original amount:  ", transferAmount, "lamports");
    console.log("   Decrypted amount: ", transferAmountRevealedEvent.decryptedAmount.toString(), "lamports");
    console.log("   Receiver received:", finalReceiverBalance - initialReceiverBalance, "lamports");
  });

  // ============= HELPER FUNCTIONS =============

  async function initDecryptCompDef(
    program: Program<AnonymeTransfer>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const offset = getCompDefAccOffset("decrypt_transfer_amount");
    const offsetValue = Buffer.from(offset).readUInt32LE();
    const provider = anchor.getProvider() as anchor.AnchorProvider;

    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const [compDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    );

    console.log("   Decrypt comp_def PDA:", compDefPDA.toBase58());
    console.log("   Offset value:", offsetValue);

    // Check if comp_def account already exists
    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

    let sig: string;
    if (accountInfo) {
      console.log("   Comp def account already exists, skipping initialization");
      sig = "already_initialized";
    } else {
      // Initialize the comp_def account
      console.log("   Initializing comp_def account...");

      // Get fresh blockhash
      const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");

      sig = await program.methods
        .initDecryptCompDef()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
          arciumProgram: getArciumProgAddress(),
        })
        .signers([owner])
        .rpc({
          commitment: "confirmed",
          skipPreflight: false,
        });

      // Wait for confirmation
      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, "confirmed");

      console.log("   ✅ Comp def account initialized");
    }

    // If uploadRawCircuit, upload the circuit after initialization
    if (uploadRawCircuit) {
      console.log("   Uploading circuit...");
      const rawCircuit = fs.readFileSync("build/decrypt_transfer_amount.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "decrypt_transfer_amount",
        program.programId,
        rawCircuit,
        true
      );
      console.log("   ✅ Circuit uploaded");
    } else if (!offchainSource) {
      // If not uploadRawCircuit and not offchainSource, finalize without circuit
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );

      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

      finalizeTx.sign(owner);

      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
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
        console.log(
          `Attempt ${attempt} failed to fetch MXE public key:`,
          error
        );
      }

      if (attempt < maxRetries) {
        console.log(
          `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error(
      `Failed to fetch MXE public key after ${maxRetries} attempts`
    );
  }

  function readKpJson(path: string): anchor.web3.Keypair {
    const file = fs.readFileSync(path);
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }
});
