import { IZkProver, ZkProverError } from '@/client/interface/zk-prover';
import { convertStringToBigInt, convertU256LeBytesToU256, convertU256ToBeBytes, } from '@/utils/convertors';
import { groth16 } from 'snarkjs';
/**
 * Default artifact locations for each Circom/Groth16 circuit.
 *
 * @remarks
 * These are provided as sensible defaults and can be updated by applications at build time
 * if they host the artifacts at different paths or URLs.
 *
 * All paths/URLs should be resolvable in the environment where the prover runs
 * (browser or Node, depending on how `fetch` is implemented).
 */
export const CIRCUIT_ARTIFACT_URLS = {
    masterViewingKeyRegistration: {
        wasm: '/zk/master_viewing_key_registration.wasm',
        zkey: '/zk/master_viewing_key_registration.zkey',
        verificationKey: '/zk/master_viewing_key_registration_verification_key.json',
    },
    createSplDepositWithHiddenAmount: {
        wasm: '/zk/create_spl_deposit_with_hidden_amount.wasm',
        zkey: '/zk/create_spl_deposit_with_hidden_amount.zkey',
        verificationKey: '/zk/create_spl_deposit_with_hidden_amount_verification_key.json',
    },
    createSplDepositWithPublicAmount: {
        wasm: '/zk/create_spl_deposit_with_public_amount.wasm',
        zkey: '/zk/create_spl_deposit_with_public_amount.zkey',
        verificationKey: '/zk/create_spl_deposit_with_public_amount_verification_key.json',
    },
    claimSplDepositWithHiddenAmount: {
        wasm: '/zk/claim_spl_deposit_with_hidden_amount.wasm',
        zkey: '/zk/claim_spl_deposit_with_hidden_amount.zkey',
        verificationKey: '/zk/claim_spl_deposit_with_hidden_amount_verification_key.json',
    },
    claimSplDeposit: {
        wasm: '/zk/claim_spl_deposit.wasm',
        zkey: '/zk/claim_spl_deposit.zkey',
        verificationKey: '/zk/claim_spl_deposit_verification_key.json',
    },
};
/**
 * Error type for WASM-based ZK prover operations.
 *
 * @internal
 */
class WasmZkProverError extends ZkProverError {
    constructor(message, cause) {
        super(message, cause);
    }
}
/**
 * Base WASM-based implementation of the {@link IZkProver} interface using snarkjs Groth16.
 *
 * @remarks
 * This class is responsible for:
 * - Managing circuit configuration
 * - Fetching and caching WASM / zkey / verification key artifacts
 * - Providing a protected `generateProof` helper that runs `snarkjs.groth16.fullProve`
 * - Converting snarkjs Groth16 proofs into Umbra's `[A, B, C]` byte-array representation
 *
 * The concrete mapping from Umbra SDK arguments to the Circom input shape is handled in the
 * IZkProver method implementations, which transform typed SDK values into plain snarkjs
 * input signals (mostly decimal strings and flattened hashes).
 *
 * All methods wrap lower-level failures in {@link WasmZkProverError}, so callers can catch
 * a single error type for ZK-related issues (circuit loading, proof generation, conversion).
 *
 * @example
 * ```typescript
 * import {
 *   WasmZkProver,
 *   WasmZkProverConfig,
 * } from '@/client/implementation/wasm-zk-prover';
 *
 * // Enable only the circuits your application needs. Artifact URLs are
 * // provided by `CIRCUIT_ARTIFACT_URLS` and can be customized at build time.
 * const config: WasmZkProverConfig = {
 *   masterViewingKeyRegistration: true,
 *   createSplDepositWithHiddenAmount: true,
 *   // other circuits default to disabled (false/undefined)
 * };
 *
 * const prover = new WasmZkProver(config);
 *
 * const [proofA, proofB, proofC] =
 *   await prover.generateMasterViewingKeyRegistrationProof(
 *     masterViewingKey,
 *     poseidonBlindingFactor,
 *     sha3BlindingFactor,
 *     expectedPoseidonCommitment,
 *     expectedSha3Commitment
 *   );
 * ```
 */
