import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { getMXEAccAddress } from "@arcium-hq/client";
import fs from "fs";
import path from "path";

const PROGRAM_ID = new PublicKey("9e1Ez1FHUzhEfA91hiTA8kFeJJik1sibDDtH5uoftqie");
const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6");
const CLUSTER_OFFSET = 1078779259;
const RPC_ENDPOINT = "https://api.devnet.solana.com";

async function main() {
  console.log("\nInitializing MXE\n");

  const keypairPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const idlPath = path.join(process.cwd(), "target/idl/private.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  const MXE_ACCOUNT = getMXEAccAddress(PROGRAM_ID);
  console.log("MXE Account:", MXE_ACCOUNT.toBase58());
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Cluster Offset:", CLUSTER_OFFSET, "\n");

  try {
    const tx = await program.methods
      .initMxe(CLUSTER_OFFSET)
      .accounts({ payer: payer.publicKey })
      .rpc();
    
    console.log("MXE initialized");
    console.log("TX:", tx);
    console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet\n`);
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}

main().catch(console.error);
