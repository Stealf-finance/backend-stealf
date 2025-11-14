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

// ✅ Configuration Arcium - Programme "private" déployé
const PROGRAM_ID = new PublicKey('9e5nBiDfYSUkV2krpoKnNZ4ZVXwG1Le8yGSeyqLFMFDF');
const ARCIUM_PROGRAM_ID = new PublicKey('BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6');
const RPC_ENDPOINT = 'https://api.devnet.solana.com';
const CLUSTER_OFFSET = 1078779259;

// ✅ Adresses Arcium officielles
const ARCIUM_FEE_POOL = new PublicKey('7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3');
const ARCIUM_CLOCK = new PublicKey('FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65');

interface AnonymousPoolResult {
  success: boolean;
  signature?: string;
  computationOffset?: string;
  commitment?: string;
  error?: string;
}

/**
 * Service pour gérer la pool anonyme (Shield/Anonymous Transfer/Unshield)
 */
class AnonymousPoolService {
  private connection: Connection;
  private program: Program | null = null;
  private provider: AnchorProvider | null = null;
  private mxePublicKey: Uint8Array | null = null;

  // ✅ PDAs dérivés
  private readonly MXE_ACCOUNT: PublicKey;
  private readonly MEMPOOL_ACCOUNT: PublicKey;
  private readonly EXECPOOL_ACCOUNT: PublicKey;
  private readonly CLUSTER_ACCOUNT: PublicKey;
  private readonly SHIELD_COMP_DEF: PublicKey;
  private readonly TRANSFER_COMP_DEF: PublicKey;
  private readonly UNSHIELD_COMP_DEF: PublicKey;

  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');

    // Dériver les PDAs
    this.MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
    this.MEMPOOL_ACCOUNT = getMempoolAccAddress(PROGRAM_ID);
    this.EXECPOOL_ACCOUNT = getExecutingPoolAccAddress(PROGRAM_ID);
    this.CLUSTER_ACCOUNT = getClusterAccAddress(CLUSTER_OFFSET);

    // Dériver les CompDef pour chaque instruction
    const shieldOffset = Buffer.from(getCompDefAccOffset('shield')).readUInt32LE(0);
    const transferOffset = Buffer.from(getCompDefAccOffset('anonymous_transfer')).readUInt32LE(0);
    const unshieldOffset = Buffer.from(getCompDefAccOffset('unshield')).readUInt32LE(0);

    this.SHIELD_COMP_DEF = getCompDefAccAddress(PROGRAM_ID, shieldOffset);
    this.TRANSFER_COMP_DEF = getCompDefAccAddress(PROGRAM_ID, transferOffset);
    this.UNSHIELD_COMP_DEF = getCompDefAccAddress(PROGRAM_ID, unshieldOffset);

    console.log('✅ Anonymous Pool Service initialized');
    console.log('   Program ID:', PROGRAM_ID.toString());
    console.log('   MXE Account:', this.MXE_ACCOUNT.toBase58());
    console.log('   Shield CompDef:', this.SHIELD_COMP_DEF.toBase58());
    console.log('   Transfer CompDef:', this.TRANSFER_COMP_DEF.toBase58());
    console.log('   Unshield CompDef:', this.UNSHIELD_COMP_DEF.toBase58());

