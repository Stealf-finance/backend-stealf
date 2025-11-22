/**
 * Abstract base class for all signer-related errors.
 *
 * @remarks
 * This class provides a foundation for all signer errors, ensuring consistent
 * error handling and type safety across signer implementations. All signer errors
 * should extend this class.
 *
 * @public
 */
export class SignerError extends Error {
    /**
     * Creates a new instance of SignerError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, cause) {
        super(message);
        this.name = this.constructor.name;
        this.cause = cause;
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
/**
 * Abstract base class defining the contract for Solana message and transaction signing.
 *
 * @remarks
 * Implementations of this class must provide cryptographic signing capabilities
 * for Solana blockchain operations. All methods are asynchronous to support
 * hardware wallets, remote signers, and other async signing mechanisms.
 *
 * @public
 *
 * @example
 * ```typescript
 * class WalletAdapterSigner extends ISigner {
 *   async signMessage(message: Bytes): Promise<SolanaSignature> {
 *     return await this.wallet.signMessage(message);
 *   }
 *
 *   async signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> {
 *     return await this.wallet.signTransaction(tx);
 *   }
 *
 *   async signTransactions(txs: VersionedTransaction[]): Promise<VersionedTransaction[]> {
 *     return await this.wallet.signAllTransactions(txs);
 *   }
 *
 *   async getPublicKey(): Promise<SolanaAddress> {
 *     return this.wallet.publicKey as SolanaAddress;
 *   }
 * }
 * ```
 */
export class ISigner {
}
