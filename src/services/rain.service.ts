import crypto from 'crypto';

/**
 * Rain Cards API Service
 *
 * Handles KYC applications, card issuance, and transactions for the PUBLIC wallet only.
 * The Rain card is linked exclusively to the user's public Solana wallet.
 */

// ============================================================================
// Type Definitions
// ============================================================================

// Application status enum
export type RainApplicationStatus =
  | 'approved'
  | 'pending'
  | 'needsInformation'
  | 'needsVerification'
  | 'manualReview'
  | 'denied'
  | 'locked'
  | 'canceled';

// Card types
export type RainCardType = 'physical' | 'virtual';
export type RainCardStatus = 'notActivated' | 'active' | 'locked' | 'canceled';
export type RainLimitFrequency =
  | 'per24HourPeriod'
  | 'per7DayPeriod'
  | 'per30DayPeriod'
  | 'perYearPeriod'
  | 'allTime'
  | 'perAuthorization';

// Transaction types
export type RainTransactionType = 'spend' | 'collateral' | 'payment' | 'fee';
export type RainTransactionStatus = 'pending' | 'reversed' | 'declined' | 'completed';

// Document types for KYC
export type RainDocumentType =
  | 'idCard'
  | 'passport'
  | 'drivers'
  | 'residencePermit'
  | 'utilityBill'
  | 'selfie'
  | 'videoSelfie'
  | 'profileImage'
  | 'other';

export type RainDocumentSide = 'front' | 'back';

// Create application request (Using API method - no Sumsub/Persona)
export interface CreateConsumerApplicationRequest {
  // Required fields
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string; // YYYY-MM-DD
  nationalId: string;
  countryOfIssue: string; // ISO alpha-2
  ipAddress: string;
  occupation: string; // SOC code
  annualSalary: string;
  accountPurpose: string;
  expectedMonthlyVolume: string;
  isTermsOfServiceAccepted: true;

  // Address
  address: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string; // ISO alpha-2
  };

  // Phone
  phoneCountryCode: string; // e.g., "1" for US
  phoneNumber: string;

  // Wallet - PUBLIC wallet only
  solanaAddress: string;

  // Optional
  sourceKey?: string;
}

// Application response
export interface ConsumerApplicationResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  isTermsOfServiceAccepted: boolean;
  applicationStatus: RainApplicationStatus;
  companyId?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };
  phoneCountryCode?: string;
  phoneNumber?: string;
  walletAddress?: string;
  solanaAddress?: string;
  applicationCompletionLink?: {
    url: string;
    params?: {
      userId?: string;
    };
  };
  applicationReason?: string;
}

// Application status response
export interface ApplicationStatusResponse {
  id: string;
  applicationStatus: RainApplicationStatus;
  applicationCompletionLink?: {
    url: string;
    params?: {
      userId?: string;
    };
  };
  applicationReason?: string;
}

// Document upload params
export interface DocumentUploadParams {
  userId: string;
  document: Buffer;
  filename: string;
  type: RainDocumentType;
  side?: RainDocumentSide;
  countryCode: string; // ISO alpha-2
}

// ============================================================================
// Card Types
// ============================================================================

// Card limit
export interface RainCardLimit {
  amount: number; // in cents
  frequency: RainLimitFrequency;
}

// Shipping address for physical cards
export interface RainShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
  phoneNumber?: string;
  method?: 'standard' | 'express' | 'international' | 'apc' | 'uspsinternational';
  firstName?: string;
  lastName?: string;
}

// Billing address
export interface RainBillingAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
  country?: string;
}

// Create card request
export interface CreateCardRequest {
  userId: string; // Rain userId
  type: RainCardType;
  status?: RainCardStatus;
  limit?: RainCardLimit;
  configuration?: {
    displayName?: string; // Max 26 chars for physical cards
    productId?: string;
    productRef?: string;
    virtualCardArt?: string;
  };
  shipping?: RainShippingAddress; // Required for physical cards
  billing?: RainBillingAddress;
  bulkShippingGroupId?: string;
}

