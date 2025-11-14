/**
 * Grid Protocol Types et Interfaces partagés
 * Toutes les interfaces communes à plusieurs services
 */

// Types conformes à la documentation Grid

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT MANAGEMENT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GridCreateAccountRequest {
  type: 'email' | 'signers';
  email?: string;
  signers?: string[];
  threshold?: number;
  memo?: string;
}

export interface GridCreateAccountResponse {
  data: {
    type: 'email' | 'signers';
    email?: string;
    status: 'pending_verification' | 'active';
    otp_sent?: boolean;
    created_at: string;
    expires_at: string;
    memo?: string | null;
    address?: string; // Pour les comptes signers
    signers?: string[]; // Pour les comptes signers
    threshold?: number; // Pour les comptes signers
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridVerifyOTPRequest {
  email: string;
  otp_code: string;
  provider?: 'privy' | 'turnkey' | 'passkey'; // Default is 'privy'
  kms_provider_config: {
    encryption_public_key: string;
  };
  expiration?: number; // Optional Unix timestamp
}

export interface GridVerifyOTPResponse {
  data: {
    address: string;
    policies: {
      signers: Array<{
        address: string;
        role: string;
        permissions: string[];
        provider: string;
      }>;
      threshold: number;
      time_lock: number;
      admin_address: string;
    };
    grid_user_id: string;
    authentication: Array<{
      provider: string;
      session: {
        user_id: string;
        session: any;
      };
    }>;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridAccountDetailsResponse {
  data: {
    address: string;
    type: string;
    status: string;
    policies: {
      signers: Array<{
        address: string;
        role: string;
        permissions: string[];
        provider: string;
      }>;
      threshold: number;
    };
    created_at: string;
    updated_at: string;
    email?: string | null;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridBalanceResponse {
  data: {
    address: string;
    lamports: number; // SOL balance in lamports
    sol: number; // SOL balance as decimal
    tokens: Array<{
      mint: string;
      amount: string;
      decimals: number;
      symbol?: string;
      name?: string;
    }>;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridUpdateAccountRequest {
  signers?: Array<{
    address: string;
    role: string;
    permissions: string[];
    provider: 'privy' | 'passkey' | 'turnkey' | 'external';
  }>;
  threshold?: number;
  time_lock?: number;
  admin_address?: string;
  transaction_signers?: string[];
}

export interface GridUpdateAccountResponse {
  data: {
    transaction: string;
    transaction_signers: string[];
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// AUTHENTICATION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GridInitiateAuthRequest {
  email: string;
  provider?: string;
}

export interface GridInitiateAuthResponse {
  data: {
    type: 'email';
    email: string;
    status: 'pending_verification';
    otp_sent: boolean;
    created_at: string;
    expires_at: string;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridAuthVerifyRequest {
  email: string;
  otp_code: string;
  kms_provider: 'privy' | 'passkey' | 'turnkey' | 'external';
  kms_provider_config: {
    encryption_public_key: string;
  };
}

export interface GridAuthVerifyResponse {
  data: {
    address: string;
    policies: {
      signers: Array<{
        address: string;
        role: 'primary' | 'backup';
        permissions: Array<'CAN_INITIATE' | 'CAN_VOTE' | 'CAN_EXECUTE'>;
        provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      }>;
      threshold: number;
      time_lock?: number | null;
      admin_address?: string;
    };
    grid_user_id: string;
    authentication: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      session: {
        user_id: string;
        session: any;
      };
    }>;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GridTransactionRequest {
  transaction: string; // Base64 encoded transaction
  transaction_signers?: string[]; // Public keys of signers
}

export interface GridTransactionResponse {
  data: {
    transaction: string;
    transaction_signers: string[];
    kms_payloads?: any[];
    expires_at: string;
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// PASSKEYS TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GridPasskeysResponse {
  data: {
    account_address: string;
    passkey: {
      address: string;
      role: string;
      permissions: string[];
      provider: 'passkey';
      added_at: string;
    } | null; // null if no passkey configured
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridAddPasskeyTransactionRequest {
  passkey: {
    address: string;
    role: string;
    permissions: string[];
  };
  transaction_signers?: string[];
}

export interface GridAddPasskeyTransactionResponse {
  data: {
    transaction: string; // Base64 encoded transaction
    transaction_signers: string[];
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    simulation_logs?: string[];
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridRemovePasskeyTransactionResponse {
  data: {
    transaction: string; // Base64 encoded prepared transaction
    transaction_signers: string[]; // List of required transaction signers
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    simulation_logs?: string[]; // Optional transaction simulation logs
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SPENDING LIMITS TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GridCreateSpendingLimitRequest {
  amount: string; // Amount in smallest token units
  mint: string; // Token contract address (Solana public key)
  period: 'one_time' | 'day' | 'week' | 'month';
  spending_limit_signers: string[]; // Authorized addresses
  transaction_signers?: string[]; // Optional transaction signers
  destinations?: string[]; // Optional allowed recipient addresses
  expiration?: number | null; // Optional Unix timestamp
}

export interface GridCreateSpendingLimitResponse {
  data: {
    spending_limit_address: string; // Address of created spending limit
    transaction: string; // Base64 encoded transaction
    kms_payloads: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    transaction_signers: string[]; // Required signers
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridUpdateSpendingLimitRequest {
  amount?: string; // Optional: New amount in smallest token units
  spending_limit_signers?: string[]; // Optional: New authorized addresses
  destinations?: string[]; // Optional: New allowed recipient addresses
  expiration?: number; // Optional: New Unix timestamp
}

export interface GridUpdateSpendingLimitResponse {
  data: {
    transaction: string; // Base64 encoded prepared transaction
    transaction_signers: string[]; // List of required transaction signers
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    simulation_logs?: string[]; // Optional transaction simulation logs
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridDeleteSpendingLimitResponse {
  data: {
    transaction: string; // Base64 encoded prepared transaction
    transaction_signers: string[]; // List of required transaction signers
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    simulation_logs?: string[]; // Optional transaction simulation logs
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

export interface GridUseSpendingLimitRequest {
  amount: string; // Amount to spend in smallest token units
  recipient_address: string; // Address to receive the tokens
  signer_address?: string; // Optional: Address of the signer using the spending limit
}

export interface GridUseSpendingLimitResponse {
  data: {
    transaction: string; // Base64 encoded prepared transaction
    transaction_signers: string[]; // List of required transaction signers
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external';
      address: string;
      payload: string;
    }>;
    simulation_logs?: string[]; // Optional transaction simulation logs
  };
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

// ============================================
// Solana Support Types
// ============================================

/**
 * Request to prepare an arbitrary Solana transaction
 * Supports custom transaction preparation with full control over instructions
 */
export interface GridPrepareArbitraryTransactionRequest {
  transaction: string; // Base64/Base58 encoded transaction to be prepared
  transaction_signers?: string[]; // Optional list of additional transaction signers (Solana public keys in base58 format)
}

/**
 * Response from preparing an arbitrary Solana transaction
 * Contains the prepared transaction with required signers and optional KMS payloads
 */
export interface GridPrepareArbitraryTransactionResponse {
  data: {
    transaction: string; // Base64 encoded prepared transaction
    transaction_signers: string[]; // List of required transaction signers (Solana public keys in base58 format)
    kms_payloads?: Array<{
      provider: 'privy' | 'passkey' | 'turnkey' | 'external'; // KMS provider type
      address: string; // Signer address
      payload: string; // Payload to be signed by the KMS provider
    }>; // KMS payloads for external signing services
    simulation_logs?: string[]; // Optional transaction simulation logs (available in debug mode)
  };
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}

/**
 * Request to submit a previously prepared transaction
 * Includes the signed transaction and KMS signature payloads
 */
export interface GridSubmitTransactionRequest {
  transaction: string; // Base64 encoded transaction with signatures
  kms_payloads?: Array<{
    provider: 'privy' | 'passkey' | 'turnkey' | 'external'; // KMS provider type
    signature: string; // Base64 encoded signature from the KMS provider
  }>; // KMS signature payloads from signing services
}

/**
 * Response from submitting a transaction
 * Contains the transaction signature and confirmation timestamp
 */
export interface GridSubmitTransactionResponse {
  data: {
    transaction_signature: string; // Solana transaction signature
    confirmed_at: string; // Timestamp when the transaction was confirmed (ISO 8601 format)
  };
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}

// ============================================
// KYC Operations Types
// ============================================

/**
 * Endorsements for payment rails
 * Available options for KYC verification
 */
export type GridKYCEndorsements = 'ach' | 'wire' | 'rtp' | 'sepa' | 'faster_payments';

/**
 * Customer type for KYC verification
 */
export type GridKYCCustomerType = 'individual' | 'business';

/**
 * KYC verification status
 */
export type GridKYCStatus = 'incomplete' | 'pending' | 'approved' | 'rejected';

/**
 * Terms of Service acceptance status
 */
export type GridTOSStatus = 'pending' | 'approved';

/**
 * Request to create a KYC verification link
 * Initiates the KYC verification process for an account
 */
export interface GridRequestKYCLinkRequest {
  grid_user_id: string; // Grid user identifier (UUID format)
  type: GridKYCCustomerType; // Customer type: 'individual' or 'business'
  email: string; // Customer email address
  full_name: string; // Customer full name
  endorsements: GridKYCEndorsements[]; // Payment rails to endorse (e.g., ['ach', 'wire'])
  redirect_uri?: string | null; // Optional redirect URI after KYC completion
}

/**
 * KYC rejection reason
 */
export interface GridKYCRejectionReason {
  code: string; // Rejection reason code
  message: string; // Human-readable rejection message
  category?: string; // Rejection category (e.g., 'identity', 'document')
}

/**
 * Response from requesting a KYC verification link
 * Contains the verification URLs and status information
 */
export interface GridRequestKYCLinkResponse {
  data: {
    id: string; // KYC link ID
    full_name: string; // Customer full name
    email: string; // Customer email address
    type: GridKYCCustomerType; // Customer type
    kyc_link: string; // URL to complete KYC verification with Persona
    tos_link: string; // URL to complete Terms of Service acceptance
    kyc_status: GridKYCStatus; // Current KYC verification status
    tos_status: GridTOSStatus; // Terms of Service acceptance status
    created_at: string; // Creation timestamp (ISO 8601 format)
    customer_id: string; // Bridge customer ID
    persona_inquiry_type: string; // Persona inquiry type for verification
    rejection_reasons?: GridKYCRejectionReason[]; // Reasons for KYC rejection if applicable
  };
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}

/**
 * Extended KYC verification status for detailed tracking
 */
export type GridKYCDetailedStatus = 'not_started' | 'under_review' | 'incomplete' | 'approved' | 'rejected';

/**
 * Response from checking KYC verification status
 * Contains current verification state and requirements
 */
export interface GridGetKYCStatusResponse {
  data: {
    id: string; // KYC link ID
    account: string; // Smart account address
    type: GridKYCCustomerType; // Customer type (individual or business)
    status: GridKYCDetailedStatus; // Current KYC status from Bridge
    tos_status: GridTOSStatus; // Terms of Service acceptance status
    rejection_reasons: GridKYCRejectionReason[]; // List of rejection reasons if applicable
    requirements_due: string[]; // Outstanding requirements from Bridge customer
    created_at: string; // KYC link creation timestamp (ISO 8601 format)
    updated_at: string; // Customer last updated timestamp (ISO 8601 format)
    kyc_continuation_link?: string | null; // Link to continue KYC process if incomplete
  };
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}

// ============================================
// Virtual Accounts Types
// ============================================

/**
 * Supported fiat currencies for virtual accounts
 * Note: Grid API expects lowercase currency codes
 */
export type GridVirtualAccountCurrency = 'usd' | 'eur';

/**
 * Virtual account status
 */
export type GridVirtualAccountStatus = 'activated' | 'deactivated';

/**
 * Payment rails for virtual accounts
 */
export type GridVirtualAccountPaymentRail = 'ach' | 'wire' | 'sepa' | 'faster_payments';

/**
 * Request to create a virtual account for fiat deposits
 * Enables receiving funds from traditional banking systems
 */
export interface GridRequestVirtualAccountRequest {
  grid_user_id: string; // Grid user identifier (UUID format)
  currency: GridVirtualAccountCurrency; // Source fiat currency (USD or EUR)
}

/**
 * Source deposit instructions for virtual account
 * Contains bank details for receiving fiat deposits
 */
export interface GridVirtualAccountDepositInstructions {
  currency: GridVirtualAccountCurrency; // Currency for deposits
  bank_beneficiary_name: string; // Name on the bank account
  bank_name: string; // Name of the bank
  bank_address: string; // Physical address of the bank
  bank_routing_number: string; // Bank routing number
  bank_account_number: string; // Bank account number
  payment_rails: GridVirtualAccountPaymentRail[]; // Available payment methods
}

/**
 * Destination details for converted funds
 * Specifies where and how the funds will be delivered
 */
export interface GridVirtualAccountDestination {
  currency: string; // Destination cryptocurrency (e.g., 'usdc')
  payment_rail: string; // Blockchain network (e.g., 'solana')
  address: string; // Destination blockchain address
}

/**
 * Response from creating a virtual account
 * Contains account details and deposit instructions
 */
export interface GridRequestVirtualAccountResponse {
  data: {
    id: string; // Virtual account ID from Bridge
    customer_id: string; // Bridge customer ID
    source_deposit_instructions: GridVirtualAccountDepositInstructions; // Bank details for deposits
    destination: GridVirtualAccountDestination; // Where funds will be sent
    status: GridVirtualAccountStatus; // Account status
    developer_fee_percent?: number | null; // Optional developer fee percentage
  };
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}

/**
 * Destination crypto currencies supported
 */
export type GridDestinationCryptoCurrency = 'usdc' | 'usdt' | 'pyusd' | 'eurc';

/**
 * Query parameters for listing virtual accounts
 */
export interface GridListVirtualAccountsQuery {
  source_currency?: 'USD' | 'EUR'; // Filter by source fiat currency (uppercase)
  destination_currency?: GridDestinationCryptoCurrency; // Filter by destination crypto currency
}

/**
 * Virtual account item in list response
 */
export interface GridVirtualAccountItem {
  id: string; // Virtual account ID from Bridge
  customer_id: string; // Bridge customer ID
  source_deposit_instructions: GridVirtualAccountDepositInstructions; // Bank details for deposits
  destination: GridVirtualAccountDestination; // Where funds will be sent
  status: GridVirtualAccountStatus; // Account status ('activated' or 'deactivated')
  developer_fee_percent?: number | null; // Optional developer fee percentage
}

/**
 * Response for listing virtual accounts
 */
export interface GridListVirtualAccountsResponse {
  data: GridVirtualAccountItem[]; // Array of virtual accounts
  metadata: {
    request_id: string; // Unique identifier for the request (UUID format)
    timestamp: string; // Timestamp when the response was generated (ISO 8601 format)
  };
}