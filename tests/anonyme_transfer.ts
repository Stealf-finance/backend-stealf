import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { PrivateWallet } from "../target/types/private_wallet";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  buildFinalizeCompDefTx,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  deserializeLE,
  RescueCipher,
  x25519,
  getMXEPublicKey,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

describe("Private Wallet Link", () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.PrivateWallet as Program<PrivateWallet>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();

  it("Links Grid and Private wallets", async () => {
    console.log("Initializing computation definition...");
    const initSig = await initLinkWalletsCompDef(program, provider, owner, false, false);
    console.log("CompDef initialized:", initSig);

    await new Promise((res) => setTimeout(res, 2000));

    await linkWallets(program, provider, owner, arciumEnv);
  });
});

async function linkWallets(
  program: Program<PrivateWallet>,
  provider: anchor.AnchorProvider,
  owner: Keypair,
  arciumEnv: any
) {
  // Generate test wallets
  const gridWallet = Keypair.generate();
  const privateWallet = Keypair.generate();

  console.log("Grid Wallet:", gridWallet.publicKey.toBase58());
  console.log("Private Wallet:", privateWallet.publicKey.toBase58());

  const computationOffset = new anchor.BN(randomBytes(8));

  const mxePublicKey = await getMXEPublicKey(provider, program.programId);
  console.log("MXE x25519 pubkey:", mxePublicKey);

  const clientSecretKey = x25519.utils.randomSecretKey();
  const clientPubKey = x25519.getPublicKey(clientSecretKey);
  const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const gridBytes = gridWallet.publicKey.toBytes();
  const gridLow = BigInt('0x' + Buffer.from(gridBytes.slice(0, 16)).toString('hex'));
  const gridHigh = BigInt('0x' + Buffer.from(gridBytes.slice(16, 32)).toString('hex'));

  const privateBytes = privateWallet.publicKey.toBytes();
  const privateLow = BigInt('0x' + Buffer.from(privateBytes.slice(0, 16)).toString('hex'));
  const privateHigh = BigInt('0x' + Buffer.from(privateBytes.slice(16, 32)).toString('hex'));

  const clientNonce = randomBytes(16);
  const allCiphertexts = cipher.encrypt([gridLow, gridHigh, privateLow, privateHigh], clientNonce);

  const [encryptedWalletsPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("encrypted_wallets"),
      owner.publicKey.toBuffer(),
    ],
    program.programId
  );

  const storeSig = await program.methods
      .storeEncryptedWallets(
        Array.from(allCiphertexts[0]),
        Array.from(allCiphertexts[1]),
        Array.from(allCiphertexts[2]),
        Array.from(allCiphertexts[3]),
      )
      .rpc({ commitment: "confirmed" });
  console.log("Encrypted wallets stored:", storeSig);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(eventName: E) => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const walletsLinkedEventPromise = awaitEvent("walletsLinkedEvent");

  const linkSig = await program.methods
    .linkWallets(
      computationOffset,
      Array.from(clientPubKey),
      new anchor.BN(deserializeLE(clientNonce).toString()),
      Array.from(clientPubKey),  // sender = client (same keys)
      new anchor.BN(deserializeLE(clientNonce).toString()),  // sender nonce (same)
    )
    .accountsPartial({
      computationAccount: getComputationAccAddress(program.programId, computationOffset),
      clusterAccount: arciumEnv.arciumClusterPubkey,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(program.programId),
      executingPool: getExecutingPoolAccAddress(program.programId),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("link_wallets")).readUInt32LE()
      ),
      payer: owner.publicKey,
      encryptedWallets: encryptedWalletsPDA,
    })
    .signers([owner])
    .rpc({ commitment: "confirmed" });

  console.log("Computation queued:", linkSig);

  await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
  );

  const event = await walletsLinkedEventPromise;

  console.log("Decrypting wallets...");
  const eventNonce = Buffer.from(event.nonce);

  // Decrypt the 4 ciphertexts (each represents a u128)
  const decrypted = cipher.decrypt(
    [
      event.gridWalletLow,
      event.gridWalletHigh,
      event.privateWalletLow,
      event.privateWalletHigh
    ],
    eventNonce
  );

  // Convert u128 bigint to 16 bytes using the same format as encryption
  const u128ToBytes = (value: bigint): Buffer => {
    const hex = value.toString(16).padStart(32, '0');
    return Buffer.from(hex, 'hex');
  };

  // Reconstruct PublicKeys from decrypted u128 values
  const decryptedGridWallet = new PublicKey(Buffer.concat([
    u128ToBytes(decrypted[0]),
    u128ToBytes(decrypted[1])
  ]));

  const decryptedPrivateWallet = new PublicKey(Buffer.concat([
    u128ToBytes(decrypted[2]),
    u128ToBytes(decrypted[3])
  ]));

  console.log("\\nDecrypted wallets:");
  console.log("   Grid Wallet:   ", decryptedGridWallet.toBase58());
  console.log("   Private Wallet:", decryptedPrivateWallet.toBase58());

  // Verify decryption correctness
  console.log("\\nVerification:");
  const gridMatch = decryptedGridWallet.equals(gridWallet.publicKey);
  const privateMatch = decryptedPrivateWallet.equals(privateWallet.publicKey);
  console.log("   Grid Wallet match:   ", gridMatch ? "[PASS]" : "[FAIL]");
  console.log("   Private Wallet match:", privateMatch ? "[PASS]" : "[FAIL]");

  console.log("\\n" + "=".repeat(50));
  console.log("Wallets successfully linked, re-encrypted, and decrypted!");

  return { gridWallet, privateWallet };
}

// ============= HELPER FUNCTIONS =============

async function initLinkWalletsCompDef(
  program: Program<PrivateWallet>,
  provider: anchor.AnchorProvider,
  owner: Keypair,
  uploadRawCircuit: boolean,
  offchainSource: boolean
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("link_wallets");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  const sig = await program.methods
    .initLinkWalletsCompDef()
    .accountsPartial({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({ commitment: "confirmed" });

  if (!offchainSource) {
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

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}
