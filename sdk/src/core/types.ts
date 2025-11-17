import { PublicKey, Keypair } from "@solana/web3.js";
import type { Environment } from "./constants";

/**
 * Configuration for the WalletLinkClient
 */
export interface WalletLinkConfig {
  /** Solana environment (devnet or mainnet) */
  environment: Environment;
  /** Optional custom RPC endpoint */
  rpcEndpoint?: string;
  /** Optional custom program ID */
  programId?: PublicKey;
  /** Optional custom cluster offset */
  clusterOffset?: number;
}

/**
 * Result of linking a smart account with a newly created private wallet
 */
export interface LinkSmartAccountResult {
  /** Transaction signature */
  signature: string;
  /** Grid wallet (smart account) public key */
  gridWallet: PublicKey;
  /** Generated private wallet keypair (includes private key) */
  privateWallet: Keypair;
}

/**
 * Result of retrieving linked wallets
 */
export interface RetrieveWalletsResult {
  /** Grid wallet public key (decrypted) */
  gridWallet: PublicKey;
  /** Private wallet public key (decrypted) */
  privateWallet: PublicKey;
}

/**
 * Event emitted when wallets are linked
 */
export interface WalletsLinkedEvent {
  nonce: number[];
  gridWalletLow: number[];
  gridWalletHigh: number[];
  privateWalletLow: number[];
  privateWalletHigh: number[];
}

/**
 * Options for linking a smart account with a new private wallet
 */
export interface LinkSmartAccountOptions {
  /** Grid wallet address (smart account from Grid SDK) */
  gridWallet: PublicKey;
  /** Optional callback when MPC computation starts */
  onComputationQueued?: (signature: string) => void;
  /** Optional callback for computation progress */
  onProgress?: (status: string) => void;
}

/**
 * Options for retrieving wallets
 */
export interface RetrieveWalletsOptions {
  /** Optional callback when MPC computation starts */
  onComputationQueued?: (signature: string) => void;
  /** Optional callback for computation progress */
  onProgress?: (status: string) => void;
}
