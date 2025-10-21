/**
 * Grid Authentication Service
 * Gère l'authentification des utilisateurs existants
 * POST /auth - Initiate Authentication
 * POST /auth/verify - Verify OTP
 */

import { GridBaseService } from './grid-base.service';
import {
  GridInitiateAuthRequest,
  GridInitiateAuthResponse,
  GridAuthVerifyRequest,
  GridAuthVerifyResponse
} from './grid-types';

export class GridAuthService extends GridBaseService {
  constructor() {
    super();
  }

  /**
   * Initiate Authentication - Pour un utilisateur existant
   * POST /auth - Conforme à la documentation Grid
   */
  async initiateAuthentication(request: GridInitiateAuthRequest): Promise<GridInitiateAuthResponse> {
    try {
      console.log(`🔐 Initiating authentication for ${request.email}`);

      const response = await this.client.post<GridInitiateAuthResponse>('/auth', {
        email: request.email,
        ...(request.provider && { provider: request.provider })
      });

      console.log(`✅ Authentication initiated for ${request.email}`);
      console.log(`   OTP sent: ${response.data.data.otp_sent}`);
      console.log(`   Expires at: ${response.data.data.expires_at}`);

      return response.data;
    } catch (error: any) {
      console.error('Failed to initiate authentication:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Verify Authentication OTP - Pour utilisateurs existants
   * POST /auth/verify - Conforme à la documentation Grid
   */
  async verifyAuthentication(request: GridAuthVerifyRequest): Promise<GridAuthVerifyResponse> {
    try {
      console.log(`🔐 Verifying authentication OTP for ${request.email}`);

      const response = await this.client.post<GridAuthVerifyResponse>('/auth/verify', {
        email: request.email,
        otp_code: request.otp_code,
        kms_provider: request.kms_provider || 'privy',
        kms_provider_config: request.kms_provider_config
      });

      console.log(`✅ Authentication verified for ${request.email}`);
      console.log(`   Account address: ${response.data.data.address}`);
      console.log(`   Grid user ID: ${response.data.data.grid_user_id}`);
      console.log(`   Signers: ${response.data.data.policies.signers.length}`);

      return response.data;
    } catch (error: any) {
      console.error('Failed to verify authentication:', error.response?.data || error.message);
      throw error;
    }
  }
}

// Export singleton instance
export const gridAuthService = new GridAuthService();