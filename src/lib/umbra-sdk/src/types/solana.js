export function convertSolanaAddressToTransactionInput(solanaAddress) {
    return { 0: solanaAddress };
}
export function convertMintAddressToTransactionInput(mintAddress) {
    return { 0: mintAddress };
}
export function convertProgramDerivedAddressToTransactionInput(programDerivedAddress) {
    return { 0: programDerivedAddress };
}
export function convertProgramAddressToTransactionInput(programAddress) {
    return { 0: programAddress };
}
