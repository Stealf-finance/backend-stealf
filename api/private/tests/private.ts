import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Private } from "../target/types/private";
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

describe("Private Transfer Validation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Private as Program<Private>;
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

  it("Should validate transfer with sufficient balance", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing validate_transfer computation definition");
    const initSig = await initValidateTransferCompDef(
      program,
      owner,
      false,
      false
    );
    console.log(
      "Validate transfer computation definition initialized with signature",
      initSig
    );

    // Obtenir la clé publique MXE pour le chiffrement
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    console.log("MXE x25519 pubkey is", mxePublicKey);

    // Setup chiffrement
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Valeurs du transfert - solde suffisant
    const senderBalance = BigInt(1_000_000_000); // 1 SOL
    const transferAmount = BigInt(250_000_000); // 0.25 SOL

    console.log("Sender balance:", Number(senderBalance), "lamports");
    console.log("Transfer amount:", Number(transferAmount), "lamports");

    // Chiffrer les montants séparément
    const nonce = randomBytes(16);
    const senderBalanceCt = cipher.encrypt([senderBalance], nonce);
    const transferAmountCt = cipher.encrypt([transferAmount], nonce);

    // Préparer l'event listener pour ValidationEvent
    const validationEventPromise = awaitEvent("validationEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    console.log("Queueing private transfer validation...");
    console.log("- Computation offset:", computationOffset.toString());

    const queueSig = await program.methods
      .validateTransfer(
        computationOffset,
        Array.from(senderBalanceCt[0]),
        Array.from(transferAmountCt[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(
          program.programId,
          computationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("validate_transfer")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("✅ Queue transaction signature:", queueSig);

    // Attendre la finalisation du calcul MPC
    console.log("⏳ Waiting for MPC computation to complete...");
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("✅ Finalize signature:", finalizeSig);

    // Récupérer l'event ValidationEvent
    const validationEvent = await validationEventPromise;
    console.log("📩 Validation event received:", validationEvent);

    // Déchiffrer le résultat
    const encryptedResult = validationEvent.isValidEncrypted;
    const resultNonce = Buffer.from(validationEvent.nonce);

    console.log("🔓 Decrypting validation result...");
    const decryptedResult = cipher.decrypt([encryptedResult], resultNonce);
    const isValid = decryptedResult[0] !== BigInt(0);

    console.log("✅ Validation result:", isValid ? "VALID" : "INVALID");

    // Vérifications
    expect(isValid).to.be.true;
    console.log("✅ Transfer validation completed successfully!");
  });

  it("Should reject transfer with insufficient balance", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Setup chiffrement
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Montant supérieur à la balance
    const senderBalance = BigInt(100_000); // 0.0001 SOL
    const transferAmount = BigInt(200_000); // 0.0002 SOL (plus que la balance)

    console.log("Testing transfer with insufficient balance...");
    console.log("Sender balance:", Number(senderBalance), "lamports");
    console.log("Transfer amount:", Number(transferAmount), "lamports");

    const nonce = randomBytes(16);
    const senderBalanceCt = cipher.encrypt([senderBalance], nonce);
    const transferAmountCt = cipher.encrypt([transferAmount], nonce);

    const validationEventPromise = awaitEvent("validationEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueSig = await program.methods
      .validateTransfer(
        computationOffset,
        Array.from(senderBalanceCt[0]),
        Array.from(transferAmountCt[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(
          program.programId,
          computationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("validate_transfer")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("✅ Queue transaction signature:", queueSig);

    console.log("⏳ Waiting for MPC computation...");
    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );

    const validationEvent = await validationEventPromise;

    // Déchiffrer le résultat
    const encryptedResult = validationEvent.isValidEncrypted;
    const resultNonce = Buffer.from(validationEvent.nonce);

    const decryptedResult = cipher.decrypt([encryptedResult], resultNonce);
    const isValid = decryptedResult[0] !== BigInt(0);

    console.log("✅ Validation result:", isValid ? "VALID" : "INVALID");

    // La validation devrait échouer (balance insuffisante)
    expect(isValid).to.be.false;

    console.log("✅ Transfer correctly rejected for insufficient balance");
  });

  it("Should reject transfer with zero amount", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Montant = 0
    const senderBalance = BigInt(1_000_000);
    const transferAmount = BigInt(0); // Montant invalide

    console.log("Testing transfer with zero amount...");

    const nonce = randomBytes(16);
    const senderBalanceCt = cipher.encrypt([senderBalance], nonce);
    const transferAmountCt = cipher.encrypt([transferAmount], nonce);

    const validationEventPromise = awaitEvent("validationEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    await program.methods
      .validateTransfer(
        computationOffset,
        Array.from(senderBalanceCt[0]),
        Array.from(transferAmountCt[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(
          program.programId,
          computationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("validate_transfer")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );

    const validationEvent = await validationEventPromise;
    const encryptedResult = validationEvent.isValidEncrypted;
    const resultNonce = Buffer.from(validationEvent.nonce);

    const decryptedResult = cipher.decrypt([encryptedResult], resultNonce);
    const isValid = decryptedResult[0] !== BigInt(0);

    // La validation devrait échouer (montant = 0)
    expect(isValid).to.be.false;

    console.log("✅ Transfer correctly rejected for zero amount");
  });

  async function initValidateTransferCompDef(
    program: Program<Private>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("validate_transfer");
    const offsetValue = Buffer.from(offset).readUInt32LE();

    const compDefPDA = getCompDefAccAddress(program.programId, offsetValue);

    console.log("Comp def PDA is", compDefPDA.toBase58());
    console.log("Offset value:", offsetValue);

    // Check if comp_def account already exists
    const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

    let sig: string;
    if (accountInfo) {
      // Account already exists, skip initialization
      console.log("Comp def account already exists, skipping initialization");
      sig = "already_initialized";
    } else {
      // Account doesn't exist, initialize it
      sig = await program.methods
        .initValidateTransferCompDef()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });
    }

    console.log("Init validate_transfer computation definition transaction", sig);

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/validate_transfer.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "validate_transfer",
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
});

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
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
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
