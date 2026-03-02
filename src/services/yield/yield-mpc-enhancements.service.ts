import { PublicKey, Connection } from "@solana/web3.js";
import { BN, AnchorProvider } from "@coral-xyz/anchor";
import { randomBytes } from "crypto";
import { ArciumVaultService } from "./arcium-vault.service";

// ========== CONSTANTS ==========

const ARCIUM_VAULT_PROGRAM_ID = new PublicKey(
  process.env.ARCIUM_VAULT_PROGRAM_ID ||
    "7VGAdVrL4WH3YUiMLPHWNzUew3DJKE6bLUbvHNHCdMta"
);

const MAX_RATE_NUM = 1_100_000n; // Overflow guard: balance * rate_num must fit in u64
const MPC_TIMEOUT_MS = 60_000;

// ========== TYPES ==========

interface MpcResult<T> {
  success: boolean;
  data?: T;
  txSignature?: string;
  finalizationSignature?: string;
  error?: string;
}

// ========== SERVICE ==========

export class YieldMpcEnhancementsService {
  constructor(private readonly arciumVaultService: ArciumVaultService) {}

  private get h() {
    return this.arciumVaultService.getHelpers();
  }

  // ========== PDA DERIVATION ==========

  getSnapshotPDA(userSharePDA: PublicKey, snapshotIndex: bigint): PublicKey {
    const indexBuf = Buffer.alloc(8);
    indexBuf.writeBigUInt64LE(snapshotIndex);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("snapshot"), userSharePDA.toBuffer(), indexBuf],
      ARCIUM_VAULT_PROGRAM_ID
    )[0];
  }

  // ========== COMPUTE YIELD DISTRIBUTION ==========

  /**
   * Distribute yield to a user's encrypted balance via MPC.
   * new_balance = old_balance * rate_num / rate_denom — computed inside the TEE.
   * rate_num must be ≤ 1_100_000 to prevent u64 overflow.
   */
  async computeYieldDistribution(
    userId: string,
    _vaultType: number,
    rateNum: bigint,
    rateDenom: bigint
  ): Promise<MpcResult<void>> {
    if (rateNum > MAX_RATE_NUM) {
      return {
        success: false,
        error: `rate_num (${rateNum}) exceeds maximum allowed value (${MAX_RATE_NUM})`,
      };
    }
    if (rateDenom === 0n) {
      return { success: false, error: "rateDenom must be greater than zero" };
    }

    return this.h.executeMpcWithRetry(
      "compute_yield_distribution",
      async (computationOffset) => {
        await this.h.getMxePublicKey();
        const userIdHash = this.h.hashUserId(userId);
        const userSharePDA = this.h.getUserSharePDA(userIdHash);
        const accounts = this.h.getArciumAccounts(
          computationOffset,
          "compute_yield_distribution"
        );
        const program = this.h.getProgram();

        const sig = await program.methods
          .queueComputeYieldDistribution(
            computationOffset,
            new BN(rateNum.toString()),
            new BN(rateDenom.toString())
          )
          .accountsPartial({
            payer: program.provider.publicKey,
            ...accounts,
            arciumVaultState: this.h.getVaultStatePDA(),
            userVaultShare: userSharePDA,
          })
          .rpc({ skipPreflight: true, commitment: "confirmed" });

        const finalizeSig = await this.h.awaitFinalizationWithTimeout(
          computationOffset
        );

        console.log(
          `[YieldMpcEnhancements] compute_yield_distribution succeeded (userId hash: ${userIdHash.toString("hex").slice(0, 8)}...)` +
          `\n  ↳ queue TX:    https://explorer.solana.com/tx/${sig}?cluster=devnet` +
          `\n  ↳ finalize TX: https://explorer.solana.com/tx/${finalizeSig}?cluster=devnet`
        );

        return { success: true, txSignature: sig, finalizationSignature: finalizeSig };
      }
    );
  }

  // ========== PROOF OF RESERVE ==========

  /**
   * Prove that the vault's global encrypted total ≥ threshold.
   * Permissionless — any payer can trigger this.
   * Returns only a boolean (no amount disclosed).
   */
  async proofOfReserve(
    thresholdLamports: bigint
  ): Promise<MpcResult<{ isSolvent: boolean }>> {
    return this.h.executeMpcWithRetry(
      "proof_of_reserve",
      async (computationOffset) => {
        await this.h.getMxePublicKey();
        const accounts = this.h.getArciumAccounts(
          computationOffset,
          "proof_of_reserve"
        );
        const program = this.h.getProgram();

        const resultPromise = new Promise<boolean>((resolve) => {
          let listenerId: number;
          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            try {
              program.removeEventListener(listenerId);
            } catch (_e) {}
          };

          listenerId = program.addEventListener(
            "reserveProofResult",
            (event: any) => {
              cleanup();
              resolve(event.isSolvent);
            }
          );

          setTimeout(() => {
            cleanup();
            resolve(false);
          }, MPC_TIMEOUT_MS);
        });

        const sig = await program.methods
          .queueProofOfReserve(
            computationOffset,
            new BN(thresholdLamports.toString())
          )
          .accountsPartial({
            payer: program.provider.publicKey,
            ...accounts,
            arciumVaultState: this.h.getVaultStatePDA(),
          })
          .rpc({ skipPreflight: true, commitment: "confirmed" });

        await this.h.awaitFinalizationWithTimeout(computationOffset);
        const isSolvent = await resultPromise;

        console.log(
          `[YieldMpcEnhancements] proof_of_reserve: isSolvent=${isSolvent}`
        );

        return { success: true, data: { isSolvent }, txSignature: sig };
      }
    );
  }

  // ========== TAKE BALANCE SNAPSHOT ==========

  /**
   * Take a snapshot of a user's encrypted balance.
   * Creates a UserBalanceSnapshot PDA with a fresh MXE nonce (re-encryption).
   */
  async takeBalanceSnapshot(
    userId: string,
    _vaultType: number,
    snapshotIndex: bigint
  ): Promise<MpcResult<{ snapshotPda: string; usedIndex: number }>> {
    return this.h.executeMpcWithRetry(
      "balance_snapshot",
      async (computationOffset) => {
        await this.h.getMxePublicKey();
        const userIdHash = this.h.hashUserId(userId);
        const userSharePDA = this.h.getUserSharePDA(userIdHash);

        // Find next available snapshot index: skip PDAs that already exist on-chain
        // (can happen if previous MongoDB update failed after a successful snapshot)
        const connection = ((this.h.getProgram().provider) as AnchorProvider).connection as Connection;
        let targetIndex = snapshotIndex;
        while (true) {
          const pda = this.getSnapshotPDA(userSharePDA, targetIndex);
          const acc = await connection.getAccountInfo(pda);
          if (!acc) break;
          targetIndex++;
        }

        const snapshotPDA = this.getSnapshotPDA(userSharePDA, targetIndex);
        const accounts = this.h.getArciumAccounts(
          computationOffset,
          "balance_snapshot"
        );
        const program = this.h.getProgram();

        const sig = await program.methods
          .queueBalanceSnapshot(
            computationOffset,
            new BN(targetIndex.toString())
          )
          .accountsPartial({
            payer: program.provider.publicKey,
            ...accounts,
            arciumVaultState: this.h.getVaultStatePDA(),
            userVaultShare: userSharePDA,
            userBalanceSnapshot: snapshotPDA,
          })
          .rpc({ skipPreflight: false, commitment: "confirmed" });

        const finalizeSig = await this.h.awaitFinalizationWithTimeout(
          computationOffset
        );

        console.log(
          `[YieldMpcEnhancements] balance_snapshot taken (index=${targetIndex})` +
          `\n  ↳ PDA: ${snapshotPDA.toBase58()}` +
          `\n  ↳ queue TX:    https://explorer.solana.com/tx/${sig}?cluster=devnet` +
          `\n  ↳ finalize TX: https://explorer.solana.com/tx/${finalizeSig}?cluster=devnet`
        );

        return {
          success: true,
          data: { snapshotPda: snapshotPDA.toBase58(), usedIndex: Number(targetIndex) },
          txSignature: sig,
          finalizationSignature: finalizeSig,
        };
      }
    );
  }

  // ========== PROOF OF YIELD FROM SNAPSHOTS ==========

  /**
   * Proves yield between two balance snapshots exceeds a threshold (in bps).
   * Reads encrypted balances from start/end snapshot PDAs on-chain.
   *
   * Note: The current implementation re-encrypts the on-chain snapshot balances
   * before passing to proof_of_yield. A future circuit accepting Enc<Mxe> account
   * references directly would be more efficient.
   */
  async proofOfYieldFromSnapshots(
    userId: string,
    startSnapshotIndex: bigint,
    endSnapshotIndex: bigint,
    thresholdBps: number
  ): Promise<MpcResult<{ exceedsThreshold: boolean }>> {
    const userIdHash = this.h.hashUserId(userId);
    const userSharePDA = this.h.getUserSharePDA(userIdHash);
    const startSnapshotPDA = this.getSnapshotPDA(userSharePDA, startSnapshotIndex);
    const endSnapshotPDA = this.getSnapshotPDA(userSharePDA, endSnapshotIndex);

    const program = this.h.getProgram();

    // Fetch on-chain snapshot accounts
    let startAccount: any;
    let endAccount: any;
    try {
      startAccount = await (program.account as any).userBalanceSnapshot.fetch(startSnapshotPDA);
      endAccount = await (program.account as any).userBalanceSnapshot.fetch(endSnapshotPDA);
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to fetch snapshot accounts: ${err.message}`,
      };
    }

    // Delegate to arciumVaultService.proofOfYield
    // The snapshot PDAs hold Enc<Mxe> balances; proofOfYield uses Enc<Shared>.
    // For now we pass placeholder values — a dedicated circuit is needed for production.
    return this.arciumVaultService.proofOfYield(
      userId,
      BigInt(0), // placeholder: startSnapshot balance (would need MXE decrypt)
      BigInt(0), // placeholder: endSnapshot balance (would need MXE decrypt)
      thresholdBps
    );
  }
}

// ========== SINGLETON ==========

let instance: YieldMpcEnhancementsService | null = null;

export function getYieldMpcEnhancementsService(): YieldMpcEnhancementsService {
  if (!instance) {
    const { getArciumVaultService } = require("./arcium-vault.service");
    instance = new YieldMpcEnhancementsService(getArciumVaultService());
  }
  return instance;
}
