import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";
import * as fs from "fs";

const DEVNET_RPC = "https://api.devnet.solana.com";

async function main() {
  const idl = JSON.parse(fs.readFileSync("./target/idl/private.json", "utf8"));
  const programId = new PublicKey(idl.address);

  console.log("Program ID:", programId.toString());

  const mxeAddress = getMXEAccAddress(programId);
  console.log("MXE Address:", mxeAddress.toString());

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const accountInfo = await connection.getAccountInfo(mxeAddress);

  if (accountInfo) {
    console.log("✅ MXE exists with", accountInfo.data.length, "bytes");
    console.log("   Owner:", accountInfo.owner.toString());
  } else {
    console.log("❌ MXE does not exist - needs initialization");
    console.log("\nRun: arcium deploy --cluster-offset 1078779259 --skip-deploy");
  }
}

main().catch(console.error);
