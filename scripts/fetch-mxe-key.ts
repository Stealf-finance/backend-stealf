/**
 * Script to fetch the MXE x25519 public key from the deployed Arcium program
 *
 * This script reads the MXE account on-chain and extracts the x25519 public key
 * that should be used for encrypting data.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getMXEAccAddress } from '@arcium-hq/client';

const PROGRAM_ID = new PublicKey('9iLVPsyFbARWtNex6SetuE1JD7xyXPxV3Y9paMJ7MFAh');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

async function fetchMXEPublicKey() {
  console.log('🔍 Fetching MXE x25519 public key...\n');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get MXE PDA
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  console.log('MXE Account PDA:', mxeAccount.toBase58());

  try {
    // Fetch account info
    const accountInfo = await connection.getAccountInfo(mxeAccount);

    if (!accountInfo) {
      console.error('❌ MXE account not found!');
      console.log('\n⚠️  This means the MXE has not been initialized yet.');
      console.log('   You need to run: arcium deploy with your program first');
      process.exit(1);
    }

    console.log('✅ MXE account found');
    console.log('   Owner:', accountInfo.owner.toBase58());
    console.log('   Data length:', accountInfo.data.length, 'bytes');

    // MXE account structure (from Arcium source):
    // - discriminator: 8 bytes
    // - cluster_id: 4 bytes
    // - utility_pubkeys: Vec<[u8; 32]> - this contains x25519 keys
    // We need to parse this carefully

    const data = accountInfo.data;

    // Skip discriminator (8 bytes)
    let offset = 8;

    // Read cluster_id (4 bytes, u32 little-endian)
    const clusterId = data.readUInt32LE(offset);
    offset += 4;
    console.log('   Cluster ID:', clusterId);

    // Read utility_pubkeys Vec length (4 bytes, u32 little-endian)
    const utilityKeysCount = data.readUInt32LE(offset);
    offset += 4;
    console.log('   Utility keys count:', utilityKeysCount);

    if (utilityKeysCount === 0) {
      console.error('\n❌ ERROR: MXE has no utility keys configured!');
      console.log('   This is the "MxeKeysNotSet" error (error 6002)');
      console.log('\n   The MXE needs to be initialized by the Arcium cluster.');
      console.log('   Contact the dev team to configure the MXE keys on the cluster.');
      process.exit(1);
    }

    // Read first x25519 public key (32 bytes)
    const x25519PublicKey = data.slice(offset, offset + 32);
    console.log('\n✅ Found x25519 public key!');
    console.log('   Key (hex):', x25519PublicKey.toString('hex'));
    console.log('   Key (array):', `[${Array.from(x25519PublicKey).join(', ')}]`);

    console.log('\n📝 Add this to your arcium.config.ts:');
    console.log(`
  MXE_X25519_PUBLIC_KEY: new Uint8Array([
    ${Array.from(x25519PublicKey).join(', ')}
  ]),
    `);

    return x25519PublicKey;

  } catch (error: any) {
    console.error('❌ Error fetching MXE account:', error.message);
    process.exit(1);
  }
}

fetchMXEPublicKey()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
