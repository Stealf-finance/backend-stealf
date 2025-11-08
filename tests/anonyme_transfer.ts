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
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("Private Link - Smart Account + Private Wallet", () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AnonymeTransfer as Program<AnonymeTransfer>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    timeoutMs = 60000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(eventName as any, (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        res(event);
      });
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${eventName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();

  it("Full flow: Smart Account + Encrypt + Store + Decrypt", async () => {
    console.log("\n🔧 SETUP");
    console.log("=".repeat(50));

    const smartAccount = Keypair.generate();
    console.log("✅ Smart Account créé:", smartAccount.publicKey.toBase58());
    console.log("   Owner:", owner.publicKey.toBase58());

    const privateWallet = Keypair.generate();
    console.log("✅ Private Wallet créé:", privateWallet.publicKey.toBase58());

    const [privateWalletPDA, privateWalletBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("private_wallet"), privateWallet.publicKey.toBuffer()],
      program.programId
    );
    console.log("✅ Private Wallet PDA:", privateWalletPDA.toBase58());
    console.log("   Bump:", privateWalletBump);

    const [smartAccountStoragePDA, smartAccountBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("smart_account_storage"), smartAccount.publicKey.toBuffer()],
      program.programId
    );
    console.log("✅ Smart Account Storage PDA:", smartAccountStoragePDA.toBase58());
    console.log("   Bump:", smartAccountBump);


    console.log("Initializing computation definitions...");
    await Promise.all([
      initEncryptPdaCompDef(program, owner, false, true).then((sig) =>
        console.log("✅ Encrypt comp def initialized:", sig)
      ),
      initDecryptPdaCompDef(program, owner, false, true).then((sig) =>
        console.log("✅ Decrypt comp def initialized:", sig)
      ),
    ]);
    console.log("All computation definitions initialized");
    await new Promise((res) => setTimeout(res, 2000));

    // --- Setup Cryptography----
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider,
      program.programId
    );

    console.log("Mxe x25519 pubkey is", mxePublicKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const nonce = randomBytes(16);

    const pdaAddressBytes = privateWalletPDA.toBuffer();
    const plaintext = Array.from(pdaAddressBytes).map((byte) => BigInt(byte));
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const encryptedPdaEventPromise = awaitEvent("encryptedPdaEvent");
    const encryptComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueEncryptSig = await program.methods
      .encryptPda(
        encryptComputationOffset,
        Array.from(ciphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          program.programId,
          encryptComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("encrypt_pda_address")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("✅ Encrypt computation queued:", queueEncryptSig);

    const finalizeEncryptSig = await awaitComputationFinalization(
      provider,
      encryptComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Encrypt computation finalized:", finalizeEncryptSig);

    const encryptedPdaEvent = await encryptedPdaEventPromise;
    console.log("✅ Event reçu avec adresse chiffrée");

    
    const storeSig = await program.methods
      .storeEncryptedAddress(Array.from(encryptedPdaEvent.encryptedAddress))
      .accounts({
        smartAccountStorage: smartAccountStoragePDA,
        smartAccount: smartAccount.publicKey,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Adresse chiffrée stockée on-chain:", storeSig);

    // --- Vérification du stockage ---
    console.log("\n✅ VERIFICATION DU STOCKAGE");
    console.log("=".repeat(50));

    const storedData = await program.account.smartAccountStorage.fetch(
      smartAccountStoragePDA
    );
    console.log("✅ Données récupérées depuis la blockchain:");
    console.log("   Owner:", storedData.owner.toBase58());
    console.log("   Smart Account:", storedData.smartAccount.toBase58());
    console.log("   Encrypted PDA (hex):", Buffer.from(storedData.encryptedPdaAddress).toString("hex").slice(0, 32) + "...");

    // Vérifier que les données correspondent
    expect(storedData.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(storedData.smartAccount.toBase58()).to.equal(
      smartAccount.publicKey.toBase58()
    );

    console.log("\n✨ RÉSUMÉ DU TEST");
    console.log("=".repeat(50));
    console.log("   Smart Account:        ", smartAccount.publicKey.toBase58());
    console.log("   Private Wallet:       ", privateWallet.publicKey.toBase58());
    console.log("   Private Wallet PDA:   ", privateWalletPDA.toBase58());
    console.log("   Storage PDA:          ", smartAccountStoragePDA.toBase58());
    console.log("\n✅ SUCCÈS ! Le chiffrement et le stockage fonctionnent correctement !");
  });

  // ============= HELPER FUNCTIONS =============

  async function initEncryptPdaCompDef(
    program: Program<AnonymeTransfer>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("encrypt_pda_address");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initEncryptPdaCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/encrypt_pda_address.arcis");
      await uploadCircuit(
        provider,
        "encrypt_pda_address",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider,
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

  async function initDecryptPdaCompDef(
    program: Program<AnonymeTransfer>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("decrypt_pda_address");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initDecryptPdaCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/decrypt_pda_address.arcis");
      await uploadCircuit(
        provider,
        "decrypt_pda_address",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider,
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