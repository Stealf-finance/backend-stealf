import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { randomBytes, createHash } from 'crypto';
import { poolManagerService } from './pool-manager.service.js';
import { MixerDeposit } from '../../models/mixer-deposit.model.js';
import { MIXER_CONFIG } from '../../config/mixer.config.js';
/**
 * Simple Mixer Service
 *
 * Provides privacy-focused transaction mixing without ZK proofs.
 *
 * Privacy Features:
 * 1. Sender/receiver decoupling - deposits go to pool, withdrawals come from pool
 * 2. Cryptographic claim secrets - no user ID linking
 * 3. Random time delays - breaks temporal analysis
 * 4. Pool mixing - all funds in single address
 *
 * Security Model:
 * - User provides claim secret to withdraw (not stored in DB)
 * - Only hash of claim secret is stored
 * - Minimum delays enforced to prevent immediate correlation
 * - Pool reserves maintained for liquidity
 */
class SimpleMixerService {
    constructor() {
        this.connection = null;
    }
    /**
     * Initialize mixer service
     */
    async initialize(connection) {
        this.connection = connection;
        poolManagerService.initialize(connection);
        console.log('🌀 Simple Mixer Service initialized');
        const stats = await poolManagerService.getPoolStats();
        console.log(`   Pool Address: ${stats.address}`);
        console.log(`   Pool Balance: ${stats.totalBalanceSOL.toFixed(4)} SOL`);
        console.log(`   Available Liquidity: ${stats.availableLiquiditySOL.toFixed(4)} SOL`);
    }
    /**
     * Deposit SOL into the mixer pool
     *
     * @param userKeypair - User's keypair for signing the deposit transaction
     * @param amount - Amount in lamports to deposit
     * @returns Claim secret (user must save this to withdraw later)
     */
    async deposit(params) {
        const { userKeypair, amount, mint = 'So11111111111111111111111111111111111111112' } = params;
        // Validate amount
        if (amount < MIXER_CONFIG.MIN_DEPOSIT_AMOUNT) {
            throw new Error(`Deposit amount must be at least ${MIXER_CONFIG.MIN_DEPOSIT_AMOUNT / LAMPORTS_PER_SOL} SOL`);
        }
        if (amount > MIXER_CONFIG.MAX_DEPOSIT_AMOUNT) {
            throw new Error(`Deposit amount cannot exceed ${MIXER_CONFIG.MAX_DEPOSIT_AMOUNT / LAMPORTS_PER_SOL} SOL`);
        }
        // Check if standardized pools are enabled
        if (MIXER_CONFIG.ENABLE_STANDARDIZED_POOLS) {
            const isStandardAmount = MIXER_CONFIG.STANDARD_POOL_SIZES.includes(amount);
            if (!isStandardAmount) {
                throw new Error(`Standardized pools enabled. Amount must be one of: ${MIXER_CONFIG.STANDARD_POOL_SIZES.map(a => a / LAMPORTS_PER_SOL).join(', ')} SOL`);
            }
        }
        console.log(`💰 Processing deposit: ${amount / LAMPORTS_PER_SOL} SOL`);
        // Generate claim secret (32 random bytes)
        const claimSecret = this.generateClaimSecret();
        const claimHash = this.hashClaimSecret(claimSecret);
        console.log(`🔑 Generated claim secret hash: ${claimHash.substring(0, 16)}...`);
        // Check for duplicate claim hash (extremely unlikely but good practice)
        const existing = await MixerDeposit.findOne({ claimHash });
        if (existing) {
            throw new Error('Claim secret collision detected. Please try again.');
        }
        // Create deposit transaction (user → pool)
        const poolAddress = poolManagerService.getPoolAddress();
        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: poolAddress,
            lamports: amount,
        }));
        console.log(`📤 Sending ${amount / LAMPORTS_PER_SOL} SOL to pool: ${poolAddress.toBase58()}`);
        // Send and confirm transaction
        const signature = await sendAndConfirmTransaction(this.connection, transaction, [userKeypair], { commitment: 'confirmed' });
        console.log(`✅ Deposit transaction confirmed: ${signature}`);
        // Save deposit record
        const depositRecord = await MixerDeposit.create({
            claimHash,
            amount,
            mint,
            depositedAt: new Date(),
            claimed: false,
            depositTxSignature: signature,
            poolSize: MIXER_CONFIG.ENABLE_STANDARDIZED_POOLS ? (amount / LAMPORTS_PER_SOL).toString() : undefined,
        });
        console.log(`💾 Deposit record saved: ${depositRecord._id}`);
        // Calculate estimated withdraw time (minimum delay)
        const estimatedWithdrawTime = new Date(Date.now() + MIXER_CONFIG.MIN_WITHDRAWAL_DELAY);
        return {
            claimSecret,
            depositTxSignature: signature,
            poolAddress: poolAddress.toBase58(),
            estimatedWithdrawTime,
        };
    }
    /**
     * Withdraw SOL from the mixer pool
     *
     * @param claimSecret - Secret provided during deposit
     * @param destinationAddress - Address to receive the funds
     * @returns Withdrawal transaction signature
     */
    async withdraw(params) {
        const { claimSecret, destinationAddress } = params;
        console.log(`🔍 Processing withdrawal request to ${destinationAddress}`);
        // Hash the provided claim secret
        const claimHash = this.hashClaimSecret(claimSecret);
        // Find deposit by claim hash
        const deposit = await MixerDeposit.findOne({ claimHash, claimed: false });
        if (!deposit) {
            throw new Error('Invalid claim secret or deposit already claimed');
        }
        console.log(`✅ Found unclaimed deposit: ${deposit.amount / LAMPORTS_PER_SOL} SOL`);
        // Check minimum time delay
        const now = Date.now();
        const depositTime = deposit.depositedAt.getTime();
        const elapsedTime = now - depositTime;
        const minDelay = MIXER_CONFIG.MIN_WITHDRAWAL_DELAY;
        if (elapsedTime < minDelay) {
            const remainingTime = minDelay - elapsedTime;
            const remainingMinutes = Math.ceil(remainingTime / 60000);
            throw new Error(`Please wait ${remainingMinutes} more minutes before withdrawing (privacy delay)`);
        }
        // Add random delay for additional privacy
        const randomDelay = Math.random() * MIXER_CONFIG.MAX_RANDOM_DELAY;
        if (randomDelay > 1000) {
            console.log(`⏱️  Applying random delay: ${Math.ceil(randomDelay / 1000)}s for privacy`);
            await this.sleep(randomDelay);
        }
        // Check pool liquidity
        const hasLiquidity = await poolManagerService.hasLiquidity(deposit.amount);
        if (!hasLiquidity) {
            throw new Error('Insufficient pool liquidity. Please try again later.');
        }
        console.log(`📤 Withdrawing ${deposit.amount / LAMPORTS_PER_SOL} SOL from pool`);
        // Create withdrawal transaction (pool → destination)
        const poolKeypair = poolManagerService.getPoolKeypair();
        const destination = new PublicKey(destinationAddress);
        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey: poolKeypair.publicKey,
            toPubkey: destination,
            lamports: deposit.amount,
        }));
        // Send and confirm transaction
        const signature = await sendAndConfirmTransaction(this.connection, transaction, [poolKeypair], { commitment: 'confirmed' });
        console.log(`✅ Withdrawal transaction confirmed: ${signature}`);
        // Mark deposit as claimed
        deposit.claimed = true;
        deposit.claimedAt = new Date();
        deposit.destinationAddress = destinationAddress;
        deposit.withdrawalTxSignature = signature;
        await deposit.save();
        console.log(`💾 Deposit marked as claimed`);
        return {
            withdrawalTxSignature: signature,
            amount: deposit.amount,
            amountSOL: deposit.amount / LAMPORTS_PER_SOL,
        };
    }
    /**
     * Get mixer statistics
     */
    async getStats() {
        const poolStats = await poolManagerService.getPoolStats();
        const [totalDeposits, unclaimedDeposits, volumeResult] = await Promise.all([
            MixerDeposit.countDocuments(),
            MixerDeposit.countDocuments({ claimed: false }),
            MixerDeposit.aggregate([
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ])
        ]);
        const totalVolume = volumeResult[0]?.total || 0;
        return {
            poolStats,
            totalDeposits,
            unclaimedDeposits,
            claimedDeposits: totalDeposits - unclaimedDeposits,
            totalVolumeSOL: totalVolume / LAMPORTS_PER_SOL,
        };
    }
    /**
     * Get deposit status by claim secret
     */
    async getDepositStatus(claimSecret) {
        const claimHash = this.hashClaimSecret(claimSecret);
        const deposit = await MixerDeposit.findOne({ claimHash });
        if (!deposit) {
            return { exists: false, claimed: false };
        }
        const now = Date.now();
        const depositTime = deposit.depositedAt.getTime();
        const elapsedTime = now - depositTime;
        const minDelay = MIXER_CONFIG.MIN_WITHDRAWAL_DELAY;
        const canWithdraw = elapsedTime >= minDelay && !deposit.claimed;
        const remainingWaitTimeMs = deposit.claimed ? 0 : Math.max(0, minDelay - elapsedTime);
        return {
            exists: true,
            claimed: deposit.claimed,
            amount: deposit.amount,
            amountSOL: deposit.amount / LAMPORTS_PER_SOL,
            depositedAt: deposit.depositedAt,
            canWithdraw,
            remainingWaitTimeMs,
        };
    }
    /**
     * Generate a cryptographically secure claim secret
     */
    generateClaimSecret() {
        // Generate 32 random bytes and encode as base64
        const secret = randomBytes(32).toString('base64');
        return secret;
    }
    /**
     * Hash a claim secret using SHA-256
     */
    hashClaimSecret(secret) {
        return createHash('sha256').update(secret).digest('hex');
    }
    /**
     * Sleep for specified milliseconds (for privacy delays)
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Check if mixer is initialized
     */
    isInitialized() {
        return this.connection !== null && poolManagerService.isInitialized();
    }
}
// Export singleton instance
export const simpleMixerService = new SimpleMixerService();
