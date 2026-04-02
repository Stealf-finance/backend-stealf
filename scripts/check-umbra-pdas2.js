require('dotenv/config');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getProgramDerivedAddress, getBytesEncoder, getAddressEncoder } = require('@solana/kit');

const UMBRA_PROGRAM_DEVNET = '342qFp62fzTt4zowrVPhrDdcRLGapPCMe8w5kFSoJ4f4';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// Seeds exactes extraites du codama (getRegisterUserForAnonymousUsageV3InstructionAsync)
const ZK_VERIFYING_KEY_SEED_BYTES = new Uint8Array([209,25,151,159,188,140,88,48,196,135,111,141,240,115,105,76,93,83,246,108,118,100,186,232,112,153,164,105,139,137,48,67]);
const INSTRUCTION_SEED_BYTES = new Uint8Array([16,58,1,0,0,0,0,0,0,0,0,0,0,0,0,0]); // u128 LE

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Dériver zkVerifyingKeyAccount avec les seeds corrects du codama
  const [zkVerifyingKeyPda] = await getProgramDerivedAddress({
    programAddress: UMBRA_PROGRAM_DEVNET,
    seeds: [
      getBytesEncoder().encode(ZK_VERIFYING_KEY_SEED_BYTES),
      getBytesEncoder().encode(INSTRUCTION_SEED_BYTES),
    ],
  });
  
  console.log('\n--- zkVerifyingKey PDA (seeds corrects du codama) ---');
  console.log('instructionSeed (u128 LE decoded):', 16 + 58*256 + 1*65536, '= 80400');
  console.log('Address:', zkVerifyingKeyPda);
  
  const zkAccount = await connection.getAccountInfo(new PublicKey(zkVerifyingKeyPda));
  if (zkAccount) {
    console.log('✅ EXISTS — owner:', zkAccount.owner.toBase58(), '— data length:', zkAccount.data.length);
    // Lire statusBits (si accessible)
    const hex = Buffer.from(zkAccount.data).toString('hex');
    console.log('Data (32 bytes prefix):', hex.slice(0, 64));
  } else {
    console.log('❌ DOES NOT EXIST on devnet — BLOCKER CONFIRMÉ!');
    console.log('→ Ce compte doit être initialisé par l\'équipe Umbra (admin authority).');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
