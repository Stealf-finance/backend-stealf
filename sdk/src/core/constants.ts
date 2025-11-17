import { PublicKey } from "@solana/web3.js";

/**
 * Program IDs for different environments
 */
export const PROGRAM_IDS = {
  devnet: new PublicKey("CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm"),
  // mainnet: new PublicKey("..."), // À ajouter lors du déploiement mainnet
} as const;

/**
 * Cluster offsets for Arcium MPC
 */
export const CLUSTER_OFFSETS = {
  devnet: 1100229901,
  // mainnet: ..., // À définir
} as const;

/**
 * RPC endpoints
 */
export const RPC_ENDPOINTS = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
} as const;

/**
 * Environment type
 */
export type Environment = keyof typeof PROGRAM_IDS;