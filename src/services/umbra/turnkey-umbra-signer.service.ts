/**
 * Crée un IUmbraSigner délégant au wallet Cash via Turnkey.
 * - signMessage → Turnkey signRawPayload (Ed25519 déterministe)
 * - signTransaction → Turnkey signTransaction (@solana/kit ↔ hex)
 * Requirements: 1.4
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IUmbraSigner = any;

/**
 * Crée un IUmbraSigner pour le Cash wallet (Turnkey server-side).
 * Compatible avec getUserRegistrationFunction() du SDK Umbra.
 */
export async function createTurnkeyUmbraSigner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  turnkeyApiClient: any,
  subOrgId: string,
  cashWalletAddress: string,
): Promise<IUmbraSigner> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getTransactionEncoder, getTransactionDecoder } = require('@solana/kit');

  return {
    address: cashWalletAddress,

    /**
     * Signe un message arbitraire via Turnkey signRawPayload.
     * Ed25519 est déterministe : même input → même signature.
     * Utilisé par le SDK pour dériver le master seed Umbra.
     */
    async signMessage(message: Uint8Array) {
      const payloadHex = Buffer.from(message).toString('hex');
      const result = await turnkeyApiClient.signRawPayload({
        organizationId: subOrgId,
        signWith: cashWalletAddress,
        payload: payloadHex,
        encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
        hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE',
      });
      // Ed25519 signature = r (32 bytes) || s (32 bytes)
      const sigBytes = new Uint8Array(Buffer.from(result.r + result.s, 'hex'));
      return { message, signature: sigBytes, signer: cashWalletAddress };
    },

    /**
     * Signe une transaction @solana/kit via Turnkey signTransaction.
     * Sérialise la TX en hex → Turnkey signe → désérialise → extrait notre signature.
     */
    async signTransaction(transaction: unknown) {
      const txBytes = getTransactionEncoder().encode(transaction);
      const txHex = Buffer.from(txBytes as Uint8Array).toString('hex');

      const result = await turnkeyApiClient.signTransaction({
        organizationId: subOrgId,
        signWith: cashWalletAddress,
        unsignedTransaction: txHex,
        type: 'TRANSACTION_TYPE_SOLANA',
      });

      const signedBytes = Buffer.from(result.signedTransaction, 'hex');
      const signedTx = getTransactionDecoder().decode(new Uint8Array(signedBytes)) as any;
      const ourSig = signedTx.signatures?.[cashWalletAddress];

      return {
        ...(transaction as object),
        signatures: {
          ...(transaction as any).signatures,
          ...(ourSig ? { [cashWalletAddress]: ourSig } : {}),
        },
      };
    },

    async signTransactions(transactions: unknown[]) {
      return Promise.all(transactions.map((tx) => this.signTransaction(tx)));
    },
  };
}
