import { Turnkey } from "@turnkey/sdk-server";
import { Connection } from "@solana/web3.js";

let _turnkeyClient: Turnkey | null = null;
let _connection: Connection | null = null;

function getTurnkeyClient(): Turnkey {
  if (!_turnkeyClient) {
    _turnkeyClient = new Turnkey({
      apiBaseUrl: "https://api.turnkey.com",
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
      defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
    });
  }
  return _turnkeyClient;
}

function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      "confirmed"
    );
  }
  return _connection;
}

/**
 * Signs and sends a transaction from a user's Cash wallet via Turnkey.
 * Pass cashWalletAddress to skip getWallets/getWalletAccounts round-trips (-2 API calls).
 *
 * @param subOrgId - The Turnkey sub-organization ID
 * @param unsignedTransactionHex - Hex-encoded unsigned transaction
 * @param cashWalletAddress - Solana address of the cash wallet (stored in DB)
 * @returns Transaction signature
 */
export async function signAndSendCashWalletTransaction(
  subOrgId: string,
  unsignedTransactionHex: string,
  cashWalletAddress?: string
): Promise<string> {
  const turnkey = getTurnkeyClient();
  const client = turnkey.apiClient();

  let signWith = cashWalletAddress;

  if (!signWith) {
    // Fallback: resolve address from Turnkey (2 extra round-trips)
    const walletsResponse = await client.getWallets({ organizationId: subOrgId });
    const wallet = walletsResponse.wallets?.[0];
    if (!wallet) throw new Error("No wallet found in sub-organization");
    const accountsResponse = await client.getWalletAccounts({
      organizationId: subOrgId,
      walletId: wallet.walletId,
    });
    const account = accountsResponse.accounts?.[0];
    if (!account) throw new Error("No wallet account found");
    signWith = account.address;
  }

  console.log(`[TurnkeySign] Signing with address: ${signWith}`);

  const signResult = await client.signTransaction({
    organizationId: subOrgId,
    signWith,
    unsignedTransaction: unsignedTransactionHex,
    type: "TRANSACTION_TYPE_SOLANA",
  });

  const conn = getConnection();
  const signedTxBytes = Buffer.from(signResult.signedTransaction, "hex");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('processed');
  const txSignature = await conn.sendRawTransaction(signedTxBytes, {
    skipPreflight: false,
    preflightCommitment: "processed",
  });

  console.log(`[TurnkeySign] Transaction sent: ${txSignature}`);
  await conn.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'processed');
  console.log(`[TurnkeySign] Transaction confirmed (processed): ${txSignature}`);
  return txSignature;
}
