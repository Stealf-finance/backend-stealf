import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import { createHash, randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  getArciumProgramId,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  RescueCipher,
  deserializeLE,
  x25519,
} from "@arcium-hq/client";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";

// ========== CONSTANTS ==========

const ARCIUM_VAULT_PROGRAM_ID = new PublicKey(
  process.env.ARCIUM_VAULT_PROGRAM_ID ||
    "7VGAdVrL4WH3YUiMLPHWNzUew3DJKE6bLUbvHNHCdMta"
);

const CLUSTER_OFFSET = 456; // v0.8.x devnet
const ARCIUM_VAULT_ID = 1; // Arcium vault uses vault_id=1

const MPC_TIMEOUT_MS = 60_000; // 60 seconds
const MAX_RETRIES = 1;

// ========== TYPES ==========

interface MpcResult<T> {
  success: boolean;
  data?: T;
  txSignature?: string;
  finalizationSignature?: string;
  error?: string;
}

interface EncryptedInput {
  ciphertext: number[];
  publicKey: number[];
  nonce: BN;
}

export interface ArciumVaultHelpers {
  encryptAmount: (amount: bigint) => EncryptedInput;
  getArciumAccounts: (computationOffset: BN, compDefName: string) => ReturnType<ArciumVaultService["getArciumAccounts"]>;
  awaitFinalizationWithTimeout: (computationOffset: BN) => Promise<string>;
  executeMpcWithRetry: <T>(
    operationName: string,
    operation: (computationOffset: BN) => Promise<MpcResult<T>>
  ) => Promise<MpcResult<T>>;
  hashUserId: (userId: string) => Buffer;
  getVaultStatePDA: () => PublicKey;
  getUserSharePDA: (userIdHash: Buffer) => PublicKey;
  getProgram: () => Program;
  getMxePublicKey: () => Promise<Uint8Array>;
}

// ========== SERVICE ==========

class ArciumVaultService {
  private connection: Connection;
  private authority: Keypair;
  private mxePublicKey: Uint8Array | null = null;
  private _provider: AnchorProvider | null = null;
  private _program: Program | null = null;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
    this.connection = new Connection(rpcUrl, "confirmed");

