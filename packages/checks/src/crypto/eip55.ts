/**
 * EIP-55 mixed-case checksum addresses (C57.1): Keccak-256 (not SHA3-256) of the lower-case hex
 * digits, each letter upper-cased where its hash nibble is 8 or more. An all-lower or all-upper
 * address carries no checksum: it is valid, flagged `checksum: absent`.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8 } from './bytes.js';

/** What an EVM address's letter case says. */
export type Eip55Checksum = 'valid' | 'invalid' | 'absent';

/** The EIP-55 form of 40 hex digits (any case, without `0x`), with `0x`. */
export function toEip55Address(hexDigits: string): string {
  const lower = hexDigits.toLowerCase();
  const hash = keccak_256(utf8(lower));
  let checksummed = '0x';
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower.charAt(index);
    const nibble = ((hash[index >> 1] ?? 0) >> (index % 2 === 0 ? 4 : 0)) & 0x0f;
    checksummed += nibble >= 8 ? character.toUpperCase() : character;
  }
  return checksummed;
}

/** The checksum state of `0x` and 40 hex digits. */
export function eip55Checksum(address: string): Eip55Checksum {
  const digits = address.slice(2);
  if (digits === digits.toLowerCase() || digits === digits.toUpperCase()) {
    return 'absent';
  }
  return toEip55Address(digits) === address ? 'valid' : 'invalid';
}
