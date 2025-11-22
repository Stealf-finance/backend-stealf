import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction as SolanaTransaction } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { umbraWalletService } from './umbra-wallet.service.js';
import { solanaWalletService } from '../wallet/solana-wallet.service.js';
import { Transaction } from '../../models/Transaction.js';
import { DepositArtifacts } from '../../models/DepositArtifacts.js';

interface SimplePrivateTransferParams {
  userId: string;
  amount: bigint;
  fromKeypair: Keypair; // Grid wallet keypair (public)
  toKeypair: Keypair;   // Umbra wallet keypair (private)
}

interface SimplePrivateTransferResult {
  success: boolean;
  signature: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  transactionId: string;
  depositArtifactsId: string;
}

/**
 * Simple Private Transfer Service
 *
 * This is a simplified implementation that transfers SOL from the public Grid wallet
 * to the private Umbra wallet without using the full Umbra mixer protocol.
 *
 * This is a temporary solution until we can properly initialize Arcium accounts.
 */
class SimplePrivateTransferService {
  /**
   * Transfer SOL from public wallet to private Umbra wallet
   */
  async transferToPrivateWallet(params: SimplePrivateTransferParams): Promise<SimplePrivateTransferResult> {
    const { userId, amount, fromKeypair, toKeypair } = params;

    try {
      console.log(`🔒 Simple private transfer: ${amount} lamports`);
      console.log(`📤 From (Grid wallet): ${fromKeypair.publicKey.toBase58()}`);

      // Get Umbra wallet to get the private address
      const umbraWallet = await umbraWalletService.getOrCreateWallet(userId, toKeypair);
      const toAddress = await umbraWallet.signer.getPublicKey();

      console.log(`📥 To (Umbra wallet): ${toAddress.toBase58()}`);

      // Get connection
      const connection = umbraClientService.getConnection();

      // Create simple SOL transfer transaction
      const transaction = new SolanaTransaction();

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: toAddress,
          lamports: Number(amount),
        })
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromKeypair.publicKey;

      // Sign with from keypair (Grid wallet)
      transaction.sign(fromKeypair);

      console.log(`📡 Sending transaction...`);

      // Send and confirm transaction
      const signature = await connection.sendRawTransaction(transaction.serialize());

      console.log(`⏳ Waiting for confirmation... Signature: ${signature}`);

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      console.log(`✅ Transfer confirmed!`);

      // Calculate time for record
      const time = BigInt(Math.floor(Date.now() / 1000));

      // Create transaction record
      const txRecord = await Transaction.create({
        userId,
        type: 'deposit',
        status: 'confirmed',
        signature,
        mint: 'So11111111111111111111111111111111111111112', // SOL mint
        amount: amount.toString(),
        claimableBalance: amount.toString(),
        generationIndex: time.toString(), // Use timestamp as pseudo generation index
        relayerPublicKey: toAddress.toString(),
        metadata: {
          time: Number(time),
          mode: 'simple-private-transfer',
          fromAddress: fromKeypair.publicKey.toBase58(),
          toAddress: toAddress.toBase58(),
          note: 'Simplified private transfer (not using full Umbra mixer)',
        }
      });

      // Create deposit artifacts for later claiming
      const depositArtifacts = await DepositArtifacts.create({
        userId,
        transactionId: txRecord._id,
        generationIndex: time.toString(),
        relayerPublicKey: toAddress.toString(),
        claimableBalance: amount.toString(),
        time: Number(time),
        mint: 'So11111111111111111111111111111111111111112',
        depositType: 'simple-private',
        claimed: false,
        metadata: {
          fromAddress: fromKeypair.publicKey.toBase58(),
          toAddress: toAddress.toBase58(),
        }
      });

      console.log(`📦 Deposit artifacts saved: ${depositArtifacts._id}`);

      return {
        success: true,
        signature,
        fromAddress: fromKeypair.publicKey.toBase58(),
        toAddress: toAddress.toBase58(),
        amount: amount.toString(),
        transactionId: txRecord._id.toString(),
        depositArtifactsId: depositArtifacts._id.toString(),
      };
    } catch (error: any) {
      console.error('❌ Simple private transfer failed:', error);

      // Save failed transaction
      await Transaction.create({
        userId,
        type: 'deposit',
        status: 'failed',
        mint: 'So11111111111111111111111111111111111111112',
        amount: amount.toString(),
        metadata: {
          error: error.message,
          mode: 'simple-private-transfer',
        }
      });

      throw new Error(`Simple private transfer failed: ${error.message}`);
    }
  }

  /**
   * Get private wallet balance
   */
  async getPrivateWalletBalance(userId: string, keypair: Keypair): Promise<number> {
    try {
      const umbraWallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
      const address = await umbraWallet.signer.getPublicKey();
      const connection = umbraClientService.getConnection();

      const balance = await connection.getBalance(address);
      return balance / LAMPORTS_PER_SOL;
    } catch (error: any) {
      console.error('❌ Failed to get private wallet balance:', error);
      throw new Error(`Failed to get private wallet balance: ${error.message}`);
    }
  }
}

export const simplePrivateTransferService = new SimplePrivateTransferService();
