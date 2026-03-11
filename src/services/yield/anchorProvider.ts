import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { PrivateYield } from "../target/types/private_yield";

const connection = new Connection(RPC_URL, "confirmed");
const backendKeypair = Keypair.fromSecretKey(/* load from env */);
const wallet = new Wallet(backendKeypair);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

const idl = require("../target/idl/private_yield.json");
const program = new Program<PrivateYield>(idl, provider);