import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";

async function initCompDefs() {
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
  const idl = JSON.parse(
    require("fs").readFileSync("target/idl/anonyme_transfer.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<AnonymeTransfer>;

  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  console.log("MXE:", getMXEAccAddress(programId).toString());

  // Initialize encrypt_pda_hash comp_def
  await initCompDef(program, provider, programId, "encrypt_pda_hash", "initEncryptPdaCompDef");

  // Initialize decrypt_pda_hash comp_def
  await initCompDef(program, provider, programId, "decrypt_pda_hash", "initDecryptPdaCompDef");

  console.log("\n✅ All comp defs initialized!");
}

async function initCompDef(
  program: Program<AnonymeTransfer>,
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  instructionName: string,
  methodName: string
) {
  const offset = getCompDefAccOffset(instructionName);
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [compDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, programId.toBuffer(), offset],
    getArciumProgAddress()
  );

  console.log(`\n=== ${instructionName} ===`);
  console.log(`Comp def PDA: ${compDefPDA.toString()}`);

  // Check if exists
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (accountInfo) {
    console.log("✅ Already initialized");
    return;
  }

  console.log("Initializing...");
  try {
    const sig = await (program as any).methods[methodName]()
      .accounts({
        compDefAccount: compDefPDA,
        payer: provider.wallet.publicKey,
        mxeAccount: getMXEAccAddress(programId),
      })
      .rpc({
        commitment: "confirmed",
      });

    console.log(`✅ Initialized: ${sig}`);
    await provider.connection.confirmTransaction(sig, "confirmed");
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.logs) {
      console.error("\nLogs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    throw error;
  }
}

initCompDefs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
