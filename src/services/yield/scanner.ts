import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getSolVaultPda, MIN_DEPOSIT_LAMPORTS } from "./constant";
import { initUserState } from "./initUserState";
import { processDeposit } from "./deposit";
import { queryAndEmitBalance } from "./balance";
import { stakeToJito } from "./staking";
import baseLogger from "../../config/logger";

const log = baseLogger.child({ module: "VaultScanner" });

// --- Dedup ---

const MAX_DEDUP = 5_000;
const processed = new Set<string>();

function dedup(signature: string): boolean {
  if (processed.has(signature)) return false;
  processed.add(signature);
  if (processed.size > MAX_DEDUP) {
    const it = processed.values();
    for (let i = 0; i < MAX_DEDUP / 2; i++) {
      processed.delete(it.next().value!);
    }
  }
  return true;
}

// --- Memo parsing ---

/**
 * Memo is a JSON string sent by the frontend via SPL Memo:
 * {
 *   "hashUserId": "02ce0ef9...",        // 32 bytes hex — SHA256(u128ToLE(userId))
 *   "ephemeralPublicKey": "555a88ca...", // 32 bytes hex — x25519 ephemeral pub key
 *   "nonce": "ca197185...",             // 16 bytes hex — RescueCipher nonce
 *   "ciphertext": "1086f91a..."         // 32 bytes hex — encrypted userId
 * }
 */
interface ParsedMemo {
  userIdHash: Buffer;
  memoEphPub: Uint8Array;
  memoNonce: Buffer;
  memoCt: Uint8Array;
}

function parseMemo(raw: string): ParsedMemo {
  const json = JSON.parse(raw);

  const userIdHash = Buffer.from(json.hashUserId, "hex");
  const memoEphPub = new Uint8Array(Buffer.from(json.ephemeralPublicKey, "hex"));
  const memoNonce = Buffer.from(json.nonce, "hex");
  const memoCt = new Uint8Array(Buffer.from(json.ciphertext, "hex"));

  if (userIdHash.length !== 32) throw new Error(`Invalid hashUserId length: ${userIdHash.length}`);
  if (memoEphPub.length !== 32) throw new Error(`Invalid ephemeralPublicKey length: ${memoEphPub.length}`);
  if (memoNonce.length !== 16) throw new Error(`Invalid nonce length: ${memoNonce.length}`);

  return { userIdHash, memoEphPub, memoNonce, memoCt };
}

// --- Memo extraction from Helius payload ---

const MEMO_PROGRAMS = new Set([
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJBfCR6MNhJeQBGUagFdFaAg3MPkpT51ypAS",
]);

function extractMemo(tx: any): string | null {
  const instructions = tx.instructions || [];
  for (const ix of instructions) {
    if (MEMO_PROGRAMS.has(ix.programId) || ix.program === "spl-memo") {
      if (ix.data) {
        try {
          const bs58 = require("bs58");
          return Buffer.from(bs58.decode(ix.data)).toString("utf-8");
        } catch {
          return ix.data;
        }
      }
      return ix.memo || null;
    }
  }
  return null;
}

// --- Processing queue (serialize staking to avoid balance race conditions) ---

let processingChain = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    processingChain = processingChain.then(fn).then(resolve, reject);
  });
}

// --- Main handler ---

const [solVault] = getSolVaultPda();
const VAULT_ADDRESS = solVault.toBase58();

/**
 * Handle Helius webhook payload for the vault.
 * For each SOL deposit to the vault that carries a memo,
 * triggers MPC bookkeeping (processDeposit) then Jito staking.
 */
export async function handleVaultTransaction(payload: any): Promise<void> {
  const transactions = Array.isArray(payload) ? payload : [payload];

  for (const tx of transactions) {
    const signature: string | undefined = tx?.signature;
    if (!signature) continue;
    if (!dedup(signature)) continue;

    // Find SOL deposit to vault
    const nativeTransfers: any[] = tx.nativeTransfers || [];
    const deposit = nativeTransfers.find(
      (t: any) => t.toUserAccount === VAULT_ADDRESS && (t.amount || 0) > 0,
    );
    if (!deposit) continue;

    const amountLamports: number = deposit.amount;

    // Minimum deposit check
    if (amountLamports < MIN_DEPOSIT_LAMPORTS) {
      log.debug(
        { sig: signature.slice(0, 12), amount: amountLamports },
        "Deposit below minimum — skipping",
      );
      continue;
    }

    // Extract memo
    const memo = extractMemo(tx);
    if (!memo) {
      log.warn(
        { sig: signature.slice(0, 12), amount: amountLamports / LAMPORTS_PER_SOL },
        "Vault deposit without memo — skipping",
      );
      continue;
    }

    log.info(
      { sig: signature.slice(0, 12), sol: amountLamports / LAMPORTS_PER_SOL },
      "Vault deposit detected",
    );

    try {
      //  Parse JSON memo → userIdHash + encrypted user identification
      const { userIdHash, memoEphPub, memoNonce, memoCt } = parseMemo(memo);

      await enqueue(async () => {
        await initUserState(userIdHash);

        const jitosolAmount = await stakeToJito(amountLamports);
        await processDeposit(userIdHash, jitosolAmount, memoEphPub, memoNonce, memoCt);

        log.info(
          { sig: signature.slice(0, 12), solIn: amountLamports, jitosolStored: jitosolAmount.toString() },
          "Vault deposit fully processed",
        );

        //Emit updated balance to frontend (fire-and-forget, outside the queue)
        queryAndEmitBalance(userIdHash).catch((err) =>
          log.error({ err }, "Failed to emit yield balance after deposit"),
        );
      });
    } catch (err) {
      log.error({ err, sig: signature.slice(0, 12) }, "Failed to process vault deposit");
    }
  }
}
