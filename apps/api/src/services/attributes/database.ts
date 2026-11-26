/**
 * C52.8, C53.7, C54.1: the `database` verification's attributes: the values the user entered, as
 * the inputs body names them, every member present (`null` when not entered, all `null` once
 * redacted, C53.6). Every member is PII, so a principal without `pii:view` sees `null` in each.
 */
import { DATABASE_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { getVerificationInputs } from '@openverify/db';
import type { VerificationAttributeHook } from './index.js';

/** The C52.8 members, in contract order. */
const NAMES = Object.keys(DATABASE_VERIFICATION_ATTRIBUTES);

/** An entered value as served: text, else `null`. */
export const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const databaseAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    const values = inputs?.values ?? null;
    return Object.fromEntries(NAMES.map((name) => [name, textOrNull(values?.[name])]));
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
