/**
 * Synthetic identifiers for the fixtures (C77.1, C79.2): every value is generated from a seed and
 * chosen so it cannot name a real party. LEIs use the fictional `SYNT` prefix with valid ISO 17442
 * check digits, IMO numbers sit below the range ships are given and carry a valid check digit,
 * BICs use a test location code (second character `0`), domains end in the reserved `.example`.
 */
import { fictionalFamilyName, fictionalGivenName } from './names.js';
import type { SeededRandom } from './random.js';

const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUMERIC = `${DIGITS}${LETTERS}`;

/** ISO 7064 MOD 97-10 remainder of an upper-case alphanumeric string (A = 10 … Z = 35). */
function mod97(text: string): number {
  let remainder = 0;
  for (const character of text) {
    const value = ALPHANUMERIC.indexOf(character);
    if (value < 0) {
      throw new RangeError('an LEI holds digits and upper-case letters only');
    }
    remainder = value < 10 ? (remainder * 10 + value) % 97 : (remainder * 100 + value) % 97;
  }
  return remainder;
}

/** ISO 17442 (ISO 7064 MOD 97-10): the two check digits of the first 18 characters of an LEI. */
export function leiCheckDigits(first18: string): string {
  if (!/^[\dA-Z]{18}$/.test(first18)) {
    throw new RangeError('an LEI starts with 18 digits or upper-case letters');
  }
  return String(98 - mod97(`${first18}00`)).padStart(2, '0');
}

/** Whether an LEI has 20 characters and valid check digits. */
export function isValidLei(lei: string): boolean {
  return /^[\dA-Z]{18}\d{2}$/.test(lei) && mod97(lei) === 1;
}

/** A synthetic LEI: `SYNT00`, 12 random characters and valid check digits. */
export function syntheticLei(random: SeededRandom): string {
  const first18 = `SYNT00${random.string(ALPHANUMERIC, 12)}`;
  return `${first18}${leiCheckDigits(first18)}`;
}

/** The IMO check digit of the first six digits (Σ dᵢ·(7−i) mod 10). */
export function imoCheckDigit(firstSix: string): number {
  if (!/^\d{6}$/.test(firstSix)) {
    throw new RangeError('an IMO number starts with six digits');
  }
  let sum = 0;
  for (let index = 0; index < 6; index += 1) {
    sum += Number(firstSix.charAt(index)) * (7 - index);
  }
  return sum % 10;
}

/** Whether a 7-digit IMO number carries its check digit. */
export function isValidImo(imo: string): boolean {
  return /^\d{7}$/.test(imo) && imoCheckDigit(imo.slice(0, 6)) === Number(imo.charAt(6));
}

/** A synthetic IMO number between 1000000 and 1999999 with a valid check digit. */
export function syntheticImo(random: SeededRandom): string {
  const firstSix = `1${random.string(DIGITS, 5)}`;
  return `${firstSix}${String(imoCheckDigit(firstSix))}`;
}

/** A synthetic 9-digit MMSI starting `100` (no maritime identification digits are `100`). */
export function syntheticMmsi(random: SeededRandom): string {
  return `100${random.string(DIGITS, 6)}`;
}

/** A synthetic test BIC of `country`: four letters, the country, a test location (`?0`). */
export function syntheticBic(random: SeededRandom, country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new RangeError('the country is an ISO 3166-1 alpha-2 code');
  }
  const location = `${random.string(`${LETTERS}23456789`, 1)}0`;
  const branch = random.chance(0.5) ? random.string(ALPHANUMERIC, 3) : '';
  return `${random.string(LETTERS, 4)}${country}${location}${branch}`;
}

/** A synthetic passport number. */
export function syntheticPassportNumber(random: SeededRandom): string {
  return `SP${random.string(DIGITS, 7)}`;
}

/** A synthetic national identification number. */
export function syntheticNationalId(random: SeededRandom): string {
  return `NI${random.string(DIGITS, 9)}`;
}

/** A synthetic tax identification number. */
export function syntheticTaxId(random: SeededRandom): string {
  return `TX${random.string(DIGITS, 8)}`;
}

/** A synthetic company registration number. */
export function syntheticRegistrationNumber(random: SeededRandom): string {
  return `RN${random.string(DIGITS, 8)}`;
}

/** A domain under the reserved `.example` TLD (RFC 2606), from a fictional word. */
export function syntheticDomain(random: SeededRandom): string {
  const words = [fictionalGivenName(random).latin.toLowerCase()];
  if (random.chance(0.4)) {
    words.push(fictionalFamilyName(random).latin.toLowerCase());
  }
  return `${words.join('-')}.example`;
}

/** A synthetic aircraft tail mark (`SBX-` and three letters: no state uses `SBX`). */
export function syntheticAircraftTail(random: SeededRandom): string {
  return `SBX-${random.string(LETTERS, 3)}`;
}

/** A synthetic aircraft manufacturer serial number. */
export function syntheticAircraftSerial(random: SeededRandom): string {
  return `SYN-${random.string(DIGITS, 5)}`;
}
