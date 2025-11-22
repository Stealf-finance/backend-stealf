import BN from 'bn.js';
export function convertArciumX25519PublicKeyToTransactionInput(publicKey) {
    return { 0: Array.from(publicKey) };
}
export function convertArciumX25519SecretKeyToTransactionInput(secretKey) {
    return { 0: Array.from(secretKey) };
}
export function convertRescueCiphertextToTransactionInput(ciphertext) {
    return { 0: Array.from(ciphertext) };
}
export function convertArciumX25519NonceToTransactionInput(nonce) {
    return { 0: new BN(nonce) };
}
export function convertComputationOffsetToTransactionInput(offset) {
    return { 0: new BN(offset) };
}
