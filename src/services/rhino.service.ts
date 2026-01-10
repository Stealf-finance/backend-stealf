import { RhinoBridge } from '../models/rhino-bridge.model.js';

/**
 * Rhino.fi Bridge Service
 *
 * Handles cross-chain bridges from Ethereum, Arbitrum, Base, Polygon to Solana
 * Direction: Receive only (other chains -> Solana)
 */

// Type definitions
interface BridgeConfig {
  supportedChains: string[];
  tokensByChain: Record<string, string[]>;
  destinationChain: string;
}

interface BridgeQuote {
  quoteId: string;
  depositAddress: string;
  payAmount: string;
  payAmountUsd: number;
  receiveAmount: string;
  receiveAmountUsd: number;
  fees: {
    fee: string;
    feeUsd: number;
  };
  expiresAt: string;
  estimatedDuration: number;
  chainIn: string;
  chainOut: string;
  tokenIn: string;
  tokenOut: string;
}

interface BridgeStatus {
  state: string;
  depositTxHash?: string;
  withdrawTxHash?: string;
}

interface DepositQuoteParams {
  chainIn: string;
  token: string;
  amount: string;
  recipientAddress: string;
  userEmail?: string;
}

// API Response types
interface RhinoQuoteResponse {
  quoteId: string;
  depositAddress?: string;
  payAmount: string;
  payAmountUsd?: number;
  receiveAmount: string;
  receiveAmountUsd?: number;
  fees?: {
    fee?: string;
    feeUsd?: number;
  };
  expiresAt?: string;
  estimatedDuration?: number;
}

interface RhinoCommitResponse {
  quoteId: string;
  depositAddress?: string;
}

interface RhinoStatusResponse {
  state?: string;
  status?: string;
  depositTxHash?: string;
  withdrawTxHash?: string;
}

interface RhinoErrorResponse {
  message?: string;
  error?: string;
}

// Rhino.fi API base URL
const RHINO_API_BASE = 'https://api.rhino.fi';