    const authorityKey = process.env.POOL_AUTHORITY_PRIVATE_KEY;
    if (!authorityKey) throw new Error("POOL_AUTHORITY_PRIVATE_KEY not configured");
    this.authority = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(authorityKey))
    );
  }

  // ========== KEY MANAGEMENT ==========

  private async getMxePublicKey(): Promise<Uint8Array> {
    if (this.mxePublicKey) return this.mxePublicKey;

    const provider = this.getProvider();
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const key = await getMXEPublicKey(provider, ARCIUM_VAULT_PROGRAM_ID);
        if (key) {
          this.mxePublicKey = key;
          return key;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Failed to fetch MXE public key after 10 attempts");
  }

  private encryptAmount(amount: bigint): EncryptedInput {
    if (!this.mxePublicKey) {
      throw new Error("MXE public key not initialized. Call getMxePublicKey() first.");
    }

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, this.mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt([amount], nonce);

    return {
      ciphertext: Array.from(ciphertext[0]),
      publicKey: Array.from(publicKey),
      nonce: new BN(deserializeLE(nonce).toString()),
    };
  }

  // ========== ACCOUNT DERIVATION ==========

  private getVaultStatePDA(): PublicKey {
    const vaultIdBuf = Buffer.alloc(8);
    vaultIdBuf.writeBigUInt64LE(BigInt(ARCIUM_VAULT_ID));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("arcium_vault"), vaultIdBuf],
      ARCIUM_VAULT_PROGRAM_ID
    )[0];
  }

  private getUserSharePDA(userIdHash: Buffer): PublicKey {
    const vaultState = this.getVaultStatePDA();
    return PublicKey.findProgramAddressSync(
      [Buffer.from("user_share"), vaultState.toBuffer(), userIdHash],
      ARCIUM_VAULT_PROGRAM_ID
    )[0];
  }

  private getArciumAccounts(computationOffset: BN, compDefName: string) {
    const offset = getCompDefAccOffset(compDefName);
    const offsetU32 = Buffer.from(offset).readUInt32LE();

    return {
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
      compDefAccount: getCompDefAccAddress(ARCIUM_VAULT_PROGRAM_ID, offsetU32),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mxeAccount: getMXEAccAddress(ARCIUM_VAULT_PROGRAM_ID),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      arciumProgram: getArciumProgramId(),
    };
  }

  static hashUserId(userId: string): Buffer {
    return createHash("sha256").update(userId).digest();
  }

  // ========== MPC OPERATIONS ==========

  /**
   * Record a deposit in the encrypted bookkeeping layer.
   * Called AFTER the actual SOL deposit is confirmed in stealf_vault.
   */
  async recordDeposit(
    userId: string,
    amountLamports: bigint
  ): Promise<MpcResult<void>> {
    return this.executeMpcWithRetry("record_deposit", async (computationOffset) => {
      await this.getMxePublicKey();
      const encrypted = this.encryptAmount(amountLamports);
      const userIdHash = ArciumVaultService.hashUserId(userId);
      const accounts = this.getArciumAccounts(computationOffset, "record_deposit");

      const program = this.getProgram();

      const sig = await program.methods
        .queueRecordDeposit(
          computationOffset,
          encrypted.ciphertext as any,
          encrypted.publicKey as any,
          encrypted.nonce
        )
        .accountsPartial({
          payer: this.authority.publicKey,
          ...accounts,
          arciumVaultState: this.getVaultStatePDA(),
          userVaultShare: this.getUserSharePDA(userIdHash),
        })
        .signers([this.authority])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      const finalizeSig = await this.awaitFinalizationWithTimeout(
        computationOffset
      );

      return { success: true, txSignature: sig, finalizationSignature: finalizeSig };
    });
  }

  /**
   * Verify a withdrawal amount against the user's encrypted balance.
   * Returns whether the withdrawal is approved (sufficient balance).
   */
  async verifyWithdrawal(
    userId: string,
    amountLamports: bigint
  ): Promise<MpcResult<{ sufficient: boolean }>> {
    return this.executeMpcWithRetry("verify_withdrawal", async (computationOffset) => {
      await this.getMxePublicKey();
      const encrypted = this.encryptAmount(amountLamports);
      const userIdHash = ArciumVaultService.hashUserId(userId);
      const accounts = this.getArciumAccounts(computationOffset, "verify_withdrawal");

      const program = this.getProgram();

      // Listen for the event to get the `sufficient` boolean
      const eventPromise = new Promise<boolean>((resolve) => {
        let listenerId: number;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          try { program.removeEventListener(listenerId); } catch (_e) {}
        };
        listenerId = program.addEventListener(
          "withdrawalVerified",
          (event: any) => {
            cleanup();
            resolve(event.sufficient);
          }
        );
        // Timeout fallback — also removes listener to avoid resource leak
        setTimeout(() => { cleanup(); resolve(false); }, MPC_TIMEOUT_MS);
      });

      const sig = await program.methods
        .queueVerifyWithdrawal(
          computationOffset,
          encrypted.ciphertext as any,
          encrypted.publicKey as any,
          encrypted.nonce
        )
        .accountsPartial({
          payer: this.authority.publicKey,
          ...accounts,
          arciumVaultState: this.getVaultStatePDA(),
          userVaultShare: this.getUserSharePDA(userIdHash),
        })
        .signers([this.authority])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await this.awaitFinalizationWithTimeout(computationOffset);
      const sufficient = await eventPromise;

      return {
        success: true,
        data: { sufficient },
        txSignature: sig,
      };
    });
  }

  /**
   * Prove that yield exceeds a threshold (in basis points) without revealing amounts.
   * Stateless — all inputs are encrypted client-side.
   */
  async proofOfYield(
    userId: string,
    balanceLamports: bigint,
    depositedLamports: bigint,
    thresholdBps: number
  ): Promise<MpcResult<{ exceedsThreshold: boolean }>> {
    return this.executeMpcWithRetry("proof_of_yield", async (computationOffset) => {
      await this.getMxePublicKey();
      const encBalance = this.encryptAmount(balanceLamports);
      const encDeposited = this.encryptAmount(depositedLamports);
      const userIdHash = ArciumVaultService.hashUserId(userId);
      const accounts = this.getArciumAccounts(computationOffset, "proof_of_yield");

      const program = this.getProgram();

      const resultPromise = new Promise<boolean>((resolve) => {
        let listenerId: number;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          try { program.removeEventListener(listenerId); } catch (_e) {}
        };
        listenerId = program.addEventListener(
          "yieldProofResult",
          (event: any) => {
            cleanup();
            resolve(event.exceedsThreshold);
          }
        );
        // Timeout fallback — also removes listener to avoid resource leak
        setTimeout(() => { cleanup(); resolve(false); }, MPC_TIMEOUT_MS);
      });

      const sig = await program.methods
        .queueProofOfYield(
          computationOffset,
          encBalance.ciphertext as any,
          encBalance.publicKey as any,
          encBalance.nonce,
          encDeposited.ciphertext as any,
          encDeposited.publicKey as any,
          encDeposited.nonce,
          new BN(thresholdBps)
        )
        .accountsPartial({
          payer: this.authority.publicKey,
          ...accounts,
          userVaultShare: this.getUserSharePDA(userIdHash),
        })
        .signers([this.authority])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await this.awaitFinalizationWithTimeout(computationOffset);
      const exceedsThreshold = await resultPromise;

      return {
        success: true,
        data: { exceedsThreshold },
        txSignature: sig,
      };
    });
  }

  /**
   * Update the encrypted global total (deposit or withdrawal delta).
   * Authority-only operation.
   */
  async updateEncryptedTotal(
    deltaLamports: bigint,
    isDeposit: boolean
  ): Promise<MpcResult<void>> {
    return this.executeMpcWithRetry("encrypted_total_update", async (computationOffset) => {
      await this.getMxePublicKey();
      const encrypted = this.encryptAmount(deltaLamports);
      const accounts = this.getArciumAccounts(
        computationOffset,
        "encrypted_total_update"
      );

      const program = this.getProgram();

      const sig = await program.methods
        .queueEncryptedTotalUpdate(
          computationOffset,
          encrypted.ciphertext as any,
          encrypted.publicKey as any,
          encrypted.nonce,
          isDeposit
        )
        .accountsPartial({
          payer: this.authority.publicKey,
          ...accounts,
          arciumVaultState: this.getVaultStatePDA(),
          authority: this.authority.publicKey,
        })
        .signers([this.authority])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      const finalizeSig = await this.awaitFinalizationWithTimeout(
        computationOffset
      );

      return { success: true, txSignature: sig, finalizationSignature: finalizeSig };
    });
  }

  /**
   * Create a UserVaultShare PDA for a new user and initialize its encrypted state.
   * Idempotent — skips creation if already exists, initializes encrypted state if stateNonce==0.
   */
  async ensureUserShare(userId: string, vaultType: number = 0): Promise<PublicKey> {
    const userIdHash = ArciumVaultService.hashUserId(userId);
    const userSharePDA = this.getUserSharePDA(userIdHash);

    await this.getMxePublicKey();
    const program = this.getProgram();

    const existing = await this.connection.getAccountInfo(userSharePDA);
    if (!existing) {
      await program.methods
        .createUserShare(Array.from(userIdHash) as any, vaultType)
        .accountsPartial({
          arciumVaultState: this.getVaultStatePDA(),
          authority: this.authority.publicKey,
        })
        .signers([this.authority])
        .rpc({ commitment: "confirmed" });
    }

    // Initialize encrypted state if stateNonce is still 0
    const shareData = await (program.account as any).userVaultShare.fetch(userSharePDA);
    if (shareData.stateNonce.toString() === "0") {
      const encrypted = this.encryptAmount(BigInt(0));
      const computationOffset = new BN(randomBytes(8), "hex");
      const accounts = this.getArciumAccounts(computationOffset, "init_encrypted_state_v3");

      await program.methods
        .queueInitEncryptedState(
          computationOffset,
          0, // target_type = 0 (UserVaultShare)
          encrypted.ciphertext as any,
          encrypted.publicKey as any,
          encrypted.nonce
        )
        .accountsPartial({
          payer: this.authority.publicKey,
          ...accounts,
          targetAccount: userSharePDA,
        })
        .signers([this.authority])
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await this.awaitFinalizationWithTimeout(computationOffset);
    }

    return userSharePDA;
  }

  // ========== PUBLIC HELPERS ACCESSOR ==========

  public getHelpers(): ArciumVaultHelpers {
    return {
      encryptAmount: (amount: bigint) => this.encryptAmount(amount),
      getArciumAccounts: (computationOffset: BN, compDefName: string) =>
        this.getArciumAccounts(computationOffset, compDefName),
      awaitFinalizationWithTimeout: (computationOffset: BN) =>
        this.awaitFinalizationWithTimeout(computationOffset),
      executeMpcWithRetry: <T>(
        operationName: string,
        operation: (computationOffset: BN) => Promise<MpcResult<T>>
      ) => this.executeMpcWithRetry(operationName, operation),
      hashUserId: ArciumVaultService.hashUserId,
      getVaultStatePDA: () => this.getVaultStatePDA(),
      getUserSharePDA: (userIdHash: Buffer) => this.getUserSharePDA(userIdHash),
      getProgram: () => this.getProgram(),
      getMxePublicKey: () => this.getMxePublicKey(),
    };
  }

  // ========== HELPERS ==========

  private getProvider(): AnchorProvider {
    if (!this._provider) {
      this._provider = new AnchorProvider(
        this.connection,
        {
          publicKey: this.authority.publicKey,
          signTransaction: async (tx: Transaction) => {
            tx.partialSign(this.authority);
            return tx;
          },
          signAllTransactions: async (txs: Transaction[]) => {
            txs.forEach((tx) => tx.partialSign(this.authority));
            return txs;
          },
        } as any,
        { commitment: "confirmed" }
      );
    }
    return this._provider;
  }

  private getProgram(): Program {
    if (!this._program) {
      const idl = require("../../../../stealf_arcium_vault/target/idl/stealf_arcium_vault.json");
      this._program = new Program(idl, this.getProvider());
    }
    return this._program;
  }

  private async awaitFinalizationWithTimeout(
    computationOffset: BN
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("MPC finalization timeout")),
        MPC_TIMEOUT_MS
      );

      awaitComputationFinalization(
        this.getProvider(),
        computationOffset,
        ARCIUM_VAULT_PROGRAM_ID,
        "confirmed"
      )
        .then((sig) => {
          clearTimeout(timeout);
          resolve(sig);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  private async executeMpcWithRetry<T>(
    operationName: string,
    operation: (computationOffset: BN) => Promise<MpcResult<T>>
  ): Promise<MpcResult<T>> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const computationOffset = new BN(randomBytes(8), "hex");

      try {
        const result = await operation(computationOffset);
        console.log(
          `[ArciumVault] ${operationName} succeeded (attempt ${attempt + 1})` +
          (result.txSignature ? `\n  ↳ queue TX:       https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet` : "") +
          (result.finalizationSignature ? `\n  ↳ finalize TX:    https://explorer.solana.com/tx/${result.finalizationSignature}?cluster=devnet` : "")
        );
        return result;
      } catch (err: any) {
        console.error(
          `[ArciumVault] ${operationName} failed (attempt ${attempt + 1}):`,
          err.message
        );

        if (attempt === MAX_RETRIES) {
          return {
            success: false,
            error: `${operationName} failed after ${MAX_RETRIES + 1} attempts: ${err.message}`,
          };
        }

        // Wait before retry
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return { success: false, error: "Unexpected retry loop exit" };
  }
}

// Singleton
let instance: ArciumVaultService | null = null;

export function getArciumVaultService(): ArciumVaultService {
  if (!instance) {
    instance = new ArciumVaultService();
  }
  return instance;
}

export function isArciumEnabled(): boolean {
  return process.env.ARCIUM_ENABLED === "true";
}

export { ArciumVaultService };