export class WasmZkProver extends IZkProver {
    constructor(config) {
        super();
        this.cache = new Map();
        this.config = config;
    }
    /**
     * Generates a Groth16 proof for a given circuit with the provided input signals.
     *
     * @remarks
     * The `input` object is passed directly to `snarkjs.groth16.fullProve` without any
     * additional transformation. It is the responsibility of the caller to ensure that
     * all values are encoded in the way the Circom circuit expects (e.g. big-endian U32
     * string arrays).
     *
     * @internal
     */
    async generateProof(circuitId, input) {
        const artifacts = await this.getArtifacts(circuitId);
        try {
            const { proof } = (await groth16.fullProve(input, artifacts.wasm, artifacts.zkey));
            // For Groth16 on BN254, snarkjs exposes the coordinates as arrays of strings:
            // - proof.pi_a: [Ax, Ay]
            // - proof.pi_b: [[Bax, Bay], [Bbx, Bby]]
            // - proof.pi_c: [Cx, Cy]
            const a = proof.pi_a;
            const b = proof.pi_b;
            const c = proof.pi_c;
            if (!a || !b || !c) {
                throw new WasmZkProverError('snarkjs proof object did not contain expected Groth16 components');
            }
            const [aBytes, bBytes, cBytes] = this.convertZkProofToBytes(proof);
            return [aBytes, bBytes, cBytes];
        }
        catch (error) {
            if (error instanceof ZkProverError) {
                throw error;
            }
            throw new WasmZkProverError(`Failed to generate Groth16 proof for circuit "${circuitId}": ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : undefined);
        }
    }
    /**
     * Lazily loads and caches the artifacts for a given circuit.
     *
     * @internal
     */
    async getArtifacts(circuitId) {
        const cached = this.cache.get(circuitId);
        if (cached) {
            return cached;
        }
        const enabled = this.config[circuitId] ?? false;
        if (!enabled) {
            throw new WasmZkProverError(`Circuit "${circuitId}" is not enabled in WasmZkProverConfig`);
        }
        const urls = CIRCUIT_ARTIFACT_URLS[circuitId];
        const [wasm, zkey, verificationKeyJson] = await Promise.all([
            this.fetchBinary(urls.wasm),
            this.fetchBinary(urls.zkey),
            urls.verificationKey
                ? this.fetchJson(urls.verificationKey)
                : Promise.resolve(undefined),
        ]);
        const artifacts = {
            wasm,
            zkey,
            verificationKeyJson,
        };
        this.cache.set(circuitId, artifacts);
        return artifacts;
    }
    /**
     * Fetches a binary resource (WASM / ZKey) as a Uint8Array.
     *
     * @internal
     */
    async fetchBinary(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new WasmZkProverError(`Failed to fetch binary artifact from "${url}": ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    }
    /**
     * Fetches a JSON resource (e.g. verification key).
     *
     * @internal
     */
    async fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new WasmZkProverError(`Failed to fetch JSON artifact from "${url}": ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    // === IZkProver implementation ===========================================================
    async generateMasterViewingKeyRegistrationProof(masterViewingKey, poseidonBlindingFactor, sha3BlindingFactor, expectedPoseidonCommitment, expectedSha3Commitment) {
        const inputs = {
            masterViewingKey: masterViewingKey.toString(),
            poseidonBlindingFactor: poseidonBlindingFactor.toString(),
            sha3BlindingFactor: sha3BlindingFactor.toString(),
            expectedPoseidonCommitment: convertU256LeBytesToU256(expectedPoseidonCommitment).toString(),
            expectedSha3Commitment: convertU256LeBytesToU256(expectedSha3Commitment).toString(),
        };
        return this.generateProof('masterViewingKeyRegistration', inputs);
    }
    async generateCreateSplDepositWithHiddenAmountProof(masterViewingKey, poseidonBlindingFactor, destinationAddressLow, destinationAddressHigh, randomSecret, nullifier, amount, relayerFee, commissionFeeLowBound, commissionFeeHighBound, commissionFeeBps, commissionFeeQuotient, commissionFeeRemainder, year, month, day, hour, minute, second, expectedYear, expectedMonth, expectedDay, expectedHour, expectedMinute, expectedSecond, expectedLinkerAddressHash, expectedDepositDataHash, expectedOnChainMvkHash, expectedSha3AggregatedHash, expectedRelayerFee, expectedCommissionFeeLowBound, expectedCommissionFeeHighBound, expectedCommissionFeeBps) {
        const inputs = {
            masterViewingKey: masterViewingKey.toString(),
            poseidonBlindingFactor: poseidonBlindingFactor.toString(),
            destinationAddressLow: destinationAddressLow.toString(),
            destinationAddressHigh: destinationAddressHigh.toString(),
            randomSecret: randomSecret.toString(),
            nullifier: nullifier.toString(),
            amount: amount.toString(),
            relayerFee: relayerFee.toString(),
            commissionFeeLowBound: commissionFeeLowBound.toString(),
            commissionFeeHighBound: commissionFeeHighBound.toString(),
            commissionFeeBps: commissionFeeBps.toString(),
            commissionFeeQuotient: commissionFeeQuotient.toString(),
            commissionFeeRemainder: commissionFeeRemainder.toString(),
            year: year.toString(),
            month: month.toString(),
            day: day.toString(),
            hour: hour.toString(),
            minute: minute.toString(),
            second: second.toString(),
            expectedYear: expectedYear.toString(),
            expectedMonth: expectedMonth.toString(),
            expectedDay: expectedDay.toString(),
            expectedHour: expectedHour.toString(),
            expectedMinute: expectedMinute.toString(),
            expectedSecond: expectedSecond.toString(),
            expectedLinkerAddressHash: convertU256LeBytesToU256(expectedLinkerAddressHash).toString(),
            expectedDepositDataHash: convertU256LeBytesToU256(expectedDepositDataHash).toString(),
            expectedOnChainMvkHash: convertU256LeBytesToU256(expectedOnChainMvkHash).toString(),
            expectedSha3AggregatedHash: convertU256LeBytesToU256(expectedSha3AggregatedHash).toString(),
            expectedRelayerFee: expectedRelayerFee.toString(),
            expectedCommissionFeeLowBound: expectedCommissionFeeLowBound.toString(),
            expectedCommissionFeeHighBound: expectedCommissionFeeHighBound.toString(),
            expectedCommissionFeeBps: expectedCommissionFeeBps.toString(),
        };
        return this.generateProof('createSplDepositWithHiddenAmount', inputs);
    }
    async generateCreateSplDepositWithPublicAmountProof(masterViewingKey, poseidonBlindingFactor, destinationAddressLow, destinationAddressHigh, randomSecret, nullifier, amount, year, month, day, hour, minute, second, expectedAmount, expectedYear, expectedMonth, expectedDay, expectedHour, expectedMinute, expectedSecond, expectedLinkerAddressHash, expectedDepositDataHash, expectedOnChainMvkHash) {
        const inputs = {
            masterViewingKey: masterViewingKey.toString(),
            poseidonBlindingFactor: poseidonBlindingFactor.toString(),
            destinationAddressLow: destinationAddressLow.toString(),
            destinationAddressHigh: destinationAddressHigh.toString(),
            randomSecret: randomSecret.toString(),
            nullifier: nullifier.toString(),
            amount: amount.toString(),
            year: year.toString(),
            month: month.toString(),
            day: day.toString(),
            hour: hour.toString(),
            minute: minute.toString(),
            second: second.toString(),
            expectedAmount: expectedAmount.toString(),
            expectedYear: expectedYear.toString(),
            expectedMonth: expectedMonth.toString(),
            expectedDay: expectedDay.toString(),
            expectedHour: expectedHour.toString(),
            expectedMinute: expectedMinute.toString(),
            expectedSecond: expectedSecond.toString(),
            expectedLinkerAddressHash: convertU256LeBytesToU256(expectedLinkerAddressHash).toString(),
            expectedDepositDataHash: convertU256LeBytesToU256(expectedDepositDataHash).toString(),
            expectedOnChainMvkHash: convertU256LeBytesToU256(expectedOnChainMvkHash).toString(),
        };
        return this.generateProof('createSplDepositWithPublicAmount', inputs);
    }
    async generateClaimSplDepositWithHiddenAmountProof(randomSecret, nullifier, masterViewingKey, merkleSiblingPathElements, merkleSiblingPathIndicies, version, commitmentIndex, destinationAddressLow, destinationAddressHigh, senderAddressLow, senderAddressHigh, blockchainId, amount, year, month, day, hour, minute, second, mintPublicKeyLow, mintPublicKeyHigh, secondAddressBlindingFactor, commissionFeeLowerBound, commissionFeeUpperBound, relayerPubkeyLow, relayerPubkeyHigh, expectedVersion, expectedFirstAddressLow, expectedFirstAddressHigh, expectedBlockchainId, expectedMerkleRoot, expectedLinkerAddressHash, expectedNullifierHash, expectedSecondAddressSha3AggregatedHash, expectedLowerBound, expectedUpperBound, expectedMintPubkeyLow, expectedMintPubkeyHigh, expectedRelayerPubkeyLow, expectedRelayerPubkeyHigh) {
        const inputs = {
            randomSecret: randomSecret.toString(),
            nullifier: nullifier.toString(),
            masterViewingKey: masterViewingKey.toString(),
            merkleSiblingPathElements: merkleSiblingPathElements.map((h) => convertU256LeBytesToU256(h).toString()),
            merkleSiblingPathIndicies: merkleSiblingPathIndicies.map((i) => i.toString()),
            version: version.toString(),
            commitmentIndex: commitmentIndex.toString(),
            destinationAddressLow: destinationAddressLow.toString(),
            destinationAddressHigh: destinationAddressHigh.toString(),
            senderAddressLow: senderAddressLow.toString(),
            senderAddressHigh: senderAddressHigh.toString(),
            blockchainId: blockchainId.toString(),
            amount: amount.toString(),
            year: year.toString(),
            month: month.toString(),
            day: day.toString(),
            hour: hour.toString(),
            minute: minute.toString(),
            second: second.toString(),
            mintPublicKeyLow: mintPublicKeyLow.toString(),
            mintPublicKeyHigh: mintPublicKeyHigh.toString(),
            secondAddressBlindingFactor: secondAddressBlindingFactor.toString(),
            commissionFeeLowerBound: commissionFeeLowerBound.toString(),
            commissionFeeUpperBound: commissionFeeUpperBound.toString(),
            relayerPubkeyLow: relayerPubkeyLow.toString(),
            relayerPubkeyHigh: relayerPubkeyHigh.toString(),
            expectedVersion: expectedVersion.toString(),
            expectedFirstAddressLow: expectedFirstAddressLow.toString(),
            expectedFirstAddressHigh: expectedFirstAddressHigh.toString(),
            expectedBlockchainId: expectedBlockchainId.toString(),
            expectedMerkleRoot: convertU256LeBytesToU256(expectedMerkleRoot).toString(),
            expectedLinkerAddressHash: convertU256LeBytesToU256(expectedLinkerAddressHash).toString(),
            expectedNullifierHash: convertU256LeBytesToU256(expectedNullifierHash).toString(),
            expectedSecondAddressSha3AggregatedHash: convertU256LeBytesToU256(expectedSecondAddressSha3AggregatedHash).toString(),
            expectedLowerBound: expectedLowerBound.toString(),
            expectedUpperBound: expectedUpperBound.toString(),
            expectedMintPubkeyLow: expectedMintPubkeyLow.toString(),
            expectedMintPubkeyHigh: expectedMintPubkeyHigh.toString(),
            expectedRelayerPubkeyLow: expectedRelayerPubkeyLow.toString(),
            expectedRelayerPubkeyHigh: expectedRelayerPubkeyHigh.toString(),
        };
        return this.generateProof('claimSplDepositWithHiddenAmount', inputs);
    }
    async generateClaimSplDepositProof(randomSecret, nullifier, masterViewingKey, merklePathElements, merklePathIndices, version, commitmentIndex, firstAddressLow, firstAddressHigh, secondAddressLow, secondAddressHigh, blockchainId, amount, year, month, day, hour, minute, seconds, mintPubkeyLow, mintPubkeyHigh, secondAddressBlindingFactor, relayerPubkeyLow, relayerPubkeyHigh, expectedVersion, expectedBlockchainId, expectedFirstAddressLow, expectedFirstAddressHigh, expectedAmount, expectedMintPubkeyLow, expectedMintPubkeyHigh, expectedMerkleRoot, expectedLinkerAddressHash, expectedNullifierHash, expectedSecondAddressKeccakAggregatedHash, expectedRelayerPubkeyLow, expectedRelayerPubkeyHigh) {
        const inputs = {
            randomSecret: randomSecret.toString(),
            nullifier: nullifier.toString(),
            masterViewingKey: masterViewingKey.toString(),
            merklePathElements: merklePathElements.map((h) => convertU256LeBytesToU256(h).toString()),
            merklePathIndices: merklePathIndices.map((i) => i.toString()),
            version: version.toString(),
            commitmentIndex: commitmentIndex.toString(),
            firstAddressLow: firstAddressLow.toString(),
            firstAddressHigh: firstAddressHigh.toString(),
            secondAddressLow: secondAddressLow.toString(),
            secondAddressHigh: secondAddressHigh.toString(),
            blockchainId: blockchainId.toString(),
            amount: amount.toString(),
            year: year.toString(),
            month: month.toString(),
            day: day.toString(),
            hour: hour.toString(),
            minute: minute.toString(),
            seconds: seconds.toString(),
            mintPubkeyLow: mintPubkeyLow.toString(),
            mintPubkeyHigh: mintPubkeyHigh.toString(),
            secondAddressBlindingFactor: secondAddressBlindingFactor.toString(),
            relayerPubkeyLow: relayerPubkeyLow.toString(),
            relayerPubkeyHigh: relayerPubkeyHigh.toString(),
            expectedVersion: expectedVersion.toString(),
            expectedBlockchainId: expectedBlockchainId.toString(),
            expectedFirstAddressLow: expectedFirstAddressLow.toString(),
            expectedFirstAddressHigh: expectedFirstAddressHigh.toString(),
            expectedAmount: expectedAmount.toString(),
            expectedMintPubkeyLow: expectedMintPubkeyLow.toString(),
            expectedMintPubkeyHigh: expectedMintPubkeyHigh.toString(),
            expectedMerkleRoot: convertU256LeBytesToU256(expectedMerkleRoot).toString(),
            expectedLinkerAddressHash: convertU256LeBytesToU256(expectedLinkerAddressHash).toString(),
            expectedNullifierHash: convertU256LeBytesToU256(expectedNullifierHash).toString(),
            expectedSecondAddressKeccakAggregatedHash: convertU256LeBytesToU256(expectedSecondAddressKeccakAggregatedHash).toString(),
            expectedRelayerPubkeyLow: expectedRelayerPubkeyLow.toString(),
            expectedRelayerPubkeyHigh: expectedRelayerPubkeyHigh.toString(),
        };
        return this.generateProof('claimSplDeposit', inputs);
    }
    /**
     * Converts a snarkjs Groth16 proof into flattened big-endian byte arrays compatible with
     * the Umbra on-chain types.
     *
     * @remarks
     * snarkjs represents Groth16 proofs over BN254 as:
     * - `pi_a`: [Ax, Ay]
     * - `pi_b`: [[Bax, Bay], [Bbx, Bby]]
     * - `pi_c`: [Cx, Cy]
     *
     * All coordinates are hex/decimal strings modulo the BN254 field. This helper:
     * 1. Parses each coordinate string into a bigint
     * 2. Encodes it as a 32-byte big-endian `U256`
     * 3. Flattens the points into contiguous byte arrays in the expected order:
     *    - A: [Ax || Ay]
     *    - B: [Bay || Bax || Bby || Bbx] (note the (1,0) / (0,1) ordering)
     *    - C: [Cx || Cy]
     *
     * @param proof - Groth16 proof returned by snarkjs.
     * @returns A tuple of (A, B, C) as big-endian byte arrays.
     *
     * @throws {@link WasmZkProverError} If the proof shape is invalid or a coordinate
     *         cannot be parsed as a valid U256.
     */
    convertZkProofToBytes(proof) {
        const { pi_a: a, pi_b: b, pi_c: c } = proof;
        if (!Array.isArray(a) || a.length !== 2) {
            throw new WasmZkProverError('Groth16 proof `pi_a` must be an array of length 2');
        }
        if (!Array.isArray(b) ||
            b.length !== 2 ||
            !Array.isArray(b[0]) ||
            !Array.isArray(b[1])) {
            throw new WasmZkProverError('Groth16 proof `pi_b` must be a 2x2 array: [[Bax, Bay], [Bbx, Bby]]');
        }
        if (!Array.isArray(c) || c.length !== 2) {
            throw new WasmZkProverError('Groth16 proof `pi_c` must be an array of length 2');
        }
        try {
            const aBytes = a.map((x) => convertU256ToBeBytes(convertStringToBigInt(x)));
            const bBytes = b.map((x) => {
                const bax = convertU256ToBeBytes(convertStringToBigInt(x[0]));
                const bay = convertU256ToBeBytes(convertStringToBigInt(x[1]));
                return [bax, bay];
            });
            const cBytes = c.map((x) => convertU256ToBeBytes(convertStringToBigInt(x)));
            const aFlattened = new Uint8Array([
                ...Array.from(aBytes[0]),
                ...Array.from(aBytes[1]),
            ]);
            // Ordering: [Bay || Bax || Bby || Bbx]
            const bFlattened = new Uint8Array([
                ...Array.from(bBytes[0][1]),
                ...Array.from(bBytes[0][0]),
                ...Array.from(bBytes[1][1]),
                ...Array.from(bBytes[1][0]),
            ]);
            const cFlattened = new Uint8Array([
                ...Array.from(cBytes[0]),
                ...Array.from(cBytes[1]),
            ]);
            return [
                aFlattened,
                bFlattened,
                cFlattened,
            ];
        }
        catch (error) {
            throw new WasmZkProverError(`Failed to convert Groth16 proof coordinates to bytes: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error : undefined);
        }
    }
}
