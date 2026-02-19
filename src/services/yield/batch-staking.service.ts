import redisClient from "../../config/redis";
import { randomBytes } from "crypto";
import { getSocketService } from "../socket/socketService";
import { getYieldService } from "./yield.service";
import { VaultType } from "../../models/VaultShare";

/**
 * Batch staking service for anti-correlation.
 *
 * Instead of staking immediately after each deposit (which creates
 * a 1:1 timing correlation between deposit and stake tx), this service
 * accumulates deposits in a Redis queue and stakes them in a single
 * batch after a random delay (5-30 minutes).
 *
 * Flow:
 *   1. User deposits → SOL arrives in vault PDA
 *   2. addToBatch() → adds to Redis queue
 *   3. Random timer (5-30 min) expires
 *   4. executeBatch() → single Jito/Marinade stake call for total
 *   5. Notify users via Socket.io
 */

const BATCH_KEY_PREFIX = "yield:batch:";
const BATCH_LOCK_PREFIX = "yield:batch:lock:";
const MIN_BATCH_DELAY_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_BATCH_DELAY_MS = 30 * 60 * 1000; // 30 minutes

interface BatchEntry {
  userId: string;
  amountLamports: string; // stored as string for Redis
  vaultType: VaultType;
  depositTimestamp: string;
  shareId: string;
}

interface BatchInfo {
  batchId: string;
  entries: BatchEntry[];
  totalLamports: bigint;
  createdAt: string;
  scheduledAt: string;
}

class BatchStakingService {
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Add a confirmed deposit to the current batch for the given vault type.
   * If no active batch exists, creates one with a random delay.
   */
  async addToBatch(
    userId: string,
    amountLamports: bigint,
    vaultType: VaultType,
    shareId: string
  ): Promise<{ batchId: string; estimatedExecutionMs: number }> {
    const batchKey = `${BATCH_KEY_PREFIX}${vaultType}:current`;

    // Check if there's an active batch
    let batchId = await redisClient.get(`${batchKey}:id`);
    let isNew = false;

    if (!batchId) {
      // Create new batch
      batchId = randomBytes(8).toString("hex");
      await redisClient.set(`${batchKey}:id`, batchId);
      await redisClient.set(
        `${batchKey}:created`,
        new Date().toISOString()
      );
      isNew = true;
    }

    // Add entry to batch
    const entry: BatchEntry = {
      userId,
      amountLamports: amountLamports.toString(),
      vaultType,
      depositTimestamp: new Date().toISOString(),
      shareId,
    };

    await redisClient.rpush(
      `${batchKey}:entries`,
      JSON.stringify(entry)
    );

    // Schedule batch execution if new
    let delayMs = 0;
    if (isNew) {
      delayMs = this.getRandomBatchDelay();
      const scheduledAt = new Date(Date.now() + delayMs).toISOString();
      await redisClient.set(`${batchKey}:scheduled`, scheduledAt);

      // Set timer
      const timer = setTimeout(async () => {
        await this.executeBatch(vaultType, batchId!);
      }, delayMs);

      this.batchTimers.set(batchId, timer);
      console.log(
        `[BatchStaking] New batch ${batchId} for ${vaultType}, ` +
          `scheduled in ${Math.round(delayMs / 60000)}min`
      );
    } else {
      // Get remaining delay
      const scheduled = await redisClient.get(`${batchKey}:scheduled`);
      if (scheduled) {
        delayMs = Math.max(
          0,
          new Date(scheduled).getTime() - Date.now()
        );
      }
    }

    // Notify user their deposit is being batched
    this.notifyUser(userId, "yield:batch:pending", {
      batchId,
      status: "pending",
      estimatedExecutionMs: delayMs,
    });

    return { batchId, estimatedExecutionMs: delayMs };
  }

