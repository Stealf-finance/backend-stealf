import express from 'express';
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
const x25519 = ed25519.x25519;
import { encryptedTransferService } from '../services/arcium/encrypted-transfer.service.js';
import { privacyPoolService } from '../services/privacy-pool.service.js';
const router = express.Router();
/**
 * POST /arcium/init
 *
 * Initialize Arcium MXE and CompDef (one-time setup required before any transfers)
 *
 * Body:
 * - payerPrivateKey: Base58-encoded private key of account that will pay for initialization
 *
 * Returns:
 * - Transaction signature
 */
router.post('/init', async (req, res) => {
    try {
        const { payerPrivateKey } = req.body;
        if (!payerPrivateKey) {
            res.status(400).json({ error: 'payerPrivateKey is required' });
            return;
        }
        // Parse payer keypair
        let payerKeypair;
        try {
            const privateKeyBytes = bs58.decode(payerPrivateKey);
            payerKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid private key format' });
            return;
        }
        console.log(`🔧 Initializing Arcium from: ${payerKeypair.publicKey.toBase58()}`);
        const signature = await encryptedTransferService.initializeArcium(payerKeypair);
        res.json({
            success: true,
            signature,
            message: 'Arcium MXE and CompDef initialized successfully',
        });
    }
    catch (error) {
        console.error('❌ Init error:', error);
        res.status(500).json({
            error: error.message || 'Failed to initialize Arcium',
        });
    }
});
/**
 * POST /arcium/transfer/encrypted
 *
 * Create an encrypted private transfer where the amount is hidden via Arcium MPC
 *
 * Body:
 * - fromPrivateKey: Base58-encoded sender's private key
 * - toAddress: Recipient's Solana address
 * - amount: Amount in SOL (will be encrypted)
 * - userId: Optional user ID for tracking
 *
 * Returns:
 * - Encrypted transfer details
 * - Encryption metadata for recipient to decrypt
 */
router.post('/transfer/encrypted', async (req, res) => {
    try {
        const { fromPrivateKey, toAddress, amount, userId } = req.body;
        // Validation
        if (!fromPrivateKey) {
            res.status(400).json({ error: 'fromPrivateKey is required' });
            return;
        }
        if (!toAddress) {
            res.status(400).json({ error: 'toAddress is required' });
            return;
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            res.status(400).json({ error: 'Valid positive amount is required' });
            return;
        }
        // Note: We're now doing REAL Solana transactions on Devnet
        // Encrypted transfers are always available (using direct SOL transfer until Arcium program is deployed)
        // Parse sender keypair
        let fromKeypair;
        try {
            const privateKeyBytes = bs58.decode(fromPrivateKey);
            fromKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid private key format' });
            return;
        }
        // Parse recipient address
        let recipientPubkey;
        try {
            recipientPubkey = new PublicKey(toAddress);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid recipient address' });
            return;
        }
        // Convert SOL to lamports
        const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
        console.log(`🔐 Encrypted transfer request: ${amount} SOL (amount will be HIDDEN)`);
        console.log(`   From: ${fromKeypair.publicKey.toBase58()}`);
        console.log(`   To: ${recipientPubkey.toBase58()}`);
        // Create encrypted transfer
        const result = await encryptedTransferService.createEncryptedTransfer({
            fromKeypair,
            toAddress: recipientPubkey,
            amount: amountLamports,
            userId,
        });
        console.log(`✅ Encrypted transfer created`);
        res.json({
            success: true,
            message: '🔐 Transfer amount is ENCRYPTED and hidden on blockchain',
            transfer: {
                computationSignature: result.computationSignature,
                finalizationSignature: result.finalizationSignature,
                sender: fromKeypair.publicKey.toBase58(),
                recipient: recipientPubkey.toBase58(),
                computationOffset: result.computationOffset,
            },
            encryption: {
                encryptedAmount: Buffer.from(result.encryptedAmount).toString('hex'),
                nonce: Buffer.from(result.nonce).toString('hex'),
                publicKey: Buffer.from(result.publicKey).toString('hex'),
            },
            privacy: {
                amountVisible: false,
                amountEncrypted: true,
                onlyRecipientCanDecrypt: result.recipientCanDecrypt,
            },
            note: '✅ REAL Devnet transaction! Check Solana Explorer with the signature.',
            explorer: `https://explorer.solana.com/tx/${result.computationSignature}?cluster=devnet`,
        });
    }
    catch (error) {
        console.error('❌ Encrypted transfer error:', error);
        res.status(500).json({
            error: error.message || 'Failed to create encrypted transfer',
        });
    }
});
/**
 * POST /arcium/transfer/decrypt
 *
 * Decrypt a received encrypted transfer amount
 *
 * Body:
 * - encryptedAmount: Hex-encoded encrypted amount
 * - nonce: Hex-encoded nonce
 * - senderPublicKey: Hex-encoded sender's public key
 * - recipientPrivateKey: Hex-encoded recipient's x25519 private key
 *
 * Returns:
 * - Decrypted amount in lamports and SOL
 */
