/**
 * C82.3: the public `address-lookup` provider fields (the contracts' names; risk-logic's
 * `ADDRESS_VERIFICATION_FIELDS`) and the readers that turn a vendor's values into them. A value in
 * another shape than the field's is `null`, never guessed.
 */
import { ADDRESS_VERIFICATION_FIELDS } from '@openverify/checks';

export type AddressVerificationField = (typeof ADDRESS_VERIFICATION_FIELDS)[number];
export type AddressVerificationFields = Record<
  AddressVerificationField,
  string | number | boolean | null
>;

/** Every field at `null`. */
export function emptyAddressFields(): AddressVerificationFields {
  return Object.fromEntries(
    ADDRESS_VERIFICATION_FIELDS.map((field) => [field, null]),
  ) as AddressVerificationFields;
}

/** A string of 1 to `max` characters, else `null`. */
export function textOf(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** USPS's `Y`/`N` flags as booleans, else `null`. */
export function flagOf(value: unknown): boolean | null {
  return value === 'Y' ? true : value === 'N' ? false : null;
}

/** A finite number within the bounds, else `null`. */
export function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

/** C82.3: what a DPV match code says about delivery. */
export function deliverabilityOf(
  matchCode: string | null,
):
  | 'confirmed'
  | 'confirmed_missing_secondary'
  | 'confirmed_secondary_invalid'
  | 'not_confirmed'
  | 'unknown' {
  switch (matchCode) {
    case 'Y':
      return 'confirmed';
    case 'D':
      return 'confirmed_missing_secondary';
    case 'S':
      return 'confirmed_secondary_invalid';
    case 'N':
      return 'not_confirmed';
    default:
      return 'unknown';
  }
}
