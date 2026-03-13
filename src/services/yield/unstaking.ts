import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import axios from "axios";
import BN from "bn.js";
import {
  VAULT_PROGRAM_ID,
  JITOSOL_MINT,
  JUPITER_API_BASE,
  MAX_SLIPPAGE_BPS,
  getVaultStatePda,
  getSolVaultPda,
} from "./constant";
import idl from "../../idl/stealf_vault.json";
import logger from "../../config/logger";

// --- Helpers ---

function getVaultAuthority(): Keypair {
  const key = process.env.VAULT_AUTHORITY_PRIVATE_KEY;
  if (!key) throw new Error("VAULT_AUTHORITY_PRIVATE_KEY not configured");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key)));
}

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");
  return new Connection(rpcUrl, "confirmed");
}

function isDevnet(): boolean {
  return (process.env.SOLANA_RPC_URL || "").includes("devnet");
}

function getJupiterApiKey(): string {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("JUPITER_API_KEY not configured");
  return key;
}

function getIdlDiscriminator(instructionName: string): Buffer {
  const ix = idl.instructions.find((i) => i.name === instructionName);
  if (!ix) throw new Error(`IDL instruction ${instructionName} not found`);
  return Buffer.from(ix.discriminator);
}

// --- Unstaking ---

export async function unstakeAndSend(
  amountLamports: number,
  recipientAddress: string,
): Promise<{ signature: string; estimatedSolOut: number }> {
  const connection = getConnection();
  const authority = getVaultAuthority();
  const [vaultState] = getVaultStatePda();
  const recipient = new PublicKey(recipientAddress);

  // --- Devnet: simple vault PDA → recipient ---
  if (isDevnet()) {
    const [solVault] = getSolVaultPda();

    const discriminator = getIdlDiscriminator("withdraw_sol");
    const data = Buffer.alloc(8 + 8);
    discriminator.copy(data, 0);
    new BN(amountLamports).toBuffer("le", 8).copy(data, 8);

    const tx = new Transaction();
    tx.add({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: vaultState, isSigner: false, isWritable: false },
        { pubkey: solVault, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    logger.info({ sig: sig.slice(0, 12), amount: amountLamports }, "DEVNET: SOL sent from vault");
    return { signature: sig, estimatedSolOut: amountLamports / 1e9 };
  }

  // --- Mainnet: JitoSOL → SOL via Jupiter ---

  const vaultJitosolAta = await getAssociatedTokenAddress(JITOSOL_MINT, vaultState, true);
  const authorityJitosolAta = await getAssociatedTokenAddress(JITOSOL_MINT, authority.publicKey);

  // Jupiter quote
  const quoteResponse = await axios.get(`${JUPITER_API_BASE}/quote`, {
    params: {
      inputMint: JITOSOL_MINT.toBase58(),
      outputMint: "So11111111111111111111111111111111111111112",
      amount: amountLamports.toString(),
      slippageBps: MAX_SLIPPAGE_BPS,
    },
    headers: { "x-api-key": getJupiterApiKey() },
  });

  const quote = quoteResponse.data;
  const estimatedSolOut = parseInt(quote.outAmount) / 1e9;
  const slippagePercent = ((amountLamports / 1e9 - estimatedSolOut) / (amountLamports / 1e9)) * 100;

  if (slippagePercent > 0.5) {
    throw new Error(`Slippage too high: ${slippagePercent.toFixed(2)}% (max 0.5%)`);
  }

  // Jupiter swap instructions
  const swapResponse = await axios.post(
    `${JUPITER_API_BASE}/swap-instructions`,
    { quoteResponse: quote, userPublicKey: authority.publicKey.toBase58() },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getJupiterApiKey(),
      },
    }
  );

  const swapIxs = swapResponse.data;

  const deserializeIx = (ix: any) => ({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((acc: any) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });

  const tx = new Transaction();

  // Step 1: withdraw JitoSOL from vault ATA → authority ATA
  const discriminator = getIdlDiscriminator("withdraw_token");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  new BN(amountLamports).toBuffer("le", 8).copy(data, 8);

  tx.add({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: vaultJitosolAta, isSigner: false, isWritable: true },
      { pubkey: authorityJitosolAta, isSigner: false, isWritable: true },
      { pubkey: JITOSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Step 2: Jupiter swap JitoSOL → SOL
  if (swapIxs.setupInstructions?.length) {
    for (const ix of swapIxs.setupInstructions) tx.add(deserializeIx(ix));
  }
  tx.add(deserializeIx(swapIxs.swapInstruction));
  if (swapIxs.cleanupInstruction) tx.add(deserializeIx(swapIxs.cleanupInstruction));

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  logger.info(
    { sig: sig.slice(0, 12), jitosolIn: amountLamports, solOut: estimatedSolOut },
    "Unstaked JitoSOL → SOL via Jupiter"
  );

  return { signature: sig, estimatedSolOut };
}