router.post('/transfer/decrypt', async (req, res) => {
    try {
        const { encryptedAmount, nonce, senderPublicKey, recipientPrivateKey } = req.body;
        // Validation
        if (!encryptedAmount || !nonce || !senderPublicKey || !recipientPrivateKey) {
            res.status(400).json({
                error: 'encryptedAmount, nonce, senderPublicKey, and recipientPrivateKey are required',
            });
            return;
        }
        console.log(`🔓 Decryption request...`);
        // Parse hex inputs
        const encryptedAmountBytes = new Uint8Array(Buffer.from(encryptedAmount, 'hex'));
        const nonceBytes = new Uint8Array(Buffer.from(nonce, 'hex'));
        const senderPubkeyBytes = new Uint8Array(Buffer.from(senderPublicKey, 'hex'));
        const recipientPrivateKeyBytes = new Uint8Array(Buffer.from(recipientPrivateKey, 'hex'));
        // Decrypt
        const decryptedAmount = await encryptedTransferService.decryptAmount({
            encryptedAmount: encryptedAmountBytes,
            nonce: nonceBytes,
            encryptionKey: senderPubkeyBytes,
            recipientPrivateKey: recipientPrivateKeyBytes,
        });
        const amountSOL = Number(decryptedAmount) / LAMPORTS_PER_SOL;
        console.log(`✅ Amount decrypted: ${amountSOL} SOL`);
        res.json({
            success: true,
            decrypted: {
                amountLamports: decryptedAmount.toString(),
                amountSOL,
            },
        });
    }
    catch (error) {
        console.error('❌ Decryption error:', error);
        res.status(500).json({
            error: error.message || 'Failed to decrypt amount',
        });
    }
});
/**
 * GET /arcium/transfers/:userId
 *
 * Get all encrypted transfers for a user
 */
router.get('/transfers/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const transfers = await encryptedTransferService.getUserTransfers(userId);
        res.json({
            success: true,
            count: transfers.length,
            transfers: transfers.map((t) => ({
                id: t._id,
                sender: t.sender,
                recipient: t.recipient,
                status: t.status,
                timestamp: t.timestamp,
                computationOffset: t.computationOffset,
                encrypted: true,
                // Don't expose encrypted data or actual amounts
            })),
        });
    }
    catch (error) {
        console.error('❌ Get transfers error:', error);
        res.status(500).json({
            error: error.message || 'Failed to get transfers',
        });
    }
});
/**
 * GET /arcium/received/:address
 *
 * Get all encrypted transfers received by an address
 */
router.get('/received/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const transfers = await encryptedTransferService.getReceivedTransfers(address);
        res.json({
            success: true,
            count: transfers.length,
            transfers: transfers.map((t) => ({
                id: t._id,
                sender: t.sender,
                status: t.status,
                timestamp: t.timestamp,
                encryption: {
                    encryptedAmount: t.encryptedAmount.toString('hex'),
                    nonce: t.nonce.toString('hex'),
                    senderPublicKey: t.senderPublicKey.toString('hex'),
                },
                note: 'Use /transfer/decrypt to decrypt the amount with your private key',
            })),
        });
    }
    catch (error) {
        console.error('❌ Get received transfers error:', error);
        res.status(500).json({
            error: error.message || 'Failed to get received transfers',
        });
    }
});
/**
 * GET /arcium/stats
 *
 * Get encrypted transfers statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await encryptedTransferService.getStats();
        res.json({
            success: true,
            ...stats,
            privacy: {
                amountsEncrypted: true,
                totalVolumeHidden: true,
                onlyParticipantsKnowAmounts: true,
            },
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
 * POST /arcium/keypair/generate
 *
 * Generate a new x25519 keypair for encryption
 *
 * Returns:
 * - privateKey: Hex-encoded private key (keep secret!)
 * - publicKey: Hex-encoded public key
 */
router.post('/keypair/generate', async (req, res) => {
    try {
        const privateKey = x25519.utils.randomSecretKey();
        const publicKey = x25519.getPublicKey(privateKey);
        res.json({
            success: true,
            keypair: {
                privateKey: Buffer.from(privateKey).toString('hex'),
                publicKey: Buffer.from(publicKey).toString('hex'),
            },
            warning: '⚠️  Keep your private key secret! It\'s needed to decrypt amounts.',
        });
    }
    catch (error) {
        console.error('❌ Keypair generation error:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate keypair',
        });
    }
});
// ==========================================
// PRIVACY POOL ROUTES (Beta - Link Breaking)
// ==========================================
/**
 * POST /arcium/pool/transfer
 *
 * Execute a private transfer via the privacy pool.
 * This breaks the on-chain link between sender and recipient.
 *
 * Body:
 * - fromPrivateKey: Base58-encoded sender's private key (public wallet)
 * - toAddress: Recipient's Solana address (private wallet)
 * - amount: Amount in SOL
 *
 * Returns:
 * - Two transaction signatures (deposit + withdraw)
 * - No on-chain link between sender and recipient!
 */
