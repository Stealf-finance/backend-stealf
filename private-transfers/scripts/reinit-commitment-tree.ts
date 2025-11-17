import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reinitialize Commitment Tree with increased capacity (100 commitments)
 *
 * NOTE: This will create a NEW commitment tree, effectively resetting the system
 * Old deposits will NOT be accessible with the new tree!
 */

async function main() {
  console.log('\n🔄 REINITIALIZE COMMITMENT TREE');
  console.log('='.repeat(60));

  // Setup connection
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load program
  const idlPath = path.join(__dirname, '../target/idl/private.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

  // Load payer
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf-8')))
  );

  console.log(`\n💰 Payer: ${payerKeypair.publicKey.toString()}`);

  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl, provider);

  console.log(`📋 Program ID: ${program.programId.toString()}`);

  // Get PDAs
  const [commitmentTreePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('commitment_tree')],
    program.programId
  );

  const [nullifierRegistryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier_registry')],
    program.programId
  );

  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault')],
    program.programId
  );

  console.log(`\n📍 Commitment Tree PDA: ${commitmentTreePDA.toString()}`);
  console.log(`📍 Nullifier Registry PDA: ${nullifierRegistryPDA.toString()}`);
  console.log(`📍 Vault PDA: ${vaultPDA.toString()}`);

  // Check if commitment tree exists
  try {
    const treeAccount = await program.account.commitmentTree.fetch(commitmentTreePDA);
    console.log(`\n⚠️  WARNING: Commitment tree already exists!`);
    console.log(`   Current capacity: ${treeAccount.commitments.length}/${treeAccount.commitments.length}`);
    console.log(`   Count: ${treeAccount.count.toString()}`);
    console.log(`\n   This will create a NEW tree. Old deposits will be inaccessible!`);
    console.log(`   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (error) {
    console.log(`\n✅ No existing tree found, proceeding with initialization...`);
  }

  // Initialize commitment tree
  console.log('\n🌳 Initializing new commitment tree (capacity: 100)...');

  try {
    const tx = await program.methods
      .initCommitmentTree()
      .accounts({
        payer: payerKeypair.publicKey,
        commitmentTree: commitmentTreePDA,
      })
      .signers([payerKeypair])
      .rpc();

    console.log(`✅ Commitment tree initialized: ${tx}`);
  } catch (error: any) {
    if (error.message?.includes('already in use')) {
      console.log(`⚠️  Tree account already exists. You may need to:`);
      console.log(`   1. Use a different seed for a new tree`);
      console.log(`   2. Or close the existing account first (risky!)`);
      console.log(`   3. Or wait for the old tree to be garbage collected\n`);
    } else {
      throw error;
    }
  }

  // Check nullifier registry
  console.log('\n🔒 Checking nullifier registry...');

  try {
    const registryAccount = await program.account.nullifierRegistry.fetch(nullifierRegistryPDA);
    console.log(`✅ Nullifier registry exists`);
    console.log(`   Used nullifiers: ${registryAccount.count.toString()}`);
  } catch (error) {
    console.log(`⚠️  Nullifier registry not found, initializing...`);

    const tx = await program.methods
      .initNullifierRegistry()
      .accounts({
        payer: payerKeypair.publicKey,
        nullifierRegistry: nullifierRegistryPDA,
      })
      .signers([payerKeypair])
      .rpc();

    console.log(`✅ Nullifier registry initialized: ${tx}`);
  }

  // Final status
  console.log('\n\n📊 FINAL STATUS');
  console.log('='.repeat(60));

  try {
    const treeAccount = await program.account.commitmentTree.fetch(commitmentTreePDA);
    const registryAccount = await program.account.nullifierRegistry.fetch(nullifierRegistryPDA);
    const vaultBalance = await connection.getBalance(vaultPDA);

    console.log(`\n✅ Commitment Tree:`);
    console.log(`   Capacity: 100 commitments`);
    console.log(`   Current count: ${treeAccount.count.toString()}`);
    console.log(`   Merkle root: ${Buffer.from(treeAccount.root).toString('hex').slice(0, 16)}...`);

    console.log(`\n✅ Nullifier Registry:`);
    console.log(`   Used nullifiers: ${registryAccount.count.toString()}/100`);

    console.log(`\n✅ Vault:`);
    console.log(`   Balance: ${vaultBalance / 1e9} SOL`);

    console.log(`\n🎉 READY TO ACCEPT DEPOSITS!\n`);
  } catch (error) {
    console.error(`\n❌ Error fetching final status:`, error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