// Card response
export interface RainCardResponse {
  id: string;
  companyId: string;
  userId: string;
  type: RainCardType;
  status: RainCardStatus;
  last4: string;
  expirationMonth: string;
  expirationYear: string;
  limit?: RainCardLimit;
  tokenWallets?: string[];
}

// Encrypted card data response
export interface RainEncryptedCardData {
  encryptedPan: {
    iv: string;
    data: string;
  };
  encryptedCvc: {
    iv: string;
    data: string;
  };
}

// Encrypted PIN response
export interface RainEncryptedPin {
  encryptedPin: {
    iv: string;
    data: string;
  };
}

// Update card request
export interface UpdateCardRequest {
  status?: RainCardStatus;
  limit?: RainCardLimit;
  billing?: RainBillingAddress;
  configuration?: {
    virtualCardArt?: string;
  };
}

// ============================================================================
// Transaction Types
// ============================================================================

// Spend transaction details
export interface RainSpendTransaction {
  amount: number; // in cents
  currency: string;
  receipt: boolean;
  merchantName: string;
  merchantCategory: string;
  merchantCategoryCode: string;
  cardId: string;
  cardType: RainCardType;
  userId: string;
  userFirstName: string;
  userEmail: string;
  status: RainTransactionStatus;
  authorizedAt: string;
  localAmount?: number;
  localCurrency?: string;
  authorizedAmount?: number;
  authorizationMethod?: string;
  memo?: string;
  merchantId?: string;
  enrichedMerchantIcon?: string;
  enrichedMerchantName?: string;
  enrichedMerchantCategory?: string;
  companyId?: string;
  userLastName?: string;
  declinedReason?: string;
  postedAt?: string;
}

// Transaction response
export interface RainTransactionResponse {
  id: string;
  type: RainTransactionType;
  spend?: RainSpendTransaction;
}

// Transaction query params
export interface GetTransactionsParams {
  userId?: string;
  cardId?: string;
  companyId?: string;
  type?: RainTransactionType[];
  authorizedBefore?: string;
  authorizedAfter?: string;
  postedBefore?: string;
  postedAfter?: string;
  cursor?: string;
  limit?: number;
}

// ============================================================================
// Rain Service Class
// ============================================================================

class RainService {
  private apiKey: string | null = null;
  private baseUrl: string = '';
  private webhookSecret: string | null = null;
  private environment: 'sandbox' | 'production' = 'sandbox';

