import { PublicKey } from "@solana/web3.js";
/**
 * Centralized configuration constants for the Stealf project
 */
// ============================================================================
// Network Configuration
// ============================================================================
export const NETWORKS = {
    DEVNET: {
        name: "devnet",
        programId: new PublicKey("CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm"),
        clusterOffset: 768109697,
        rpcEndpoint: "https://devnet.helius-rpc.com/?api-key=43e43858-1784-4f9f-8a2d-fd791cd44d53",
        explorer: "https://explorer.solana.com",
    },
    MAINNET: {
        name: "mainnet-beta",
        // programId: new PublicKey("..."), // TODO: Deploy to mainnet
        // clusterOffset: ..., // TODO: Configure mainnet cluster
        rpcEndpoint: "https://api.mainnet-beta.solana.com",
        explorer: "https://explorer.solana.com",
    },
    LOCALNET: {
        name: "localnet",
        programId: new PublicKey("CJGGJceyiZqWszErY1mmkHzbVwsgeYdDe32hHZrfbwmm"),
        clusterOffset: 0,
        rpcEndpoint: "http://localhost:8899",
        explorer: "http://localhost:3000",
    },
};
// ============================================================================
// Program Configuration
// ============================================================================
export const PROGRAM_CONFIG = {
    /** Program name */
    NAME: "Private Wallet",
    /** Seeds for PDAs */
    SEEDS: {
        ENCRYPTED_WALLETS: "encrypted_wallets",
        SIGN_PDA: "sign_pda",
    },
    /** Computation definition names */
    COMP_DEFS: {
        LINK_WALLETS: "link_wallets",
    },
    /** Transaction commitment level */
    COMMITMENT: "confirmed",
    /** Default timeout for MPC computations (ms) */
    MPC_TIMEOUT_MS: 120000, // 2 minutes
};
// ============================================================================
// Arcium Configuration
// ============================================================================
export const ARCIUM_CONFIG = {
    /** Arcium program ID (same across all networks) */
    PROGRAM_ID: new PublicKey("Bv3Fb9VjzjWGfX18QTUcVycAfeLoQ5zZN6vv2g3cTZxp"),
    /** MXE Account address */
    MXE_ACCOUNT: new PublicKey("94yTWsEdXqZqcUHqAsvuMtVgtaVhWeeN3JAioTW76Q9R"),
    /** Version */
    VERSION: "0.4.0",
    /** Supported backends */
    BACKENDS: ["Cerberus"],
};
// ============================================================================
// Encryption Configuration
// ============================================================================
export const ENCRYPTION_CONFIG = {
    /** Cipher algorithm */
    ALGORITHM: "x25519-RescueCipher",
    /** Key size in bytes */
    KEY_SIZE: 32,
    /** Nonce size in bytes */
    NONCE_SIZE: 16,
    /** Field element size (u128) */
    FIELD_ELEMENT_SIZE: 16,
    /** Number of field elements per wallet (low + high) */
    ELEMENTS_PER_WALLET: 2,
};
// ============================================================================
// Validation Rules
// ============================================================================
export const VALIDATION = {
    /** Minimum SOL balance required for operations */
    MIN_BALANCE_SOL: 0.01,
    /** Maximum retry attempts for failed operations */
    MAX_RETRIES: 3,
    /** Retry delay in milliseconds */
    RETRY_DELAY_MS: 1000,
};
// ============================================================================
// Error Messages
// ============================================================================
export const ERROR_MESSAGES = {
    WALLET_NOT_CONNECTED: "Wallet is not connected",
    INSUFFICIENT_BALANCE: "Insufficient SOL balance",
    INVALID_PUBLIC_KEY: "Invalid public key provided",
    MPC_TIMEOUT: "MPC computation timed out",
    MPC_FAILED: "MPC computation failed",
    ALREADY_LINKED: "Wallets are already linked",
    NOT_LINKED: "No linked wallets found",
    NETWORK_ERROR: "Network request failed",
};
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Get network configuration by name
 */
export function getNetworkConfig(network) {
    return NETWORKS[network];
}
/**
 * Get current network from environment
 */
export function getCurrentNetwork() {
    const env = process.env.SOLANA_NETWORK || process.env.NEXT_PUBLIC_SOLANA_NETWORK;
    return env?.toUpperCase() || "DEVNET";
}
/**
 * Check if running in production
 */
export function isProduction() {
    return getCurrentNetwork() === "MAINNET";
}
/**
 * Get explorer URL for a transaction
 */
export function getExplorerUrl(signature, network) {
    const config = getNetworkConfig(network);
    const cluster = network === "MAINNET" ? "" : `?cluster=${config.name}`;
    return `${config.explorer}/tx/${signature}${cluster}`;
}
/**
 * Get explorer URL for an address
 */
export function getAddressExplorerUrl(address, network) {
    const config = getNetworkConfig(network);
    const cluster = network === "MAINNET" ? "" : `?cluster=${config.name}`;
    return `${config.explorer}/address/${address}${cluster}`;
}
