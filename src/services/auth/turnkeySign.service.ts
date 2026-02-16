import { Turnkey } from "@turnkey/sdk-server";
import { Connection, Transaction } from "@solana/web3.js";

let _turnkeyClient: Turnkey | null = null;

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

/**
 * Signs and sends a transaction from a user's Cash wallet via Turnkey.
 *
 * @param subOrgId - The Turnkey sub-organization ID
 * @param unsignedTransactionHex - Hex-encoded unsigned transaction
 * @returns Transaction signature
 */
export async function signAndSendCashWalletTransaction(
  subOrgId: string,
  unsignedTransactionHex: string
): Promise<string> {
  const turnkey = getTurnkeyClient();
  const client = turnkey.apiClient();

  console.log(`[TurnkeySign] Signing for subOrg: ${subOrgId}`);

  // Get the wallet for this sub-org
  const walletsResponse = await client.getWallets({
    organizationId: subOrgId,
  });

  const wallet = walletsResponse.wallets?.[0];
  if (!wallet) {
    throw new Error("No wallet found in sub-organization");
  }

  // Get wallet accounts to find the Solana address
  const accountsResponse = await client.getWalletAccounts({
    organizationId: subOrgId,
    walletId: wallet.walletId,
  });

  const account = accountsResponse.accounts?.[0];
  if (!account) {
    throw new Error("No wallet account found");
  }

  console.log(`[TurnkeySign] Signing with address: ${account.address}`);

  // Sign the transaction via Turnkey's signTransaction (designed for Solana)
  const signResult = await client.signTransaction({
    organizationId: subOrgId,
    signWith: account.address,
    unsignedTransaction: unsignedTransactionHex,
    type: "TRANSACTION_TYPE_SOLANA",
  });

  console.log(`[TurnkeySign] Transaction signed successfully`);

  // Send the signed transaction
  const signedTxBytes = Buffer.from(signResult.signedTransaction, "hex");
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const txSignature = await connection.sendRawTransaction(signedTxBytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  console.log(`[TurnkeySign] Transaction sent: ${txSignature}`);
  return txSignature;
}