  /**
   * Initialize the Rain service
   */
  async initialize(): Promise<void> {
    this.environment = (process.env.RAIN_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox';

    // Set API key based on environment
    if (this.environment === 'production') {
      this.apiKey = process.env.RAIN_API_KEY_PRODUCTION || null;
      this.baseUrl = 'https://api.raincards.xyz/v1/issuing';
    } else {
      this.apiKey = process.env.RAIN_API_KEY_SANDBOX || null;
      this.baseUrl = 'https://api-dev.raincards.xyz/v1/issuing';
    }

    this.webhookSecret = process.env.RAIN_WEBHOOK_SECRET || null;

    if (!this.apiKey) {
      console.warn(`  [Rain] API key not set for ${this.environment} environment`);
    } else {
      console.log(`  [Rain] Service initialized (${this.environment})`);
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get current environment
   */
  getEnvironment(): string {
    return this.environment;
  }

  // ==========================================================================
  // API Helpers
  // ==========================================================================

  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: any,
    isFormData: boolean = false
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Rain API key not configured');
    }

    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Api-Key': this.apiKey,
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = isFormData ? body : JSON.stringify(body);
    }

    console.log(`[Rain] ${method} ${endpoint}`);

    const response = await fetch(url, options);
    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `Rain API error: ${response.status}`;
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage = responseText || errorMessage;
      }
      console.error(`[Rain] Error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    // Handle empty responses (204 No Content)
    if (!responseText || response.status === 204) {
      return {} as T;
    }

    return JSON.parse(responseText) as T;
  }

  // ==========================================================================
  // KYC / Applications
  // ==========================================================================

  /**
   * Create a consumer application for KYC
   * Links the Rain account to the user's PUBLIC Solana wallet
   */
  async createConsumerApplication(
    params: CreateConsumerApplicationRequest
  ): Promise<ConsumerApplicationResponse> {
    // Build request body for API-based KYC
    const requestBody = {
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      birthDate: params.birthDate,
      nationalId: params.nationalId,
      countryOfIssue: params.countryOfIssue,
      ipAddress: params.ipAddress,
      occupation: params.occupation,
      annualSalary: params.annualSalary,
      accountPurpose: params.accountPurpose,
      expectedMonthlyVolume: params.expectedMonthlyVolume,
      isTermsOfServiceAccepted: true,
      address: params.address,
      phoneCountryCode: params.phoneCountryCode,
      phoneNumber: params.phoneNumber,
      // Link to PUBLIC wallet only
      solanaAddress: params.solanaAddress,
      sourceKey: params.sourceKey || 'stealf',
    };

    console.log(`[Rain] Creating consumer application for ${params.email}`);
    console.log(`[Rain] Linked to PUBLIC wallet: ${params.solanaAddress}`);

    const result = await this.apiRequest<ConsumerApplicationResponse>(
      'POST',
      '/applications/user',
      requestBody
    );

    console.log(`[Rain] Application created: ${result.id}`);
    console.log(`[Rain] Status: ${result.applicationStatus}`);

    return result;
  }

  /**
   * Get application status for a user
   */
  async getApplicationStatus(userId: string): Promise<ApplicationStatusResponse> {
    console.log(`[Rain] Getting application status for user: ${userId}`);

    const result = await this.apiRequest<ApplicationStatusResponse>(
      'GET',
      `/applications/user/${userId}`
    );

    console.log(`[Rain] Application status: ${result.applicationStatus}`);

    return result;
  }

  /**
   * Upload a document for KYC verification
   */
  async uploadDocument(params: DocumentUploadParams): Promise<void> {
    const { userId, document, filename, type, side, countryCode } = params;

    console.log(`[Rain] Uploading document for user ${userId}`);
    console.log(`[Rain] Type: ${type}, Side: ${side || 'N/A'}, Country: ${countryCode}`);

    // Create FormData
    const formData = new FormData();

    // Create Blob from Buffer
    const blob = new Blob([document], { type: 'application/octet-stream' });
    formData.append('document', blob, filename);

    if (type) {
      formData.append('type', type);
    }
    if (side) {
      formData.append('side', side);
    }
    if (countryCode) {
      formData.append('countryCode', countryCode);
    }

    await this.apiRequest<void>(
      'PUT',
      `/applications/user/${userId}/document`,
      formData,
      true // isFormData
    );

    console.log(`[Rain] Document uploaded successfully`);
  }

  // ==========================================================================
  // Cards
  // ==========================================================================

  /**
   * Create a card for a user
   * For physical cards, first/last name must be Latin characters only (A-Z, a-z, spaces, hyphens)
   */
  async createCard(params: CreateCardRequest): Promise<RainCardResponse> {
    const { userId, ...cardData } = params;

    console.log(`[Rain] Creating ${cardData.type} card for user: ${userId}`);

    // Validate physical card requirements
    if (cardData.type === 'physical') {
      if (!cardData.shipping) {
        throw new Error('Shipping address is required for physical cards');
      }
      // Validate displayName for Latin characters if provided
      if (cardData.configuration?.displayName) {
        const latinRegex = /^[A-Za-z\s\-\.]+$/;
        if (!latinRegex.test(cardData.configuration.displayName)) {
          throw new Error('Display name must contain only Latin characters (A-Z, spaces, hyphens)');
        }
      }
    }

    const result = await this.apiRequest<RainCardResponse>(
      'POST',
      `/users/${userId}/cards`,
      cardData
    );

    console.log(`[Rain] Card created: ${result.id} (${result.type}, last4: ${result.last4})`);

    return result;
  }

  /**
   * Get all cards for a user
   */
  async getCards(params: {
    userId?: string;
    companyId?: string;
    status?: RainCardStatus;
    cursor?: string;
    limit?: number;
  }): Promise<RainCardResponse[]> {
    const queryParams = new URLSearchParams();

    if (params.userId) queryParams.append('userId', params.userId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.status) queryParams.append('status', params.status);
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.limit) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    const endpoint = `/cards${queryString ? `?${queryString}` : ''}`;

    console.log(`[Rain] Getting cards: ${endpoint}`);

    const result = await this.apiRequest<RainCardResponse[]>('GET', endpoint);

    console.log(`[Rain] Found ${result.length} cards`);

    return result;
  }

  /**
   * Get a card by ID
   */
  async getCard(cardId: string): Promise<RainCardResponse> {
    console.log(`[Rain] Getting card: ${cardId}`);

    const result = await this.apiRequest<RainCardResponse>('GET', `/cards/${cardId}`);

    console.log(`[Rain] Card found: ${result.id} (${result.type}, status: ${result.status})`);

    return result;
  }

  /**
   * Update a card (status, limit, billing, etc.)
   */
  async updateCard(cardId: string, params: UpdateCardRequest): Promise<RainCardResponse> {
    console.log(`[Rain] Updating card: ${cardId}`);

    const result = await this.apiRequest<RainCardResponse>('PATCH', `/cards/${cardId}`, params);

    console.log(`[Rain] Card updated: ${result.id} (status: ${result.status})`);

    return result;
  }

  /**
   * Activate a card
   */
  async activateCard(cardId: string): Promise<RainCardResponse> {
    return this.updateCard(cardId, { status: 'active' });
  }

  /**
   * Lock a card (temporarily disable)
   */
  async lockCard(cardId: string): Promise<RainCardResponse> {
    return this.updateCard(cardId, { status: 'locked' });
  }

  /**
   * Unlock a card (re-enable after lock)
   */
  async unlockCard(cardId: string): Promise<RainCardResponse> {
    return this.updateCard(cardId, { status: 'active' });
  }

  /**
   * Cancel a card (permanent, irreversible)
   */
  async cancelCard(cardId: string): Promise<RainCardResponse> {
    return this.updateCard(cardId, { status: 'canceled' });
  }

  /**
   * Get encrypted card data (PAN, CVC)
   * Requires SessionId header with encrypted session
   */
  async getCardSecrets(cardId: string, encryptedSessionId: string): Promise<RainEncryptedCardData> {
    console.log(`[Rain] Getting encrypted card data for: ${cardId}`);

    if (!this.apiKey) {
      throw new Error('Rain API key not configured');
    }

    const url = `${this.baseUrl}/cards/${cardId}/secrets`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Api-Key': this.apiKey,
        'SessionId': encryptedSessionId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rain API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as RainEncryptedCardData;

    console.log(`[Rain] Encrypted card data retrieved`);

    return result;
  }

  /**
   * Get encrypted PIN
   * Requires SessionId header with encrypted session
   */
  async getCardPin(cardId: string, encryptedSessionId: string): Promise<RainEncryptedPin> {
    console.log(`[Rain] Getting encrypted PIN for: ${cardId}`);

    if (!this.apiKey) {
      throw new Error('Rain API key not configured');
    }

    const url = `${this.baseUrl}/cards/${cardId}/pin`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Api-Key': this.apiKey,
        'SessionId': encryptedSessionId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rain API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as RainEncryptedPin;

    console.log(`[Rain] Encrypted PIN retrieved`);

    return result;
  }

  /**
   * Update card PIN
   * Requires SessionId header with encrypted session
   */
  async updateCardPin(
    cardId: string,
    encryptedSessionId: string,
    encryptedPin: { iv: string; data: string }
  ): Promise<void> {
    console.log(`[Rain] Updating PIN for: ${cardId}`);

    if (!this.apiKey) {
      throw new Error('Rain API key not configured');
    }

    const url = `${this.baseUrl}/cards/${cardId}/pin`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Api-Key': this.apiKey,
        'SessionId': encryptedSessionId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ encryptedPin }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rain API error: ${response.status} - ${errorText}`);
    }

    console.log(`[Rain] PIN updated successfully`);
  }

  // ==========================================================================
  // Transactions
  // ==========================================================================

  /**
   * Get all transactions with optional filters
   */
  async getTransactions(params: GetTransactionsParams = {}): Promise<RainTransactionResponse[]> {
    const queryParams = new URLSearchParams();

    if (params.userId) queryParams.append('userId', params.userId);
    if (params.cardId) queryParams.append('cardId', params.cardId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.type) {
      params.type.forEach(t => queryParams.append('type', t));
    }
    if (params.authorizedBefore) queryParams.append('authorizedBefore', params.authorizedBefore);
    if (params.authorizedAfter) queryParams.append('authorizedAfter', params.authorizedAfter);
    if (params.postedBefore) queryParams.append('postedBefore', params.postedBefore);
    if (params.postedAfter) queryParams.append('postedAfter', params.postedAfter);
    if (params.cursor) queryParams.append('cursor', params.cursor);
    if (params.limit) queryParams.append('limit', params.limit.toString());

    const queryString = queryParams.toString();
    const endpoint = `/transactions${queryString ? `?${queryString}` : ''}`;

    console.log(`[Rain] Getting transactions: ${endpoint}`);

    const result = await this.apiRequest<RainTransactionResponse[]>('GET', endpoint);

    console.log(`[Rain] Found ${result.length} transactions`);

    return result;
  }

  /**
   * Get a transaction by ID
   */
  async getTransaction(transactionId: string): Promise<RainTransactionResponse> {
    console.log(`[Rain] Getting transaction: ${transactionId}`);

    const result = await this.apiRequest<RainTransactionResponse>(
      'GET',
      `/transactions/${transactionId}`
    );

    console.log(`[Rain] Transaction found: ${result.id} (type: ${result.type})`);

    return result;
  }

  /**
   * Get transactions for a specific user
   */
  async getUserTransactions(
    rainUserId: string,
    options: {
      limit?: number;
      cursor?: string;
      authorizedAfter?: string;
      authorizedBefore?: string;
    } = {}
  ): Promise<RainTransactionResponse[]> {
    return this.getTransactions({
      userId: rainUserId,
      ...options,
    });
  }

  /**
   * Get transactions for a specific card
   */
  async getCardTransactions(
    cardId: string,
    options: {
      limit?: number;
      cursor?: string;
      authorizedAfter?: string;
      authorizedBefore?: string;
    } = {}
  ): Promise<RainTransactionResponse[]> {
    return this.getTransactions({
      cardId,
      ...options,
    });
  }

  // ==========================================================================
  // Encryption Helpers (for SessionId)
  // ==========================================================================

  /**
   * Get the public key for encrypting SessionId
   */
  getPublicKey(): string {
    if (this.environment === 'production') {
      return process.env.RAIN_PUBLIC_KEY_PRODUCTION || '';
    }
    return process.env.RAIN_PUBLIC_KEY_SANDBOX || '';
  }

  /**
   * Encrypt a session ID using Rain's public key
   * This is required for getting card secrets and PIN
   */
  encryptSessionId(sessionId: string): string {
    const publicKey = this.getPublicKey();
    if (!publicKey) {
      throw new Error('Rain public key not configured');
    }

    // Use RSA encryption with public key
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(sessionId)
    );

    return encryptedBuffer.toString('base64');
  }

  // ==========================================================================
  // Webhook Verification
  // ==========================================================================

  /**
   * Verify webhook signature (HMAC SHA256)
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('[Rain] Webhook secret not configured');
      return false;
    }

    // Extract hex signature from "sha256=<hex>"
    const providedSignature = signature.replace('sha256=', '');

    // Compute HMAC SHA256
    const computedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(providedSignature, 'hex'),
        Buffer.from(computedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }
}

// Export singleton
export const rainService = new RainService();
