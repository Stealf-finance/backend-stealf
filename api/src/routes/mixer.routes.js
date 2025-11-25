import express from 'express';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { simpleMixerService } from '../services/mixer/simple-mixer.service.js';
import bs58 from 'bs58';
const router = express.Router();
/**
 * POST /mixer/deposit
 *
 * Deposit SOL into the mixer pool
 *
 * Body:
 * - privateKey: Base58-encoded private key
 * - amount: Amount in SOL (will be converted to lamports)
 *
 * Returns:
 * - claimSecret: Secret to use for withdrawal (SAVE THIS!)
 * - depositTxSignature: Transaction signature
 * - poolAddress: Pool address
 * - estimatedWithdrawTime: Earliest time for withdrawal
 */
router.post('/deposit', async (req, res) => {
    try {
        const { privateKey, amount } = req.body;
        // Validation
        if (!privateKey) {
            res.status(400).json({ error: 'privateKey is required' });
            return;
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            res.status(400).json({ error: 'Valid positive amount is required' });
            return;
        }
        // Convert private key to keypair
        let userKeypair;
        try {
            const privateKeyBytes = bs58.decode(privateKey);
            userKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid private key format' });
            return;
        }
        // Convert SOL to lamports
        const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
        console.log(`📥 Deposit request: ${amount} SOL from ${userKeypair.publicKey.toBase58()}`);
        // Process deposit
        const result = await simpleMixerService.deposit({
            userKeypair,
            amount: amountLamports,
        });
        console.log(`✅ Deposit successful`);
        res.json({
            success: true,
            claimSecret: result.claimSecret,
            depositTxSignature: result.depositTxSignature,
            poolAddress: result.poolAddress,
            estimatedWithdrawTime: result.estimatedWithdrawTime,
            amountSOL: amount,
            amountLamports,
            warning: '⚠️  SAVE YOUR CLAIM SECRET! You will need it to withdraw your funds.',
        });
    }
    catch (error) {
        console.error('❌ Deposit error:', error);
        res.status(500).json({
            error: error.message || 'Failed to process deposit',
        });
    }
});
/**
 * POST /mixer/withdraw
 *
 * Withdraw SOL from the mixer pool
 *
 * Body:
 * - claimSecret: Secret from deposit
 * - destinationAddress: Solana address to receive funds
 *
 * Returns:
 * - withdrawalTxSignature: Transaction signature
 * - amount: Amount withdrawn in lamports
 * - amountSOL: Amount withdrawn in SOL
 */
router.post('/withdraw', async (req, res) => {
    try {
        const { claimSecret, destinationAddress } = req.body;
        // Validation
        if (!claimSecret) {
            res.status(400).json({ error: 'claimSecret is required' });
            return;
        }
        if (!destinationAddress) {
            res.status(400).json({ error: 'destinationAddress is required' });
            return;
        }
        console.log(`📤 Withdrawal request to ${destinationAddress}`);
        // Process withdrawal
        const result = await simpleMixerService.withdraw({
            claimSecret,
            destinationAddress,
        });
        console.log(`✅ Withdrawal successful: ${result.amountSOL} SOL`);
        res.json({
            success: true,
            withdrawalTxSignature: result.withdrawalTxSignature,
            amount: result.amount,
            amountSOL: result.amountSOL,
        });
    }
    catch (error) {
        console.error('❌ Withdrawal error:', error);
        res.status(500).json({
            error: error.message || 'Failed to process withdrawal',
        });
    }
});
/**
 * POST /mixer/status
 *
 * Check deposit status by claim secret
 *
 * Body:
 * - claimSecret: Secret from deposit
 *
 * Returns:
 * - exists: Whether deposit exists
 * - claimed: Whether already claimed
 * - amount: Deposit amount (if exists)
 * - canWithdraw: Whether can withdraw now
 * - remainingWaitTimeMs: Remaining wait time in milliseconds
 */
router.post('/status', async (req, res) => {
    try {
        const { claimSecret } = req.body;
        if (!claimSecret) {
            res.status(400).json({ error: 'claimSecret is required' });
            return;
        }
        const status = await simpleMixerService.getDepositStatus(claimSecret);
        res.json({
            success: true,
            ...status,
            remainingWaitTimeMinutes: status.remainingWaitTimeMs
                ? Math.ceil(status.remainingWaitTimeMs / 60000)
                : 0,
        });
    }
    catch (error) {
        console.error('❌ Status check error:', error);
        res.status(500).json({
            error: error.message || 'Failed to check status',
        });
    }
});
/**
 * GET /mixer/stats
 *
 * Get mixer statistics
 *
 * Returns:
 * - Pool statistics
 * - Deposit counts
 * - Total volume
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await simpleMixerService.getStats();
        res.json({
            success: true,
            ...stats,
        });
    }
    catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({
            error: error.message || 'Failed to get stats',
        });
    }
});
/**
 * POST /mixer/transfer
 *
 * One-step transfer: Public Wallet → Pool → Private Wallet
 * Combines deposit and withdraw in a single request for ease of use
 *
 * Body:
 * - publicWalletPrivateKey: Base58-encoded private key of public wallet (source)
 * - privateWalletAddress: Solana address of private wallet (destination)
 * - amount: Amount in SOL
 *
 * Returns:
 * - depositTxSignature: Deposit transaction signature
 * - withdrawalTxSignature: Withdrawal transaction signature
 * - amountSOL: Amount transferred
 */
router.post('/transfer', async (req, res) => {
    try {
        const { publicWalletPrivateKey, privateWalletAddress, amount } = req.body;
        // Validation
        if (!publicWalletPrivateKey) {
            res.status(400).json({ error: 'publicWalletPrivateKey is required' });
            return;
        }
        if (!privateWalletAddress) {
            res.status(400).json({ error: 'privateWalletAddress is required' });
            return;
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            res.status(400).json({ error: 'Valid positive amount is required' });
            return;
        }
        // Convert private key to keypair
        let userKeypair;
        try {
            const privateKeyBytes = bs58.decode(publicWalletPrivateKey);
            userKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid public wallet private key format' });
            return;
        }
        // Convert SOL to lamports
        const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
        console.log(`🔄 Private transfer: ${amount} SOL`);
        console.log(`   From (public): ${userKeypair.publicKey.toBase58()}`);
        console.log(`   To (private):  ${privateWalletAddress}`);
        // Step 1: Deposit to pool
        console.log(`   Step 1/2: Depositing to pool...`);
        const depositResult = await simpleMixerService.deposit({
            userKeypair,
            amount: amountLamports,
        });
        console.log(`   ✅ Deposited to pool: ${depositResult.depositTxSignature}`);
        // Step 2: Withdraw to private wallet
        console.log(`   Step 2/2: Withdrawing to private wallet...`);
        const withdrawResult = await simpleMixerService.withdraw({
            claimSecret: depositResult.claimSecret,
            destinationAddress: privateWalletAddress,
        });
        console.log(`   ✅ Withdrawn to private wallet: ${withdrawResult.withdrawalTxSignature}`);
        console.log(`✅ Private transfer complete!`);
        res.json({
            success: true,
            depositTxSignature: depositResult.depositTxSignature,
            withdrawalTxSignature: withdrawResult.withdrawalTxSignature,
            amountSOL: amount,
            amountLamports,
            fromAddress: userKeypair.publicKey.toBase58(),
            toAddress: privateWalletAddress,
            poolAddress: depositResult.poolAddress,
        });
    }
    catch (error) {
        console.error('❌ Transfer error:', error);
        res.status(500).json({
            error: error.message || 'Failed to process transfer',
        });
    }
});
export default router;
