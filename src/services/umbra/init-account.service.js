import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { umbraWalletService } from './umbra-wallet.service.js';
/**
 * Account Initialization Service
 * Handles Umbra account initialization and funding
 */
class InitAccountService {
    /**
     * Request airdrop for a user's Umbra wallet (devnet only)
     */
    async requestAirdrop(userId, keypair) {
        try {
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            const userPubkey = await wallet.signer.getPublicKey();
            const connection = umbraClientService.getConnection();
            console.log(`💧 Requesting airdrop for: ${userPubkey.toBase58()}`);
            // Request 1 SOL airdrop
            const signature = await connection.requestAirdrop(userPubkey, 1 * LAMPORTS_PER_SOL);
            // Wait for confirmation
            await connection.confirmTransaction(signature);
            // Get new balance
            const balance = await connection.getBalance(userPubkey);
            console.log(`✅ Airdrop successful! New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
            return {
                signature,
                balance: balance / LAMPORTS_PER_SOL,
            };
        }
        catch (error) {
            console.error('❌ Airdrop failed:', error);
            throw new Error(`Airdrop failed: ${error.message}`);
        }
    }
    /**
     * Get Umbra wallet balance
     */
    async getBalance(userId, keypair) {
        try {
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            const userPubkey = await wallet.signer.getPublicKey();
            const connection = umbraClientService.getConnection();
            const balance = await connection.getBalance(userPubkey);
            return balance / LAMPORTS_PER_SOL;
        }
        catch (error) {
            console.error('❌ Failed to get balance:', error);
            throw new Error(`Failed to get balance: ${error.message}`);
        }
    }
}
export const initAccountService = new InitAccountService();
