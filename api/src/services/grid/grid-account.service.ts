/**
 * Grid Account Management Service
 * Gère la création et la gestion des comptes Grid
 * POST /accounts - Create Account
 * POST /accounts/verify - Verify OTP
 * GET /accounts/{address} - Get Details
 * PATCH /accounts/{address} - Update Account
 * GET /accounts/{address}/balances - Get Balances
 */

import { GridBaseService } from './grid-base.service';
import { v4 as uuidv4 } from 'uuid';
import {
  GridCreateAccountRequest,
  GridCreateAccountResponse,
  GridVerifyOTPRequest,
  GridVerifyOTPResponse,
  GridAccountDetailsResponse,
  GridUpdateAccountRequest,
  GridUpdateAccountResponse,
  GridBalanceResponse
} from './grid-types';

export class GridAccountService extends GridBaseService {
  constructor() {
    super();
  }

  /**
   * Create Account - Exact implementation from Grid documentation
   * POST /accounts
   */
  async createAccount(request: GridCreateAccountRequest): Promise<GridCreateAccountResponse> {
    try {
      console.log('📝 Creating Grid account:', request.type);

      const response = await this.client.post<GridCreateAccountResponse>('/accounts', request);

      if (request.type === 'email') {
        console.log(`✉️ OTP sent to ${request.email}`);
      } else {
        console.log(`🔑 Signer account created: ${response.data.data.address}`);
      }

      return response.data;
    } catch (error: any) {
      console.error('Failed to create Grid account:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Verify OTP - Complete account creation/authentication
   * POST /accounts/verify - Conforme à la documentation Grid
   */
  async verifyOTP(request: GridVerifyOTPRequest): Promise<GridVerifyOTPResponse> {
    try {
      console.log(`🔐 Verifying OTP for ${request.email}`);

      // Add x-idempotency-key header required for this endpoint
      const idempotencyKey = uuidv4();

      const response = await this.client.post<GridVerifyOTPResponse>('/accounts/verify',
        {
          email: request.email,
          otp_code: request.otp_code,
          provider: request.provider || 'privy', // Default to Privy as per Grid docs
          kms_provider_config: request.kms_provider_config,
          ...(request.expiration && { expiration: request.expiration })
        },
        {
          headers: {
            'x-idempotency-key': idempotencyKey
          }
        }
      );

      console.log(`✅ Account verified: ${response.data.data.address}`);
      console.log(`   Grid User ID: ${response.data.data.grid_user_id}`);
      console.log(`   Policies: ${response.data.data.policies.signers.length} signers, threshold ${response.data.data.policies.threshold}`);

      return response.data;
    } catch (error: any) {
      console.error('OTP verification failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get Account Details - Conforme à la documentation Grid
   * GET /accounts/{address}
   */
  async getAccountDetails(address: string): Promise<GridAccountDetailsResponse> {
    try {
      console.log(`📋 Getting account details for ${address}`);

      const response = await this.client.get<GridAccountDetailsResponse>(`/accounts/${address}`);

      console.log(`✅ Account details retrieved:`);
      console.log(`   Type: ${response.data.data.type}`);
      console.log(`   Status: ${response.data.data.status}`);
      console.log(`   Email: ${response.data.data.email || 'N/A'}`);
      console.log(`   Signers: ${response.data.data.policies.signers.length}`);

      return response.data;
    } catch (error: any) {
      console.error('Failed to get account details:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update Account - Conforme à la documentation Grid
   * PATCH /accounts/{address}
   */
  async updateAccount(
    address: string,
    request: GridUpdateAccountRequest,
    admin: boolean = false
  ): Promise<GridUpdateAccountResponse> {
    try {
      console.log(`🔄 Updating account ${address}`);

      const response = await this.client.patch<GridUpdateAccountResponse>(
        `/accounts/${address}`,
        request,
        {
          params: admin ? { admin: true } : undefined
        }
      );

      console.log(`✅ Account update prepared:`);
      console.log(`   Transaction signers required: ${response.data.data.transaction_signers.length}`);
      console.log(`   KMS payloads: ${response.data.data.kms_payloads?.length || 0}`);

      return response.data;
    } catch (error: any) {
      console.error('Failed to update account:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get Account Balance - Conforme à la documentation Grid
   * GET /accounts/{address}/balances
   */
  async getBalance(
    address: string,
    limit: number = 10,
    page: number = 1
  ): Promise<GridBalanceResponse> {
    try {
      console.log(`💰 Getting balance for ${address} (page ${page}, limit ${limit})`);

      const response = await this.client.get<GridBalanceResponse>(
        `/accounts/${address}/balances`,
        {
          params: {
            limit: Math.min(Math.max(1, limit), 100), // Ensure 1 <= limit <= 100
            page: Math.max(1, page) // Ensure page >= 1
          }
        }
      );

      console.log(`✅ Balance retrieved for ${address}:`);
      console.log(`   SOL: ${response.data.data.sol} (${response.data.data.lamports} lamports)`);
      console.log(`   Tokens: ${response.data.data.tokens.length}`);

      return response.data;
    } catch (error: any) {
      console.error('Failed to get balance:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get Transaction History
   * GET /accounts/{address}/transactions
   */
  async getTransactions(address: string, limit: number = 10): Promise<any> {
    try {
      console.log(`📜 Getting transactions for ${address} (limit ${limit})`);

      const response = await this.client.get(
        `/accounts/${address}/transactions`,
        {
          params: {
            limit: Math.min(Math.max(1, limit), 100)
          }
        }
      );

      console.log(`✅ Retrieved ${response.data.data?.transactions?.length || 0} transactions`);
      return response.data;
    } catch (error: any) {
      console.error('Failed to get transactions:', error.response?.data || error.message);
      throw error;
    }
  }
}

// Export singleton instance
export const gridAccountService = new GridAccountService();