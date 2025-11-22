import { SignerError } from '@/client/interface';
import { RescueCipher } from '@/client/implementation';
import { DEFAULT_SIGNING_MESSAGE, MXE_ARCIUM_X25519_PUBLIC_KEY } from '@/constants/arcium';
import { kmac128, kmac256 } from '@noble/hashes/sha3-addons.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { convertU128BeBytesToU128, convertU128ToLeBytes, convertU256LeBytesToU256, convertU256ToLeBytes, } from '@/utils/convertors';
// Imported for TSDoc @throws type references - used in JSDoc comments
// @ts-expect-error - This import is used in JSDoc @throws tags, but TypeScript doesn't recognize JSDoc as usage
import { PoseidonHasher } from '@/utils/hasher';
import { Keypair } from '@solana/web3.js';
import { breakPublicKeyIntoTwoParts } from '@/utils/miscellaneous';
/**
 * Abstract base class for all Umbra wallet-related errors.
 *
 * @remarks
 * This class provides a foundation for all Umbra wallet errors, ensuring consistent
 * error handling and type safety across wallet operations. All Umbra wallet errors
 * should extend this class.
 *
 * @public
 */
export class UmbraWalletError extends Error {
    /**
     * Creates a new instance of UmbraWalletError.
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
 * Error thrown when wallet initialization fails.
 *
 * @remarks
 * This error is thrown when wallet creation fails due to signer unavailability,
 * key derivation failures, or other initialization issues.
 *
 * @public
 */
export class UmbraWalletInitializationError extends UmbraWalletError {
    /**
     * Creates a new instance of UmbraWalletInitializationError.
     *
     * @param message - Error message describing why wallet initialization failed
     * @param cause - Optional underlying error that caused the initialization failure
     */
    constructor(message, cause) {
        super(`Failed to initialize Umbra wallet: ${message}`, cause);
    }
}
/**
 * Error thrown when an invalid purpose code is requested.
 *
 * @remarks
 * This error is thrown when `getPurposeCode` is called with an unsupported purpose string.
 *
 * @public
 */
export class InvalidPurposeCodeError extends UmbraWalletError {
    /**
     * Creates a new instance of InvalidPurposeCodeError.
     *
     * @param purpose - The invalid purpose string that was provided
     * @param cause - Optional underlying error that caused the error
     */
    constructor(purpose, cause) {
        super(`Invalid purpose code: "${purpose}". Supported purposes are: claim_spl_deposit_with_hidden_amount, claim_spl_deposit_with_public_amount, create_spl_deposit_with_hidden_amount, create_spl_deposit_with_public_amount`, cause);
    }
}
/**
 * Umbra Privacy wallet implementation providing cryptographic operations and transaction signing.
 *
 * @remarks
 * The UmbraWallet class is the main interface for interacting with the Umbra Privacy protocol.
 * It provides functionality for:
 * - Deriving cryptographic keys from a signer
 * - Creating and managing Rescue ciphers for encryption/decryption
 * - Generating linker hashes for transaction privacy
 * - Signing messages and transactions
 *
 * The wallet derives its cryptographic material from a master signature seed obtained by
 * signing a default message with the provided signer. This seed is used to derive:
 * - X25519 key pair for Rescue cipher operations
 * - Master viewing key for compliance and transaction linking
 *
 * **Key Derivation:**
 * - X25519 keys are derived using KMAC256 with domain separator "Umbra Privacy - X25519 Private Key"
 * - Master viewing key is derived using KMAC128 with domain separator "Umbra Privacy - Master Viewing Key"
 *
 * **Rescue Ciphers:**
 * The wallet maintains a cache of Rescue ciphers for different public keys. The cipher for
 * the MXE (Multi-Execution Environment) public key is automatically created during initialization.
 *
 * @public
 *
 * @example
 * ```typescript
 * // Create wallet from a signer
 * const wallet = await UmbraWallet.fromSigner(signer);
 *
 * // Generate linker hash for a transaction
 * const linkerHash = wallet.generateLinkerHash(
 *   'create_spl_deposit_with_hidden_amount',
 *   year, month, day, hour, minute, second
 * );
 *
 * // Sign a message
 * const signature = await wallet.signMessage(message);
 *
 * // Get Rescue cipher for a public key
 * const cipher = wallet.getRescueCipherForPublicKey(publicKey);
 * ```
 */
export class UmbraWallet {
    /**
     * Private constructor for creating UmbraWallet instances.
     *
     * @param signer - The signer instance to use for operations
     * @param arciumX25519PublicKey - The derived X25519 public key
     * @param getRescueCipherForPublicKey - Function to create Rescue ciphers
     * @param masterViewingKey - The derived master viewing key
     *
     * @remarks
     * This constructor is private. Use the static factory method `fromSigner` to create instances.
     */
    constructor(signer, arciumX25519PublicKey, getRescueCipherForPublicKey, masterViewingKey, masterViewingKeyPoseidonBlindingFactor, masterViewingKeySha3BlindingFactor, generateRandomSecret) {
        this.signer = signer;
        this.arciumX25519PublicKey = arciumX25519PublicKey;
        this.rescueCiphers = new Map();
        this.getRescueCipherForPublicKey = getRescueCipherForPublicKey;
        this.rescueCiphers.set(MXE_ARCIUM_X25519_PUBLIC_KEY, this.getRescueCipherForPublicKey(MXE_ARCIUM_X25519_PUBLIC_KEY));
        this.masterViewingKey = masterViewingKey;
        this.masterViewingKeyPoseidonBlindingFactor =
            masterViewingKeyPoseidonBlindingFactor;
        this.masterViewingKeySha3BlindingFactor = masterViewingKeySha3BlindingFactor;
        this.generateRandomSecret = generateRandomSecret;
    }
    /**
     * Creates a new UmbraWallet instance from a signer.
     *
     * @param signer - The signer instance to use for wallet operations
     * @returns A promise resolving to a new UmbraWallet instance
     *
     * @throws {@link UmbraWalletInitializationError} When wallet initialization fails
     * @throws {@link SignerError} When message signing fails during initialization
     *
     * @remarks
     * This factory method initializes a new UmbraWallet by:
     * 1. Signing the default message to obtain a master signature seed
     * 2. Deriving X25519 key pair from the master signature seed
     * 3. Deriving the master viewing key from the master signature seed
     * 4. Creating a function to generate Rescue ciphers for any public key
     * 5. Pre-creating the Rescue cipher for the MXE public key
     *
     * The master signature seed is obtained by signing a default message that warns users
     * about the security implications. This signature is used as a seed for all key derivation.
     *
     * @example
     * ```typescript
     * const wallet = await UmbraWallet.fromSigner(signer);
     * console.log(`Wallet public key: ${wallet.arciumX25519PublicKey}`);
     * console.log(`Master viewing key: ${wallet.masterViewingKey}`);
     * ```
     */
    static async fromSigner(signer) {
        try {
            const masterSignatureSeed = await signer.signMessage(DEFAULT_SIGNING_MESSAGE);
            const { x25519PrivateKey, x25519PublicKey } = this.createX25519KeypairFromMasterSignatureSeed(masterSignatureSeed);
            const masterViewingKey = this.generateMasterViewingKeyFromMasterSignatureSeed(masterSignatureSeed);
            const masterViewingKeyPoseidonBlindingFactor = this.generateMasterViewingKeyBlindingFactorFromMasterSignatureSeed(masterSignatureSeed);
            const masterViewingKeySha3BlindingFactor = this.generateMasterViewingKeySha3BlindingFactorFromMasterSignatureSeed(masterSignatureSeed);
            const randomSecretMasterSeed = kmac256(new TextEncoder().encode('Umbra Privacy - Random Secret Master Seed'), masterSignatureSeed);
            const generateRandomSecret = (index) => {
                const randomSecretBeBytes = kmac128(convertU256ToLeBytes(index), randomSecretMasterSeed);
                return convertU128BeBytesToU128(randomSecretBeBytes);
            };
            const getRescueCipherForPublicKey = (publicKey) => {
                const rescueCipher = RescueCipher.fromX25519Pair(x25519PrivateKey, publicKey);
                return rescueCipher;
            };
            return new UmbraWallet(signer, x25519PublicKey, getRescueCipherForPublicKey, masterViewingKey, masterViewingKeyPoseidonBlindingFactor, masterViewingKeySha3BlindingFactor, generateRandomSecret);
        }
        catch (error) {
            if (error instanceof SignerError) {
                throw error;
            }
            throw new UmbraWalletInitializationError('Failed to create wallet from signer', error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Derives an X25519 key pair from a master signature seed.
     *
     * @param masterSignatureSeed - The master signature seed (64-byte signature)
     * @returns An object containing the derived X25519 private and public keys
     *
     * @remarks
     * This method derives an X25519 key pair using KMAC256 with a domain separator.
     * The derivation process:
     * 1. Uses KMAC256 to derive a 32-byte private key from the seed
     * 2. Computes the corresponding public key using X25519 scalar multiplication
     *
     * The domain separator "Umbra Privacy - X25519 Private Key" ensures the derived
     * key is unique to this purpose and prevents key reuse across different contexts.
     *
     * @example
     * ```typescript
     * const { x25519PrivateKey, x25519PublicKey } =
     *   UmbraWallet.createX25519KeypairFromMasterSignatureSeed(signatureSeed);
     * ```
     */
    static createX25519KeypairFromMasterSignatureSeed(masterSignatureSeed) {
        const X25519_DOMAIN_SEPARATOR = new TextEncoder().encode('Umbra Privacy - X25519 Private Key');
        const x25519PrivateKeyBeBytes = kmac256(masterSignatureSeed, X25519_DOMAIN_SEPARATOR);
        const x25519PublicKeyBeBytes = x25519.getPublicKey(x25519PrivateKeyBeBytes);
        return {
            x25519PrivateKey: x25519PrivateKeyBeBytes,
            x25519PublicKey: x25519PublicKeyBeBytes,
        };
    }
    /**
     * Derives a master viewing key from a master signature seed.
     *
     * @param masterSignatureSeed - The master signature seed (64-byte signature)
     * @returns A 128-bit master viewing key (U128)
     *
     * @remarks
     * This method derives a 128-bit master viewing key using KMAC128 with a domain separator.
     * The master viewing key is used for:
     * - Compliance and transaction linking
     * - Generating linker hashes for transaction privacy
     * - Enabling authorized parties to link related transactions
     *
     * The domain separator "Umbra Privacy - Master Viewing Key" ensures the derived
     * key is unique to this purpose and prevents key reuse across different contexts.
     *
     * @example
     * ```typescript
     * const masterViewingKey =
     *   UmbraWallet.generateMasterViewingKeyFromMasterSignatureSeed(signatureSeed);
     * ```
     */
    static generateMasterViewingKeyFromMasterSignatureSeed(masterSignatureSeed) {
        const MASTER_VIEWING_KEY_DOMAIN_SEPARATOR = new TextEncoder().encode('Umbra Privacy - Master Viewing Key');
        const masterViewingKeyBeBytes = kmac128(masterSignatureSeed, MASTER_VIEWING_KEY_DOMAIN_SEPARATOR);
        return convertU128BeBytesToU128(masterViewingKeyBeBytes);
    }
    /**
     * Derives a SHA-3-specific blinding factor for the master viewing key from a master signature seed.
     *
     * @param masterSignatureSeed - The master signature seed (64-byte signature)
     * @returns A 128-bit blinding factor (U128) for use with SHA-3–based commitments
     *
     * @remarks
     * This method derives a 128-bit value using KMAC128 with the domain separator
     * "Umbra Privacy - Master Viewing Key Sha3 Blinding Factor". It is computed from
     * the same master signature seed as the master viewing key and Poseidon blinding factor,
     * but uses a distinct label so that SHA-3–based and Poseidon-based constructions never
     * reuse the exact same randomness.
     *
     * Use this factor anywhere you need per-user randomness in SHA-3 commitments or hashes
     * that are tied to the master viewing key, without exposing the viewing key itself.
     */
    static generateMasterViewingKeySha3BlindingFactorFromMasterSignatureSeed(masterSignatureSeed) {
        const MASTER_VIEWING_KEY_SHA3_BLINDING_FACTOR_DOMAIN_SEPARATOR = new TextEncoder().encode('Umbra Privacy - Master Viewing Key Sha3 Blinding Factor');
        const masterViewingKeySha3BlindingFactorBeBytes = kmac128(masterSignatureSeed, MASTER_VIEWING_KEY_SHA3_BLINDING_FACTOR_DOMAIN_SEPARATOR);
        return convertU128BeBytesToU128(masterViewingKeySha3BlindingFactorBeBytes);
    }
    /**
     * Derives a blinding factor for the master viewing key from a master signature seed.
     *
     * @param masterSignatureSeed - The master signature seed (64-byte signature)
     * @returns A 128-bit blinding factor (U128) for use alongside the master viewing key
     *
     * @remarks
     * This method derives a second 128-bit value using KMAC128 with a dedicated domain
     * separator "Umbra Privacy - Master Viewing Key Blinding Factor". It is computed from
     * the same master signature seed as the master viewing key, but with a different
     * derivation label so that:
     *
     * - The blinding factor is **cryptographically independent** from the master viewing key
     * - The viewing key never needs to be reused directly as randomness in other schemes
     *
     * Typical uses include:
     * - Adding noise/randomness to commitments that depend on the master viewing key
     * - Generating per-user randomness in zero-knowledge proofs or encrypted metadata
     *
     * @example
     * ```typescript
     * const blindingFactor =
     *   UmbraWallet.generateMasterViewingKeyBlindingFactorFromMasterSignatureSeed(signatureSeed);
     * ```
     */
    static generateMasterViewingKeyBlindingFactorFromMasterSignatureSeed(masterSignatureSeed) {
        const MASTER_VIEWING_KEY_BLINDING_FACTOR_DOMAIN_SEPARATOR = new TextEncoder().encode('Umbra Privacy - Master Viewing Key Blinding Factor');
        const masterViewingKeyBlindingFactorBeBytes = kmac128(masterSignatureSeed, MASTER_VIEWING_KEY_BLINDING_FACTOR_DOMAIN_SEPARATOR);
        return convertU128BeBytesToU128(masterViewingKeyBlindingFactorBeBytes);
    }
    /**
     * Gets the purpose code for a given transaction purpose string.
     *
     * @param purpose - The transaction purpose string
     * @returns The corresponding purpose code as a U128
     *
     * @throws {@link InvalidPurposeCodeError} When the purpose string is not supported
     *
     * @remarks
     * Purpose codes are used to identify different types of transactions in the Umbra protocol.
     * Supported purposes:
     * - `claim_spl_deposit_with_hidden_amount` → 0
     * - `claim_spl_deposit_with_public_amount` → 1
     * - `create_spl_deposit_with_hidden_amount` → 2
     * - `create_spl_deposit_with_public_amount` → 3
     *
     * Purpose codes are included in linker hash generation to ensure different transaction
     * types produce different hashes even with the same timestamp.
     *
     * @example
     * ```typescript
     * const purposeCode = UmbraWallet.getPurposeCode('create_spl_deposit_with_hidden_amount');
     * // Returns 2n
     * ```
     */
    static getPurposeCode(purpose) {
        const PURPOSE_CODES_MAPPER = new Map([
            ['create_spl_deposit_with_hidden_amount', 0n],
            ['create_spl_deposit_with_public_amount', 1n],
            ['claim_spl_deposit_with_hidden_amount', 2n],
            ['claim_spl_deposit_with_public_amount', 3n],
        ]);
        const purposeCode = PURPOSE_CODES_MAPPER.get(purpose);
        if (purposeCode === undefined) {
            throw new InvalidPurposeCodeError(purpose);
        }
        return purposeCode;
    }
    /**
     * Generates a linker hash for transaction privacy and compliance.
     *
     * @param purpose - The transaction purpose (determines the purpose code)
     * @param year - Transaction year
     * @param month - Transaction month
     * @param day - Transaction day
     * @param hour - Transaction hour
     * @param minute - Transaction minute
     * @param second - Transaction second
     * @returns A 32-byte Poseidon hash that links transactions with the same parameters
     *
     * @throws {@link InvalidPurposeCodeError} When the purpose string is not supported
     * @throws {@link PoseidonHasherError} When Poseidon hashing fails
     *
     * @remarks
     * The linker hash is computed using Poseidon over:
     * - Master viewing key (for user identification)
     * - Purpose code (for transaction type)
     * - Timestamp components (year, month, day, hour, minute, second)
     *
     * This hash enables:
     * - **Privacy**: Different transactions produce different hashes
     * - **Compliance**: Authorized parties can link transactions with the same parameters
     * - **Uniqueness**: Each unique combination of parameters produces a unique hash
     *
     * The hash is deterministic - the same inputs will always produce the same hash,
     * allowing for transaction linking while maintaining privacy for unrelated transactions.
     *
     * @example
     * ```typescript
     * const linkerHash = wallet.generateLinkerHash(
     *   'create_spl_deposit_with_hidden_amount',
     *   2024n, 1n, 15n, 10n, 30n, 0n
     * );
     * // Returns a 32-byte PoseidonHash
     * ```
     */
    generateIndividualTransactionViewingKey(purpose, year, month, day, hour, minute, second) {
        const purposeCode = UmbraWallet.getPurposeCode(purpose);
        return PoseidonHasher.hash([
            this.masterViewingKey,
            purposeCode,
            year,
            month,
            day,
            hour,
            minute,
            second,
        ]);
    }
    generateCreateDepositLinkerHash(purpose, time, address) {
        const dateObj = new Date(Number(time) * 1000);
        const year = dateObj.getUTCFullYear();
        const month = dateObj.getUTCMonth() + 1; // Months are zero-based
        const day = dateObj.getUTCDate();
        const hour = dateObj.getUTCHours();
        const minute = dateObj.getUTCMinutes();
        const second = dateObj.getUTCSeconds();
        const [addressLow, addressHigh] = breakPublicKeyIntoTwoParts(address);
        const individualTransactionViewingKey = this.generateIndividualTransactionViewingKey(purpose, BigInt(year), BigInt(month), BigInt(day), BigInt(hour), BigInt(minute), BigInt(second));
        return PoseidonHasher.hash([
            convertU256LeBytesToU256(individualTransactionViewingKey),
            addressLow,
            addressHigh,
        ]);
    }
    generateClaimDepositLinkerHash(purpose, time, commitmentInsertionIndex) {
        const dateObj = new Date(Number(time) * 1000);
        const year = dateObj.getUTCFullYear();
        const month = dateObj.getUTCMonth() + 1; // Months are zero-based
        const day = dateObj.getUTCDate();
        const hour = dateObj.getUTCHours();
        const minute = dateObj.getUTCMinutes();
        const second = dateObj.getUTCSeconds();
        const individualTransactionViewingKey = this.generateIndividualTransactionViewingKey(purpose, BigInt(year), BigInt(month), BigInt(day), BigInt(hour), BigInt(minute), BigInt(second));
        return PoseidonHasher.hash([
            convertU256LeBytesToU256(individualTransactionViewingKey),
            commitmentInsertionIndex,
        ]);
    }
    /**
     * Signs a message using the wallet's signer.
     *
     * @param message - The message bytes to sign
     * @returns A promise resolving to a 64-byte Ed25519 signature
     *
     * @throws {@link SignerError} When message signing fails
     *
     * @remarks
     * This method delegates to the underlying signer's `signMessage` method.
     * The signature is a standard Solana Ed25519 signature (64 bytes).
     *
     * @example
     * ```typescript
     * const message = new TextEncoder().encode('Hello, Umbra!');
     * const signature = await wallet.signMessage(message);
     * ```
     */
    async signMessage(message) {
        const signature = await this.signer.signMessage(message);
        return signature;
    }
    /**
     * Signs a single Solana versioned transaction.
     *
     * @param transaction - The versioned transaction to sign
     * @returns A promise resolving to the signed transaction
     *
     * @throws {@link SignerError} When transaction signing fails
     *
     * @remarks
     * This method delegates to the underlying signer's `signTransaction` method.
     * The transaction is modified in-place with the signature attached.
     *
     * @example
     * ```typescript
     * const signedTx = await wallet.signTransaction(transaction);
     * await connection.sendTransaction(signedTx);
     * ```
     */
    async signTransaction(transaction) {
        const signedTransaction = await this.signer.signTransaction(transaction);
        return signedTransaction;
    }
    /**
     * Signs a Solana versioned transaction using a one-time ephemeral Ed25519 keypair.
     *
     * @param transaction - The versioned transaction to sign
     * @returns A promise resolving to the signed transaction and the ephemeral public key bytes
     *
     * @remarks
     * This method generates a fresh Ed25519 keypair for each call, constructs a Solana
     * `Keypair` from it, and uses the transaction's `sign` method to attach the signature.
     * The private key is scoped to this method and is not stored on the wallet instance.
     *
     * The returned public key allows callers to add the ephemeral signer to account
     * metas or verify the transaction signature as needed.
     */
    async signTransactionWithEphemeralKeypair(transaction) {
        // Generate a fresh Ed25519 private key and corresponding public key
        const privateKey = ed25519.utils.randomSecretKey();
        const publicKey = ed25519.getPublicKey(privateKey);
        // Solana Keypair secretKey is 64 bytes: [privateKey(32) | publicKey(32)]
        const secretKey = new Uint8Array(64);
        secretKey.set(privateKey, 0);
        secretKey.set(publicKey, 32);
        const ephemeralKeypair = Keypair.fromSecretKey(secretKey);
        // Sign the transaction with the ephemeral keypair
        transaction.sign([ephemeralKeypair]);
        return {
            signedTransaction: transaction,
            ephemeralPublicKey: publicKey,
        };
    }
    /**
     * Signs multiple Solana versioned transactions in a batch.
     *
     * @param transactions - Array of versioned transactions to sign
     * @returns A promise resolving to an array of signed transactions in the same order as input
     *
     * @throws {@link SignerError} When batch transaction signing fails
     *
     * @remarks
     * This method delegates to the underlying signer's `signTransactions` method.
     * All transactions are signed in a single batch operation, which may be more
     * efficient than signing them individually.
     *
     * @example
     * ```typescript
     * const signedTxs = await wallet.signTransactions([tx1, tx2, tx3]);
     * // All transactions are now signed
     * ```
     */
    async signTransactions(transactions) {
        const signedTransactions = await this.signer.signTransactions(transactions);
        return signedTransactions;
    }
    /**
     * Adds a Rescue cipher to the cache for a given X25519 public key.
     *
     * @param publicKey - The X25519 public key to create and cache a Rescue cipher for
     *
     * @remarks
     * This method creates a Rescue cipher that encrypts data using a shared secret derived
     * from an X25519 key exchange between the wallet's X25519 secret key and the provided
     * X25519 public key. The cipher is then cached in the `rescueCiphers` map for future use.
     *
     * **Key Exchange Process:**
     * The method performs an X25519 Diffie-Hellman key exchange:
     * `sharedSecret = X25519(walletSecretKey, providedPublicKey)`
     *
     * This shared secret is used to initialize the Rescue cipher, enabling encrypted
     * communication with the party that owns the provided public key.
     *
     * **Caching:**
     * The cipher is stored in the `rescueCiphers` map, allowing efficient reuse without
     * recreating the cipher for subsequent operations with the same public key. If a cipher
     * already exists for the given public key, it will be overwritten with a new instance.
     *
     * **Use Cases:**
     * - Pre-caching ciphers for frequently used public keys
     * - Setting up encryption for communication with specific parties
     * - Optimizing performance by avoiding repeated cipher creation
     *
     * @example
     * ```typescript
     * // Add a cipher for a specific public key
     * wallet.addEncryptorForPublicKey(recipientPublicKey);
     *
     * // The cipher is now cached and can be retrieved
     * const cipher = wallet.rescueCiphers.get(recipientPublicKey);
     * const [ciphertext, nonce] = await cipher.encrypt([100n, 200n]);
     * ```
     */
    addEncryptorForPublicKey(publicKey) {
        this.rescueCiphers.set(publicKey, this.getRescueCipherForPublicKey(publicKey));
    }
    /**
     * Derives a deterministic nullifier for a given index using the wallet's master viewing key.
     *
     * @param index - The nullifier index (typically a position or counter) encoded as a {@link U256}.
     * @returns A 128-bit nullifier value as a {@link U128}.
     *
     * @remarks
     * This function uses a two-step KMAC-based derivation:
     * - First, it derives a *nullifier master seed* from the master viewing key and a fixed
     *   context string (`"Umbra Privacy - Nullifier Master Seed"`).
     * - It then derives the final nullifier from the provided `index` and the nullifier master seed.
     *
     * The resulting nullifier is deterministic for a given `(masterViewingKey, index)` pair,
     * while remaining unlinkable across different master viewing keys due to the domain-separated
     * KMAC construction.
     *
     * @example
     * ```ts
     * const index: U256 = /* obtain index *\/;
     * const nullifier: U128 = wallet.generateNullifier(index);
     * console.log(nullifier.toString());
     * ```
     */
    generateNullifier(index) {
        const message = convertU128ToLeBytes(this.masterViewingKey);
        const nullifierMasterSeed = kmac128(new TextEncoder().encode('Umbra Privacy - Nullifier Master Seed'), message);
        const nullifierBeBytes = kmac128(convertU256ToLeBytes(index), nullifierMasterSeed);
        return convertU128BeBytesToU128(nullifierBeBytes);
    }
}
