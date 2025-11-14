import { Connection, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress } from "@arcium-hq/client";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
const mxeAddress = getMXEAccAddress(programId);

console.log("Program ID:", programId.toString());
console.log("MXE Address:", mxeAddress.toString());

connection.getAccountInfo(mxeAddress).then(accountInfo => {
  if (accountInfo) {
    console.log("\n✅ MXE account EXISTS!");
    console.log("   Owner:", accountInfo.owner.toString());
    console.log("   Data length:", accountInfo.data.length);
    console.log("   Lamports:", accountInfo.lamports);
    console.log("   Executable:", accountInfo.executable);
  } else {
    console.log("\n❌ MXE account does NOT exist");
  }
  process.exit(0);
}).catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
