import { ITransactionForwarder, TransactionForwarderError } from '@/client/interface';
import { Connection } from '@solana/web3.js';
/**
 * Error thrown when a single transaction forwarding operation fails.
 *
 * @remarks
 * This error is thrown when `forwardTransaction` fails due to network errors,
 * invalid transaction, insufficient fees, or other forwarding issues.
 *
 * @public
 */
export class TransactionForwardingError extends TransactionForwarderError {
    /**
     * Creates a new instance of TransactionForwardingError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, cause) {
        super(message, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'CONNECTION_FORWARDER_TRANSACTION_ERROR';
    }
}
/**
 * Error thrown when batch transaction forwarding operation fails.
 *
 * @remarks
 * This error is thrown when `forwardTransactions` fails for any transaction
 * in the batch. The error message should indicate which transaction(s) failed.
 *
 * @public
 */
export class BatchTransactionForwardingError extends TransactionForwarderError {
    /**
     * Creates a new instance of BatchTransactionForwardingError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, cause) {
        super(message, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'CONNECTION_FORWARDER_BATCH_ERROR';
    }
}
/**
 * Error thrown when the delays array length is invalid for variable delay forwarding.
 *
 * @remarks
 * This error is thrown when `forwardTransactions` is called with variable delays and the
 * delays array length does not match `transactions.length - 1`.
 *
 * @public
 */
export class InvalidDelayArrayError extends TransactionForwarderError {
    /**
     * Creates a new instance of InvalidDelayArrayError.
     *
     * @param transactionsLength - The number of transactions
     * @param delaysLength - The number of delays provided
     * @param cause - Optional underlying error that caused this error
     */
    constructor(transactionsLength, delaysLength, cause) {
        super(`Invalid delays array length: expected ${transactionsLength - 1} delays for ${transactionsLength} transactions, but got ${delaysLength}`, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'CONNECTION_FORWARDER_INVALID_DELAY_ARRAY';
    }
}
/**
 * Transaction forwarder implementation that uses a Solana Connection to forward transactions.
 *
 * @remarks
 * This forwarder directly submits transactions to the Solana network using the provided
 * `Connection` instance. It supports forwarding single transactions and batches of transactions,
 * with optional delays between transactions to prevent rate limiting.
 *
 * **Features:**
 * - Direct RPC submission via Solana Connection
 * - Sequential transaction forwarding with confirmation
 * - Fixed and variable delay support between transactions (after confirmation)
 * - Comprehensive error handling with specific error types
 *
 * @public
 *
 * @example
 * ```typescript
 * // Create from existing connection
 * const connection = new Connection('https://api.mainnet-beta.solana.com');
 * const forwarder = ConnectionBasedForwarder.fromConnection(connection);
 *
 * // Or create from RPC URL
 * const forwarder = ConnectionBasedForwarder.fromRpcUrl('https://api.mainnet-beta.solana.com');
 *
 * // Forward a single transaction
 * const signature = await forwarder.forwardTransaction(signedTx);
 *
 * // Forward multiple transactions sequentially (each confirmed before next)
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3]);
 *
 * // Forward with fixed delay
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3], 500);
 *
 * // Forward with variable delays
 * const delays = [200, 500, 300];
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3, tx4], delays);
 *
 * // Resume from offset with fixed delay
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3], 1, 500);
 *
 * // Resume from offset with variable delays
 * const delays = [200, 500];
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3, tx4], 1, delays);
 * ```
 */
export class ConnectionBasedForwarder extends ITransactionForwarder {
    /**
     * Creates a new instance of ConnectionBasedForwarder.
     *
     * @param connection - The Solana Connection instance to use for forwarding
     */
    constructor(connection) {
        super();
        this.connection = connection;
    }
    /**
     * Returns the underlying Solana `Connection` instance used by this forwarder.
     *
     * @returns The `Connection` instance.
     */
    getConnection() {
        return this.connection;
    }
    /**
     * Creates a ConnectionBasedForwarder from an existing Connection instance.
     *
     * @param connection - The Solana Connection instance to use
     * @returns A new ConnectionBasedForwarder instance
     *
     * @example
     * ```typescript
     * const connection = new Connection('https://api.mainnet-beta.solana.com');
     * const forwarder = ConnectionBasedForwarder.fromConnection(connection);
     * ```
     */
    static fromConnection(connection) {
        return new ConnectionBasedForwarder(connection);
    }
    /**
     * Creates a ConnectionBasedForwarder from an RPC URL.
     *
     * @param rpcUrl - The RPC endpoint URL (e.g., 'https://api.mainnet-beta.solana.com')
     * @returns A new ConnectionBasedForwarder instance
     *
     * @example
     * ```typescript
     * const forwarder = ConnectionBasedForwarder.fromRpcUrl('https://api.mainnet-beta.solana.com');
     * ```
     */
    static fromRpcUrl(rpcUrl) {
        return new ConnectionBasedForwarder(new Connection(rpcUrl));
    }
    /**
     * Forwards a single signed transaction to the network and waits for confirmation.
     *
     * @param transaction - The signed `VersionedTransaction` to forward
     * @returns A promise resolving to the transaction signature
     *
     * @throws {@link TransactionForwardingError} When forwarding fails due to network errors, invalid transaction, insufficient fees, or connection issues
     *
     * @remarks
     * This method submits a single signed transaction to the Solana network using the
     * underlying Connection's `sendTransaction` method and waits for confirmation before
     * returning. The transaction must be fully signed before calling this method.
     *
     * @example
     * ```typescript
     * const signedTx = await signer.signTransaction(transaction);
     * const signature = await forwarder.forwardTransaction(signedTx);
     * console.log(`Transaction forwarded and confirmed: ${signature}`);
     * ```
     */
    async forwardTransaction(transaction) {
        try {
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            return signature;
        }
        catch (error) {
            throw new TransactionForwardingError(`Failed to forward transaction: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Implementation of forwardTransactions that handles all overloads.
     *
     * @internal
     */
    async forwardTransactions(transactions, delayOrDelaysOrOffset, delayOrDelays) {
        try {
            // Handle offset-based overloads (3 parameters)
            if (delayOrDelays !== undefined) {
                const offset = delayOrDelaysOrOffset;
                if (typeof offset !== 'number') {
                    throw new BatchTransactionForwardingError('Invalid offset parameter type');
                }
                if (offset < 0 || offset >= transactions.length) {
                    throw new BatchTransactionForwardingError(`Offset ${offset} is out of bounds for array of length ${transactions.length}`);
                }
                if (typeof delayOrDelays === 'number') {
                    return await this.forwardTransactionsWithOffsetAndFixedDelay(transactions, offset, delayOrDelays);
                }
                if (Array.isArray(delayOrDelays)) {
                    return await this.forwardTransactionsWithOffsetAndVariableDelays(transactions, offset, delayOrDelays);
                }
                throw new BatchTransactionForwardingError('Invalid delay parameter type for offset overload');
            }
            // Handle non-offset overloads (2 parameters or less)
            if (delayOrDelaysOrOffset === undefined) {
                return await this.forwardTransactionsSequentially(transactions);
            }
            if (typeof delayOrDelaysOrOffset === 'number') {
                return await this.forwardTransactionsWithFixedDelay(transactions, delayOrDelaysOrOffset);
            }
            if (Array.isArray(delayOrDelaysOrOffset)) {
                return await this.forwardTransactionsWithVariableDelays(transactions, delayOrDelaysOrOffset);
            }
            throw new BatchTransactionForwardingError('Invalid parameter type');
        }
        catch (error) {
            if (error instanceof TransactionForwarderError) {
                throw error;
            }
            throw new BatchTransactionForwardingError(`Failed to forward batch transactions: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Forwards transactions sequentially, confirming each before sending the next.
     *
     * @param transactions - Array of transactions to forward
     * @returns Array of transaction signatures
     *
     * @internal
     */
    async forwardTransactionsSequentially(transactions) {
        const signatures = [];
        for (const transaction of transactions) {
            if (!transaction) {
                throw new BatchTransactionForwardingError(`Transaction is undefined`);
            }
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            signatures.push(signature);
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially with a fixed delay between each, confirming each before sending the next.
     *
     * @param transactions - Array of transactions to forward
     * @param delayMs - Fixed delay in milliseconds between transactions (after confirmation)
     * @returns Array of transaction signatures
     *
     * @internal
     */
    async forwardTransactionsWithFixedDelay(transactions, delayMs) {
        const signatures = [];
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new BatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            signatures.push(signature);
            if (i < transactions.length - 1) {
                await this.sleep(delayMs);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially with variable delays between each, confirming each before sending the next.
     *
     * @param transactions - Array of transactions to forward
     * @param delaysMs - Array of delays in milliseconds (must have length `transactions.length - 1`)
     * @returns Array of transaction signatures
     *
     * @internal
     */
    async forwardTransactionsWithVariableDelays(transactions, delaysMs) {
        if (delaysMs.length !== transactions.length - 1) {
            throw new InvalidDelayArrayError(transactions.length, delaysMs.length);
        }
        const signatures = [];
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new BatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            signatures.push(signature);
            if (i < transactions.length - 1) {
                const delay = delaysMs[i];
                if (delay === undefined) {
                    throw new BatchTransactionForwardingError(`Delay at index ${i} is undefined`);
                }
                await this.sleep(delay);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially starting from a specific offset with a fixed delay, confirming each before sending the next.
     *
     * @param transactions - Array of transactions to forward
     * @param offset - The index to start from
     * @param delayMs - Fixed delay in milliseconds between transactions (after confirmation)
     * @returns Array of transaction signatures for the remaining transactions
     *
     * @internal
     */
    async forwardTransactionsWithOffsetAndFixedDelay(transactions, offset, delayMs) {
        const signatures = [];
        for (let i = offset; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new BatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            signatures.push(signature);
            // Wait before next transaction (except after the last one)
            if (i < transactions.length - 1 && delayMs > 0) {
                await this.sleep(delayMs);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially starting from a specific offset with variable delays, confirming each before sending the next.
     *
     * @param transactions - Array of transactions to forward
     * @param offset - The index to start from
     * @param delaysMs - Array of delays in milliseconds (must have length `(transactions.length - offset) - 1`)
     * @returns Array of transaction signatures for the remaining transactions
     *
     * @internal
     */
    async forwardTransactionsWithOffsetAndVariableDelays(transactions, offset, delaysMs) {
        const remainingCount = transactions.length - offset;
        const expectedDelaysLength = remainingCount - 1;
        if (delaysMs.length !== expectedDelaysLength) {
            throw new InvalidDelayArrayError(remainingCount, delaysMs.length);
        }
        const signatures = [];
        let delayIndex = 0;
        for (let i = offset; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new BatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.connection.sendTransaction(transaction);
            await this.connection.confirmTransaction(signature);
            signatures.push(signature);
            // Wait before next transaction (except after the last one)
            if (i < transactions.length - 1) {
                const delay = delaysMs[delayIndex];
                if (delay === undefined) {
                    throw new BatchTransactionForwardingError(`Delay at index ${delayIndex} is undefined`);
                }
                await this.sleep(delay);
                delayIndex++;
            }
        }
        return signatures;
    }
    /**
     * Sleeps for the specified number of milliseconds.
     *
     * @param ms - Number of milliseconds to sleep
     * @returns A promise that resolves after the specified delay
     *
     * @internal
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
