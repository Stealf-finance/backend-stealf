/**
 * Ensures that a bigint value fits into the requested byte width.
 *
 * @param value - The bigint value to validate.
 * @param numberOfBytes - The number of bytes available for the representation.
 *
 * @throws RangeError If the value is negative or cannot be represented in `numberOfBytes` bytes.
 */
function assertFitsInBytes(value, numberOfBytes) {
    const max = (1n << (8n * BigInt(numberOfBytes))) - 1n;
    if (value < 0n || value > max) {
        throw new RangeError(`Value ${value.toString()} does not fit in ${numberOfBytes} bytes`);
    }
}
/**
 * Converts a bigint into a little-endian byte array of fixed length.
 *
 * @param bigint - The unsigned bigint value to convert.
 * @param numberOfBytes - The exact number of bytes to output.
 * @returns A `LeBytes` buffer representing the value in little-endian order.
 *
 * @throws RangeError If `bigint` cannot be represented in `numberOfBytes` bytes.
 */
export function convertBigIntToLeBytes(bigint, numberOfBytes) {
    assertFitsInBytes(bigint, numberOfBytes);
    const bytes = new Uint8Array(numberOfBytes);
    for (let i = 0; i < numberOfBytes; i++) {
        bytes[i] = Number(bigint & 0xffn);
        bigint = bigint >> 8n;
    }
    return bytes;
}
/**
 * Converts a bigint into a big-endian byte array of fixed length.
 *
 * @param bigint - The unsigned bigint value to convert.
 * @param numberOfBytes - The exact number of bytes to output.
 * @returns A `BeBytes` buffer representing the value in big-endian order.
 *
 * @throws RangeError If `bigint` cannot be represented in `numberOfBytes` bytes.
 */
export function convertBigIntToBeBytes(bigint, numberOfBytes) {
    assertFitsInBytes(bigint, numberOfBytes);
    const bytes = new Uint8Array(numberOfBytes);
    for (let i = 0; i < numberOfBytes; i++) {
        bytes[i] = Number((bigint >> (8n * BigInt(numberOfBytes - i - 1))) & 0xffn);
    }
    return bytes;
}
/**
 * Converts a little-endian byte array into a bigint.
 *
 * @param bytes - The little-endian bytes.
 * @param numberOfBytes - Number of bytes to read from the buffer.
 * @returns The reconstructed bigint value.
 */
export function convertLeBytesToBigInt(bytes, numberOfBytes) {
    let bigint = 0n;
    for (let i = 0; i < numberOfBytes; i++) {
        bigint = (bigint << 8n) | BigInt(bytes.at(i));
    }
    return bigint;
}
/**
 * Converts a big-endian byte array into a bigint.
 *
 * @param bytes - The big-endian bytes.
 * @param numberOfBytes - Number of bytes to read from the buffer.
 * @returns The reconstructed bigint value.
 */
export function convertBeBytesToBigInt(bytes, numberOfBytes) {
    let bigint = 0n;
    for (let i = 0; i < numberOfBytes; i++) {
        bigint = (bigint << 8n) | BigInt(bytes.at(i));
    }
    return bigint;
}
/**
 * Converts little-endian bytes to a Node.js `Buffer`.
 */
export function convertLeBytesToBuffer(bytes) {
    return Buffer.from(bytes);
}
/**
 * Converts big-endian bytes to a Node.js `Buffer`.
 */
export function convertBeBytesToBuffer(bytes) {
    return Buffer.from(bytes);
}
/**
 * U8 ⇄ bytes (LE / BE) helpers.
 *
 * @remarks
 * These functions assume the underlying bigint already satisfies the U8 range.
 */
export function convertU8ToLeBytes(u8) {
    return convertBigIntToLeBytes(u8, 1);
}
export function convertU8ToBeBytes(u8) {
    return convertBigIntToBeBytes(u8, 1);
}
export function convertU8LeBytesToU8(u8Bytes) {
    return convertLeBytesToBigInt(u8Bytes, 1);
}
export function convertU8BeBytesToU8(u8BeBytes) {
    return convertBeBytesToBigInt(u8BeBytes, 1);
}
/**
 * U16 ⇄ bytes (LE / BE) helpers.
 */
export function convertU16ToLeBytes(u16) {
    return convertBigIntToLeBytes(u16, 2);
}
export function convertU16ToBeBytes(u16) {
    return convertBigIntToBeBytes(u16, 2);
}
export function convertU16LeBytesToU16(u16Bytes) {
    return convertLeBytesToBigInt(u16Bytes, 2);
}
export function convertU16BeBytesToU16(u16BeBytes) {
    return convertBeBytesToBigInt(u16BeBytes, 2);
}
/**
 * U32 ⇄ bytes (LE / BE) helpers.
 */
export function convertU32ToLeBytes(u32) {
    return convertBigIntToLeBytes(u32, 4);
}
export function convertU32ToBeBytes(u32) {
    return convertBigIntToBeBytes(u32, 4);
}
export function convertU32LeBytesToU32(u32Bytes) {
    return convertLeBytesToBigInt(u32Bytes, 4);
}
export function convertU32BeBytesToU32(u32BeBytes) {
    return convertBeBytesToBigInt(u32BeBytes, 4);
}
/**
 * U64 ⇄ bytes (LE / BE) helpers.
 */
export function convertU64ToLeBytes(u64) {
    return convertBigIntToLeBytes(u64, 8);
}
export function convertU64ToBeBytes(u64) {
    return convertBigIntToBeBytes(u64, 8);
}
export function convertU64LeBytesToU64(u64Bytes) {
    return convertLeBytesToBigInt(u64Bytes, 8);
}
export function convertU64BeBytesToU64(u64BeBytes) {
    return convertBeBytesToBigInt(u64BeBytes, 8);
}
/**
 * U128 ⇄ bytes (LE / BE) helpers.
 */
export function convertU128ToLeBytes(u128) {
    return convertBigIntToLeBytes(u128, 16);
}
export function convertU128ToBeBytes(u128) {
    return convertBigIntToBeBytes(u128, 16);
}
export function convertU128LeBytesToU128(u128Bytes) {
    return convertLeBytesToBigInt(u128Bytes, 16);
}
export function convertU128BeBytesToU128(u128BeBytes) {
    return convertBeBytesToBigInt(u128BeBytes, 16);
}
/**
 * U256 ⇄ bytes (LE / BE) helpers.
 */
export function convertU256ToLeBytes(u256) {
    return convertBigIntToLeBytes(u256, 32);
}
export function convertU256ToBeBytes(u256) {
    return convertBigIntToBeBytes(u256, 32);
}
export function convertU256LeBytesToU256(u256Bytes) {
    return convertLeBytesToBigInt(u256Bytes, 32);
}
export function convertU256BeBytesToU256(u256BeBytes) {
    return convertBeBytesToBigInt(u256BeBytes, 32);
}
/**
 * Converts a decimal string representation of an integer into a bigint.
 *
 * @param string - The string to convert (typically base-10 encoded).
 * @returns The corresponding bigint value.
 *
 * @throws SyntaxError If the string is not a valid bigint literal for `BigInt(...)`.
 */
export function convertStringToBigInt(string) {
    return BigInt(string);
}
