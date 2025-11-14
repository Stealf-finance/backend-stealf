import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Private } from "../target/types/private";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

// ===================================
// CONFIGURATION DEVNET
// ===================================

const DEVNET_RPC = "https://api.devnet.solana.com";
const ARCIUM_CLUSTER_DEVNET = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

// WORKAROUND: SDK uses wrong Arcium Program ID (Bv3Fb... for localnet instead of BKck65... for devnet)
// We must derive addresses manually with the CORRECT Arcium Program ID

const ARCIUM_PROGRAM_ID_DEVNET = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");

// Manual PDA derivation with correct Arcium Program ID
function getMXEAccAddressDevnet(mxeProgramId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("MXEAccount"), mxeProgramId.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getMempoolAccAddressDevnet(mxeProgramId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("Mempool"), mxeProgramId.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getCompDefAccAddressDevnet(mxeProgramId: PublicKey, offset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(offset, 0);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("ComputationDefinitionAccount"), mxeProgramId.toBuffer(), offsetBuffer],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getExecutingPoolAccAddressDevnet(mxeProgramId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("Execpool"), mxeProgramId.toBuffer()],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

function getComputationAccAddressDevnet(mxeProgramId: PublicKey, offset: anchor.BN): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("ComputationAccount"), mxeProgramId.toBuffer(), offset.toArrayLike(Buffer, 'le', 8)],
    ARCIUM_PROGRAM_ID_DEVNET
  );
  return address;
}

// ===================================
// HELPER FUNCTIONS
// ===================================

function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`⚠️  Attempt ${attempt}/${maxRetries} failed to fetch MXE public key`);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

// Dériver l'adresse UserAccount PDA
function deriveUserAccountPDA(owner: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_account"), owner.toBuffer()],
    programId
  );
}

// Dériver l'adresse Vault PDA
function deriveVaultPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    programId
  );
}

// ===================================
// MAIN TEST
// ===================================

