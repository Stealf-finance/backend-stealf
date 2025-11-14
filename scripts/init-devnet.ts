import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  getMXEAccAddress,
  buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import * as fs from "fs";

async function initDevnet() {
  // Configure for devnet
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
    fs.readFileSync("target/idl/anonyme_transfer.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<AnonymeTransfer>;

  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Upload circuits (this will also initialize comp_def accounts if needed)
  console.log("\n=== Uploading encrypt_pda_hash circuit ===");
  await uploadCircuitOnly(
    provider,
    program,
    programId,
    "encrypt_pda_hash",
    "build/encrypt_pda_hash_testnet.arcis"
  );

  console.log("\n=== Uploading decrypt_pda_hash circuit ===");
  await uploadCircuitOnly(
    provider,
    program,
    programId,
    "decrypt_pda_hash",
    "build/decrypt_pda_hash_testnet.arcis"
  );

  console.log("\n✅ All circuits uploaded successfully!");
}

async function uploadCircuitOnly(
  provider: anchor.AnchorProvider,
  program: Program<AnonymeTransfer>,
  programId: PublicKey,
  instructionName: string,
  circuitPath: string
) {
  const offset = getCompDefAccOffset(instructionName);
  const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const [compDefPDA] = PublicKey.findProgramAddressSync(
    [baseSeed, programId.toBuffer(), offset],
    getArciumProgAddress()
  );

  console.log(`Comp def PDA: ${compDefPDA.toString()}`);

  // Check if comp_def account exists
  const accountInfo = await provider.connection.getAccountInfo(compDefPDA);

  if (!accountInfo) {
    console.log("Comp def account does not exist, initializing via program...");

    const methodName =
      instructionName === "encrypt_pda_hash"
        ? "initEncryptPdaCompDef"
        : "initDecryptPdaCompDef";

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

      console.log(`✅ Comp def initialized: ${sig}`);
      await provider.connection.confirmTransaction(sig, "confirmed");
    } catch (error: any) {
      console.error("Error initializing comp_def:", error.message);
      if (error.logs) {
        console.error("\nTransaction logs:");
        error.logs.forEach((log: string) => console.error("  ", log));
      }
      throw error;
    }
  }

  console.log("✅ Comp def account exists, finalizing with circuit...");

  const rawCircuit = fs.readFileSync(circuitPath);
  console.log(`Circuit size: ${rawCircuit.length} bytes`);

  try {
    // First upload the circuit
    console.log("  Uploading raw circuit...");
    await uploadCircuit(
      provider,
      instructionName,
      programId,
      rawCircuit,
      true // useTestnet flag for devnet
    );
    console.log("  ✅ Circuit uploaded");

    // Then finalize the comp_def with the circuit
    console.log("  Finalizing comp_def...");
    const offsetValue = Buffer.from(offset).readUInt32LE();
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      offsetValue,
      programId
    );
    const sig = await provider.sendAndConfirm(finalizeTx);
    console.log("  ✅ Comp def finalized:", sig);
  } catch (error: any) {
    console.error("Error:", error.message);
    if (error.logs) {
      console.error("\nTransaction logs:");
      error.logs.forEach((log: string) => console.error("  ", log));
    }
    // If error is "already in use", the circuit might already be uploaded, try to finalize
    if (error.message?.includes("already in use")) {
      console.log("  Circuit already exists, trying to finalize directly...");
      try {
        const offsetValue = Buffer.from(offset).readUInt32LE();
        const finalizeTx = await buildFinalizeCompDefTx(
          provider,
          offsetValue,
          programId
        );
        const sig = await provider.sendAndConfirm(finalizeTx);
        console.log("  ✅ Comp def finalized:", sig);
      } catch (finalizeError: any) {
        console.error("  Error finalizing:", finalizeError.message);
        throw finalizeError;
      }
    } else {
      throw error;
    }
  }
}

initDevnet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
