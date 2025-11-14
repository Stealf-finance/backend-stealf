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
  getClusterAccAddress,
  deserializeLE,
  RescueCipher,
  x25519,
  getMXEPublicKey,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

// Cluster configuration
// For localnet testing: null (uses ARCIUM_CLUSTER_PUBKEY from env)
// For devnet/testnet: specific cluster offset
const CLUSTER_OFFSET = 768109697;
const PROGRAM = "A26JcC1bfDZ1wV5Vkdo4rrwDcUzorjT55a6RGp7bAfzx";

function getClusterAccount(): PublicKey {
  if (CLUSTER_OFFSET !== null) {
    return getClusterAccAddress(CLUSTER_OFFSET);
  } else {
    return getArciumEnv().arciumClusterPubkey;
  }
}



if (useDevnet) {
  // Devnet configuration
  const connection = new anchor.web3.Connection(
    "https://devnet.helius-rpc.com/?api-key=43e43858-1784-4f9f-8a2d-fd791cd44d53", // or your preferred RPC
    "confirmed"
  );
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program<PROGRAM>(IDL as anchor.Idl, provider);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET); // Use your cluster offset
} else {
  // Local configuration
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.YourProgram as Program<PROGRAM>;
  const arciumEnv = getArciumEnv();
  const clusterAccount = arciumEnv.arciumClusterPubkey;
}

describe("Private Wallet Link", () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.PrivateWallet as Program<PrivateWallet>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const clusterAccount = getClusterAccount();


  it("Links Grid and Private wallets", async () => {
    console.log("Initializing computation definition...");
    const initSig = await initLinkWalletsCompDef(program, provider, owner, false, false);
    console.log("CompDef initialized:", initSig);

    await new Promise((res) => setTimeout(res, 2000));

    // Generate random wallets for testing
    const randomGridWallet = Keypair.generate();
    await linkSmartAccountWithPrivateWallet(randomGridWallet.publicKey, program, provider, owner, clusterAccount);
  });

  it.skip("Links Smart Account with a new Private wallet", async () => {
    // This test is skipped because it would conflict with the PDA of the first test
    // In production, each user would have their own unique owner keypair
    const smartAccountAddress = Keypair.generate();

    console.log("\n" + "=".repeat(50));
    console.log("Testing Smart Account Linking");
    console.log("=".repeat(50));

    const result = await linkSmartAccountWithPrivateWallet(
      smartAccountAddress.publicKey,
      program,
      provider,
      owner,
      clusterAccount
    );

    console.log("\n✅ Smart Account successfully linked!");
    console.log("   Smart Account:", result.gridWallet.toBase58());
    console.log("   Private Wallet:", result.privateWallet.publicKey.toBase58());
  });

  it("Retrieves linked wallets for existing user (login scenario)", async () => {
    console.log("\n" + "=".repeat(50));
    console.log("Testing Wallet Retrieval for Existing User");
    console.log("=".repeat(50));

    // Note: The first test already created a wallet link for this owner
    // We're simulating a user login by retrieving the existing linked wallets

    console.log("\n🔑 Simulating user login (retrieving existing wallets)...");
    const retrievedWallets = await retrieveLinkedWallets(
      owner.publicKey,
      program,
      provider,
      clusterAccount
    );

    console.log("\n✅ Wallets successfully retrieved!");
    console.log("   Grid Wallet:   ", retrievedWallets.gridWallet.toBase58());
    console.log("   Private Wallet:", retrievedWallets.privateWallet.toBase58());

    console.log("\n" + "=".repeat(50));
    console.log("🎉 Login scenario successful! User can access their wallets!");
    console.log("=".repeat(50));
  });
});

/**
 * Links a smart account address with a newly created private wallet
 * @param smartAccountAddress - The address of the smart account (grid wallet)
 * @param program - The Arcium program instance
 * @param provider - The Anchor provider
 * @param owner - The keypair of the transaction payer/signer
 * @param arciumEnv - The Arcium environment configuration
 * @returns The grid wallet public key and the newly created private wallet keypair
 */
