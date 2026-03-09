/**
 * YieldService — public API facade for SOL yield operations (Jito only, private mode).
 *
 * Delegates to focused sub-modules:
 *   yield.config       → constants, helpers, PDAs
 *   sol-staking        → Jito staking
 *   sol-deposit        → deposit flow
 *   sol-withdraw       → withdrawal flow
 *   yield-rates        → exchange rates, APY, balance, dashboard
 *   private-sol        → authority-indirection private flows
 */
import {
  buildDepositTransaction,
  confirmDeposit,
} from "./sol-deposit.service";

import {
  buildWithdrawTransaction,
  confirmWithdraw,
} from "./sol-withdraw.service";

import {
  executeStaking,
} from "./sol-staking.service";

import {
  getExchangeRate,
  getAPYRates,
  getBalance,
  getDashboard,
  verifyConsistency,
} from "./yield-rates.service";

import {
  buildPrivateDepositTransaction,
  confirmPrivateDeposit,
  executePrivateWithdraw,
} from "./private-sol.service";

// Re-export for services that import directly from yield.service
export { executeStaking };

class YieldService {
  // ---- Public deposit ----
  buildDepositTransaction = buildDepositTransaction;
  confirmDeposit = confirmDeposit;

  // ---- Public withdrawal ----
  buildWithdrawTransaction = buildWithdrawTransaction;
  confirmWithdraw = confirmWithdraw;

  // ---- Rates & balance ----
  getExchangeRate = getExchangeRate;
  getAPYRates = getAPYRates;
  getBalance = getBalance;
  getDashboard = getDashboard;
  verifyConsistency = verifyConsistency;

  // ---- Staking (used by batch-staking service) ----
  executeStaking = executeStaking;

  // ---- Private flows (authority indirection) ----
  buildPrivateDepositTransaction = buildPrivateDepositTransaction;
  confirmPrivateDeposit = confirmPrivateDeposit;
  executePrivateWithdraw = executePrivateWithdraw;
}

// Singleton
let instance: YieldService | null = null;

export function getYieldService(): YieldService {
  if (!instance) instance = new YieldService();
  return instance;
}

export { YieldService };
