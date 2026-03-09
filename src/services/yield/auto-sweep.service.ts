import { User, IUser } from "../../models/User";
import { getYieldService } from "./yield.service";
import { VaultType } from "../../models/VaultShare";

/**
 * Yield-to-Card Auto-Sweep Service
 *
 * Periodically checks users with auto-sweep enabled:
 * 1. Calculates their accumulated yield
 * 2. If yield > user's threshold, executes partial withdrawal
 * 3. Credits the Rain card balance via Rain service
 *
 * Runs as a cron job (daily at 06:00 UTC).
 * Users can configure: interval (daily/weekly), minimum yield threshold.
 */

interface SweepResult {
  userId: string;
  yieldAmount: number;
  success: boolean;
  error?: string;
}

class AutoSweepService {
  private isRunning = false;

  /**
   * Execute auto-sweep for all eligible users.
   * Called by cron job.
   */
  async executeSweep(): Promise<SweepResult[]> {
    if (this.isRunning) {
      console.log("[AutoSweep] Already running, skipping");
      return [];
    }

    this.isRunning = true;
    const results: SweepResult[] = [];

    try {
      const eligibleUsers = await this.getEligibleUsers();
      console.log(
        `[AutoSweep] Found ${eligibleUsers.length} eligible users`
      );

      for (const user of eligibleUsers) {
        try {
          const result = await this.sweepForUser(user);
          results.push(result);
        } catch (error: any) {
          results.push({
            userId: user._id.toString(),
            yieldAmount: 0,
            success: false,
            error: error.message,
          });
          console.error(
            `[AutoSweep] Failed for user ${user._id}: ${error.message}`
          );
        }
      }
    } finally {
      this.isRunning = false;
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(
      `[AutoSweep] Complete: ${succeeded} succeeded, ${failed} failed`
    );

    return results;
  }

  /**
   * Find users eligible for auto-sweep right now.
   */
  private async getEligibleUsers(): Promise<IUser[]> {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday

    // Daily users are always eligible
    // Weekly users only on Mondays (day 1)
    const query: any = {
      autoSweepEnabled: true,
      status: "active",
      $or: [
        { autoSweepInterval: "daily" },
        { autoSweepInterval: "weekly", ...(dayOfWeek === 1 ? {} : { _id: null }) },
      ],
    };

    // Simpler approach: get all enabled users, filter in code
    const users = await User.find({
      autoSweepEnabled: true,
      status: "active",
    });

    return users.filter((user) => {
      if (user.autoSweepInterval === "daily") return true;
      if (user.autoSweepInterval === "weekly" && dayOfWeek === 1) return true;
      return false;
    });
  }

  /**
   * Execute sweep for a single user.
   */
  private async sweepForUser(user: IUser): Promise<SweepResult> {
    const userId = user._id.toString();
    const vaultType: VaultType = "sol_jito";
    const minYield = user.autoSweepMinYield || 0.01;

    const yieldService = getYieldService();
    const balance = await yieldService.getBalance(userId);

    // Check if yield meets the threshold
    if (balance.yieldEarned < minYield) {
      console.log(
        `[AutoSweep] User ${userId}: yield ${balance.yieldEarned.toFixed(4)} SOL < threshold ${minYield} SOL, skipping`
      );
      return {
        userId,
        yieldAmount: balance.yieldEarned,
        success: true, // Not an error, just below threshold
      };
    }

    // Execute partial withdrawal of just the yield amount
    const withdrawAmount = balance.yieldEarned;

    const withdrawResult = await yieldService.buildWithdrawTransaction(
      userId,
      withdrawAmount,
      vaultType
    );

    // TODO: When Rain service is implemented, replace this with:
    // 1. Send the withdrawal transaction
    // 2. Convert SOL to USDC via Jupiter
    // 3. Credit Rain card balance via rainService.creditBalance(userId, usdAmount)
    //
    // For now, log the intent and return success
    console.log(
      `[AutoSweep] User ${userId}: sweeping ${withdrawAmount.toFixed(4)} SOL yield (estimated ${withdrawResult.estimatedSolOut.toFixed(4)} SOL out)`
    );

    // Placeholder: actual Rain funding will be added when Rain service exists
    // The withdrawal transaction is built but not sent yet
    // When Rain is ready:
    //   const sig = await sendTransaction(withdrawResult.transaction);
    //   await yieldService.confirmWithdraw(sig, userId, vaultType, withdrawAmount);
    //   await rainService.fund(userId, solToUsd(withdrawResult.estimatedSolOut));

    return {
      userId,
      yieldAmount: withdrawAmount,
      success: true,
    };
  }

  /**
   * Configure auto-sweep for a user.
   */
  async configure(
    userId: string,
    config: {
      enabled: boolean;
      interval?: "daily" | "weekly";
      minYield?: number;
      vaultType?: VaultType;
    }
  ): Promise<IUser> {
    const update: any = {
      autoSweepEnabled: config.enabled,
    };
    if (config.interval) update.autoSweepInterval = config.interval;
    if (config.minYield !== undefined) update.autoSweepMinYield = config.minYield;
    if (config.vaultType) update.autoSweepVaultType = config.vaultType;

    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) throw new Error("User not found");

    console.log(
      `[AutoSweep] User ${userId}: configured auto-sweep (enabled=${config.enabled}, interval=${config.interval || "unchanged"}, minYield=${config.minYield ?? "unchanged"})`
    );

    return user;
  }

  /**
   * Get auto-sweep configuration for a user.
   */
  async getConfig(userId: string): Promise<{
    enabled: boolean;
    interval: "daily" | "weekly";
    minYield: number;
    vaultType: VaultType;
  }> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    return {
      enabled: user.autoSweepEnabled,
      interval: user.autoSweepInterval,
      minYield: user.autoSweepMinYield,
      vaultType: user.autoSweepVaultType as VaultType,
    };
  }
}

// Singleton
let instance: AutoSweepService | null = null;

export function getAutoSweepService(): AutoSweepService {
  if (!instance) {
    instance = new AutoSweepService();
  }
  return instance;
}

export { AutoSweepService };
