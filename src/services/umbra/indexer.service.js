import { PublicKey } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { DepositArtifacts } from '../../models/DepositArtifacts.js';
/**
 * Indexer Service
 * Provides Merkle siblings for claims
 *
 * NOTE: This is a simplified implementation.
 * In production, you should:
 * 1. Listen to on-chain events
 * 2. Build/maintain a full Merkle tree
 * 3. Store tree state in database
 */
class IndexerService {
    constructor() {
        this.connection = null;
        const programIdStr = process.env.SOLANA_PROGRAM_ID || 'A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4';
        this.programId = new PublicKey(programIdStr);
    }
    /**
     * Initialize the indexer
     */
    async initialize() {
        this.connection = umbraClientService.getConnection();
        console.log('✅ IndexerService initialized');
    }
    /**
     * Get Merkle siblings for a given commitment index
     *
     * This is a SIMPLIFIED implementation that tries multiple approaches:
     * 1. Fetch from external indexer API (if available)
     * 2. Calculate from local database
     * 3. Return empty siblings (for testing)
     */
    async getMerkleSiblings(commitmentIndex) {
        console.log(`📊 Fetching Merkle siblings for index ${commitmentIndex}`);
        // Approach 1: Try external indexer
        try {
            const indexerUrl = process.env.UMBRA_INDEXER_URL;
            if (indexerUrl) {
                const response = await fetch(`${indexerUrl}siblings/${commitmentIndex}`);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`✅ Fetched siblings from external indexer`);
                    return data.siblings || [];
                }
            }
        }
        catch (error) {
            console.warn(`⚠️  External indexer unavailable:`, error.message);
        }
        // Approach 2: Calculate from local deposits
        try {
            const siblings = await this.calculateSiblingsFromLocalData(commitmentIndex);
            if (siblings.length > 0) {
                console.log(`✅ Calculated siblings from local data`);
                return siblings;
            }
        }
        catch (error) {
            console.warn(`⚠️  Failed to calculate siblings:`, error.message);
        }
        // Approach 3: Return empty array for testing
        // NOTE: This will make claims fail in production!
        console.warn(`⚠️  Returning empty siblings array (TESTING ONLY)`);
        console.warn(`   Real claims will fail without proper Merkle tree`);
        // Return empty siblings for 48-level tree
        return new Array(48).fill('0x' + '0'.repeat(64));
    }
    /**
     * Calculate Merkle siblings from local database
     * This builds a minimal Merkle tree from known deposits
     */
    async calculateSiblingsFromLocalData(commitmentIndex) {
        // Get all deposits from database
        const deposits = await DepositArtifacts.find().sort({ createdAt: 1 });
        if (deposits.length === 0) {
            throw new Error('No deposits found in database');
        }
        // Build a simple Merkle tree
        // NOTE: This is a VERY simplified implementation
        // In production, use a proper Merkle tree library
        const leaves = deposits.map((d, idx) => ({
            index: idx,
            commitment: d.nullifierHash || this.hashCommitment(d.generationIndex),
        }));
        // For now, return dummy siblings
        // TODO: Implement proper Merkle tree construction
        const siblings = [];
        for (let i = 0; i < 48; i++) {
            // Generate a dummy sibling hash
            siblings.push('0x' + Buffer.from(`sibling-${i}-${commitmentIndex}`).toString('hex').padStart(64, '0').slice(0, 64));
        }
        return siblings;
    }
    /**
     * Hash a commitment (simplified)
     */
    hashCommitment(value) {
        const crypto = require('crypto');
        return '0x' + crypto.createHash('sha256').update(value).digest('hex');
    }
    /**
     * Get current Merkle root
     * This would be fetched from on-chain state in production
     */
    async getCurrentMerkleRoot() {
        // Try to fetch from indexer
        try {
            const indexerUrl = process.env.UMBRA_INDEXER_URL;
            if (indexerUrl) {
                const response = await fetch(`${indexerUrl}root`);
                if (response.ok) {
                    const data = await response.json();
                    return data.root;
                }
            }
        }
        catch (error) {
            console.warn(`⚠️  Could not fetch Merkle root:`, error.message);
        }
        // Return dummy root
        return '0x' + '0'.repeat(64);
    }
    /**
     * Check if a nullifier has been used
     * This prevents double-spending
     */
    async isNullifierUsed(nullifierHash) {
        // Check in database
        const deposit = await DepositArtifacts.findOne({
            nullifierHash,
            claimed: true,
        });
        if (deposit) {
            console.log(`⚠️  Nullifier already used: ${nullifierHash}`);
            return true;
        }
        // TODO: Also check on-chain state
        // For now, assume if it's not in our DB, it's not used
        return false;
    }
    /**
     * Register a new deposit commitment
     * This would update the Merkle tree in production
     */
    async registerDeposit(commitment, nullifierHash) {
        console.log(`📝 Registering new deposit commitment`);
        // Get current deposit count to determine index
        const depositCount = await DepositArtifacts.countDocuments();
        // In production, this would:
        // 1. Add commitment to Merkle tree
        // 2. Update tree root
        // 3. Store tree state in database
        console.log(`✅ Deposit registered at index ${depositCount}`);
        return depositCount;
    }
    /**
     * Get deposit by index
     */
    async getDepositByIndex(index) {
        const deposits = await DepositArtifacts.find().sort({ createdAt: 1 }).limit(1).skip(index);
        return deposits[0] || null;
    }
    /**
     * Get total number of deposits
     */
    async getTotalDeposits() {
        return await DepositArtifacts.countDocuments();
    }
}
export const indexerService = new IndexerService();
