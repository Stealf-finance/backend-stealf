import { Connection, PublicKey, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { RescueCipher, x25519 } from '@arcium-hq/client';
import crypto, { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration Arcium - Session 2025-10-10
const PROGRAM_ID = new PublicKey('3qNdgo5mmDPs4dP5euewp27J5QgeR9FCfZju2c3vqgJh'); // ✅ Programme déployé avec keypair actuelle
const ARCIUM_PROGRAM_ID = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');
const RPC_ENDPOINT = 'https://api.devnet.solana.com'; // Utilisation du RPC public Solana
const MXE_ACCOUNT = new PublicKey('FahjDdDwLoRmPgoqdnvGTAMsfFnE9okSiY4Ddf2iVayR'); // ✅ MXE avec authority (créé via arcium init-mxe)
const COMP_DEF_ACCOUNT = new PublicKey('GJyjMzNE4f88R8QCTiAaFM8B29X2EHv48Ko1pPo1bGMT'); // ✅ Comp def initialisé (PDA dérivé)

interface RegisterUserResult {
  success: boolean;
  userId?: number;
  balancePDA?: string;
  signature?: string;
  error?: string;
}

interface PrivateTransferResult {
  success: boolean;
  signature?: string;
  computationOffset?: string;
  error?: string;
}

interface BalanceInfo {
  userId: number;
  encryptedBalance: number[];
  nonce: string;
}

interface ExecutePrivateTransferFromUserResult {
  success: boolean;
  signature?: string;
  senderWallet?: string;
  recipientWallet?: string;
  arciumUserId?: number;
  arciumBalancePDA?: string;
  error?: string;
}

/**
 * Service pour gérer les transactions privées avec Arcium MPC
 *
 * Architecture:
 * 1. Chaque utilisateur reçoit un ID unique (u32)
 * 2. Les balances sont stockées chiffrées on-chain
 * 3. Les transferts utilisent le MPC cluster pour valider et calculer
 * 4. Privacy 100%: montants et balances jamais révélés
 */
class PrivateTransferService {
  private connection: Connection;
  private program: Program | null = null;
  private provider: AnchorProvider | null = null;
  private mxePublicKey: Uint8Array | null = null;

  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');
    this.loadProgram();
  }

  /**
   * Convertit l'IDL Arcium au format Anchor v0.29 compatible
   */
  private convertArciumIdlToAnchor(arciumIdl: any): any {
    // Convertir les types avec le nouveau format vers l'ancien
    const convertType = (type: any): any => {
      if (!type) return type;

      // Si c'est un objet avec "defined", le convertir
      if (type.defined && typeof type.defined === 'object' && type.defined.name) {
        return type.defined.name;
      }

      return type;
    };

    // Convertir récursivement tous les champs de types
    const convertTypes = (types: any[]): any[] => {
      if (!types || !Array.isArray(types)) return [];

      return types.map(typeObj => {
        if (typeObj.type?.kind === 'struct' && typeObj.type.fields) {
          return {
            ...typeObj,
            type: {
              ...typeObj.type,
              fields: typeObj.type.fields.map((field: any) => ({
                ...field,
                type: convertType(field.type)
              }))
            }
          };
        }
        return typeObj;
      });
    };

    // Anchor v0.29 attend metadata.address, pas address au niveau racine
    const converted = {
      version: arciumIdl.metadata?.version || '0.1.0',
      name: arciumIdl.metadata?.name || 'private_transfer',
      instructions: arciumIdl.instructions || [],
      accounts: arciumIdl.accounts || [],
      types: convertTypes(arciumIdl.types),
      events: arciumIdl.events || [],
      errors: arciumIdl.errors || [],
      metadata: {
        address: arciumIdl.address,
        ...arciumIdl.metadata
      }
    };

    return converted;
  }

  /**
   * Charge le programme Anchor avec l'IDL
   */
  private async loadProgram(): Promise<void> {
    try {
      // Charger l'IDL du programme déployé
      const idlPath = path.join(__dirname, '../../../arcium-program/private_transfer/target/idl/private_transfer.json');

      if (!fs.existsSync(idlPath)) {
        console.warn('⚠️  IDL file not found:', idlPath);
        console.warn('⚠️  Arcium functions will be limited until program is built');
        return;
      }

      const arciumIdl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

      // Vérifier que l'IDL a la structure attendue
      if (!arciumIdl.instructions || !Array.isArray(arciumIdl.instructions)) {
        console.warn('⚠️  IDL format invalid - no instructions found');
        console.warn('⚠️  Arcium functions will work with limited features');
        return;
      }

      // Convertir l'IDL Arcium au format Anchor compatible
      const idl = this.convertArciumIdlToAnchor(arciumIdl);

      // Créer un wallet dummy pour le provider (sera remplacé par le vrai wallet lors des appels)
      const dummyKeypair = Keypair.generate();
      const wallet = new Wallet(dummyKeypair);

      this.provider = new AnchorProvider(
        this.connection,
        wallet,
        { commitment: 'confirmed' }
      );

      // Debug: vérifier la structure de l'IDL
      console.log('🔍 IDL structure:', {
        hasVersion: !!idl.version,
        hasName: !!idl.name,
        instructionCount: idl.instructions?.length || 0,
        hasAddress: !!idl.metadata?.address
      });

      // ✅ SOLUTION: Utiliser 2 arguments seulement, comme dans les scripts Arcium officiels!
      // Anchor lit automatiquement le program_id depuis arciumIdl.address
      // Ne PAS passer PROGRAM_ID en 3ème argument, ça cause l'erreur _bn
      console.log('🔍 Loading program from IDL.address:', arciumIdl.address);
      this.program = new Program(arciumIdl as any, this.provider);

      console.log('✅ Arcium program loaded successfully');
      console.log('📋 Program ID:', this.program.programId.toString());
    } catch (error: any) {
      console.error('❌ Failed to load Arcium program:', error.message);
      console.warn('⚠️  Arcium MPC features will be disabled. The program is deployed but IDL format may be incompatible.');
      console.warn('⚠️  You can still use basic wallet functions.');
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
      console.log('🔑 Fetching MXE public key...');

      const mxeAccountInfo = await this.connection.getAccountInfo(MXE_ACCOUNT);
      if (!mxeAccountInfo) {
        throw new Error('MXE account not found');
      }

      // La clé publique x25519 est stockée dans le compte MXE
      // Offset exact dépend du layout MXEAccount d'Arcium
      // Généralement après le discriminator (8 bytes)
      this.mxePublicKey = mxeAccountInfo.data.slice(8, 40);

      console.log('✅ MXE public key retrieved');
      return this.mxePublicKey;
    } catch (error: any) {
      console.error('❌ Failed to get MXE public key:', error);
      throw new Error(`Cannot retrieve MXE key: ${error.message}`);
    }
  }

  /**
   * Enregistre un nouvel utilisateur et lui assigne un ID unique
   * @param userAddress - Adresse publique du wallet Arcium (juste pour référence)
   * @param payerKeypair - Server keypair (paie les frais et signe)
   */
  async registerUser(userAddress: PublicKey, payerKeypair: Keypair): Promise<RegisterUserResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded. Run: anchor build');
      }

      console.log('📝 Registering new user...');
      console.log('   Address:', userAddress.toString());

      // Dériver les PDAs
      const [userRegistryPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_registry')],
        PROGRAM_ID
      );

      // Vérifier si le registre existe
      try {
        await this.program.account.userRegistry.fetch(userRegistryPDA);
      } catch (e) {
        console.log('⚠️  UserRegistry not initialized. Please run init-user-registry.ts first');
        throw new Error('UserRegistry not initialized');
      }

      const registry = await this.program.account.userRegistry.fetch(userRegistryPDA);
      const nextUserId = registry.nextUserId;

      const [balancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('balance'), new BN(nextUserId).toArrayLike(Buffer, 'le', 4)],
        PROGRAM_ID
      );

      // Vérifier si l'utilisateur est déjà enregistré
      try {
        const existingBalance = await this.program.account.encryptedBalance.fetch(balancePDA);
        console.log('ℹ️  User already registered with ID:', existingBalance.userId);
        return {
          success: true,
          userId: existingBalance.userId,
          balancePDA: balancePDA.toString(),
        };
      } catch (e) {
        // Utilisateur pas encore enregistré, on continue
      }

      // ✅ Créer un provider temporaire avec le SERVER keypair (qui paie)
      const tempWallet = new Wallet(payerKeypair);
      const tempProvider = new AnchorProvider(
        this.connection,
        tempWallet,
        { commitment: 'confirmed' }
      );
      const tempProgram = new Program(this.program.idl, tempProvider);

      // Appeler l'instruction avec le bon programme
      // Note: 'user' = wallet Arcium (juste une adresse, pas de signature), 'payer' = server keypair (paie et signe)
      const tx = await tempProgram.methods
        .registerUser()
        .accounts({
          userRegistry: userRegistryPDA,
          balanceAccount: balancePDA,
          user: userAddress,  // L'utilisateur Arcium (juste l'adresse publique)
          payer: payerKeypair.publicKey,  // Server keypair qui paie
          systemProgram: SystemProgram.programId,
        })
        // Pas besoin de .signers() car le provider wallet (payerKeypair) signe automatiquement
        .rpc();

      console.log('✅ User registered successfully');
      console.log('   Transaction:', tx);
      console.log('   User ID:', nextUserId);
      console.log('   Balance PDA:', balancePDA.toString());

      return {
        success: true,
        userId: nextUserId,
        balancePDA: balancePDA.toString(),
        signature: tx,
      };
    } catch (error: any) {
      console.error('❌ Failed to register user:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Récupère l'ID d'un utilisateur depuis son adresse
   */
  async getUserId(userAddress: PublicKey): Promise<number | null> {
    try {
      if (!this.program) {
        return null;
      }

      // Chercher dans tous les comptes balance pour trouver celui qui correspond à l'adresse
      // Note: En production, on devrait avoir un mapping address -> user_id
      const [userRegistryPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('user_registry')],
        PROGRAM_ID
      );

      const registry = await this.program.account.userRegistry.fetch(userRegistryPDA);
      const maxUserId = registry.nextUserId;

      // Parcourir les IDs possibles (optimisation: utiliser un cache ou index)
      for (let userId = 0; userId < maxUserId; userId++) {
        const [balancePDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('balance'), new BN(userId).toArrayLike(Buffer, 'le', 4)],
          PROGRAM_ID
        );

        try {
          const balance = await this.program.account.encryptedBalance.fetch(balancePDA);
          if (balance.ownerAddress.toString() === userAddress.toString()) {
            return userId;
          }
        } catch (e) {
          // Compte n'existe pas, continuer
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting user ID:', error);
      return null;
    }
  }

  /**
   * Récupère la balance chiffrée d'un utilisateur
   */
  async getEncryptedBalance(userId: number): Promise<BalanceInfo | null> {
    try {
      if (!this.program) {
        return null;
      }

      const [balancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('balance'), new BN(userId).toArrayLike(Buffer, 'le', 4)],
        PROGRAM_ID
      );

      const balanceAccount = await this.program.account.encryptedBalance.fetch(balancePDA);

      return {
        userId: balanceAccount.userId,
        encryptedBalance: Array.from(balanceAccount.encryptedBalance),
        nonce: balanceAccount.nonce.toString(),
      };
    } catch (error) {
      console.error('Error fetching encrypted balance:', error);
      return null;
    }
  }

  /**
   * Effectue un transfert privé entre deux utilisateurs
   */
  async executePrivateTransfer(
    senderId: number,
    receiverId: number,
    amount: bigint,
    senderKeypair: Keypair,
    payerKeypair: Keypair  // Server keypair qui paie les frais
  ): Promise<PrivateTransferResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded. Run: anchor build');
      }

      console.log('\n🔐 ═══════════════════════════════════════════');
      console.log('🔐 PRIVATE TRANSFER (ARCIUM MPC)');
      console.log('🔐 ═══════════════════════════════════════════');
      console.log(`  Sender ID:    ${senderId}`);
      console.log(`  Receiver ID:  ${receiverId}`);
      console.log(`  Amount:       ${amount} lamports`);
      console.log('🔐 ═══════════════════════════════════════════\n');

      // 1. Récupérer les balances actuelles
      const senderBalance = await this.getEncryptedBalance(senderId);
      const receiverBalance = await this.getEncryptedBalance(receiverId);

      if (!senderBalance || !receiverBalance) {
        throw new Error('User balance not found');
      }

      // 2. Setup chiffrement
      const mxePublicKey = await this.getMXEPublicKey();
      const clientPrivateKey = x25519.utils.randomSecretKey();
      const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
      const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      const nonce = randomBytes(16);

      // 3. Chiffrer les données
      const senderIdEncrypted = cipher.encrypt([BigInt(senderId)], nonce);
      const receiverIdEncrypted = cipher.encrypt([BigInt(receiverId)], nonce);
      const amountEncrypted = cipher.encrypt([amount], nonce);

      console.log('🔐 Data encrypted for MPC computation...');

      // 4. Dériver les PDAs
      const [senderBalancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('balance'), new BN(senderId).toArrayLike(Buffer, 'le', 4)],
        PROGRAM_ID
      );

      const [receiverBalancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('balance'), new BN(receiverId).toArrayLike(Buffer, 'le', 4)],
        PROGRAM_ID
      );

      // 5. Générer computation offset unique
      const computationOffset = new BN(Date.now());

      console.log('📡 Submitting transaction to Solana...');

      // Helper: Convert bigint to 32-byte array (big-endian)
      const bigintToBytes32 = (value: bigint): number[] => {
        const hex = value.toString(16).padStart(64, '0');
        return Array.from(Buffer.from(hex, 'hex'));
      };

      // Dériver tous les comptes Arcium requis
      // MXE_ACCOUNT est défini en haut du fichier (constante globale)

      // Sign PDA (seed = 'SignerAccount', base = notre PROGRAM_ID)
      const [signPdaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('SignerAccount')],
        PROGRAM_ID
      );

      // Mempool PDA (seed = 'Mempool' + notre PROGRAM_ID)
      const [mempoolPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('Mempool'), PROGRAM_ID.toBuffer()],
        ARCIUM_PROGRAM_ID
      );

      // Execpool PDA (seed = 'Execpool' + notre PROGRAM_ID)
      const [execpoolPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('Execpool'), PROGRAM_ID.toBuffer()],
        ARCIUM_PROGRAM_ID
      );

      // Computation PDA (seed = 'ComputationAccount' + notre PROGRAM_ID + offset)
      const [computationPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('ComputationAccount'), PROGRAM_ID.toBuffer(), computationOffset.toArrayLike(Buffer, 'le', 8)],
        ARCIUM_PROGRAM_ID
      );

      // Comp def account (défini en haut du fichier)
      const compDefPDA = COMP_DEF_ACCOUNT;

      // Cluster account (cluster 8, créé sur le PC fixe qui run le node)
      // Note: D'après CLAUDE.md - Cluster 8 Pubkey
      const clusterPDA = new PublicKey('53gPzLaB8paJvSDkDwneMYUAnSnb2g5ZWBHWY2Wp61sv');

      // Arcium system accounts (constants from arcium-anchor v0.3.1)
      const ARCIUM_FEE_POOL = new PublicKey('7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3');
      const ARCIUM_CLOCK = new PublicKey('FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65');

      // 6. Créer un provider temporaire avec le senderKeypair (wallet Arcium de l'user)
      // Note: Le wallet Arcium doit avoir du SOL pour payer les frais
      const tempWallet = new Wallet(senderKeypair);
      const tempProvider = new AnchorProvider(
        this.connection,
        tempWallet,
        { commitment: 'confirmed' }
      );
      const tempProgram = new Program(this.program.idl, tempProvider);

      // 7. Envoyer la transaction
      const tx = await tempProgram.methods
        .privateTransfer(
          computationOffset,
          senderId,
          receiverId,
          bigintToBytes32(senderIdEncrypted[0]),
          bigintToBytes32(receiverIdEncrypted[0]),
          bigintToBytes32(amountEncrypted[0]),
          Array.from(senderBalance.encryptedBalance),
          Array.from(receiverBalance.encryptedBalance),
          Array.from(clientPublicKey),
          new BN(Buffer.from(nonce))
        )
        .accounts({
          senderBalance: senderBalancePDA,
          receiverBalance: receiverBalancePDA,
          payer: senderKeypair.publicKey, // ✅ Wallet Arcium de l'user (doit avoir du SOL)
          signPdaAccount: signPdaPDA,
          mxeAccount: MXE_ACCOUNT,
          mempoolAccount: mempoolPDA,
          executingPool: execpoolPDA,
          computationAccount: computationPDA,
          compDefAccount: compDefPDA,
          clusterAccount: clusterPDA,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          systemProgram: SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc(); // ✅ Provider signe automatiquement, pas besoin de .signers()

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
   * Déchiffre une balance (côté client)
   */
  async decryptBalance(
    encryptedBalance: Uint8Array,
    nonce: bigint,
    clientPrivateKey: Uint8Array
  ): Promise<bigint> {
    try {
      const mxePublicKey = await this.getMXEPublicKey();
      const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      const decrypted = cipher.decrypt([encryptedBalance], nonce);
      return decrypted[0];
    } catch (error: any) {
      console.error('Error decrypting balance:', error);
      throw error;
    }
  }

  /**
   * Exécute une transaction privée complète depuis un utilisateur MongoDB
   *
   * Flow:
   * 1. Récupère le wallet Solana de l'utilisateur depuis MongoDB
   * 2. Crée un wallet Arcium privé si nécessaire
   * 3. Enregistre l'utilisateur dans Arcium
   * 4. Effectue le transfert privé 100% masqué
   *
   * @param mongoUserId - ID de l'utilisateur dans MongoDB
   * @param recipientAddress - Adresse publique du destinataire
   * @param amount - Montant en lamports
   */
  async executePrivateTransferFromUser(
    mongoUserId: string,
    recipientAddress: PublicKey,
    amount: bigint
  ): Promise<ExecutePrivateTransferFromUserResult> {
    try {
      console.log('🔐 Starting Arcium private transfer flow...');
      console.log(`   MongoDB User ID: ${mongoUserId}`);
      console.log(`   Recipient: ${recipientAddress.toString()}`);
      console.log(`   Amount: ${amount} lamports`);

      // Import dynamique pour éviter les circular dependencies
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

      const senderPublicKey = new PublicKey(user.solanaWallet);
      console.log(`✅ User wallet found: ${senderPublicKey.toString()}`);

      // 2. Créer wallet Arcium privé si nécessaire (Privacy 1)
      let arciumWalletPubkey: PublicKey;

      if (!user.solanaPrivateWallet) {
        console.log('🔑 Creating Arcium private wallet (Privacy 1)...');
        const arciumWalletPublicKey = await solanaWalletService.generatePrivateWallet(
          user._id.toString(),
          user.email
        );
        user.solanaPrivateWallet = arciumWalletPublicKey;
        await user.save();
        arciumWalletPubkey = new PublicKey(arciumWalletPublicKey);
        console.log(`✅ Arcium wallet created: ${arciumWalletPublicKey}`);
      } else {
        arciumWalletPubkey = new PublicKey(user.solanaPrivateWallet);
        console.log(`✅ Arcium wallet exists: ${user.solanaPrivateWallet}`);
      }

      // 3. Récupérer le server keypair (nécessaire pour payer les frais)
      const serverKeypair = await solanaWalletService.getServerKeypair();
      if (!serverKeypair) {
        return {
          success: false,
          error: 'Server keypair not found',
        };
      }

      // 4. Enregistrer dans Arcium si pas déjà fait
      let arciumUserId: number;
      let balancePDA: string;

      if (user.arciumUserId === undefined || user.arciumUserId === null) {
        console.log('📝 Registering user in Arcium MPC system...');

        // Enregistrer avec juste l'adresse publique (pas besoin de keypair)
        const registerResult = await this.registerUser(arciumWalletPubkey, serverKeypair);

        if (!registerResult.success || registerResult.userId === undefined) {
          return {
            success: false,
            error: `Failed to register in Arcium: ${registerResult.error}`,
          };
        }

        arciumUserId = registerResult.userId;
        balancePDA = registerResult.balancePDA!;

        // Sauvegarder l'ID Arcium dans MongoDB
        user.arciumUserId = arciumUserId;
        await user.save();

        console.log(`✅ User registered in Arcium with ID: ${arciumUserId}`);
      } else {
        arciumUserId = user.arciumUserId;

        // Calculer le balance PDA
        const [balancePDAKey] = PublicKey.findProgramAddressSync(
          [Buffer.from('balance'), new BN(arciumUserId).toArrayLike(Buffer, 'le', 4)],
          PROGRAM_ID
        );
        balancePDA = balancePDAKey.toString();

        console.log(`✅ User already registered with Arcium ID: ${arciumUserId}`);
      }

      // 4. Vérifier si le destinataire est déjà enregistré dans Arcium, sinon l'enregistrer
      console.log('🔍 Checking if recipient is registered in Arcium...');
      let recipientArciumUserId = await this.getUserId(recipientAddress);

      if (recipientArciumUserId === null) {
        console.log('📝 Recipient not registered, registering now...');

        // Trouver le user MongoDB du recipient par son wallet Arcium
        const { User } = await import('../../models/User.js');
        const recipientUser = await User.findOne({ solanaPrivateWallet: recipientAddress.toString() });

        if (!recipientUser) {
          return {
            success: false,
            error: 'Recipient not found in system. Only registered users can receive private transfers.',
          };
        }

        // Enregistrer avec juste l'adresse publique (pas besoin de keypair)
        const registerRecipientResult = await this.registerUser(recipientAddress, serverKeypair);

        if (!registerRecipientResult.success || registerRecipientResult.userId === undefined) {
          return {
            success: false,
            error: `Failed to register recipient in Arcium: ${registerRecipientResult.error}`,
          };
        }

        recipientArciumUserId = registerRecipientResult.userId;
        console.log(`✅ Recipient registered with Arcium ID: ${recipientArciumUserId}`);
      } else {
        console.log(`✅ Recipient already registered with Arcium ID: ${recipientArciumUserId}`);
      }

      // 5. Récupérer le keypair du wallet Arcium de l'utilisateur
      console.log('🔑 Loading user Arcium wallet keypair...');
      const arciumWalletKeypair = await solanaWalletService.getPrivateWalletKeypair(user._id.toString());

      if (!arciumWalletKeypair) {
        return {
          success: false,
          error: 'Failed to load Arcium wallet keypair',
        };
      }

      // 6. Effectuer le transfert privé via MPC
      console.log('🔐 Executing private transfer via Arcium MPC...');
      console.log(`   Sender Arcium ID: ${arciumUserId} (ENCRYPTED IN MPC)`);
      console.log(`   Recipient Arcium ID: ${recipientArciumUserId} (ENCRYPTED IN MPC)`);
      console.log(`   Amount: ${amount} lamports (ENCRYPTED IN MPC)`);
      console.log(`   ⚠️  On Solscan, you will see ONLY encrypted data!`);

      const transferResult = await this.executePrivateTransfer(
        arciumUserId,
        recipientArciumUserId,
        amount,
        arciumWalletKeypair,
        serverKeypair // ✅ Server keypair paie les frais de transaction
      );

      if (!transferResult.success) {
        return {
          success: false,
          error: `Private transfer failed: ${transferResult.error}`,
        };
      }

      console.log('✅ Private transfer queued successfully!');
      console.log(`   Transaction: ${transferResult.signature}`);
      console.log(`   MPC computation in progress (10-30 seconds)...`);

      return {
        success: true,
        signature: transferResult.signature,
        senderWallet: arciumWalletPubkey.toString(),
        recipientWallet: recipientAddress.toString(),
        arciumUserId,
        arciumBalancePDA: balancePDA,
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

const privateTransferService = new PrivateTransferService();
export default privateTransferService;
