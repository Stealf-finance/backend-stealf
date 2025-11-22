import { PublicKey } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { umbraWalletService } from './umbra-wallet.service.js';
import { indexerService } from './indexer.service.js';
import { Transaction } from '../../models/Transaction.js';
import { DepositArtifacts } from '../../models/DepositArtifacts.js';
/**
 * Claim Service
 * Handles claiming/withdrawing deposits from Umbra mixer
 */
class ClaimService {
    /**
     * Claim a deposit using zero-knowledge proof
     */
    async claimDeposit(params) {
        const { userId, keypair, depositArtifactsId, recipientAddress } = params;
        try {
            // Get deposit artifacts
            const depositArtifacts = await DepositArtifacts.findById(depositArtifactsId);
            if (!depositArtifacts) {
                throw new Error(`Deposit artifacts not found: ${depositArtifactsId}`);
            }
            if (depositArtifacts.userId.toString() !== userId) {
                throw new Error('Unauthorized: Deposit does not belong to this user');
            }
            if (depositArtifacts.claimed) {
                throw new Error('Deposit already claimed');
            }
            // Get Umbra client and wallet
            const client = umbraClientService.getClient();
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            // Attach wallet to client
            client.setUmbraWallet(wallet);
            console.log(`🎁 Claiming deposit ${depositArtifactsId} for user ${userId}...`);
            // Determine recipient (default to user's own address)
            const recipient = recipientAddress
                ? new PublicKey(recipientAddress)
                : await wallet.signer.getPublicKey();
            // Fetch Merkle siblings from indexer
            console.log('📊 Fetching Merkle siblings...');
            const commitmentIndex = depositArtifacts.commitmentInsertionIndex || 0;
            const merkleSiblings = await indexerService.getMerkleSiblings(commitmentIndex);
            console.log(`✅ Got ${merkleSiblings.length} Merkle siblings`);
            // Check if nullifier has been used
            if (depositArtifacts.nullifierHash) {
                const isUsed = await indexerService.isNullifierUsed(depositArtifacts.nullifierHash);
                if (isUsed) {
                    throw new Error('Nullifier already used - deposit may have been claimed already');
                }
            }
            // Claim the deposit with ZK proof
            const result = await client.claimDepositFromMixerPool(BigInt(depositArtifacts.generationIndex), BigInt(depositArtifacts.time), recipient, depositArtifacts.mint, new PublicKey(depositArtifacts.relayerPublicKey), {
                mode: 'connection',
            });
            console.log('✅ Claim successful:', result);
            // Create claim transaction record
            const claimTransaction = await Transaction.create({
                userId,
                type: 'claim',
                status: 'confirmed',
                signature: result,
                mint: depositArtifacts.mint,
                amount: depositArtifacts.claimableBalance,
                generationIndex: depositArtifacts.generationIndex,
                metadata: {
                    depositArtifactsId: depositArtifacts._id.toString(),
                    recipientAddress: recipient.toString(),
                }
            });
            // Mark deposit as claimed
            depositArtifacts.claimed = true;
            depositArtifacts.claimedAt = new Date();
            depositArtifacts.claimTransactionId = claimTransaction._id;
            await depositArtifacts.save();
            console.log(`✅ Deposit marked as claimed: ${depositArtifactsId}`);
            return {
                success: true,
                signature: result,
                amount: depositArtifacts.claimableBalance,
                transactionId: claimTransaction._id.toString(),
            };
        }
        catch (error) {
            console.error('❌ Claim failed:', error);
            // Save failed claim attempt
            await Transaction.create({
                userId,
                type: 'claim',
                status: 'failed',
                metadata: {
                    depositArtifactsId,
                    error: error.message,
                }
            });
            throw new Error(`Claim failed: ${error.message}`);
        }
    }
    /**
     * Get all claimed deposits for a user
     */
    async getClaimedDeposits(userId) {
        const deposits = await DepositArtifacts.find({
            userId,
            claimed: true
        })
            .sort({ claimedAt: -1 })
            .populate('claimTransactionId');
        return deposits;
    }
    /**
     * Get claim history for a user
     */
    async getClaimHistory(userId) {
        const claims = await Transaction.find({
            userId,
            type: 'claim'
        }).sort({ createdAt: -1 });
        return claims;
    }
}
// Export singleton instance
export const claimService = new ClaimService();
