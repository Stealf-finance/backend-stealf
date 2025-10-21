import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  RescueCipher,
  x25519,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  getCompDefAccOffset,
} from '@arcium-hq/client';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Configuration Arcium - OFF-CHAIN CIRCUIT STORAGE (2025-10-10)
// ⚠️ Programme déployé avec arcium deploy sur cluster officiel devnet
const PROGRAM_ID = new PublicKey('Aztg5mR3EecUByit1wB5scfTgoPPxYjca1nHyjchY26L');
const ARCIUM_PROGRAM_ID = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');
const RPC_ENDPOINT = 'https://api.devnet.solana.com';
const CLUSTER_OFFSET = 1078779259;

// ✅ Adresses Arcium officielles (constantes réseau)
const ARCIUM_FEE_POOL = new PublicKey('7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3');
const ARCIUM_CLOCK = new PublicKey('FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65');

interface ExecutePrivateTransferResult {
  success: boolean;
  signature?: string;
  computationOffset?: string;
  error?: string;
}

/**
 * Service simplifié pour tester le circuit MPC sans UserRegistry
 *
 * Ce service appelle directement l'instruction private_transfer
 * sans gérer d'enregistrement d'utilisateurs
 */
class PrivateTransferSimpleService {
  private connection: Connection;
  private program: Program | null = null;
  private provider: AnchorProvider | null = null;
  private mxePublicKey: Uint8Array | null = null;

  // ✅ Dériver les adresses PDAs automatiquement
  private readonly MXE_ACCOUNT: PublicKey;
  private readonly MEMPOOL_ACCOUNT: PublicKey;
  private readonly EXECPOOL_ACCOUNT: PublicKey;
  private readonly CLUSTER_ACCOUNT: PublicKey;
  private readonly COMP_DEF_ACCOUNT: PublicKey;

  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');

    // ✅ DÉRIVER toutes les adresses PDAs depuis le PROGRAM_ID
    this.MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
    this.MEMPOOL_ACCOUNT = getMempoolAccAddress(PROGRAM_ID);
    this.EXECPOOL_ACCOUNT = getExecutingPoolAccAddress(PROGRAM_ID);
    this.CLUSTER_ACCOUNT = getClusterAccAddress(CLUSTER_OFFSET);

    // ✅ Calculer l'offset de comp_def pour "private_transfer_offchain"
    const compDefOffsetBuffer = getCompDefAccOffset('private_transfer_offchain');
    const compDefOffset = Buffer.from(compDefOffsetBuffer).readUInt32LE(0);
    this.COMP_DEF_ACCOUNT = getCompDefAccAddress(PROGRAM_ID, compDefOffset);

    console.log('✅ Arcium PDAs derived:');
    console.log('   MXE Account:', this.MXE_ACCOUNT.toBase58());
    console.log('   Mempool Account:', this.MEMPOOL_ACCOUNT.toBase58());
    console.log('   Execpool Account:', this.EXECPOOL_ACCOUNT.toBase58());
    console.log('   Cluster Account:', this.CLUSTER_ACCOUNT.toBase58());
    console.log('   CompDef Account:', this.COMP_DEF_ACCOUNT.toBase58());

