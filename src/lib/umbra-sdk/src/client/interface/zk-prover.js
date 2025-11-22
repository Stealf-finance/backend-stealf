/**
 * Abstract base class for all zero-knowledge proof generator-related errors.
 *
 * @remarks
 * This class provides a foundation for all ZK prover errors, ensuring consistent
 * error handling and type safety across proof generator implementations. All ZK prover errors
 * should extend this class.
 *
 * @public
 */
export class ZkProverError extends Error {
    /**
     * Creates a new instance of ZkProverError.
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
 * Abstract base class defining the contract for zero-knowledge proof generation.
 *
 * @remarks
 * Implementations of this class must provide cryptographic proof generation capabilities
 * for zero-knowledge operations on the Solana blockchain. All methods are asynchronous
 * to support various proof generation backends (WASM, native libraries, remote services).
 *
 * This interface supports multiple proof types including:
 * - Master viewing key registration proofs
 * - SPL token deposit proofs (with hidden and public amounts)
 * - Deposit claim proofs with Merkle tree inclusion verification
 *
 * @public
 *
 * @example
 * ```typescript
 * class WasmZkProver extends IZkProver {
 *   async generateMasterViewingKeyRegistrationProof(
 *     masterViewingKey: U128,
 *     poseidonBlindingFactor: U128,
 *     sha3BlindingFactor: U128,
 *     expectedPoseidonCommitment: PoseidonHash,
 *     expectedSha3Commitment: Sha3Hash
 *   ): Promise<[Groth16ProofABeBytes, Groth16ProofBBeBytes, Groth16ProofCBeBytes]> {
 *     // Implementation using WASM circuit
 *   }
 *   // ... other methods
 * }
 * ```
 */
export class IZkProver {
}
