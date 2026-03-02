import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Standard denomination service for anti-correlation.
 *
 * Decomposes arbitrary SOL amounts into standard denominations
 * to prevent amount-based transaction correlation.
 * Standard amounts: 0.1, 0.5, 1, 5, 10 SOL
 *
 * Example: 3.7 SOL → [1, 1, 1, 0.5, 0.1, 0.1] = 3.8 SOL (0.1 SOL surplus)
 */

const DENOMINATIONS_SOL = [10, 5, 1, 0.5, 0.1]; // Largest first (greedy)

interface DenominationResult {
  /** Ordered list of standard denomination amounts in SOL */
  denominations: number[];
  /** Total of all denominations in SOL (>= original amount) */
  totalDeposited: number;
  /** Surplus to return to user via Privacy Pool (totalDeposited - originalAmount) */
  surplusSol: number;
  /** Denominations in a randomized execution order */
  shuffledDenominations: number[];
}

/**
 * Decompose an arbitrary SOL amount into standard denominations.
 * Uses greedy algorithm (largest denomination first).
 *
 * @param amountSol - Amount in SOL to decompose
 * @returns Denomination breakdown with surplus calculation
 */
export function decomposeToDenominations(amountSol: number): DenominationResult {
  if (amountSol <= 0) {
    return {
      denominations: [],
      totalDeposited: 0,
      surplusSol: 0,
      shuffledDenominations: [],
    };
  }

  const denominations: number[] = [];
  let remaining = amountSol;

  // Greedy: fit largest denominations first
  for (const denom of DENOMINATIONS_SOL) {
    while (remaining >= denom - 0.0001) { // Small epsilon for floating point
      denominations.push(denom);
      remaining -= denom;
      remaining = Math.round(remaining * 10000) / 10000; // Avoid float drift
    }
  }

  // If there's still a remainder < 0.1 SOL, add one more 0.1 SOL denomination
  if (remaining > 0.0001) {
    denominations.push(0.1);
  }

  const totalDeposited = denominations.reduce((a, b) => a + b, 0);
  const surplusSol = Math.round((totalDeposited - amountSol) * 1e9) / 1e9;

  // Shuffle for randomized execution order
  const shuffledDenominations = [...denominations];
  for (let i = shuffledDenominations.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledDenominations[i], shuffledDenominations[j]] = [
      shuffledDenominations[j],
      shuffledDenominations[i],
    ];
  }

  return {
    denominations,
    totalDeposited,
    surplusSol,
    shuffledDenominations,
  };
}

/**
 * Convert SOL amount to lamports.
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

/**
 * Calculate a random delay in milliseconds for surplus return.
 * Between 1 and 30 minutes.
 */
export function getRandomSurplusDelay(): number {
  const minMs = 1 * 60 * 1000;   // 1 minute
  const maxMs = 30 * 60 * 1000;  // 30 minutes
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}