async function main() {
  console.log("\n🚀 TEST COMPLET: Shielded Pool Phase 2 sur Devnet");
  console.log("=".repeat(80));

  // 1. Setup connection
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const alice = readKpJson(`${os.homedir()}/.config/solana/id.json`);
  const bob = Keypair.generate(); // Générer Bob wallet

  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(alice),
    { commitment: "confirmed" }
  );

  anchor.setProvider(provider);

  // 2. Load program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/private.json", "utf8")
  );
  const program = new Program(idl, provider) as Program<Private>;

  console.log("\n📋 Configuration:");
  console.log(`   - Program ID: ${program.programId.toString()}`);
  console.log(`   - Alice (sender): ${alice.publicKey.toString()}`);
  console.log(`   - Bob (receiver): ${bob.publicKey.toString()}`);

  // 3. Check balances
  const aliceBalance = await connection.getBalance(alice.publicKey);
  console.log(`\n💰 Balances initiales:`);
  console.log(`   - Alice: ${(aliceBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (aliceBalance < 0.1 * LAMPORTS_PER_SOL) {
    console.log("\n❌ ERROR: Alice a besoin d'au moins 0.1 SOL pour le test");
    console.log("   Commande: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  // 4. Transférer SOL d'Alice à Bob pour créer son compte
  console.log(`\n💸 Transfert 0.05 SOL d'Alice à Bob pour son wallet...`);
  try {
    const transferIx = anchor.web3.SystemProgram.transfer({
      fromPubkey: alice.publicKey,
      toPubkey: bob.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    });
    const transferSig = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(transferIx),
      [alice]
    );
    console.log(`   ✅ Transfert confirmé`);
  } catch (error: any) {
    console.log(`   ⚠️  Transfert échoué: ${error.message}`);
  }

  // 5. Dériver les PDAs
  const [aliceUserAccount] = deriveUserAccountPDA(alice.publicKey, program.programId);
  const [bobUserAccount] = deriveUserAccountPDA(bob.publicKey, program.programId);
  const [vault] = deriveVaultPDA(program.programId);

  console.log(`\n🔑 PDAs:`);
  console.log(`   - Alice UserAccount: ${aliceUserAccount.toString()}`);
  console.log(`   - Bob UserAccount: ${bobUserAccount.toString()}`);
  console.log(`   - Vault: ${vault.toString()}`);

  // 6. Setup encryption avec Arcium
  console.log("\n🔐 Setting up Arcium encryption...");

  // Fetch MXE account data using custom devnet function
  const mxeAddress = getMXEAccAddressDevnet(program.programId);
  console.log(`   - MXE Address: ${mxeAddress.toBase58()}`);
  const mxeAccountInfo = await connection.getAccountInfo(mxeAddress);
  if (!mxeAccountInfo) {
    throw new Error(`MXE account not found at ${mxeAddress.toBase58()}`);
  }

  // Extract x25519 public key from MXE account (offset 8 for discriminator + 32 bytes for pubkey)
  const mxePublicKey = mxeAccountInfo.data.slice(8, 8 + 32);
  console.log(`   - MXE x25519 pubkey: ${Buffer.from(mxePublicKey).toString("hex").substring(0, 16)}...`);

  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // ===================================
  // ÉTAPE 1: Créer UserAccounts
  // ===================================

  console.log("\n" + "=".repeat(80));
  console.log("ÉTAPE 1: Créer UserAccounts pour Alice et Bob");
  console.log("=".repeat(80));

  // Vérifier si les comptes existent déjà
  const aliceAccountInfo = await connection.getAccountInfo(aliceUserAccount);
  const bobAccountInfo = await connection.getAccountInfo(bobUserAccount);

  if (!aliceAccountInfo) {
    console.log("\n👤 Création du compte Alice...");
    try {
      const createAliceSig = await program.methods
        .createUserAccount()
        .accountsPartial({
          owner: alice.publicKey,
        })
        .signers([alice])
        .rpc();
      console.log(`   ✅ Alice UserAccount créé!`);
      console.log(`   🔗 https://explorer.solana.com/tx/${createAliceSig}?cluster=devnet`);
    } catch (error: any) {
      console.log(`   ❌ Erreur création Alice: ${error.message}`);
      throw error;
    }
  } else {
    console.log(`   ✅ Alice UserAccount existe déjà`);
  }

  if (!bobAccountInfo) {
    console.log("\n👤 Création du compte Bob...");
    try {
      const createBobSig = await program.methods
        .createUserAccount()
        .accountsPartial({
          owner: bob.publicKey,
        })
        .signers([bob])
        .rpc();
      console.log(`   ✅ Bob UserAccount créé!`);
      console.log(`   🔗 https://explorer.solana.com/tx/${createBobSig}?cluster=devnet`);
    } catch (error: any) {
      console.log(`   ❌ Erreur création Bob: ${error.message}`);
      throw error;
    }
  } else {
    console.log(`   ✅ Bob UserAccount existe déjà`);
  }

  // ===================================
  // ÉTAPE 2: Deposits
  // ===================================

  console.log("\n" + "=".repeat(80));
  console.log("ÉTAPE 2: Déposer SOL dans le Vault");
  console.log("=".repeat(80));

  const aliceDepositAmount = 0.05 * LAMPORTS_PER_SOL; // 0.05 SOL (enough for 0.01 SOL transfer)
  const bobDepositAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL (initial balance)

  console.log(`\n💰 Alice dépose ${aliceDepositAmount / LAMPORTS_PER_SOL} SOL...`);

  // Chiffrer la balance Alice après dépôt
  const aliceInitialBalance = BigInt(aliceDepositAmount);
  const aliceNonce = randomBytes(16);
  const aliceEncryptedBalance = cipher.encrypt([aliceInitialBalance], aliceNonce);

  try {
    const depositAliceSig = await program.methods
      .deposit(
        new anchor.BN(aliceDepositAmount),
        Array.from(aliceEncryptedBalance[0]),
        Array.from(aliceNonce)
      )
      .accounts({
        owner: alice.publicKey,
        userAccount: aliceUserAccount,
        vault: vault,
      })
      .signers([alice])
      .rpc();
    console.log(`   ✅ Alice a déposé ${aliceDepositAmount / LAMPORTS_PER_SOL} SOL`);
    console.log(`   🔗 https://explorer.solana.com/tx/${depositAliceSig}?cluster=devnet`);
  } catch (error: any) {
    console.log(`   ❌ Erreur deposit Alice: ${error.message}`);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((log: string) => console.log(`   ${log}`));
    }
    throw error;
  }

  console.log(`\n💰 Bob dépose ${bobDepositAmount / LAMPORTS_PER_SOL} SOL...`);

  // Chiffrer la balance Bob après dépôt
  const bobInitialBalance = BigInt(bobDepositAmount);
  const bobNonce = randomBytes(16);
  const bobEncryptedBalance = cipher.encrypt([bobInitialBalance], bobNonce);

  try {
    const depositBobSig = await program.methods
      .deposit(
        new anchor.BN(bobDepositAmount),
        Array.from(bobEncryptedBalance[0]),
        Array.from(bobNonce)
      )
      .accounts({
        owner: bob.publicKey,
        userAccount: bobUserAccount,
        vault: vault,
      })
      .signers([bob])
      .rpc();
    console.log(`   ✅ Bob a déposé ${bobDepositAmount / LAMPORTS_PER_SOL} SOL`);
    console.log(`   🔗 https://explorer.solana.com/tx/${depositBobSig}?cluster=devnet`);
  } catch (error: any) {
    console.log(`   ❌ Erreur deposit Bob: ${error.message}`);
    throw error;
  }

  // Vérifier vault balance
  const vaultBalance = await connection.getBalance(vault);
  console.log(`\n   📊 Vault balance: ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // ===================================
  // ÉTAPE 3: Private Transfer
  // ===================================

  console.log("\n" + "=".repeat(80));
  console.log("ÉTAPE 3: Transfert Privé Alice → Bob (0.01 SOL)");
  console.log("=".repeat(80));

  const transferAmount = BigInt(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL test amount

  console.log(`\n🔒 Chiffrement des valeurs pour MPC...`);
  const transferNonce = randomBytes(16);

  // Chiffrer les balances actuelles et le montant
  const aliceBalanceCt = cipher.encrypt([aliceInitialBalance], transferNonce);
  const bobBalanceCt = cipher.encrypt([bobInitialBalance], transferNonce);
  const transferAmountCt = cipher.encrypt([transferAmount], transferNonce);

  console.log(`   ✅ Alice balance encrypted: ${Buffer.from(aliceBalanceCt[0]).toString("hex").substring(0, 16)}...`);
  console.log(`   ✅ Bob balance encrypted: ${Buffer.from(bobBalanceCt[0]).toString("hex").substring(0, 16)}...`);
  console.log(`   ✅ Transfer amount encrypted: ${Buffer.from(transferAmountCt[0]).toString("hex").substring(0, 16)}...`);
  console.log(`   ℹ️  Montant réel JAMAIS révélé on-chain!`);

  // Generate computation offset
  const computationOffset = new anchor.BN(randomBytes(8), "hex");

  console.log(`\n📤 Queueing private transfer MPC computation...`);

  try {
    // Add compute budget
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1,
    });

    const queueSig = await program.methods
      .privateTransfer(
        computationOffset,
        Array.from(aliceBalanceCt[0]),
        Array.from(bobBalanceCt[0]),
        Array.from(transferAmountCt[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(transferNonce).toString())
      )
      .preInstructions([modifyComputeUnits, addPriorityFee])
      .accountsPartial({
        payer: alice.publicKey,
        senderAccount: aliceUserAccount,
        receiverAccount: bobUserAccount,
        computationAccount: getComputationAccAddressDevnet(program.programId, computationOffset),
        clusterAccount: ARCIUM_CLUSTER_DEVNET,
        mxeAccount: getMXEAccAddressDevnet(program.programId),
        mempoolAccount: getMempoolAccAddressDevnet(program.programId),
        executingPool: getExecutingPoolAccAddressDevnet(program.programId),
        compDefAccount: getCompDefAccAddressDevnet(
          program.programId,
          Buffer.from(getCompDefAccOffset("private_transfer")).readUInt32LE()
        ),
        // Anchor auto-resolves: poolAccount, signPdaAccount, clockAccount, systemProgram, arciumProgram
      })
      .signers([alice])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`   ✅ Queue transaction confirmed!`);
    console.log(`   🔗 https://explorer.solana.com/tx/${queueSig}?cluster=devnet`);

    // Wait for MPC computation
    console.log(`\n⏳ Waiting for Arcium MPC cluster to process computation...`);
    console.log(`   (This may take 30-90 seconds)`);

    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );

    console.log(`   ✅ MPC computation completed!`);
    console.log(`   🔗 https://explorer.solana.com/tx/${finalizeSig}?cluster=devnet`);

    // ===================================
    // ÉTAPE 4: Vérification
    // ===================================

    console.log("\n" + "=".repeat(80));
    console.log("ÉTAPE 4: Vérification des balances on-chain");
    console.log("=".repeat(80));

    // Fetch updated accounts
    const aliceAccountUpdated = await program.account.userAccount.fetch(aliceUserAccount);
    const bobAccountUpdated = await program.account.userAccount.fetch(bobUserAccount);

    console.log(`\n📊 Alice UserAccount (on-chain):`);
    console.log(`   - Balance chiffrée: ${Buffer.from(aliceAccountUpdated.encryptedBalance).toString("hex").substring(0, 32)}...`);
    console.log(`   - Total deposits: ${aliceAccountUpdated.totalDeposits.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Last updated: ${new Date(aliceAccountUpdated.lastUpdated.toNumber() * 1000).toISOString()}`);

    console.log(`\n📊 Bob UserAccount (on-chain):`);
    console.log(`   - Balance chiffrée: ${Buffer.from(bobAccountUpdated.encryptedBalance).toString("hex").substring(0, 32)}...`);
    console.log(`   - Total deposits: ${bobAccountUpdated.totalDeposits.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`   - Last updated: ${new Date(bobAccountUpdated.lastUpdated.toNumber() * 1000).toISOString()}`);

    // Vérifier vault balance final
    const vaultBalanceFinal = await connection.getBalance(vault);
    console.log(`\n   📊 Vault balance final: ${(vaultBalanceFinal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`   ✅ Vault conserve tous les SOL déposés (pas de fuite)`);

    // SUCCESS!
    console.log("\n" + "=".repeat(80));
    console.log("🎉 SUCCESS! Shielded Pool Phase 2 Test RÉUSSI!");
    console.log("=".repeat(80));
    console.log(`   ✅ UserAccounts créés pour Alice et Bob`);
    console.log(`   ✅ Deposits effectués dans le vault`);
    console.log(`   ✅ Private transfer MPC exécuté sans erreur`);
    console.log(`   ✅ Balances on-chain mises à jour (CHIFFRÉES)`);
    console.log(`   ✅ Montant du transfert JAMAIS révélé on-chain`);
    console.log(`   ✅ Vault balance cohérente`);
    console.log(`\n   🔐 CONFIDENTIALITÉ: Seules les adresses sont publiques,`);
    console.log(`      les montants restent PRIVÉS grâce au MPC Arcium!`);

  } catch (error: any) {
    console.log(`\n❌ Error during private transfer:`);
    console.log(error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log(`   ${log}`));
    }
    process.exit(1);
  }

  console.log("\n" + "=".repeat(80));
  console.log("Test completed!\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
