/**
 * Diagnostic: vérifie si les PDAs statiques Umbra existent sur devnet.
 */
require('dotenv/config');
const { Connection, PublicKey } = require('@solana/web3.js');

const UMBRA_PROGRAM_DEVNET = '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

const sdkChunk = require('../node_modules/@umbra-privacy/sdk/dist/chunk-PG2J6V6Y.js');
const {
  getProgramInformationPda,
  getZkVerifyingKeyPda,
  getArciumEncryptedUserAccountPda,
  getCompDefOffset,
} = sdkChunk;

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log('[Check] RPC:', RPC_URL);
  console.log('[Check] Umbra program:', UMBRA_PROGRAM_DEVNET);

  // 1. programInformation PDA
  const programInfoPda = await getProgramInformationPda(UMBRA_PROGRAM_DEVNET);
  console.log('\n--- programInformation PDA ---');
  console.log('Address:', programInfoPda);
  const programInfoAccount = await connection.getAccountInfo(new PublicKey(programInfoPda));
  if (programInfoAccount) {
    console.log('✅ EXISTS — owner:', programInfoAccount.owner.toBase58(), '— data length:', programInfoAccount.data.length);
  } else {
    console.log('❌ DOES NOT EXIST on devnet — BLOCKER!');
  }

  // 2. zkVerifyingKeyAccount pour register_user_for_anonymous_usage_v3
  const instructionSeed = getCompDefOffset('register_user_for_anonymous_usage_v3');
  console.log('\n--- zkVerifyingKey PDA ---');
  console.log('instructionSeed:', instructionSeed);
  const zkVerifyingKeyPda = await getZkVerifyingKeyPda(BigInt(instructionSeed), UMBRA_PROGRAM_DEVNET);
  console.log('Address:', zkVerifyingKeyPda);
  const zkAccount = await connection.getAccountInfo(new PublicKey(zkVerifyingKeyPda));
  if (zkAccount) {
    console.log('✅ EXISTS — owner:', zkAccount.owner.toBase58(), '— data length:', zkAccount.data.length);
  } else {
    console.log('❌ DOES NOT EXIST on devnet — BLOCKER!');
  }

  // 3. userAccount PDA du wealth wallet (détecter un état partiel)
  const wealthWallet = process.env.TEST_WEALTH_WALLET;
  if (wealthWallet) {
    console.log('\n--- userAccount PDA pour wealth wallet', wealthWallet, '---');
    const userAccountPda = await getArciumEncryptedUserAccountPda(wealthWallet, UMBRA_PROGRAM_DEVNET);
    console.log('Address:', userAccountPda);
    const userAccount = await connection.getAccountInfo(new PublicKey(userAccountPda));
    if (userAccount) {
      console.log('⚠️  EXISTS (état partiel possible) — data length:', userAccount.data.length, '— owner:', userAccount.owner.toBase58());
      console.log('Data (hex prefix):', Buffer.from(userAccount.data).toString('hex').slice(0, 64), '...');
    } else {
      console.log('✅ NOT EXISTS (pas d\'état partiel)');
    }
  } else {
    console.log('\n[Skip] TEST_WEALTH_WALLET non défini — skipping userAccount PDA check');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