    this.loadProgram();
  }

  /**
   * Charge le programme Anchor
   */
  private async loadProgram(): Promise<void> {
    try {
      const idlPath = path.join(__dirname, '../../../private/target/idl/private.json');

      if (!fs.existsSync(idlPath)) {
        console.warn('⚠️  IDL file not found:', idlPath);
        return;
      }

      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
      const dummyKeypair = Keypair.generate();
      const wallet = new Wallet(dummyKeypair);

      this.provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
      this.program = new Program(idl as any, this.provider);

      console.log('✅ Program loaded:', this.program.programId.toString());
    } catch (error: any) {
      console.error('❌ Failed to load program:', error.message);
    }
  }

  /**
   * Récupère la clé publique MXE
   */
  private async getMXEPublicKey(): Promise<Uint8Array> {
    if (this.mxePublicKey) {
      return this.mxePublicKey;
    }

    const mxeAccountInfo = await this.connection.getAccountInfo(this.MXE_ACCOUNT);
    if (!mxeAccountInfo) {
      throw new Error('MXE account not found');
    }

    // Clé publique x25519 à l'offset 41
    this.mxePublicKey = mxeAccountInfo.data.slice(41, 73);
    console.log('✅ MXE public key retrieved');
    return this.mxePublicKey;
  }

  /**
   * Chiffre des valeurs individuelles pour Arcium
   */
  private async encryptValues(values: bigint[], nonce: Uint8Array): Promise<{
    encryptedValues: number[][];  // Array de tableaux [u8; 32]
    pubKey: number[];
    nonceU128: BN;
    clientPrivateKey: Uint8Array;
  }> {
    const mxePublicKey = await this.getMXEPublicKey();
    const clientPrivateKey = x25519.utils.randomSecretKey();
    const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
    const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Chiffrer chaque valeur individuellement
    const encryptedValues = values.map(value => {
      const encrypted = cipher.encrypt([value], nonce);
      return encrypted[0];  // Prendre le premier élément [u8; 32]
    });

    return {
      encryptedValues,
      pubKey: Array.from(clientPublicKey),
      nonceU128: new BN(Buffer.from(nonce)),
      clientPrivateKey,
    };
  }

  /**
   * SHIELD - Déposer des fonds dans la pool anonyme
   */
  async shield(
    payerKeypair: Keypair,
    amount: bigint,
    secret: bigint
  ): Promise<AnonymousPoolResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded');
      }

      console.log('\n🔐 ═══════════════════════════════════════════');
      console.log('🔐 SHIELD - Deposit to Anonymous Pool');
      console.log('🔐 ═══════════════════════════════════════════');
      console.log(`  Payer:    ${payerKeypair.publicKey.toString()}`);
      console.log(`  Amount:   ${amount}`);
      console.log(`  Secret:   ${secret}`);
      console.log('🔐 ═══════════════════════════════════════════\n');

      const nonce = randomBytes(16);
      const { encryptedValues, pubKey, nonceU128 } = await this.encryptValues(
        [amount, secret],
        nonce
      );

      const [encryptedAmount, encryptedSecret] = encryptedValues;

      console.log('✅ Encrypted values (amount, secret)');
      console.log('   Encrypted amount length:', encryptedAmount.length);
      console.log('   Encrypted secret length:', encryptedSecret.length);

      const computationOffset = new BN(Date.now());
      const [signPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('SignerAccount')],
        PROGRAM_ID
      );
      const computationPDA = getComputationAccAddress(PROGRAM_ID, computationOffset);

      console.log('📍 PDAs:');
      console.log('   Sign PDA:', signPDA.toBase58());
      console.log('   Computation PDA:', computationPDA.toBase58());

      const tempWallet = new Wallet(payerKeypair);
      const tempProvider = new AnchorProvider(this.connection, tempWallet, { commitment: 'confirmed' });
      const tempProgram = new Program(this.program.idl, tempProvider);

      console.log('📡 Submitting shield transaction...');

      const tx = await tempProgram.methods
        .shield(
          computationOffset,
          pubKey,
          nonceU128,
          encryptedAmount,
          encryptedSecret
        )
        .accounts({
          payer: payerKeypair.publicKey,
          signPdaAccount: signPDA,
          mxeAccount: this.MXE_ACCOUNT,
          mempoolAccount: this.MEMPOOL_ACCOUNT,
          executingPool: this.EXECPOOL_ACCOUNT,
          computationAccount: computationPDA,
          compDefAccount: this.SHIELD_COMP_DEF,
          clusterAccount: this.CLUSTER_ACCOUNT,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          systemProgram: SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc();

      console.log('✅ Shield transaction submitted:', tx);
      console.log('⏳ Waiting for MPC computation...\n');

      return {
        success: true,
        signature: tx,
        computationOffset: computationOffset.toString(),
      };
    } catch (error: any) {
      console.error('❌ Shield failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ANONYMOUS TRANSFER - Transférer anonymement dans la pool
   */
  async anonymousTransfer(
    payerKeypair: Keypair,
    senderSecret: bigint,
    amount: bigint,
    receiverSecret: bigint
  ): Promise<AnonymousPoolResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded');
      }

      console.log('\n🕵️  ═══════════════════════════════════════════');
      console.log('🕵️  ANONYMOUS TRANSFER');
      console.log('🕵️  ═══════════════════════════════════════════');
      console.log(`  Amount:   ${amount}`);
      console.log('🕵️  ═══════════════════════════════════════════\n');

      const nonce = randomBytes(16);
      const { encryptedValues, pubKey, nonceU128 } = await this.encryptValues(
        [senderSecret, amount, receiverSecret],
        nonce
      );

      const [encryptedSenderSecret, encryptedAmount, encryptedReceiverSecret] = encryptedValues;

      console.log('✅ Encrypted values (sender_secret, amount, receiver_secret)');

      const computationOffset = new BN(Date.now());
      const [signPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('SignerAccount')],
        PROGRAM_ID
      );
      const computationPDA = getComputationAccAddress(PROGRAM_ID, computationOffset);

      const tempWallet = new Wallet(payerKeypair);
      const tempProvider = new AnchorProvider(this.connection, tempWallet, { commitment: 'confirmed' });
      const tempProgram = new Program(this.program.idl, tempProvider);

      console.log('📡 Submitting anonymous transfer...');

      const tx = await tempProgram.methods
        .anonymousTransfer(
          computationOffset,
          pubKey,
          nonceU128,
          encryptedSenderSecret,
          encryptedAmount,
          encryptedReceiverSecret
        )
        .accounts({
          payer: payerKeypair.publicKey,
          signPdaAccount: signPDA,
          mxeAccount: this.MXE_ACCOUNT,
          mempoolAccount: this.MEMPOOL_ACCOUNT,
          executingPool: this.EXECPOOL_ACCOUNT,
          computationAccount: computationPDA,
          compDefAccount: this.TRANSFER_COMP_DEF,
          clusterAccount: this.CLUSTER_ACCOUNT,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          systemProgram: SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc();

      console.log('✅ Anonymous transfer submitted:', tx);
      console.log('⏳ Waiting for MPC computation...\n');

      return {
        success: true,
        signature: tx,
        computationOffset: computationOffset.toString(),
      };
    } catch (error: any) {
      console.error('❌ Anonymous transfer failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * UNSHIELD - Retirer des fonds de la pool
   */
  async unshield(
    payerKeypair: Keypair,
    secret: bigint,
    amount: bigint
  ): Promise<AnonymousPoolResult> {
    try {
      if (!this.program) {
        throw new Error('Program not loaded');
      }

      console.log('\n🔓 ═══════════════════════════════════════════');
      console.log('🔓 UNSHIELD - Withdraw from Anonymous Pool');
      console.log('🔓 ═══════════════════════════════════════════');
      console.log(`  Amount:   ${amount}`);
      console.log('🔓 ═══════════════════════════════════════════\n');

      const nonce = randomBytes(16);
      const { encryptedValues, pubKey, nonceU128 } = await this.encryptValues(
        [secret, amount],
        nonce
      );

      const [encryptedSecret, encryptedAmount] = encryptedValues;

      console.log('✅ Encrypted values (secret, amount)');

      const computationOffset = new BN(Date.now());
      const [signPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('SignerAccount')],
        PROGRAM_ID
      );
      const computationPDA = getComputationAccAddress(PROGRAM_ID, computationOffset);

      const tempWallet = new Wallet(payerKeypair);
      const tempProvider = new AnchorProvider(this.connection, tempWallet, { commitment: 'confirmed' });
      const tempProgram = new Program(this.program.idl, tempProvider);

      console.log('📡 Submitting unshield transaction...');

      const tx = await tempProgram.methods
        .unshield(
          computationOffset,
          pubKey,
          nonceU128,
          encryptedSecret,
          encryptedAmount
        )
        .accounts({
          payer: payerKeypair.publicKey,
          signPdaAccount: signPDA,
          mxeAccount: this.MXE_ACCOUNT,
          mempoolAccount: this.MEMPOOL_ACCOUNT,
          executingPool: this.EXECPOOL_ACCOUNT,
          computationAccount: computationPDA,
          compDefAccount: this.UNSHIELD_COMP_DEF,
          clusterAccount: this.CLUSTER_ACCOUNT,
          poolAccount: ARCIUM_FEE_POOL,
          clockAccount: ARCIUM_CLOCK,
          systemProgram: SystemProgram.programId,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc();

      console.log('✅ Unshield transaction submitted:', tx);
      console.log('⏳ Waiting for MPC computation...\n');

      return {
        success: true,
        signature: tx,
        computationOffset: computationOffset.toString(),
      };
    } catch (error: any) {
      console.error('❌ Unshield failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

const anonymousPoolService = new AnonymousPoolService();
export default anonymousPoolService;
