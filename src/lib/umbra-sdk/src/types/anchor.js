import BN from 'bn.js';
export function convertVersionByteToTransactionInput(versionByte) {
    return { 0: new BN(versionByte) };
}
export function convertCanonicalBumpToTransactionInput(canonicalBump) {
    return { 0: new BN(canonicalBump) };
}
export function convertReservedSpaceToTransactionInput(reservedSpace) {
    return { 0: new BN(reservedSpace) };
}