class RhinoService {
  private apiKey: string | null = null;
  private bridgeConfig: BridgeConfig | null = null;
  private configLastFetched: number = 0;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize the Rhino service
   */
  async initialize(): Promise<void> {
    this.apiKey = process.env.RHINO_API_KEY || null;

    if (!this.apiKey) {
      console.warn('  RHINO_API_KEY not set - Rhino bridge service will use public endpoints only');
    }

    try {
      // Pre-fetch configs
      await this.getBridgeConfigs();
      console.log('  Rhino.fi Bridge Service initialized');
    } catch (error) {
      console.error('  Failed to initialize Rhino service:', error);
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return true; // Service works with public endpoints even without API key
  }

  /**
   * Get supported chains and tokens for bridging to Solana
   */
  async getBridgeConfigs(): Promise<BridgeConfig> {
    // Return cached if fresh
    if (this.bridgeConfig && Date.now() - this.configLastFetched < this.CONFIG_CACHE_TTL) {
      return this.bridgeConfig;
    }

    try {
      const response = await fetch(`${RHINO_API_BASE}/bridge/configs`);
      const data = await response.json();

      // Supported source chains for receiving on Solana
      const supportedSourceChains = [
        'ETHEREUM',
        'ARBITRUM_ONE',
        'BASE',
        'POLYGON',
        'OPTIMISM',
      ];

      // Build tokens by chain from config
      const tokensByChain: Record<string, string[]> = {};

      for (const chain of supportedSourceChains) {
        if (data[chain]?.tokens) {
          tokensByChain[chain] = Object.keys(data[chain].tokens);
        } else {
          // Default tokens if not in config
          tokensByChain[chain] = ['USDC', 'USDT', 'ETH'];
        }
      }

      this.bridgeConfig = {
        supportedChains: supportedSourceChains,
        tokensByChain,
        destinationChain: 'SOLANA',
      };

      this.configLastFetched = Date.now();
      return this.bridgeConfig;
    } catch (error) {
      console.error('[RhinoService] Error fetching configs:', error);

      // Return default config on error
      this.bridgeConfig = {
        supportedChains: ['ETHEREUM', 'ARBITRUM_ONE', 'BASE', 'POLYGON', 'OPTIMISM'],
        tokensByChain: {
          ETHEREUM: ['USDC', 'USDT', 'ETH'],
          ARBITRUM_ONE: ['USDC', 'USDT', 'ETH'],
          BASE: ['USDC', 'ETH'],
          POLYGON: ['USDC', 'USDT'],
          OPTIMISM: ['USDC', 'USDT', 'ETH'],
        },
        destinationChain: 'SOLANA',
      };

      return this.bridgeConfig;
    }
  }

  /**
   * Get a public quote (no authentication required)
   */
  async getPublicQuote(params: {
    chainIn: string;
    token: string;
    amount: string;
  }): Promise<any> {
    const { chainIn, token, amount } = params;

    const queryParams = new URLSearchParams({
      chainIn,
      chainOut: 'SOLANA',
      token,
      amount,
      mode: 'pay',
    });

    const response = await fetch(`${RHINO_API_BASE}/bridge/quote/public?${queryParams}`);
    return response.json();
  }

  /**
   * Get a bridge quote with deposit address
   * Uses Rhino.fi API flow:
   * 1. POST /bridge/quote/user - Get quote with quoteId
   * 2. POST /bridge/quote/commit/{quoteId} - Commit to get deposit instructions
   */
  async getDepositQuote(params: DepositQuoteParams): Promise<BridgeQuote> {
    const { chainIn, token, amount, recipientAddress, userEmail } = params;

    if (!this.apiKey) {
      throw new Error('RHINO_API_KEY is required for deposit quotes');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'authorization': this.apiKey,
    };

    try {
      console.log('[RhinoService] Creating deposit quote...');
      console.log('[RhinoService] Chain:', chainIn);
      console.log('[RhinoService] Token:', token);
      console.log('[RhinoService] Amount:', amount);
      console.log('[RhinoService] Recipient:', recipientAddress);

      // Step 1: Get user quote
      // Note: For receiving, depositor is the user's address on source chain (we use a placeholder)
      // and recipient is the Solana address
      const quoteBody = {
        token,
        chainIn,
        chainOut: 'SOLANA',
        amount,
        mode: 'pay',
        depositor: '0x0000000000000000000000000000000000000000', // Placeholder - user will deposit from their own wallet
        recipient: recipientAddress,
      };

      console.log('[RhinoService] Quote request body:', JSON.stringify(quoteBody));

      const quoteResponse = await fetch(`${RHINO_API_BASE}/bridge/quote/user`, {
        method: 'POST',
        headers,
        body: JSON.stringify(quoteBody),
      });

      const quoteText = await quoteResponse.text();
      console.log('[RhinoService] Quote response status:', quoteResponse.status);
      console.log('[RhinoService] Quote response:', quoteText);

      if (!quoteResponse.ok) {
        let errorMessage = `Quote request failed: ${quoteResponse.status}`;
        try {
          const errorData = JSON.parse(quoteText);
          errorMessage = errorData.message || errorData.error || errorData._tag || errorMessage;
        } catch (e) {
          errorMessage = quoteText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const quote = JSON.parse(quoteText) as RhinoQuoteResponse;

      if (!quote.quoteId) {
        throw new Error('No quoteId received from Rhino API');
      }

      console.log('[RhinoService] Got quoteId:', quote.quoteId);

      // Step 2: Commit the quote
      const commitResponse = await fetch(`${RHINO_API_BASE}/bridge/quote/commit/${quote.quoteId}`, {
        method: 'POST',
        headers,
      });

      const commitText = await commitResponse.text();
      console.log('[RhinoService] Commit response status:', commitResponse.status);
      console.log('[RhinoService] Commit response:', commitText);

      if (!commitResponse.ok) {
        let errorMessage = `Commit request failed: ${commitResponse.status}`;
        try {
          const errorData = JSON.parse(commitText);
          errorMessage = errorData.message || errorData.error || errorData._tag || errorMessage;
        } catch (e) {
          errorMessage = commitText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const commitResult = JSON.parse(commitText) as RhinoCommitResponse;

      // Build the response
      // Note: The deposit address may come from the quote or commit response
      // For Rhino.fi, after committing, the user sends to a specific deposit address
      const bridgeQuote: BridgeQuote = {
        quoteId: quote.quoteId,
        depositAddress: commitResult.depositAddress || quote.depositAddress || '',
        payAmount: quote.payAmount,
        payAmountUsd: quote.payAmountUsd || 0,
        receiveAmount: quote.receiveAmount,
        receiveAmountUsd: quote.receiveAmountUsd || 0,
        fees: {
          fee: quote.fees?.fee || '0',
          feeUsd: quote.fees?.feeUsd || 0,
        },
        expiresAt: quote.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        estimatedDuration: quote.estimatedDuration || 300,
        chainIn,
        chainOut: 'SOLANA',
        tokenIn: token,
        tokenOut: token,
      };

      // Save to database for tracking
      await RhinoBridge.create({
        userEmail,
        quoteId: bridgeQuote.quoteId,
        chainIn,
        chainOut: 'SOLANA',
        tokenIn: token,
        tokenOut: token,
        depositAddress: bridgeQuote.depositAddress,
        recipientAddress,
        payAmount: bridgeQuote.payAmount,
        payAmountUsd: bridgeQuote.payAmountUsd,
        receiveAmount: bridgeQuote.receiveAmount,
        receiveAmountUsd: bridgeQuote.receiveAmountUsd,
        fees: bridgeQuote.fees,
        expiresAt: new Date(bridgeQuote.expiresAt),
        estimatedDuration: bridgeQuote.estimatedDuration,
        status: 'pending',
      });

      console.log(`[RhinoService] Bridge quote created: ${bridgeQuote.quoteId}`);
      console.log(`[RhinoService] Deposit address: ${bridgeQuote.depositAddress}`);
      console.log(`[RhinoService] ${amount} ${token} on ${chainIn} -> ${bridgeQuote.receiveAmount} on Solana`);

      return bridgeQuote;
    } catch (error) {
      console.error('[RhinoService] Error getting deposit quote:', error);
      throw error;
    }
  }

  /**
   * Get bridge status by quoteId
   */
  async getBridgeStatus(quoteId: string): Promise<BridgeStatus> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Fetch from Rhino API
      const response = await fetch(`${RHINO_API_BASE}/bridge/status/${quoteId}`, {
        headers,
      });

      if (!response.ok) {
        // If API fails, check our database
        const dbRecord = await RhinoBridge.findOne({ quoteId });
        if (dbRecord) {
          return {
            state: dbRecord.status.toUpperCase(),
            depositTxHash: dbRecord.depositTxHash,
            withdrawTxHash: dbRecord.withdrawTxHash,
          };
        }
        throw new Error(`Status request failed: ${response.status}`);
      }

      const status = await response.json() as RhinoStatusResponse;

      // Update database record
      const updateData: any = {
        status: (status.state || status.status || 'pending').toLowerCase(),
      };

      if (status.depositTxHash) {
        updateData.depositTxHash = status.depositTxHash;
      }
      if (status.withdrawTxHash) {
        updateData.withdrawTxHash = status.withdrawTxHash;
      }

      await RhinoBridge.findOneAndUpdate(
        { quoteId },
        updateData,
        { new: true }
      );

      return {
        state: status.state || status.status || 'PENDING',
        depositTxHash: status.depositTxHash,
        withdrawTxHash: status.withdrawTxHash,
      };
    } catch (error) {
      console.error('[RhinoService] Error getting bridge status:', error);

      // Fallback to database
      const dbRecord = await RhinoBridge.findOne({ quoteId });
      if (dbRecord) {
        return {
          state: dbRecord.status.toUpperCase(),
          depositTxHash: dbRecord.depositTxHash,
          withdrawTxHash: dbRecord.withdrawTxHash,
        };
      }

      throw error;
    }
  }

  /**
   * Handle webhook from Rhino.fi for status updates
   */
  async handleWebhook(payload: any): Promise<void> {
    try {
      const { quoteId, state, status, depositTxHash, withdrawTxHash } = payload;

      const bridgeStatus = state || status;
      console.log(`  Rhino webhook received: ${quoteId} -> ${bridgeStatus}`);

      await RhinoBridge.findOneAndUpdate(
        { quoteId },
        {
          status: bridgeStatus.toLowerCase(),
          ...(depositTxHash && { depositTxHash }),
          ...(withdrawTxHash && { withdrawTxHash }),
        }
      );

      // If completed, log success
      if (bridgeStatus === 'EXECUTED' || bridgeStatus === 'executed') {
        const bridge = await RhinoBridge.findOne({ quoteId });
        console.log(`  Bridge completed: ${bridge?.payAmount} ${bridge?.tokenIn} -> Solana`);
      }
    } catch (error) {
      console.error('[RhinoService] Webhook error:', error);
      throw error;
    }
  }

  /**
   * Get user's bridge history
   */
  async getUserBridges(userEmail: string, limit: number = 20): Promise<any[]> {
    return RhinoBridge.find({ userEmail })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Get pending bridges for a user
   */
  async getPendingBridges(userEmail: string): Promise<any[]> {
    return RhinoBridge.find({
      userEmail,
      status: { $in: ['pending', 'pending_confirmation', 'accepted'] },
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Get a bridge by quoteId from database
   */
  async getBridgeByQuoteId(quoteId: string): Promise<any> {
    return RhinoBridge.findOne({ quoteId }).lean();
  }
}

// Export singleton
export const rhinoService = new RhinoService();
