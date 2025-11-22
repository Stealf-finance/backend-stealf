/**
 * Abstract base class for all transaction forwarder-related errors.
 *
 * @remarks
 * This class provides a foundation for all transaction forwarder errors, ensuring consistent
 * error handling and type safety across forwarder implementations. All transaction forwarder errors
 * in implementations should extend this class and provide a unique error code.
 *
 * The error code serves as an identifier for programmatic error handling and allows implementations
 * to define specific error types with associated codes for different failure scenarios.
 *
 * @public
 */
export class TransactionForwarderError extends Error {
    /**
     * Creates a new instance of TransactionForwarderError.
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
 * Abstract base class defining the contract for forwarding Solana transactions.
 *
 * @remarks
 * Implementations of this class must provide transaction forwarding capabilities for Solana
 * blockchain operations. Transaction forwarders are responsible for submitting signed transactions
 * to the network, handling retries, and managing transaction lifecycle.
 *
 * This interface supports forwarding both single transactions and batches of transactions,
 * allowing implementations to optimize for different use cases such as:
 * - Direct RPC submission
 * - Relayer services
 * - Transaction batching and optimization
 * - Custom routing logic
 *
 * The generic type parameter `T` represents the return type of the forwarding operation,
 * which may vary by implementation (e.g., transaction signatures, receipt objects, or custom response types).
 *
 * @typeParam T - The type returned after successfully forwarding a transaction
 *
 * @public
 *
 * @example
 * ```typescript
 * // Example with transaction signature as return type
 * class RpcTransactionForwarder extends ITransactionForwarder<string> {
 *   async forwardTransaction(tx: VersionedTransaction): Promise<string> {
 *     const signature = await this.connection.sendTransaction(tx);
 *     return signature;
 *   }
 *
 *   async forwardTransactions(txs: VersionedTransaction[]): Promise<string[]> {
 *     const signatures = await Promise.all(
 *       txs.map(tx => this.connection.sendTransaction(tx))
 *     );
 *     return signatures;
 *   }
 * }
 *
 * // Example with custom response type
 * interface ForwardResponse {
 *   signature: string;
 *   slot: number;
 *   confirmation: string;
 * }
 *
 * class RelayerForwarder extends ITransactionForwarder<ForwardResponse> {
 *   async forwardTransaction(tx: VersionedTransaction): Promise<ForwardResponse> {
 *     // Implementation using relayer service
 *   }
 *   // ... other methods
 * }
 * ```
 */
export class ITransactionForwarder {
}
