import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("CeuEReAhX6ZXUJRSR4wm2SGMqbmQcAaR9gbMiKz8DTNE");
const CLUSTER_OFFSET = 1078779259; // v0.3.0 cluster (compatible v0.4.0 per docs)
const ARCIUM_CLUSTER_DEVNET = new PublicKey("CaTxKKfdaoCM7ZzLj5dLzrrmnsg9GJb5iYzRzCk8VEu3");

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

async function main() {
  console.log("🔧 Checking MXE Status on Devnet");
  console.log("=".repeat(60));

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  console.log(`\n📋 Configuration:`);
  console.log(`   - Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`   - Wallet: ${wallet.publicKey.toString()}`);
  console.log(`   - Cluster Offset: ${CLUSTER_OFFSET}`);
  console.log(`   - Cluster: ${ARCIUM_CLUSTER_DEVNET.toString()}`);

  const mxeAddress = getMXEAccAddress(PROGRAM_ID);
  console.log(`\n🔑 MXE Account:`);
  console.log(`   - Address: ${mxeAddress.toString()}`);

  try {
    const accountInfo = await connection.getAccountInfo(mxeAddress);
    if (accountInfo) {
      console.log(`   ✅ MXE exists with ${accountInfo.data.length} bytes`);
      console.log(`   - Owner: ${accountInfo.owner.toString()}`);
    } else {
      console.log(`   ❌ MXE does not exist`);
      console.log(`\n⚠️  You need to run: arcium deploy --cluster-offset ${CLUSTER_OFFSET}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error checking MXE: ${error.message}`);
  }
}

main().catch(console.error);