  /**
   * Execute a batch: stake the accumulated total in a single transaction.
   * Idempotent — uses Redis lock to ensure one execution per batch.
   */
  async executeBatch(vaultType: VaultType, batchId: string): Promise<void> {
    const lockKey = `${BATCH_LOCK_PREFIX}${batchId}`;
    const batchKey = `${BATCH_KEY_PREFIX}${vaultType}:current`;

    // Acquire lock (NX = only if not exists, EX = expire after 5 minutes)
    const acquired = await redisClient.set(lockKey, "1", "EX", 300, "NX");
    if (!acquired) {
      console.log(`[BatchStaking] Batch ${batchId} already executing, skipping`);
      return;
    }

    try {
      // Read all entries
      const rawEntries = await redisClient.lrange(`${batchKey}:entries`, 0, -1);
      if (rawEntries.length === 0) {
        console.log(`[BatchStaking] Batch ${batchId} is empty, skipping`);
        return;
      }

      const entries: BatchEntry[] = rawEntries.map((e) => JSON.parse(e));
      const totalLamports = entries.reduce(
        (sum, e) => sum + BigInt(e.amountLamports),
        BigInt(0)
      );

      console.log(
        `[BatchStaking] Executing batch ${batchId}: ` +
          `${entries.length} deposits, total ${Number(totalLamports) / 1e9} SOL, ` +
          `type ${vaultType}`
      );

      // Execute the actual staking call
      const yieldService = getYieldService();
      // The yield service handles the actual Jito/Marinade staking
      // This is a backend-signed transaction using the authority key
      const stakingResult = await yieldService.executeStaking(
        Number(totalLamports),
        vaultType
      );

      console.log(
        `[BatchStaking] Batch ${batchId} staked: ${stakingResult?.signature || "n/a"}`
      );

      // Notify all users in the batch
      for (const entry of entries) {
        this.notifyUser(entry.userId, "yield:batch:complete", {
          batchId,
          status: "staked",
          amountLamports: entry.amountLamports,
          stakingSignature: stakingResult?.signature,
        });
      }

      // Clean up Redis
      await redisClient.del(
        `${batchKey}:id`,
        `${batchKey}:entries`,
        `${batchKey}:created`,
        `${batchKey}:scheduled`
      );

      // Clean up timer
      this.batchTimers.delete(batchId);
    } catch (err: any) {
      console.error(`[BatchStaking] Batch ${batchId} failed:`, err.message);

      // Notify users of failure
      const rawEntries = await redisClient.lrange(`${batchKey}:entries`, 0, -1);
      for (const raw of rawEntries) {
        const entry: BatchEntry = JSON.parse(raw);
        this.notifyUser(entry.userId, "yield:batch:error", {
          batchId,
          status: "error",
          error: "Staking temporarily delayed. Your deposit is safe.",
        });
      }
    } finally {
      // Release lock
      await redisClient.del(lockKey);
    }
  }

  /**
   * Get the current batch status for a vault type.
   */
  async getBatchStatus(vaultType: VaultType): Promise<BatchInfo | null> {
    const batchKey = `${BATCH_KEY_PREFIX}${vaultType}:current`;
    const batchId = await redisClient.get(`${batchKey}:id`);
    if (!batchId) return null;

    const rawEntries = await redisClient.lrange(`${batchKey}:entries`, 0, -1);
    const entries: BatchEntry[] = rawEntries.map((e) => JSON.parse(e));
    const totalLamports = entries.reduce(
      (sum, e) => sum + BigInt(e.amountLamports),
      BigInt(0)
    );

    const createdAt = (await redisClient.get(`${batchKey}:created`)) || "";
    const scheduledAt = (await redisClient.get(`${batchKey}:scheduled`)) || "";

    return {
      batchId,
      entries,
      totalLamports,
      createdAt,
      scheduledAt,
    };
  }

  private getRandomBatchDelay(): number {
    return (
      Math.floor(Math.random() * (MAX_BATCH_DELAY_MS - MIN_BATCH_DELAY_MS)) +
      MIN_BATCH_DELAY_MS
    );
  }

  private notifyUser(userId: string, _event: string, data: any): void {
    try {
      getSocketService().emitPrivateTransferUpdate(userId, {
        transferId: data.batchId || "batch",
        status: data.status || "pending",
        amount: data.amountLamports ? Number(data.amountLamports) / 1e9 : 0,
      });
    } catch {
      // Socket.io might not be initialized in all contexts
    }
  }
}

// Singleton
let instance: BatchStakingService | null = null;

export function getBatchStakingService(): BatchStakingService {
  if (!instance) {
    instance = new BatchStakingService();
  }
  return instance;
}

export { BatchStakingService };
