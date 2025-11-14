import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
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
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("Simple Private Transfer", () => {
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

  it("Simple wallet-to-wallet transfer with encrypted amount", async () => {
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

    // 3. Initialize transfer comp def
    console.log("Initializing transfer computation definition...");
    const offset = getCompDefAccOffset("transfer");
    const offsetValue = Buffer.from(offset).readUInt32LE();

    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const [compDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    );

    console.log("   Transfer comp_def PDA:", compDefPDA.toBase58());
    console.log("   Offset value:", offsetValue);

    // Check if comp_def account already exists
    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

    if (!accountInfo) {
      console.log("   Initializing comp_def account...");
      const initSig = await program.methods
        .initTransferCompDef()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          arciumProgram: getArciumProgAddress(),
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
      console.log("   ✅ Comp def initialized:", initSig);
    } else {
      console.log("   Comp def account already exists");
    }

    // Upload circuit for localnet (always upload, it will handle existing circuits)
    console.log("   Uploading circuit...");
    const rawCircuit = fs.readFileSync("build/transfer.arcis");
    try {
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "transfer",
        program.programId,
        rawCircuit,
        true
      );
      console.log("   ✅ Circuit uploaded and finalized");
    } catch (error) {
      console.log("   ⚠️  Circuit upload failed (circuit may exist), finalizing comp_def manually...");
      // Circuit already exists, just finalize the comp_def
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
      } catch (finalizeError) {
        console.log("   ⚠️  Finalize failed (may already be finalized):", finalizeError.message);
      }
    }

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
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Generate ephemeral key pair and nonce
    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const nonce = randomBytes(16);
    const nonceNum = new anchor.BN(deserializeLE(nonce).toString());

    // Encrypt the amount using RescueCipher (client-side encryption)
    // In 0.3.0, we calculate shared secret manually
    const sharedSecret = x25519.scalarMult(ephemeralPrivateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const encryptedAmount = cipher.encrypt([BigInt(transferAmount)], nonce)[0];

    console.log("Transfer parameters:");
    console.log("   Amount:", transferAmount, "lamports (0.1 SOL)");
    console.log("   Computation offset:", computationOffset.toString());
    console.log("   Encrypted amount:", Buffer.from(encryptedAmount).toString("hex").slice(0, 20) + "...");

    // 6. Queue private transfer
    const transferCompletedEventPromise = awaitEvent("transferCompleted");

    // Calculate sign PDA manually (0.3.0 doesn't have helper function)
    // derive_seed!(SignerAccount) = "SignerAccount".as_bytes()
    const SIGN_PDA_SEED = Buffer.from("SignerAccount");
    const [signPdaAddress] = PublicKey.findProgramAddressSync(
      [SIGN_PDA_SEED],
      program.programId
    );

    const queueSig = await program.methods
      .privateTransfer(
        computationOffset,
        Array.from(Buffer.from(encryptedAmount.toString(16).padStart(64, '0'), 'hex')),
        Array.from(ephemeralPublicKey),
        nonceNum
      )
      .accountsPartial({
        payer: sender.publicKey,
        sender: sender.publicKey,
        receiver: receiver.publicKey,
        signPdaAccount: signPdaAddress,
        computationAccount: getComputationAccAddress(
          program.programId,
          computationOffset
        ),
        clusterAccount: getClusterAccAddress(0),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: compDefPDA,
        arciumProgram: getArciumProgAddress(),
      })
      .signers([sender])
      .rpc({ skipPreflight: false, commitment: "confirmed" });
    console.log("✅ Transfer queued:", queueSig);

    console.log("\n🔓 MPC DECRYPTION & TRANSFER");
    console.log("=".repeat(50));

    // 7. Wait for computation finalization
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Computation finalized:", finalizeSig);

    // 8. Wait for callback event
    const transferCompletedEvent = await transferCompletedEventPromise;
    console.log("✅ Transfer executed! Amount:", transferCompletedEvent.amount.toString(), "lamports");

    console.log("\n✅ VERIFICATION");
    console.log("=".repeat(50));

    // 9. Check final balances
    const finalReceiverBalance = await provider.connection.getBalance(receiver.publicKey);
    console.log("📊 Final receiver balance:", finalReceiverBalance / 1e9, "SOL");
    console.log("📊 Balance increase:", (finalReceiverBalance - initialReceiverBalance) / 1e9, "SOL");

    expect(finalReceiverBalance - initialReceiverBalance).to.equal(transferAmount);
    expect(transferCompletedEvent.amount.toNumber()).to.equal(transferAmount);

    console.log("\n✨ SUCCESS! Simple private transfer completed!");
    console.log("   Original amount:  ", transferAmount, "lamports");
    console.log("   Decrypted amount: ", transferCompletedEvent.amount.toString(), "lamports");
    console.log("   Receiver received:", finalReceiverBalance - initialReceiverBalance, "lamports");
  });
});