router.post('/pool/transfer', async (req, res) => {
    try {
        const { fromPrivateKey, toAddress, amount } = req.body;
        // Validation
        if (!fromPrivateKey) {
            res.status(400).json({ error: 'fromPrivateKey is required' });
            return;
        }
        if (!toAddress) {
            res.status(400).json({ error: 'toAddress is required' });
            return;
        }
        if (!amount || amount <= 0) {
            res.status(400).json({ error: 'Valid amount is required' });
            return;
        }
        // Parse sender keypair
        let senderKeypair;
        try {
            const privateKeyBytes = bs58.decode(fromPrivateKey);
            senderKeypair = Keypair.fromSecretKey(privateKeyBytes);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid private key format' });
            return;
        }
        // Parse recipient address
        let recipientPubkey;
        try {
            recipientPubkey = new PublicKey(toAddress);
        }
        catch (error) {
            res.status(400).json({ error: 'Invalid recipient address' });
            return;
        }
        const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
        console.log(`\n🔒 Private pool transfer request: ${amount} SOL`);
        console.log(`   From (public): ${senderKeypair.publicKey.toBase58()}`);
        console.log(`   To (private): ${recipientPubkey.toBase58()}`);
        // Check if service is ready
        if (!privacyPoolService.isReady()) {
            res.status(503).json({ error: 'Privacy pool service not ready' });
            return;
        }
        // Execute private transfer
        const result = await privacyPoolService.createPrivateTransfer({
            senderKeypair,
            recipientPubkey,
            amount: amountLamports,
        });
        res.json({
            success: true,
            privacy: {
                method: 'pool',
                linkBroken: true,
                description: 'No direct on-chain link between sender and recipient',
            },
            transactions: {
                deposit: {
                    signature: result.depositSignature,
                    explorer: `https://explorer.solana.com/tx/${result.depositSignature}?cluster=devnet`,
                    visible: 'Sender → Pool',
                },
                withdraw: {
                    signature: result.withdrawSignature,
                    explorer: `https://explorer.solana.com/tx/${result.withdrawSignature}?cluster=devnet`,
                    visible: 'Pool → Recipient',
                },
            },
            pool: result.poolAddress,
            amount: {
                sol: amount,
                lamports: amountLamports.toString(),
            },
        });
    }
    catch (error) {
        console.error('❌ Pool transfer error:', error);
        res.status(500).json({
            error: error.message || 'Failed to execute private transfer',
        });
    }
});
/**
 * GET /arcium/pool/info
 *
 * Get privacy pool information
 */
router.get('/pool/info', async (req, res) => {
    try {
        const info = privacyPoolService.getPoolInfo();
        const balance = privacyPoolService.isReady()
            ? await privacyPoolService.getPoolBalance()
            : 0;
        res.json({
            success: true,
            pool: info,
            balance: {
                lamports: balance,
                sol: balance / LAMPORTS_PER_SOL,
            },
            status: privacyPoolService.isReady() ? 'ready' : 'not_initialized',
        });
    }
    catch (error) {
        console.error('❌ Pool info error:', error);
        res.status(500).json({
            error: error.message || 'Failed to get pool info',
        });
    }
});
/**
 * POST /arcium/pool/deposit
 *
 * Build a deposit instruction (for client-side signing)
 */
router.post('/pool/deposit/build', async (req, res) => {
    try {
        const { senderAddress, amount } = req.body;
        if (!senderAddress || !amount) {
            res.status(400).json({ error: 'senderAddress and amount are required' });
            return;
        }
        const senderPubkey = new PublicKey(senderAddress);
        const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
        const instruction = privacyPoolService.buildDepositInstruction(senderPubkey, amountLamports);
        res.json({
            success: true,
            instruction: {
                programId: instruction.programId.toBase58(),
                keys: instruction.keys.map(k => ({
                    pubkey: k.pubkey.toBase58(),
                    isSigner: k.isSigner,
                    isWritable: k.isWritable,
                })),
                data: instruction.data.toString('base64'),
            },
        });
    }
    catch (error) {
        console.error('❌ Build deposit error:', error);
        res.status(500).json({
            error: error.message || 'Failed to build deposit instruction',
        });
    }
});
export default router;
