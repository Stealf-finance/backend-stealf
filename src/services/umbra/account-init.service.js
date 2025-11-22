import { VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';
import { umbraClientService } from './umbra-client.service.js';
import { umbraWalletService } from './umbra-wallet.service.js';
import { AccountInitialisationInstructions } from '../../lib/umbra-sdk/dist/index.mjs';
// Umbra program ID from IDL (A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4)
const UMBRA_PROGRAM_ID = new PublicKey('A5GtBtbNA3teSioCX2H3pqHncEqMPsnHxzzXYPFCzTA4');
/**
 * Account Initialization Service
 * Handles Arcium Encrypted User Account initialization on-chain
 */
class AccountInitService {
    /**
     * Initialize Arcium Encrypted User Account for a user
     * This is required before the user can deposit into the Umbra mixer pool
     */
    async initializeArciumUserAccount(userId, keypair) {
        try {
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            const userPubkey = await wallet.signer.getPublicKey();
            const connection = umbraClientService.getConnection();
            console.log(`🔐 Initializing Arcium Encrypted User Account for: ${userPubkey.toBase58()}`);
            // Get the PDA for the encrypted user account using the correct seeds from IDL
            // Seeds: ["arcium_encrypted_user_account", destination_address]
            const [encryptedUserAccountPda] = PublicKey.findProgramAddressSync([
                Buffer.from('arcium_encrypted_user_account', 'utf8'),
                userPubkey.toBuffer()
            ], UMBRA_PROGRAM_ID);
            console.log(`📍 Encrypted User Account PDA: ${encryptedUserAccountPda.toBase58()}`);
            // Check if account already exists
            try {
                const accountInfo = await connection.getAccountInfo(encryptedUserAccountPda);
                if (accountInfo) {
                    console.log('⚠️  Account already initialized');
                    return {
                        signature: 'already_initialized',
                        pda: encryptedUserAccountPda.toBase58(),
                    };
                }
            }
            catch (error) {
                // Account doesn't exist, continue with initialization
            }
            // Create a zero hash for optional data
            const ZERO_SHA3_HASH = new Uint8Array(32);
            // Build the initialization instruction manually to include signer account
            // The SDK's builder doesn't pass the signer to accountsPartial, so we need to do it manually
            const instructionBuilder = await AccountInitialisationInstructions.buildInitialiseArciumEncryptedUserAccountInstruction({
                destinationAddress: userPubkey,
                signer: userPubkey,
            }, {
                optionalData: ZERO_SHA3_HASH,
            });
            // Fix the instruction: replace the signer account with the correct userPubkey
            // Anchor seems to derive a different account, so we manually fix it
            const instruction = instructionBuilder;
            // Find and replace the signer account (index 2, writable + signer)
            const signerAccountIndex = instruction.keys.findIndex(key => key.isSigner && key.isWritable);
            if (signerAccountIndex !== -1) {
                console.log(`🔧 Replacing incorrect signer account at index ${signerAccountIndex}`);
                console.log(`   Old signer: ${instruction.keys[signerAccountIndex].pubkey.toBase58()}`);
                instruction.keys[signerAccountIndex] = {
                    pubkey: userPubkey,
                    isWritable: true,
                    isSigner: true,
                };
                console.log(`   New signer: ${userPubkey.toBase58()}`);
            }
            console.log('📝 Built initialization instruction');
            console.log('📋 Instruction accounts:', JSON.stringify(instruction.keys.map((key, idx) => ({
                index: idx,
                pubkey: key.pubkey.toBase58(),
                writable: key.isWritable,
                signer: key.isSigner,
            })), null, 2));
            // Get latest blockhash
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            // Create transaction message
            const messageV0 = new TransactionMessage({
                payerKey: userPubkey,
                recentBlockhash: blockhash,
                instructions: [instruction],
            }).compileToV0Message();
            // Create versioned transaction
            const transaction = new VersionedTransaction(messageV0);
            // Get the actual Solana keypair from the signer (which holds the Grid keypair)
            // The signer is a KeypairSigner that wraps the Grid keypair
            const solanaKeypair = wallet.signer.getKeypair();
            console.log(`🔑 Keypair public key: ${solanaKeypair.publicKey.toBase58()}`);
            console.log(`🔑 User pubkey from wallet: ${userPubkey.toBase58()}`);
            console.log(`🔑 Keys match: ${solanaKeypair.publicKey.equals(userPubkey)}`);
            // Sign transaction with the Grid keypair
            transaction.sign([solanaKeypair]);
            console.log('✍️  Transaction signed, sending...');
            // Send and confirm transaction
            const signature = await connection.sendTransaction(transaction);
            console.log(`📤 Transaction sent: ${signature}`);
            await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight,
            });
            console.log('⏳ Waiting for account data to propagate...');
            // Wait a bit for the account data to be fully propagated
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Verify the account is properly initialized
            const accountInfo = await connection.getAccountInfo(encryptedUserAccountPda);
            if (!accountInfo) {
                throw new Error('Account was not created despite successful transaction');
            }
            console.log('✅ Arcium Encrypted User Account initialized successfully!');
            console.log(`   - PDA: ${encryptedUserAccountPda.toBase58()}`);
            console.log(`   - Signature: ${signature}`);
            return {
                signature,
                pda: encryptedUserAccountPda.toBase58(),
            };
        }
        catch (error) {
            console.error('❌ Failed to initialize Arcium account:', error);
            throw new Error(`Failed to initialize Arcium account: ${error.message}`);
        }
    }
    /**
     * Check if a user's Arcium account is initialized
     */
    async isAccountInitialized(userId, keypair) {
        try {
            const wallet = await umbraWalletService.getOrCreateWallet(userId, keypair);
            const userPubkey = await wallet.signer.getPublicKey();
            const connection = umbraClientService.getConnection();
            // Use the same PDA derivation as in initializeArciumUserAccount
            const [encryptedUserAccountPda] = PublicKey.findProgramAddressSync([
                Buffer.from('arcium_encrypted_user_account', 'utf8'),
                userPubkey.toBuffer()
            ], UMBRA_PROGRAM_ID);
            const accountInfo = await connection.getAccountInfo(encryptedUserAccountPda);
            return accountInfo !== null;
        }
        catch (error) {
            return false;
        }
    }
}
export const accountInitService = new AccountInitService();
