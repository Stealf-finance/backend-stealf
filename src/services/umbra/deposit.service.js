import { PublicKey } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { umbraWalletService } from './umbra-wallet.service.js';
import { Transaction } from '../../models/Transaction.js';
import { DepositArtifacts } from '../../models/DepositArtifacts.js';
import { WSOL_MINT_ADDRESS } from '../../lib/umbra-sdk/dist/index.mjs';
/**
 * Deposit Service
 * Handles public and confidential deposits into Umbra mixer
 *
 * NOTE: Users must have their Arcium encrypted user account initialized before depositing.
 * This requires an initial transaction to set up the account on-chain.
 * In devnet, users can request SOL from the faucet to initialize their account.
 */
class DepositService {
    /**
     * Deposit with public amount (visible on-chain)
     */
    async depositPublic(params) {
        const { userId, keypair, amount, mint = WSOL_MINT_ADDRESS.toString(), generationIndex } = params;
        try {
            // Register account for anonymity (handles both Arcium account init + Master Viewing Key registration)
            // This MUST be called before any deposit operation
            console.log('🔐 Registering account for anonymity (Arcium + MVK)...');
            const ZERO_SHA3_HASH = new Uint8Array(32);
            try {
                const client = umbraClientService.getClient();
                const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
                client.setUmbraWallet(wallet);
                await client.registerAccountForAnonymity(ZERO_SHA3_HASH, { mode: 'connection' });
                console.log('✅ Account registered for anonymity successfully');
            }
            catch (error) {
                // If already registered, continue
                if (error.message?.includes('already') || error.message?.includes('registered')) {
                    console.log('✅ Account already registered for anonymity');
                }
                else {
                    throw error;
                }
            }
            // Get Umbra client and wallet
            const client = umbraClientService.getClient();
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            // DEBUG: Inspect raw account data to see status byte
            const connection = umbraClientService.getConnection();
            const userPubkeyForDebug = await wallet.signer.getPublicKey();
            const UMBRA_PROGRAM_ID = new PublicKey('A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4');
            const [encryptedUserAccountPda] = PublicKey.findProgramAddressSync([
                Buffer.from('arcium_encrypted_user_account', 'utf8'),
                userPubkeyForDebug.toBuffer()
            ], UMBRA_PROGRAM_ID);
            const accountInfo = await connection.getAccountInfo(encryptedUserAccountPda);
            if (accountInfo) {
                console.log('🔍 DEBUG: Raw account data inspection:');
                console.log(`   - PDA: ${encryptedUserAccountPda.toBase58()}`);
                console.log(`   - Owner: ${accountInfo.owner.toBase58()}`);
                console.log(`   - Data length: ${accountInfo.data.length} bytes`);
                console.log(`   - First 100 bytes (hex):`, accountInfo.data.slice(0, 100).toString('hex'));
                // Try to parse status byte (usually at offset 8 for Anchor discriminator)
                const discriminator = accountInfo.data.slice(0, 8);
                console.log(`   - Discriminator (8 bytes):`, discriminator.toString('hex'));
                // Status byte might be after discriminator
                const statusByte = accountInfo.data[8];
                console.log(`   - Status byte at offset 8: ${statusByte} (binary: ${statusByte.toString(2).padStart(8, '0')})`);
                console.log(`   - Bit 0 (IS_INITIALISED): ${(statusByte & 1) !== 0 ? 'SET' : 'NOT SET'}`);
                console.log(`   - Bit 2 (HAS_REGISTERED_MVK): ${(statusByte & 4) !== 0 ? 'SET' : 'NOT SET'}`);
                console.log(`   - Bit 3 (IS_ACTIVE): ${(statusByte & 8) !== 0 ? 'SET' : 'NOT SET'}`);
            }
            else {
                console.log('⚠️  DEBUG: Account does not exist at PDA:', encryptedUserAccountPda.toBase58());
            }
            // Attach wallet to client
            client.setUmbraWallet(wallet);
            console.log(`💰 Depositing ${amount} lamports (public mode) for user ${userId}...`);
            console.log(`🪙 Mint: ${mint}`);
            // Use WSOL_MINT_ADDRESS constant directly from SDK for proper comparison
            // The SDK compares with === so we need to use the exact same instance
            const mintAddress = mint === WSOL_MINT_ADDRESS.toString()
                ? WSOL_MINT_ADDRESS
                : new PublicKey(mint);
            console.log(`🔍 Using mint address:`, mintAddress.toBase58());
            console.log(`🔍 Is WSOL?`, mintAddress === WSOL_MINT_ADDRESS);
            // Use userPubkeyForDebug (already declared above for debug logging)
            console.log(`👤 User public key (will be used as relayer):`, userPubkeyForDebug.toBase58());
            // Perform deposit with explicit relayer (use own address to avoid external relayer fetch)
            const result = await client.depositPubliclyIntoMixerPool(amount, // Cast to Amount type
            userPubkeyForDebug, mintAddress, // Pass the exact WSOL_MINT_ADDRESS instance or new PublicKey
            {
                mode: 'connection',
                generationIndex: generationIndex,
                relayerPublicKey: userPubkeyForDebug, // Use own address as relayer to avoid fetching random relayer
            });
            console.log('✅ Deposit successful:', result.txReturnedData);
            // Calculate time for linker hash
            const time = BigInt(Math.floor(Date.now() / 1000));
            // Create transaction record
            const transaction = await Transaction.create({
                userId,
                type: 'deposit',
                status: 'confirmed',
                signature: result.txReturnedData,
                mint,
                amount: amount.toString(),
                claimableBalance: result.claimableBalance.toString(),
                generationIndex: result.generationIndex.toString(),
                relayerPublicKey: result.relayerPublicKey.toString(),
                metadata: {
                    time: Number(time),
                    mode: 'connection',
                }
            });
            // Create deposit artifacts for later claiming
            const depositArtifacts = await DepositArtifacts.create({
                userId,
                transactionId: transaction._id,
                generationIndex: result.generationIndex.toString(),
                relayerPublicKey: result.relayerPublicKey.toString(),
                claimableBalance: result.claimableBalance.toString(),
                time: Number(time),
                mint,
                depositType: 'public',
                claimed: false,
            });
            console.log(`📦 Deposit artifacts saved: ${depositArtifacts._id}`);
            return {
                success: true,
                generationIndex: result.generationIndex.toString(),
                claimableBalance: result.claimableBalance.toString(),
                signature: result.txReturnedData,
                transactionId: transaction._id.toString(),
                depositArtifactsId: depositArtifacts._id.toString(),
            };
        }
        catch (error) {
            console.error('❌ Deposit failed:', error);
            // Save failed transaction
            await Transaction.create({
                userId,
                type: 'deposit',
                status: 'failed',
                mint,
                amount: amount.toString(),
                metadata: {
                    error: error.message,
                }
            });
            throw new Error(`Deposit failed: ${error.message}`);
        }
    }
    /**
     * Deposit with confidential amount (hidden on-chain)
     */
    async depositConfidential(params) {
        const { userId, keypair, amount, mint = WSOL_MINT_ADDRESS.toString(), relayerPublicKey } = params;
        try {
            // Get Umbra client and wallet
            const client = umbraClientService.getClient();
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            // Attach wallet to client
            client.setUmbraWallet(wallet);
            console.log(`🔒 Depositing ${amount} lamports (confidential mode) for user ${userId}...`);
            // Determine relayer public key
            const relayer = relayerPublicKey
                ? new PublicKey(relayerPublicKey)
                : await wallet.signer.getPublicKey(); // Use own address as relayer
            // Perform confidential deposit
            const result = await client.depositConfidentiallyIntoMixerPool(amount, await wallet.signer.getPublicKey(), mint, relayer, {
                mode: 'forwarder', // Use relayer for gasless transaction
            });
            console.log('✅ Confidential deposit successful');
            // Calculate time
            const time = BigInt(Math.floor(Date.now() / 1000));
            // Create transaction record
            const transaction = await Transaction.create({
                userId,
                type: 'deposit',
                status: 'pending',
                mint,
                amount: amount.toString(),
                claimableBalance: result.claimableBalance.toString(),
                generationIndex: result.generationIndex.toString(),
                relayerPublicKey: result.relayerPublicKey.toString(),
                metadata: {
                    time: Number(time),
                    mode: 'forwarder',
                }
            });
            // Create deposit artifacts
            const depositArtifacts = await DepositArtifacts.create({
                userId,
                transactionId: transaction._id,
                generationIndex: result.generationIndex.toString(),
                relayerPublicKey: result.relayerPublicKey.toString(),
                claimableBalance: result.claimableBalance.toString(),
                time: Number(time),
                mint,
                depositType: 'confidential',
                claimed: false,
            });
            console.log(`📦 Confidential deposit artifacts saved: ${depositArtifacts._id}`);
            return {
                success: true,
                generationIndex: result.generationIndex.toString(),
                claimableBalance: result.claimableBalance.toString(),
                transactionId: transaction._id.toString(),
                depositArtifactsId: depositArtifacts._id.toString(),
            };
        }
        catch (error) {
            console.error('❌ Confidential deposit failed:', error);
            await Transaction.create({
                userId,
                type: 'deposit',
                status: 'failed',
                mint,
                amount: amount.toString(),
                metadata: {
                    error: error.message,
                }
            });
            throw new Error(`Confidential deposit failed: ${error.message}`);
        }
    }
    /**
     * Get all claimable deposits for a user
     */
    async getClaimableDeposits(userId) {
        const deposits = await DepositArtifacts.find({
            userId,
            claimed: false
        }).sort({ createdAt: -1 });
        return deposits;
    }
}
// Export singleton instance
export const depositService = new DepositService();
