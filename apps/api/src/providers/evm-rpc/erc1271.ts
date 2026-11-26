/**
 * C57.4, C57.5: ERC-1271 over the EVM RPC. A contract wallet answers `isValidSignature(bytes32
 * hash, bytes signature)` with exactly the 4-byte magic value `0x1626ba7e`, ABI-encoded as one
 * 32-byte word (the value then 28 zero bytes); any other answer, including a shorter or longer
 * one, does not accept the signature. The call is bounded (gas 500,000, one call per submit).
 */

/** `bytes4(keccak256("isValidSignature(bytes32,bytes)"))`, the selector and the magic value. */
export const ERC1271_MAGIC_VALUE = '0x1626ba7e';
/** C57.5: the gas of the one `isValidSignature` call per submit. */
export const ERC1271_CALL_GAS = 500_000;

const WORD_BYTES = 32;
/** The offset of the `bytes` argument after the head (the digest and the offset itself). */
const SIGNATURE_OFFSET = 2 * WORD_BYTES;
const SELECTOR = ERC1271_MAGIC_VALUE.slice(2);
const MAGIC_RESULT = /^0x1626ba7e0{56}$/iu;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LOWER_HEX = /^(?:[\da-f]{2})*$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const CODE = /^0x(?:[\da-f]{2})+$/iu;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const word = (value: number): string => value.toString(16).padStart(WORD_BYTES * 2, '0');
const padded = (length: number): number => Math.ceil(length / WORD_BYTES) * WORD_BYTES;

/** The `eth_call` data of `isValidSignature(digest, signature)`, `0x` hex. */
export function encodeIsValidSignatureCall(digest: Uint8Array, signature: Uint8Array): string {
  if (digest.length !== WORD_BYTES) {
    throw new RangeError('the ERC-1271 hash is 32 bytes');
  }
  const tail = toHex(signature).padEnd(padded(signature.length) * 2, '0');
  return `0x${SELECTOR}${toHex(digest)}${word(SIGNATURE_OFFSET)}${word(signature.length)}${tail}`;
}

/** The arguments of `isValidSignature` call data, or `null` when `data` is not exactly one. */
export function decodeIsValidSignatureCall(
  data: string,
): { digest: Uint8Array; signature: Uint8Array } | null {
  const hex = data.startsWith(`0x${SELECTOR}`) ? data.slice(2 + SELECTOR.length) : null;
  if (hex === null || hex.length < 3 * WORD_BYTES * 2 || !LOWER_HEX.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(Buffer.from(hex, 'hex'));
  const number = (at: number): number | null => {
    const value = BigInt(`0x${toHex(bytes.slice(at, at + WORD_BYTES))}`);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  };
  const offset = number(WORD_BYTES);
  const length = number(SIGNATURE_OFFSET);
  const start = SIGNATURE_OFFSET + WORD_BYTES;
  if (offset !== SIGNATURE_OFFSET || length === null || bytes.length !== start + padded(length)) {
    return null;
  }
  if (bytes.slice(start + length).some((byte) => byte !== 0)) {
    return null;
  }
  return { digest: bytes.slice(0, WORD_BYTES), signature: bytes.slice(start, start + length) };
}

/** The one answer that accepts a signature: the magic value padded to a 32-byte word. */
export function isErc1271MagicResult(result: string): boolean {
  return MAGIC_RESULT.test(result);
}

/** Whether an `eth_getCode` answer holds contract code (anything but `0x`). */
export function holdsContractCode(code: string): boolean {
  return CODE.test(code);
}
