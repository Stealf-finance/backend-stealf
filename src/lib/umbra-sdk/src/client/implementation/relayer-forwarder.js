import { ITransactionForwarder, TransactionForwarderError } from '@/client/interface';
import { PublicKey } from '@solana/web3.js';
import { RELAYER_BASE_URL } from '@/constants/anchor';
/**
 * Error thrown when a single transaction forwarding operation fails via relayer.
 *
 * @remarks
 * This error is thrown when `forwardTransaction` fails due to network errors,
 * invalid transaction, relayer service errors, or other forwarding issues.
 *
 * @public
 */
export class RelayerTransactionForwardingError extends TransactionForwarderError {
    /**
     * Creates a new instance of RelayerTransactionForwardingError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, cause) {
        super(message, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'RELAYER_FORWARDER_TRANSACTION_ERROR';
    }
}
/**
 * Error thrown when batch transaction forwarding operation fails via relayer.
 *
 * @remarks
 * This error is thrown when `forwardTransactions` fails for any transaction
 * in the batch. The error message should indicate which transaction(s) failed.
 *
 * @public
 */
export class RelayerBatchTransactionForwardingError extends TransactionForwarderError {
    /**
     * Creates a new instance of RelayerBatchTransactionForwardingError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, cause) {
        super(message, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'RELAYER_FORWARDER_BATCH_ERROR';
    }
}
/**
 * Error thrown when the delays array length is invalid for variable delay forwarding.
 *
 * @remarks
 * This error is thrown when `forwardTransactions` is called with variable delays and the
 * delays array length does not match the expected length.
 *
 * @public
 */
export class RelayerInvalidDelayArrayError extends TransactionForwarderError {
    /**
     * Creates a new instance of RelayerInvalidDelayArrayError.
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
        this.code = 'RELAYER_FORWARDER_INVALID_DELAY_ARRAY';
    }
}
/**
 * Error thrown when the relayer service returns an error response.
 *
 * @remarks
 * This error is thrown when the relayer endpoint returns an error object
 * in the response instead of a transaction signature.
 *
 * @public
 */
export class RelayerServiceError extends TransactionForwarderError {
    /**
     * Creates a new instance of RelayerServiceError.
     *
     * @param message - Human-readable error message describing what went wrong
     * @param relayerError - The error object returned by the relayer service
     * @param cause - Optional underlying error that caused this error
     */
    constructor(message, relayerError, cause) {
        super(message, cause);
        /**
         * Unique identifier code for this error type.
         */
        this.code = 'RELAYER_FORWARDER_SERVICE_ERROR';
        this.relayerError = relayerError;
    }
}
/**
 * Transaction forwarder implementation that uses a relayer service to forward transactions.
 *
 * @remarks
 * This forwarder submits transactions to a relayer service endpoint. The endpoint URL is
 * constructed by appending the relayer's public key to the base URL defined in
 * `RELAYER_BASE_URL`. Transactions are sent as base64-encoded payloads and the relayer
 * returns transaction signatures.
 *
 * **Features:**
 * - Relayer service submission via HTTP
 * - Sequential transaction forwarding
 * - Fixed and variable delay support between transactions
 * - Offset-based forwarding support
 * - Comprehensive error handling with specific error types
 *
 * @public
 *
 * @example
 * ```typescript
 * // Create from relayer public key (uses RELAYER_BASE_URL constant)
 * const relayerPublicKey = new PublicKey('...') as SolanaAddress;
 * const forwarder = RelayerForwarder.fromPublicKey(relayerPublicKey);
 *
 * // Forward a single transaction
 * const signature = await forwarder.forwardTransaction(signedTx);
 *
 * // Forward multiple transactions sequentially
 * const signatures = await forwarder.forwardTransactions([tx1, tx2, tx3]);
 * ```
 */
export class RelayerForwarder extends ITransactionForwarder {
    /**
     * Creates a new instance of RelayerForwarder.
     *
     * @param relayerPublicKey - The relayer's public key
     */
    constructor(relayerPublicKey) {
        super();
        this.relayerPublicKey = relayerPublicKey;
    }
    /**
     * Creates a RelayerForwarder from a relayer public key.
     *
     * @remarks
     * The endpoint URL is constructed using the `RELAYER_BASE_URL` constant
     * from `@/constants/anchor` with the relayer's public key appended.
     * The full endpoint URL will be: `${RELAYER_BASE_URL}${relayerPublicKey.toBase58()}`
     *
     * @param relayerPublicKey - The relayer's public key (will be appended to RELAYER_BASE_URL)
     * @returns A new RelayerForwarder instance
     *
     * @example
     * ```typescript
     * const relayerPublicKey = new PublicKey('...') as SolanaAddress;
     * const forwarder = RelayerForwarder.fromPublicKey(relayerPublicKey);
     * ```
     */
    static fromPublicKey(relayerPublicKey) {
        return new RelayerForwarder(relayerPublicKey);
    }
    /**
     * Creates a RelayerForwarder using a randomly selected relayer.
     *
     * @remarks
     * This method selects a random relayer index and queries the relayer
     * discovery service at `https://relayer.umbraprivacy.com` to obtain
     * the corresponding relayer public key.
     *
     * **Request body**
     * ```json
     * { "relayerIndex": number }
     * ```
     *
     * **Successful response**
     * ```json
     * { "relayerPublicKey": string }
     * ```
     *
     * **Error response**
     * ```json
     * { "error": object }
     * ```
     *
     * @returns A promise resolving to a new RelayerForwarder instance.
     *
     * @throws {@link RelayerServiceError} When the relayer discovery service
     *         returns an error object.
     * @throws {@link RelayerTransactionForwardingError} When the HTTP request
     *         fails or the response format is invalid.
     */
    static async getRandomRelayerForwarder() {
        const NUMBER_OF_RELAYERS = 1;
        const relayerIndex = Math.floor(Math.random() * NUMBER_OF_RELAYERS);
        try {
            const response = (await fetch('https://relayer.umbraprivacy.com', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ relayerIndex }),
            }));
            if (!response.ok) {
                throw new RelayerTransactionForwardingError(`Relayer discovery service returned status ${response.status}: ${response.statusText}`);
            }
            const jsonData = await response.json();
            const data = jsonData;
            if ('error' in data) {
                throw new RelayerServiceError('Relayer discovery service returned an error', data.error);
            }
            const relayerPublicKey = data
                .relayerPublicKey;
            if (typeof relayerPublicKey !== 'string' || relayerPublicKey.length === 0) {
                throw new RelayerTransactionForwardingError('Invalid response format from relayer discovery service: missing or invalid relayerPublicKey');
            }
            const publicKey = new PublicKey(relayerPublicKey);
            return RelayerForwarder.fromPublicKey(publicKey);
        }
        catch (error) {
            if (error instanceof TransactionForwarderError) {
                throw error;
            }
            throw new RelayerTransactionForwardingError(`Failed to get random relayer forwarder: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Fetches the list of currently registered relayer public keys.
     *
     * @remarks
     * This method performs a simple GET request to `https://relayer.umbraprivacy.com`.
     * The service responds with either:
     *
     * **Successful response**
     * ```json
     * { "relayerPublicKeys": string[] }
     * ```
     *
     * **Error response**
     * ```json
     * { "error": object }
     * ```
     *
     * At most 10 relayer public keys will be returned.
     *
     * @returns A promise resolving to an array of `SolanaAddress` values.
     *
     * @throws {@link RelayerServiceError} When the relayer discovery service
     *         returns an error object.
     * @throws {@link RelayerTransactionForwardingError} When the HTTP request
     *         fails or the response format is invalid.
     */
    static async getRelayerList() {
        try {
            const response = (await fetch('https://relayer.umbraprivacy.com', {
                method: 'GET',
            }));
            if (!response.ok) {
                throw new RelayerTransactionForwardingError(`Relayer discovery service returned status ${response.status}: ${response.statusText}`);
            }
            const jsonData = await response.json();
            const data = jsonData;
            if ('error' in data) {
                throw new RelayerServiceError('Relayer discovery service returned an error', data.error);
            }
            const relayerPublicKeys = data.relayerPublicKeys;
            if (!Array.isArray(relayerPublicKeys) ||
                relayerPublicKeys.some((key) => typeof key !== 'string' || key.length === 0)) {
                throw new RelayerTransactionForwardingError('Invalid response format from relayer discovery service: missing or invalid relayerPublicKeys');
            }
            return relayerPublicKeys.map((key) => new PublicKey(key));
        }
        catch (error) {
            if (error instanceof TransactionForwarderError) {
                throw error;
            }
            throw new RelayerTransactionForwardingError(`Failed to get relayer list: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Gets the full endpoint URL for this relayer.
     *
     * @returns The endpoint URL constructed from RELAYER_BASE_URL and relayer public key
     *
     * @internal
     */
    getEndpointUrl() {
        const publicKeyString = this.relayerPublicKey.toBase58();
        return `${RELAYER_BASE_URL}${publicKeyString}`;
    }
    /**
     * Encodes a transaction to base64.
     *
     * @param transaction - The transaction to encode
     * @returns Base64-encoded transaction string
     *
     * @internal
     */
    encodeTransactionToBase64(transaction) {
        const serialized = transaction.serialize();
        return Buffer.from(serialized).toString('base64');
    }
    /**
     * Sends a transaction to the relayer service and returns the signature.
     *
     * @param transaction - The transaction to forward
     * @returns A promise resolving to the transaction signature
     *
     * @throws {@link RelayerTransactionForwardingError} When forwarding fails
     * @throws {@link RelayerServiceError} When the relayer service returns an error
     *
     * @internal
     */
    async sendTransactionToRelayer(transaction) {
        const endpointUrl = this.getEndpointUrl();
        const txBase64 = this.encodeTransactionToBase64(transaction);
        try {
            const response = (await fetch(endpointUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tx: txBase64 }),
            }));
            if (!response.ok) {
                throw new RelayerTransactionForwardingError(`Relayer service returned status ${response.status}: ${response.statusText}`);
            }
            const jsonData = await response.json();
            const data = jsonData;
            if ('error' in data) {
                throw new RelayerServiceError('Relayer service returned an error', data.error);
            }
            if (!('txSignature' in data) || typeof data.txSignature !== 'string') {
                throw new RelayerTransactionForwardingError('Invalid response format from relayer service: missing or invalid txSignature');
            }
            return data.txSignature;
        }
        catch (error) {
            if (error instanceof TransactionForwarderError) {
                throw error;
            }
            throw new RelayerTransactionForwardingError(`Failed to forward transaction to relayer: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Forwards a single signed transaction to the network via relayer service.
     *
     * @param transaction - The signed `VersionedTransaction` to forward
     * @returns A promise resolving to the transaction signature
     *
     * @throws {@link RelayerTransactionForwardingError} When forwarding fails due to network errors, invalid transaction, or relayer service errors
     *
     * @remarks
     * This method submits a single signed transaction to the relayer service endpoint.
     * The transaction is base64-encoded and sent via HTTP POST. The relayer service
     * processes the transaction and returns the signature. The transaction must be
     * fully signed before calling this method.
     *
     * @example
     * ```typescript
     * const signedTx = await signer.signTransaction(transaction);
     * const signature = await forwarder.forwardTransaction(signedTx);
     * console.log(`Transaction forwarded via relayer: ${signature}`);
     * ```
     */
    async forwardTransaction(transaction) {
        return await this.sendTransactionToRelayer(transaction);
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
                    throw new RelayerBatchTransactionForwardingError('Invalid offset parameter type');
                }
                if (offset < 0 || offset >= transactions.length) {
                    throw new RelayerBatchTransactionForwardingError(`Offset ${offset} is out of bounds for array of length ${transactions.length}`);
                }
                if (typeof delayOrDelays === 'number') {
                    return await this.forwardTransactionsWithOffsetAndFixedDelay(transactions, offset, delayOrDelays);
                }
                if (Array.isArray(delayOrDelays)) {
                    return await this.forwardTransactionsWithOffsetAndVariableDelays(transactions, offset, delayOrDelays);
                }
                throw new RelayerBatchTransactionForwardingError('Invalid delay parameter type for offset overload');
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
            throw new RelayerBatchTransactionForwardingError('Invalid parameter type');
        }
        catch (error) {
            if (error instanceof TransactionForwarderError) {
                throw error;
            }
            throw new RelayerBatchTransactionForwardingError(`Failed to forward batch transactions: ${error instanceof Error ? error.message : String(error)}`, error instanceof TransactionForwarderError ? error : undefined);
        }
    }
    /**
     * Forwards transactions sequentially, sending each to relayer service.
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
                throw new RelayerBatchTransactionForwardingError(`Transaction is undefined`);
            }
            const signature = await this.sendTransactionToRelayer(transaction);
            signatures.push(signature);
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially with a fixed delay between each.
     *
     * @param transactions - Array of transactions to forward
     * @param delayMs - Fixed delay in milliseconds between transactions
     * @returns Array of transaction signatures
     *
     * @internal
     */
    async forwardTransactionsWithFixedDelay(transactions, delayMs) {
        const signatures = [];
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new RelayerBatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.sendTransactionToRelayer(transaction);
            signatures.push(signature);
            if (i < transactions.length - 1 && delayMs > 0) {
                await this.sleep(delayMs);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially with variable delays between each.
     *
     * @param transactions - Array of transactions to forward
     * @param delaysMs - Array of delays in milliseconds (must have length `transactions.length - 1`)
     * @returns Array of transaction signatures
     *
     * @internal
     */
    async forwardTransactionsWithVariableDelays(transactions, delaysMs) {
        if (delaysMs.length !== transactions.length - 1) {
            throw new RelayerInvalidDelayArrayError(transactions.length, delaysMs.length);
        }
        const signatures = [];
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new RelayerBatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.sendTransactionToRelayer(transaction);
            signatures.push(signature);
            if (i < transactions.length - 1) {
                const delay = delaysMs[i];
                if (delay === undefined) {
                    throw new RelayerBatchTransactionForwardingError(`Delay at index ${i} is undefined`);
                }
                await this.sleep(delay);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially starting from a specific offset with a fixed delay.
     *
     * @param transactions - Array of transactions to forward
     * @param offset - The index to start from
     * @param delayMs - Fixed delay in milliseconds between transactions
     * @returns Array of transaction signatures for the remaining transactions
     *
     * @internal
     */
    async forwardTransactionsWithOffsetAndFixedDelay(transactions, offset, delayMs) {
        const signatures = [];
        for (let i = offset; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new RelayerBatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.sendTransactionToRelayer(transaction);
            signatures.push(signature);
            if (i < transactions.length - 1 && delayMs > 0) {
                await this.sleep(delayMs);
            }
        }
        return signatures;
    }
    /**
     * Forwards transactions sequentially starting from a specific offset with variable delays.
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
            throw new RelayerInvalidDelayArrayError(remainingCount, delaysMs.length);
        }
        const signatures = [];
        let delayIndex = 0;
        for (let i = offset; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (!transaction) {
                throw new RelayerBatchTransactionForwardingError(`Transaction at index ${i} is undefined`);
            }
            const signature = await this.sendTransactionToRelayer(transaction);
            signatures.push(signature);
            if (i < transactions.length - 1) {
                const delay = delaysMs[delayIndex];
                if (delay === undefined) {
                    throw new RelayerBatchTransactionForwardingError(`Delay at index ${delayIndex} is undefined`);
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
