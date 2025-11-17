import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEPublicKey,
  deserializeLE,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { PROGRAM_IDS, CLUSTER_OFFSETS, RPC_ENDPOINTS } from "../core/constants";
import type {
  WalletLinkConfig,
  LinkSmartAccountOptions,
  LinkSmartAccountResult,
  RetrieveWalletsOptions,
  RetrieveWalletsResult,
  WalletsLinkedEvent,
} from "../core/types";
import { PDAUtils } from "../utils/pda";

/**
 * Client for interacting with Stealf private wallet linking
 *
 * This SDK allows you to:
 * 1. Link a Grid Smart Account with a newly created private wallet
 * 2. Retrieve linked wallets using MPC re-encryption
 *
 * @example
 * ```typescript
 * import { WalletLinkClient } from '@stealf/wallet-link-sdk';
 *
 * const client = new WalletLinkClient(wallet, {
 *   environment: 'devnet'
 * });
 *
 * // Create and link a private wallet for a smart account
 * const result = await client.linkSmartAccountWithPrivateWallet({
 *   gridWallet: smartAccountAddress
 * });
 *
 * console.log('Private wallet:', result.privateWallet.secretKey);
 * ```
 */
export class WalletLinkClient {
  private program: anchor.Program;
  private provider: anchor.AnchorProvider;
  private programId: PublicKey;
  private clusterOffset: number;

  /**
   * Create a new WalletLinkClient
   *
   * @param wallet - Solana wallet adapter
   * @param config - Configuration options
   *
   * @example
   * ```typescript
   * import { WalletLinkClient } from '@stealf/wallet-link-sdk';
   *
   * const client = new WalletLinkClient(wallet, {
   *   environment: 'devnet'
   * });
   * ```
   */
  constructor(
    wallet: anchor.Wallet,
    config: WalletLinkConfig
  ) {
    // Setup connection
    const rpcEndpoint = config.rpcEndpoint || RPC_ENDPOINTS[config.environment];
    const connection = new Connection(rpcEndpoint, "confirmed");

    // Setup provider
    this.provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    // Get program ID and cluster offset
    this.programId = config.programId || PROGRAM_IDS[config.environment];
    this.clusterOffset = config.clusterOffset || CLUSTER_OFFSETS[config.environment];

    // Load IDL
    this.program = new anchor.Program(
      this.getIDL(),
      this.provider
    );
  }

