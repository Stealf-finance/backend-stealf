/**
 * Check if CompDef account exists for encrypted_transfer instruction
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getCompDefAccAddress } from '@arcium-hq/client';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('9iLVPsyFbARWtNex6SetuE1JD7xyXPxV3Y9paMJ7MFAh');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Calculate comp_def_offset the same way as Rust macro
function calculateCompDefOffset(instructionName: string): number {
  const hash = createHash('sha256').update(instructionName).digest();
  return hash.readUInt32LE(0);
}

async function checkCompDef() {
  console.log('🔍 Checking CompDef for encrypted_transfer instruction...\n');

  const connection = new Connection(RPC_URL, 'confirmed');

  const instructionName = 'encrypted_transfer';
  const compDefOffset = calculateCompDefOffset(instructionName);

  console.log('Instruction name:', instructionName);
  console.log('CompDef offset:', compDefOffset);

  // Get CompDef PDA
  const compDefAccount = getCompDefAccAddress(PROGRAM_ID, compDefOffset);
  console.log('CompDef PDA:', compDefAccount.toBase58());

  try {
    const accountInfo = await connection.getAccountInfo(compDefAccount);

    if (!accountInfo) {
      console.log('\n❌ CompDef account does NOT exist');
      console.log('   You need to initialize it by calling init_encrypted_transfer_comp_def');
      console.log('\n   Run: POST /api/arcium/init with your payer keypair');
      return false;
    }

    console.log('\n✅ CompDef account EXISTS!');
    console.log('   Owner:', accountInfo.owner.toBase58());
    console.log('   Data length:', accountInfo.data.length, 'bytes');
    console.log('\n   You can proceed with encrypted transfers!');
    return true;

  } catch (error: any) {
    console.error('❌ Error checking CompDef:', error.message);
    return false;
  }
}

checkCompDef()
  .then(exists => process.exit(exists ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
