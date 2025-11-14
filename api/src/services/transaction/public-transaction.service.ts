import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { solanaWalletService } from '../wallet/solana-wallet.service.js';

// Devnet RPC endpoint
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

export interface PublicTransactionRequest {
  fromUserId: string;
  toAddress: string;
  amount: number; // Amount in SOL
}

export interface PublicTransactionResponse {
  success: boolean;
  signature?: string;
  message?: string;
  error?: string;
}

class PublicTransactionService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  }

  /**
   * Send a public transaction on Solana devnet
   */
  async sendPublicTransaction(
    request: PublicTransactionRequest
  ): Promise<PublicTransactionResponse> {
    try {
      const { fromUserId, toAddress, amount } = request;

      // Validate inputs
      if (!fromUserId || !toAddress || !amount || amount <= 0) {
        return {
          success: false,
          error: 'Invalid transaction parameters',
        };
      }

      // Get sender's wallet
      const senderKeypair = await solanaWalletService.getWallet(fromUserId);
      if (!senderKeypair) {
        return {
          success: false,
          error: 'Sender wallet not found',
        };
      }

      // Validate recipient address
      let recipientPubkey: PublicKey;
      try {
        recipientPubkey = new PublicKey(toAddress);
      } catch (error) {
        return {
          success: false,
          error: 'Invalid recipient address',
        };
      }

      // Check sender balance
      const senderBalance = await this.connection.getBalance(senderKeypair.publicKey);
      const lamportsToSend = amount * LAMPORTS_PER_SOL;

      if (senderBalance < lamportsToSend) {
        return {
          success: false,
          error: `Insufficient balance. Available: ${(senderBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
        };
      }

      // Create transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports: lamportsToSend,
        })
      );

      // Send and confirm transaction
      console.log(`📤 Sending ${amount} SOL from ${senderKeypair.publicKey.toString()} to ${toAddress}`);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [senderKeypair],
        {
          commitment: 'confirmed',
        }
      );

      console.log(`✅ Transaction successful! Signature: ${signature}`);

      return {
        success: true,
        signature,
        message: `Successfully sent ${amount} SOL`,
      };
    } catch (error: any) {
      console.error('❌ Transaction error:', error);
      return {
        success: false,
        error: error.message || 'Transaction failed',
      };
    }
  }

  /**
   * Get transaction status by signature
   */
  async getTransactionStatus(signature: string): Promise<any> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return status;
    } catch (error) {
      console.error('Error getting transaction status:', error);
      throw error;
    }
  }
}

export const publicTransactionService = new PublicTransactionService();
