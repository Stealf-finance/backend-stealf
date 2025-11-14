/**
 * Grid Base Service - Configuration partagée pour tous les services Grid
 * Fournit la configuration Axios et les interceptors communs
 */

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

export abstract class GridBaseService {
  protected client: AxiosInstance;
  protected apiKey: string;
  protected environment: 'production' | 'sandbox';

  constructor() {
    this.apiKey = process.env.GRID_API_KEY || '48b93dff-b385-4fcf-b62b-fe859fe381bd';
    this.environment = (process.env.GRID_ENVIRONMENT as 'production' | 'sandbox') || 'production';

    this.client = axios.create({
      baseURL: 'https://grid.squads.xyz/api/grid/v1',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      }
    });

    // Add auth headers to all requests
    this.client.interceptors.request.use((config) => {
      config.headers['Authorization'] = `Bearer ${this.apiKey}`;
      config.headers['x-grid-environment'] = this.environment;

      // Add idempotency key if not present
      if (!config.headers['x-idempotency-key'] && ['post', 'put', 'patch'].includes(config.method?.toLowerCase() || '')) {
        config.headers['x-idempotency-key'] = uuidv4();
      }

      return config;
    });

    // Log responses for debugging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`✅ Grid API ${response.config.method?.toUpperCase()} ${response.config.url}:`, response.status);
        return response;
      },
      (error) => {
        console.error(`❌ Grid API Error:`, {
          method: error.config?.method?.toUpperCase(),
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data
        });
        throw error;
      }
    );
  }

  /**
   * Generate UUID for idempotency
   */
  protected generateIdempotencyKey(): string {
    return uuidv4();
  }
}