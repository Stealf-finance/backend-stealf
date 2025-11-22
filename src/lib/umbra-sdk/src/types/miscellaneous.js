import BN from 'bn.js';
export function convertFlagBitsToTransactionInput(flagBits) {
    return { 0: new BN(flagBits) };
}
export function convertAmountToTransactionInput(amount) {
    return { 0: new BN(amount) };
}
export function convertBasisPointsToTransactionInput(basisPoints) {
    return { 0: Number(basisPoints) };
}
export function convertAccountOffsetToTransactionInput(accountOffset) {
    return { 0: Number(accountOffset) };
}
export function convertEphemeralOffsetToTransactionInput(ephemeralOffset) {
    return { 0: new BN(ephemeralOffset) };
}
export function convertYearToTransactionInput(year) {
    return { 0: new BN(year) };
}
export function convertMonthToTransactionInput(month) {
    return { 0: new BN(month) };
}
export function convertDayToTransactionInput(day) {
    return { 0: new BN(day) };
}
export function convertHourToTransactionInput(hour) {
    return { 0: new BN(hour) };
}
export function convertMinuteToTransactionInput(minute) {
    return { 0: new BN(minute) };
}
export function convertSecondToTransactionInput(second) {
    return { 0: new BN(second) };
}
export function convertBooleanToTransactionInput(boolean) {
    return { 0: boolean };
}
export function convertSlotToTransactionInput(slot) {
    return { 0: new BN(slot) };
}
export function convertRiskThresholdToTransactionInput(riskThreshold) {
    return { 0: Array.from(riskThreshold) };
}
export function convertNumberOfTransactionsToTransactionInput(numberOfTransactions) {
    return { 0: new BN(numberOfTransactions) };
}
export function convertInstructionSeedToTransactionInput(instructionSeed) {
    return { 0: Number(instructionSeed) };
}
export function convertTimeToTransactionInput(time) {
    return { 0: new BN(time) };
}