  /**
   * Links a Grid Smart Account with a newly created private wallet
   *
   * This function:
   * 1. Generates a new private wallet (Keypair)
   * 2. Encrypts the link between Grid wallet and Private wallet using MPC
   * 3. Stores the encrypted link on-chain in a PDA
   * 4. Returns the complete private wallet Keypair (with secret key)
   *
   * Based on the test function: linkSmartAccountWithPrivateWallet()
   *
   * @param options - Linking options
   * @returns Link result with the generated private wallet Keypair
   *
   * @example
   * ```typescript
   * // User has a Grid Smart Account from Grid SDK
   * const gridWallet = new PublicKey("...");
   *
   * const result = await client.linkSmartAccountWithPrivateWallet({
   *   gridWallet: gridWallet,
   *   onProgress: (status) => console.log(status),
   *   onComputationQueued: (sig) => console.log('TX:', sig)
   * });
   *
   * console.log("Grid Wallet:", result.gridWallet.toBase58());
   * console.log("Private Wallet:", result.privateWallet.publicKey.toBase58());
   *
   * // IMPORTANT: Save the private wallet secret key securely!
   * const secretKey = result.privateWallet.secretKey;
   * ```
   */
  async linkSmartAccountWithPrivateWallet(
    options: LinkSmartAccountOptions
  ): Promise<LinkSmartAccountResult> {
    const { gridWallet, onComputationQueued, onProgress } = options;

    onProgress?.("Generating new private wallet...");

    // Generate NEW private wallet (this is what makes it different from the old linkWallets)
    const privateWallet = Keypair.generate();

    console.log("Smart Account (Grid Wallet):", gridWallet.toBase58());
    console.log("Private Wallet (Generated):", privateWallet.publicKey.toBase58());

    onProgress?.("Fetching MXE public key...");

    // Get MXE public key for encryption
    const mxePublicKey = await getMXEPublicKey(
      this.provider,
      this.programId
    );

    if (!mxePublicKey) {
      throw new Error("Failed to fetch MXE public key");
    }

    onProgress?.("Setting up encryption...");

    // Setup encryption - exactly like in the test
    const clientSecretKey = x25519.utils.randomSecretKey();
    const clientPubKey = x25519.getPublicKey(clientSecretKey);
    const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    onProgress?.("Encrypting wallet addresses...");

    // Convert wallet addresses to field elements (u128) - exactly like in test
    const gridBytes = gridWallet.toBytes();
    const gridLow = BigInt('0x' + Buffer.from(gridBytes.slice(0, 16)).toString('hex'));
    const gridHigh = BigInt('0x' + Buffer.from(gridBytes.slice(16, 32)).toString('hex'));

    const privateBytes = privateWallet.publicKey.toBytes();
    const privateLow = BigInt('0x' + Buffer.from(privateBytes.slice(0, 16)).toString('hex'));
    const privateHigh = BigInt('0x' + Buffer.from(privateBytes.slice(16, 32)).toString('hex'));

    // Encrypt
    const clientNonce = randomBytes(16);
    const allCiphertexts = cipher.encrypt(
      [gridLow, gridHigh, privateLow, privateHigh],
      clientNonce
    );

    onProgress?.("Storing encrypted wallets on-chain...");

    // Derive PDA - using the connected wallet's public key (Grid Smart Account owner)
    const [encryptedWalletsPDA] = PDAUtils.getEncryptedWalletsPDA(
      this.provider.wallet.publicKey,
      this.programId
    );

    console.log("Encrypted wallets PDA:", encryptedWalletsPDA.toBase58());

    // Store encrypted wallets on-chain
    const storeSig = await this.program.methods
      .storeEncryptedWallets(
        Array.from(allCiphertexts[0]),
        Array.from(allCiphertexts[1]),
        Array.from(allCiphertexts[2]),
        Array.from(allCiphertexts[3]),
      )
      .rpc({ commitment: "confirmed" });

    console.log("Encrypted wallets stored:", storeSig);

    onProgress?.("Queueing MPC computation...");

    // Setup event listener - exactly like in test
    const walletsLinkedEventPromise = this.awaitEvent("walletsLinkedEvent");

    // Generate computation offset
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Get cluster account
    const clusterAccount = getClusterAccAddress(this.clusterOffset);

    // Queue MPC computation - exactly like in test
    const linkSig = await this.program.methods
      .linkWallets(
        computationOffset,
        Array.from(clientPubKey),
        new anchor.BN(deserializeLE(clientNonce).toString()),
        Array.from(clientPubKey),  // sender = client (same keys)
        new anchor.BN(deserializeLE(clientNonce).toString()),  // sender nonce (same)
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(this.programId, computationOffset),
        clusterAccount: clusterAccount,
        mxeAccount: getMXEAccAddress(this.programId),
        mempoolAccount: getMempoolAccAddress(this.programId),
        executingPool: getExecutingPoolAccAddress(this.programId),
        compDefAccount: getCompDefAccAddress(
          this.programId,
          Buffer.from(getCompDefAccOffset("link_wallets")).readUInt32LE()
        ),
        payer: this.provider.wallet.publicKey,
        encryptedWallets: encryptedWalletsPDA,
      })
      .rpc({ commitment: "confirmed" });

    console.log("Computation queued:", linkSig);
    onComputationQueued?.(linkSig);

    onProgress?.("Waiting for MPC computation...");

