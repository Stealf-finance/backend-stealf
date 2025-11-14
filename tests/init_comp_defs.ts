import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import { AnonymeTransfer } from "../target/types/anonyme_transfer";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

describe("Initialize Computation Definitions on Devnet", () => {
  const DEVNET_RPC = "https://api.devnet.solana.com";
  const PROGRAM_ID = new PublicKey("2KftoWDxRvz1QjUDZgxwYNwLBGQ29N8chbHrfm8hCEdY");

  function readKpJson(path: string) {
    const file = fs.readFileSync(path);
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }

  it("Initialize wrap comp_def", async () => {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const wallet = new anchor.Wallet(
      readKpJson(`${os.homedir()}/.config/solana/id.json`)
    );
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = anchor.workspace
      .AnonymeTransfer as Program<AnonymeTransfer>;

    console.log("\n" + "=".repeat(70));
    console.log("🔧 INITIALIZING WRAP COMP_DEF ON DEVNET");
    console.log("=".repeat(70));
    console.log("Program ID:", PROGRAM_ID.toBase58());
    console.log("Wallet:", wallet.publicKey.toBase58());

    const wrapOffset = getCompDefAccOffset("wrap");
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

    const [wrapCompDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), wrapOffset],
      getArciumProgAddress()
    );

    console.log("Wrap comp_def PDA:", wrapCompDefPDA.toBase58());

    // Check if already initialized
    try {
      const existingAccount = await connection.getAccountInfo(wrapCompDefPDA);
      if (existingAccount) {
        console.log(
          "✅ Wrap comp_def already initialized at:",
          wrapCompDefPDA.toBase58()
        );
        console.log("   Skipping initialization");
        return;
      }
    } catch (e) {
      console.log("Comp_def not yet initialized, proceeding...");
    }

    console.log("\n⏳ Initializing wrap comp_def...");

    const sig = await program.methods
      .initWrapCompDef()
      .accountsPartial({
        payer: wallet.publicKey,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        compDefAccount: wrapCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log("✅ Wrap comp_def initialized successfully!");
    console.log("   Signature:", sig);
    console.log("   🔗 View: https://solscan.io/tx/" + sig + "?cluster=devnet");
    console.log("=".repeat(70));
  });

  it("Initialize transfer comp_def", async () => {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const wallet = new anchor.Wallet(
      readKpJson(`${os.homedir()}/.config/solana/id.json`)
    );
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = anchor.workspace
      .AnonymeTransfer as Program<AnonymeTransfer>;

    console.log("\n" + "=".repeat(70));
    console.log("🔧 INITIALIZING TRANSFER COMP_DEF ON DEVNET");
    console.log("=".repeat(70));
    console.log("Program ID:", PROGRAM_ID.toBase58());
    console.log("Wallet:", wallet.publicKey.toBase58());

    const transferOffset = getCompDefAccOffset("transfer");
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

    const [transferCompDefPDA] = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), transferOffset],
      getArciumProgAddress()
    );

    console.log("Transfer comp_def PDA:", transferCompDefPDA.toBase58());

    // Check if already initialized
    try {
      const existingAccount = await connection.getAccountInfo(
        transferCompDefPDA
      );
      if (existingAccount) {
        console.log(
          "✅ Transfer comp_def already initialized at:",
          transferCompDefPDA.toBase58()
        );
        console.log("   Skipping initialization");
        return;
      }
    } catch (e) {
      console.log("Comp_def not yet initialized, proceeding...");
    }

    console.log("\n⏳ Initializing transfer comp_def...");

    const sig = await program.methods
      .initTransferCompDef()
      .accountsPartial({
        payer: wallet.publicKey,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        compDefAccount: transferCompDefPDA,
        arciumProgram: getArciumProgAddress(),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log("✅ Transfer comp_def initialized successfully!");
    console.log("   Signature:", sig);
    console.log("   🔗 View: https://solscan.io/tx/" + sig + "?cluster=devnet");
    console.log("=".repeat(70));
  });
});