async function linkSmartAccountWithPrivateWallet(
  smartAccountAddress: PublicKey,
  program: Program<PrivateWallet>,
  provider: anchor.AnchorProvider,
  owner: Keypair,
  arciumEnv: any
) {
  // Use provided smart account as grid wallet
  const gridWallet = smartAccountAddress;
  // Generate new private wallet
  const privateWallet = Keypair.generate();

  console.log("Smart Account (Grid Wallet):", gridWallet.toBase58());
  console.log("Private Wallet (Generated):", privateWallet.publicKey.toBase58());

  const computationOffset = new anchor.BN(randomBytes(8));

  const mxePublicKey = await getMXEPublicKey(provider, program.programId);
  console.log("MXE x25519 pubkey:", mxePublicKey);

  const clientSecretKey = x25519.utils.randomSecretKey();
  const clientPubKey = x25519.getPublicKey(clientSecretKey);
  const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const gridBytes = gridWallet.toBytes();
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

  // Use cluster offset for deriving the cluster account address
  const clusterAccount = getClusterAccAddress(768109697);

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
      clusterAccount: clusterAccount,
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

  const decryptedWallets = decryptWalletsLocally(event, cipher);

  console.log("\nDecrypted wallets:");
  console.log("   Grid Wallet:   ", decryptedWallets.gridWallet.toBase58());
  console.log("   Private Wallet:", decryptedWallets.privateWallet.toBase58());

  // Verify decryption correctness
  console.log("\nVerification:");
  const gridMatch = decryptedWallets.gridWallet.equals(gridWallet);
  const privateMatch = decryptedWallets.privateWallet.equals(privateWallet.publicKey);
  console.log("   Grid Wallet match:   ", gridMatch ? "[PASS]" : "[FAIL]");
  console.log("   Private Wallet match:", privateMatch ? "[PASS]" : "[FAIL]");

  console.log("\n" + "=".repeat(50));
  console.log("Wallets successfully linked, re-encrypted, and decrypted!");

  return { gridWallet, privateWallet };
}

/**
 * Decrypts wallet addresses locally from MPC computation event
 * @param event - The walletsLinkedEvent containing encrypted wallet data
 * @param cipher - The RescueCipher instance used for decryption
 * @returns The decrypted grid wallet and private wallet PublicKeys
 */
function decryptWalletsLocally(
  event: {
    nonce: number[];
    gridWalletLow: number[];
    gridWalletHigh: number[];
    privateWalletLow: number[];
    privateWalletHigh: number[];
  },
  cipher: RescueCipher
): { gridWallet: PublicKey; privateWallet: PublicKey } {
  console.log("Decrypting wallets locally...");

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
  const gridWallet = new PublicKey(Buffer.concat([
    u128ToBytes(decrypted[0]),
    u128ToBytes(decrypted[1])
  ]));

  const privateWallet = new PublicKey(Buffer.concat([
    u128ToBytes(decrypted[2]),
    u128ToBytes(decrypted[3])
  ]));

  return { gridWallet, privateWallet };
}

/**
 * Retrieves linked wallets for an existing user (login scenario)
 * Reads encrypted data from PDA and uses MPC to re-encrypt with a new ephemeral client key
 * @param ownerPublicKey - The public key of the account owner
 * @param program - The Arcium program instance
 * @param provider - The Anchor provider
 * @param arciumEnv - The Arcium environment configuration
 * @returns The decrypted grid wallet and private wallet PublicKeys
 */
async function retrieveLinkedWallets(
  ownerPublicKey: PublicKey,
  program: Program<PrivateWallet>,
  provider: anchor.AnchorProvider,
  arciumEnv: any
): Promise<{ gridWallet: PublicKey; privateWallet: PublicKey }> {
  console.log("Retrieving linked wallets for existing user...");

  // Derive the PDA address for encrypted wallets
  const [encryptedWalletsPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("encrypted_wallets"),
      ownerPublicKey.toBuffer(),
    ],
    program.programId
  );

  console.log("Encrypted wallets PDA:", encryptedWalletsPDA.toBase58());

  // Generate NEW ephemeral client keys for this session
  const computationOffset = new anchor.BN(randomBytes(8));
  const mxePublicKey = await getMXEPublicKey(provider, program.programId);
  console.log("MXE x25519 pubkey:", mxePublicKey);

  const clientSecretKey = x25519.utils.randomSecretKey();
  const clientPubKey = x25519.getPublicKey(clientSecretKey);
  const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // Generate a new nonce for this session
  const clientNonce = randomBytes(16);

  // Setup event listener
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
  const clusterAccount = getClusterAccAddress(768109697);

  // Queue MPC computation to re-encrypt the stored wallets with the new client key
  // The MPC will decrypt the PDA data and re-encrypt it for the new client
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
      clusterAccount: clusterAccount,
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(program.programId),
      executingPool: getExecutingPoolAccAddress(program.programId),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("link_wallets")).readUInt32LE()
      ),
      payer: ownerPublicKey,
      encryptedWallets: encryptedWalletsPDA,
    })
    .rpc({ commitment: "confirmed" });

  console.log("MPC computation queued:", linkSig);

  // Wait for MPC computation to complete
  await awaitComputationFinalization(
    provider,
    computationOffset,
    program.programId,
    "confirmed"
  );

  const event = await walletsLinkedEventPromise;

  // Decrypt the wallets using the new cipher
  const decryptedWallets = decryptWalletsLocally(event, cipher);

  console.log("\n✅ Wallets successfully retrieved!");
  console.log("   Grid Wallet:   ", decryptedWallets.gridWallet.toBase58());
  console.log("   Private Wallet:", decryptedWallets.privateWallet.toBase58());

  return decryptedWallets;
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