    this.loadProgram();
  }

  /**
   * Charge le programme Anchor avec l'IDL
   */
  private async loadProgram(): Promise<void> {
    try {
      const idlPath = path.join(__dirname, '../../../arcium-program/private_transfer/target/idl/private_transfer.json');

      if (!fs.existsSync(idlPath)) {
        console.warn('⚠️  IDL file not found:', idlPath);
        return;
      }

      const arciumIdl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

      const dummyKeypair = Keypair.generate();
      const wallet = new Wallet(dummyKeypair);

      this.provider = new AnchorProvider(
        this.connection,
        wallet,
        { commitment: 'confirmed' }
      );

      this.program = new Program(arciumIdl as any, this.provider);

      console.log('✅ Arcium program loaded (simple mode)');
      console.log('📋 Program ID:', this.program.programId.toString());
    } catch (error: any) {
      console.error('❌ Failed to load Arcium program:', error.message);
    }
  }

  /**
   * Récupère la clé publique MXE pour le chiffrement
   */
  private async getMXEPublicKey(): Promise<Uint8Array> {
    if (this.mxePublicKey) {
      return this.mxePublicKey;
    }

    try {
      const mxeAccountInfo = await this.connection.getAccountInfo(this.MXE_ACCOUNT);
      if (!mxeAccountInfo) {
        throw new Error('MXE account not found');
      }

      // Clé publique x25519 après discriminator (8 bytes) + authority flag (1 byte) + authority pubkey (32 bytes)
      this.mxePublicKey = mxeAccountInfo.data.slice(41, 73);

      console.log('✅ MXE public key retrieved');
      return this.mxePublicKey;
    } catch (error: any) {
      console.error('❌ Failed to get MXE public key:', error);
      throw new Error(`Cannot retrieve MXE key: ${error.message}`);
    }
  }

  /**
   * Effectue un transfert privé (version simple pour test)
   *
   * @param senderKeypair - Wallet qui envoie (doit avoir du SOL pour les frais)
   * @param amount - Montant en lamports
   */
  async executeSimplePrivateTransfer(
    senderKeypair: Keypair,
    amount: bigint
  ): Promise<ExecutePrivateTransferResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded. Run: anchor build');
      }

      console.log('\n🔐 ═══════════════════════════════════════════');
      console.log('🔐 SIMPLE PRIVATE TRANSFER TEST (ARCIUM MPC)');
      console.log('🔐 ═══════════════════════════════════════════');
      console.log(`  Sender:       ${senderKeypair.publicKey.toString()}`);
      console.log(`  Amount:       ${amount} lamports`);
      console.log('🔐 ═══════════════════════════════════════════\n');

      // 1. Setup chiffrement
      const mxePublicKey = await this.getMXEPublicKey();
      const clientPrivateKey = x25519.utils.randomSecretKey();
      const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
      const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      const nonce = randomBytes(16);

      console.log('🔐 Data encrypted for MPC computation...');

      // 2. Chiffrer les données pour le circuit MPC
      // Circuit attend: TransferInput { sender_id: u32, receiver_id: u32, amount: u64, sender_balance: u64, receiver_balance: u64 }
      const senderId = BigInt(1); // ID de test
      const receiverId = BigInt(2); // ID de test
      const amountBigInt = BigInt(amount);
      const senderBalance = BigInt(1000000); // Balance initiale de test (1M)
      const receiverBalance = BigInt(500000); // Balance initiale de test (500K)

      // Chiffrer chaque champ (cipher.encrypt retourne un tableau de nombres)
      const encryptedSenderId = cipher.encrypt([senderId], nonce);
      const encryptedReceiverId = cipher.encrypt([receiverId], nonce);
      const encryptedAmount = cipher.encrypt([amountBigInt], nonce);
      const encryptedSenderBalance = cipher.encrypt([senderBalance], nonce);
      const encryptedReceiverBalance = cipher.encrypt([receiverBalance], nonce);

      // cipher.encrypt() retourne un tableau de tableaux: [[...32 bytes...]]
      // On prend le premier élément [0] qui contient les 32 bytes
      const senderIdBytes = encryptedSenderId[0];
      const receiverIdBytes = encryptedReceiverId[0];
      const amountBytes = encryptedAmount[0];
      const senderBalanceBytes = encryptedSenderBalance[0];
      const receiverBalanceBytes = encryptedReceiverBalance[0];

      // Préparer la clé publique et le nonce
      const pubKeyArray = Array.from(clientPublicKey);
      const nonceU128 = new BN(Buffer.from(nonce));

      console.log('✅ Encrypted 5 fields for TransferInput struct');
      console.log('🔍 DEBUG: Data types:');
      console.log('   senderIdBytes:', Array.isArray(senderIdBytes), 'length:', senderIdBytes.length);
      console.log('   pubKeyArray:', Array.isArray(pubKeyArray), 'length:', pubKeyArray.length);
      console.log('   nonceU128:', nonceU128.toString());

      // 3. Générer computation offset unique
      const computationOffset = new BN(Date.now());

      // 4. Dériver les PDAs nécessaires
      const [signPdaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('SignerAccount')],
        PROGRAM_ID
      );

      // ✅ Utiliser getComputationAccAddress pour dériver l'adresse computation
      const computationPDA = getComputationAccAddress(PROGRAM_ID, computationOffset);

      console.log('📍 Using derived PDAs:');
      console.log('   Sign PDA:', signPdaPDA.toBase58());
      console.log('   MXE Account:', this.MXE_ACCOUNT.toBase58());
      console.log('   Mempool Account:', this.MEMPOOL_ACCOUNT.toBase58());
      console.log('   Execpool Account:', this.EXECPOOL_ACCOUNT.toBase58());
      console.log('   Computation Account:', computationPDA.toBase58());
      console.log('   CompDef Account:', this.COMP_DEF_ACCOUNT.toBase58());
      console.log('   Cluster Account:', this.CLUSTER_ACCOUNT.toBase58());

      console.log('📡 Submitting transaction to Solana...');

      // 4. Créer un provider temporaire avec le senderKeypair
      const tempWallet = new Wallet(senderKeypair);
      const tempProvider = new AnchorProvider(
        this.connection,
        tempWallet,
        { commitment: 'confirmed' }
      );
      const tempProgram = new Program(this.program.idl, tempProvider);

      // 5. Envoyer la transaction avec les 7 arguments chiffrés
      const tx = await tempProgram.methods
        .privateTransfer(
          computationOffset,
          pubKeyArray,           // pub_key: [u8; 32]
          nonceU128,             // nonce: u128
          senderIdBytes,         // encrypted_sender_id: [u8; 32]
          receiverIdBytes,       // encrypted_receiver_id: [u8; 32]
          amountBytes,           // encrypted_amount: [u8; 32]
          senderBalanceBytes,    // encrypted_sender_balance: [u8; 32]
          receiverBalanceBytes   // encrypted_receiver_balance: [u8; 32]
        )
        .accounts({
          payer: senderKeypair.publicKey,
          signPdaAccount: signPdaPDA,
          mxeAccount: this.MXE_ACCOUNT,
          mempoolAccount: this.MEMPOOL_ACCOUNT,
          executingPool: this.EXECPOOL_ACCOUNT,
          computationAccount: computationPDA,
          compDefAccount: this.COMP_DEF_ACCOUNT,
          clusterAccount: this.CLUSTER_ACCOUNT,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          systemProgram: SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc();

      console.log('✅ Transaction submitted:', tx);
      console.log('⏳ Waiting for MPC computation (10-30 seconds)...');
      console.log('\n🔐 ═══════════════════════════════════════════');
      console.log('✅ PRIVATE TRANSFER QUEUED');
      console.log('🔐 ═══════════════════════════════════════════\n');

      return {
        success: true,
        signature: tx,
        computationOffset: computationOffset.toString(),
      };
    } catch (error: any) {
      console.error('❌ Private transfer failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Exécute une transaction privée depuis un utilisateur MongoDB
   * Version simplifiée pour tester
   */
  async executePrivateTransferFromUser(
    mongoUserId: string,
    recipientAddress: PublicKey,
    amount: bigint
  ): Promise<ExecutePrivateTransferResult> {
    try {
      console.log('🔐 Starting simple Arcium private transfer...');
      console.log(`   MongoDB User ID: ${mongoUserId}`);
      console.log(`   Recipient: ${recipientAddress.toString()}`);
      console.log(`   Amount: ${amount} lamports`);

      // Import dynamique
      const { User } = await import('../../models/User.js');
      const { solanaWalletService } = await import('../wallet/solana-wallet.service.js');

      // 1. Récupérer l'utilisateur MongoDB
      const user = await User.findById(mongoUserId);
      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      if (!user.solanaWallet) {
        return {
          success: false,
          error: 'User does not have a Solana wallet',
        };
      }

      console.log(`✅ User wallet found: ${user.solanaWallet}`);

      // 2. Récupérer le wallet keypair (pour signer)
      const walletKeypair = await solanaWalletService.getWallet(user._id.toString());

      if (!walletKeypair) {
        return {
          success: false,
          error: 'Failed to load wallet keypair',
        };
      }

      // 3. Vérifier que le wallet a assez de SOL
      const balance = await this.connection.getBalance(walletKeypair.publicKey);
      console.log(`💰 Wallet balance: ${balance / 1e9} SOL`);

      if (balance < Number(amount) + 5000) { // Amount + frais de tx (~0.000005 SOL)
        return {
          success: false,
          error: `Insufficient balance. Required: ${(Number(amount) + 5000) / 1e9} SOL, Available: ${balance / 1e9} SOL`,
        };
      }

      // 4. Effectuer le transfert privé simple
      console.log('🔐 Executing simple private transfer via Arcium MPC...');

      const transferResult = await this.executeSimplePrivateTransfer(
        walletKeypair,
        amount
      );

      if (!transferResult.success) {
        return {
          success: false,
          error: `Private transfer failed: ${transferResult.error}`,
        };
      }

      console.log('✅ Simple private transfer queued successfully!');
      console.log(`   Transaction: ${transferResult.signature}`);
      console.log(`   MPC computation in progress...`);

      return {
        success: true,
        signature: transferResult.signature,
        computationOffset: transferResult.computationOffset,
      };

    } catch (error: any) {
      console.error('❌ Error in executePrivateTransferFromUser:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

const privateTransferSimpleService = new PrivateTransferSimpleService();
export default privateTransferSimpleService;
