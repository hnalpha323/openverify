/**
 * C52.8, C53.7, C54.1, C59.6: the `aamva` verification's attributes: `source` (`form` for values
 * the user entered, `government_id` for values the server copied from the inquiry's licence;
 * `null` before either) and the values as the AAMVA body names them, every member present (`null`
 * when absent, all `null` once redacted, C53.6, while the source stays). The values are PII, so a
 * principal without `pii:view` sees `null` in each; the source is not.
 */
import { AAMVA_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { getVerificationInputs } from '@openverify/db';
import { textOrNull } from './database.js';
import type { VerificationAttributeHook } from './index.js';

/** The C52.8 value members, in contract order. */
const VALUE_NAMES = Object.keys(AAMVA_VERIFICATION_ATTRIBUTES).filter((name) => name !== 'source');

/** The attribute `source` of the inputs' origin. */
const SOURCE_OF = { flow: 'form', government_id: 'government_id' } as const;

export const aamvaAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const inputs = await getVerificationInputs(db, verification.environmentId, verification.id);
    const values = inputs?.values ?? null;
    return {
      source: inputs === null ? null : SOURCE_OF[inputs.source],
      ...Object.fromEntries(VALUE_NAMES.map((name) => [name, textOrNull(values?.[name])])),
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
