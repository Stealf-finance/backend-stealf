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

  it("Full flow: Smart Account + Encrypt Private Wallet PDA + Store + Decrypt", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("\n🔧 SETUP");
    console.log("=".repeat(50));

    // 1. Créer un Smart Account (simulé avec un Keypair)
    const smartAccount = Keypair.generate();
    console.log("✅ Smart Account créé:", smartAccount.publicKey.toBase58());
    console.log("   KeyPubAuth:", owner.publicKey.toBase58());

    // 2. Créer un wallet privé
    const privateWallet = Keypair.generate();
    console.log("✅ Private Wallet créé:", privateWallet.publicKey.toBase58());

    // 3. Calculer le PDA du wallet privé (celui qu'on va chiffrer et stocker)
    const [privateWalletPDA, privateWalletBump] =
      PublicKey.findProgramAddressSync(
        [Buffer.from("private_wallet"), privateWallet.publicKey.toBuffer()],
        program.programId
      );
    console.log("✅ Private Wallet PDA calculé:", privateWalletPDA.toBase58());
    console.log("   Bump:", privateWalletBump);

    // 4. Calculer le PDA du Smart Account Storage (où on va stocker l'adresse chiffrée)
    const [smartAccountStoragePDA, smartAccountBump] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("smart_account_storage"),
          smartAccount.publicKey.toBuffer(),
        ],
        program.programId
      );
    console.log(
      "✅ Smart Account Storage PDA:",
      smartAccountStoragePDA.toBase58()
    );
    console.log("   Bump:", smartAccountBump);

    console.log("\n🔐 ENCRYPTION FLOW");
    console.log("=".repeat(50));

    // 5. Initialiser le circuit de chiffrement
    console.log("Initializing encrypt_pda_address computation definition...");
    const initEncryptSig = await initEncryptPdaCompDef(
      program,
      owner,
      false,
      true // offchainSource: true pour utiliser Supabase
    );
    console.log("✅ Encrypt comp def initialized:", initEncryptSig);

    // 6. Obtenir la clé publique MXE pour chiffrer
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("✅ MXE x25519 pubkey récupérée");

    // 7. Générer clé éphémère pour chiffrement
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // 8. Chiffrer l'adresse du PDA privé (convertie en BigInt)
    const pdaAddressBytes = privateWalletPDA.toBuffer();
    const plaintext = Array.from(pdaAddressBytes).map((byte) => BigInt(byte));

    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);
    console.log("✅ Adresse PDA chiffrée côté client");

    // 9. Envoyer au circuit MPC pour re-chiffrement sécurisé
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
        payer: owner.publicKey,
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
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("✅ Encrypt computation queued:", queueEncryptSig);

    // 10. Attendre la finalisation du calcul MPC
    const finalizeEncryptSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      encryptComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Encrypt computation finalized:", finalizeEncryptSig);

    // 11. Récupérer l'event avec l'adresse chiffrée
    const encryptedPdaEvent = await encryptedPdaEventPromise;
    console.log("✅ Event reçu avec adresse chiffrée");

    console.log("\n💾 STORAGE");
    console.log("=".repeat(50));

    // 12. Stocker l'adresse chiffrée dans le PDA du Smart Account
    const storeSig = await program.methods
      .storeEncryptedAddress(Array.from(encryptedPdaEvent.encryptedAddress))
      .accountsPartial({
        smartAccountStorage: smartAccountStoragePDA,
        smartAccount: smartAccount.publicKey,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    console.log("✅ Adresse chiffrée stockée on-chain:", storeSig);

    // 13. Vérifier le stockage
    const storedData = await program.account.smartAccountStorage.fetch(
      smartAccountStoragePDA
    );
    console.log("✅ Données stockées vérifiées:");
    console.log("   Owner:", storedData.owner.toBase58());
    console.log("   Smart Account:", storedData.smartAccount.toBase58());
    console.log("   Encrypted PDA:", Buffer.from(storedData.encryptedPdaAddress).toString("hex").slice(0, 20) + "...");

    expect(storedData.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(storedData.smartAccount.toBase58()).to.equal(
      smartAccount.publicKey.toBase58()
    );

    console.log("\n🔓 DECRYPTION FLOW");
    console.log("=".repeat(50));

    // 14. Initialiser le circuit de déchiffrement
    console.log("Initializing decrypt_pda_address computation definition...");
    const initDecryptSig = await initDecryptPdaCompDef(
      program,
      owner,
      false,
      true // offchainSource: true pour utiliser Supabase
    );
    console.log("✅ Decrypt comp def initialized:", initDecryptSig);

    // 15. Déchiffrer l'adresse via MPC
    const decryptedPdaEventPromise = awaitEvent("decryptedPdaEvent");
    const decryptComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueDecryptSig = await program.methods
      .decryptPda(
        decryptComputationOffset,
        Array.from(encryptedPdaEvent.encryptedAddress),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(Uint8Array.from(encryptedPdaEvent.nonce)).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          program.programId,
          decryptComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("decrypt_pda_address")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("✅ Decrypt computation queued:", queueDecryptSig);

    // 16. Attendre la finalisation
    const finalizeDecryptSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      decryptComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Decrypt computation finalized:", finalizeDecryptSig);

    // 17. Récupérer l'event avec l'adresse déchiffrée
    const decryptedPdaEvent = await decryptedPdaEventPromise;
    const decryptedAddress = new PublicKey(
      decryptedPdaEvent.decryptedAddress
    );
    console.log("✅ Adresse PDA déchiffrée:", decryptedAddress.toBase58());

    console.log("\n✨ VERIFICATION");
    console.log("=".repeat(50));

    // 18. Vérifier que l'adresse déchiffrée correspond à l'originale
    expect(decryptedAddress.toBase58()).to.equal(
      privateWalletPDA.toBase58()
    );
    console.log("✅ SUCCÈS ! L'adresse déchiffrée correspond à l'adresse PDA originale !");
    console.log("\n📊 RÉSUMÉ:");
    console.log("   Smart Account:        ", smartAccount.publicKey.toBase58());
    console.log("   Private Wallet:       ", privateWallet.publicKey.toBase58());
    console.log("   Private Wallet PDA:   ", privateWalletPDA.toBase58());
    console.log("   Adresse déchiffrée:   ", decryptedAddress.toBase58());
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
        provider as anchor.AnchorProvider,
        "encrypt_pda_address",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
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
        provider as anchor.AnchorProvider,
        "decrypt_pda_address",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
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
