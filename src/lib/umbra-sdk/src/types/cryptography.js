import BN from 'bn.js';
export function convertPoseidonHashToTransactionInput(poseidonHash) {
    return { 0: Array.from(poseidonHash) };
}
export function convertSha3HashToTransactionInput(sha3Hash) {
    return { 0: Array.from(sha3Hash) };
}
export function convertZkMerkleTreeInsertionIndexToTransactionInput(zkMerkleTreeInsertionIndex) {
    return { 0: new BN(zkMerkleTreeInsertionIndex) };
}
export function convertGroth16ProofABeBytesToTransactionInput(groth16ProofA) {
    return { 0: Array.from(groth16ProofA) };
}
export function convertGroth16ProofBBeBytesToTransactionInput(groth16ProofB) {
    return { 0: Array.from(groth16ProofB) };
}
export function convertGroth16ProofCBeBytesToTransactionInput(groth16ProofC) {
    return { 0: Array.from(groth16ProofC) };
}