    // Wait for MPC computation to complete
    await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.programId,
      "confirmed"
    );

    // Get the event
    const event = await walletsLinkedEventPromise;

    // Decrypt wallets locally to verify
    const decryptedWallets = this.decryptWalletsLocally(event, cipher);

    console.log("\nDecrypted wallets (verification):");
    console.log("   Grid Wallet:   ", decryptedWallets.gridWallet.toBase58());
    console.log("   Private Wallet:", decryptedWallets.privateWallet.toBase58());

    // Verify decryption correctness
    console.log("\nVerification:");
    const gridMatch = decryptedWallets.gridWallet.equals(gridWallet);
    const privateMatch = decryptedWallets.privateWallet.equals(privateWallet.publicKey);
    console.log("   Grid Wallet match:   ", gridMatch ? "✅ PASS" : "❌ FAIL");
    console.log("   Private Wallet match:", privateMatch ? "✅ PASS" : "❌ FAIL");

    if (!gridMatch || !privateMatch) {
      throw new Error("Wallet decryption verification failed!");
    }

    onProgress?.("Complete!");

    console.log("\n" + "=".repeat(50));
    console.log("Wallets successfully linked, re-encrypted, and decrypted!");

    // Return the FULL Keypair (with secret key) - this is critical!
    return {
      signature: linkSig,
      gridWallet,
      privateWallet, // Full Keypair with secret key
    };
  }

  /**
   * Retrieves linked wallets for an existing user (login scenario)
   *
   * This function:
   * 1. Reads encrypted data from the PDA
   * 2. Uses MPC to re-encrypt with a new ephemeral client key
   * 3. Decrypts locally to get the wallet addresses
   *
   * Based on the test function: retrieveLinkedWallets()
   *
   * @param options - Retrieval options
   * @returns Decrypted wallet addresses
   *
   * @example
   * ```typescript
   * const wallets = await client.retrieveLinkedWallets({
   *   onProgress: (status) => console.log(status)
   * });
   *
   * console.log("Grid wallet:", wallets.gridWallet.toBase58());
   * console.log("Private wallet:", wallets.privateWallet.toBase58());
   * ```
   */
  async retrieveLinkedWallets(
    options?: RetrieveWalletsOptions
  ): Promise<RetrieveWalletsResult> {
    const { onComputationQueued, onProgress } = options || {};

    console.log("Retrieving linked wallets for existing user...");
    onProgress?.("Retrieving linked wallets...");

    // Derive the PDA address for encrypted wallets
    const [encryptedWalletsPDA] = PDAUtils.getEncryptedWalletsPDA(
      this.provider.wallet.publicKey,
      this.programId
    );

    console.log("Encrypted wallets PDA:", encryptedWalletsPDA.toBase58());
    onProgress?.("Fetching MXE public key...");

    // Get MXE public key
    const mxePublicKey = await getMXEPublicKey(
      this.provider,
      this.programId
    );

    if (!mxePublicKey) {
      throw new Error("Failed to fetch MXE public key");
    }

    console.log("MXE x25519 pubkey:", mxePublicKey);

    onProgress?.("Generating new encryption keys...");

    // Generate NEW ephemeral client keys for this session
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    const clientSecretKey = x25519.utils.randomSecretKey();
    const clientPubKey = x25519.getPublicKey(clientSecretKey);
    const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Generate a new nonce for this session
    const clientNonce = randomBytes(16);

    onProgress?.("Queueing MPC re-encryption...");

    // Setup event listener - exactly like in test
    const walletsLinkedEventPromise = this.awaitEvent("walletsLinkedEvent");

    // Get cluster account
    const clusterAccount = getClusterAccAddress(this.clusterOffset);

    // Queue MPC computation to re-encrypt the stored wallets with the new client key
    // The MPC will decrypt the PDA data and re-encrypt it for the new client
    const linkSig = await this.program.methods
      .linkWallets(
        computationOffset,
        Array.from(clientPubKey),
        new anchor.BN(deserializeLE(clientNonce).toString()),
        Array.from(clientPubKey),  // sender = client (same keys)
        new anchor.BN(deserializeLE(clientNonce).toString()),  // sender nonce (same)
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(this.programId, computationOffset),
        clusterAccount: clusterAccount,
        mxeAccount: getMXEAccAddress(this.programId),
        mempoolAccount: getMempoolAccAddress(this.programId),
        executingPool: getExecutingPoolAccAddress(this.programId),
        compDefAccount: getCompDefAccAddress(
          this.programId,
          Buffer.from(getCompDefAccOffset("link_wallets")).readUInt32LE()
        ),
        payer: this.provider.wallet.publicKey,
        encryptedWallets: encryptedWalletsPDA,
      })
      .rpc({ commitment: "confirmed" });

    console.log("MPC computation queued:", linkSig);
    onComputationQueued?.(linkSig);

    onProgress?.("Waiting for MPC computation...");

    // Wait for MPC computation to complete
    await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.programId,
      "confirmed"
    );

    // Get the event
    const event = await walletsLinkedEventPromise;

    onProgress?.("Decrypting wallets...");

    // Decrypt the wallets using the new cipher
    const decryptedWallets = this.decryptWalletsLocally(event, cipher);

    console.log("\n✅ Wallets successfully retrieved!");
    console.log("   Grid Wallet:   ", decryptedWallets.gridWallet.toBase58());
    console.log("   Private Wallet:", decryptedWallets.privateWallet.toBase58());

    onProgress?.("Complete!");

    return decryptedWallets;
  }

  /**
   * Check if the current user has linked wallets
   */
  async hasLinkedWallets(): Promise<boolean> {
    const [encryptedWalletsPDA] = PDAUtils.getEncryptedWalletsPDA(
      this.provider.wallet.publicKey,
      this.programId
    );

    try {
      const accountInfo = await this.provider.connection.getAccountInfo(
        encryptedWalletsPDA
      );
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * Decrypts wallet addresses locally from MPC computation event
   * Based on the test function: decryptWalletsLocally()
   *
   * @param event - The walletsLinkedEvent containing encrypted wallet data
   * @param cipher - The RescueCipher instance used for decryption
   * @returns The decrypted grid wallet and private wallet PublicKeys
   */
  private decryptWalletsLocally(
    event: WalletsLinkedEvent,
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
   * Event listener helper - exactly like in test
   * Waits for a specific event to be emitted
   */
  private async awaitEvent(
    eventName: string
  ): Promise<any> {
    let listenerId: number;
    const event = await new Promise<any>((res) => {
      listenerId = this.program.addEventListener(eventName as any, (event) => {
        res(event);
      });
    });
    await this.program.removeEventListener(listenerId!);
    return event;
  }

  /**
   * Get the IDL for the program
   */
  private getIDL(): any {
    // Import the actual generated IDL
    return require("../idl/private_wallet.json");
  }
}
