/**
 * C52.8, C53.7: the type attributes of each Phase 5 golden API fixture
 * (`contracts/fixtures/api/verification-<api-type>.json`), served through mocked attribute hooks
 * so the masking tests see real values at every exit. Only tests import this file; every value
 * in the fixtures is synthetic.
 */
import { readFileSync } from 'node:fs';
import { PII_VERIFICATION_ATTRIBUTES, type ApiVerificationType } from '@openverify/contracts';
import type {
  Phase5VerificationType,
  VerificationAttributeHook,
} from '../services/attributes/index.js';

/** Each Phase 5 type: its domain name, API name and its attribute module's export. */
export const PHASE5_ATTRIBUTE_TYPES = [
  { type: 'document', apiType: 'document', hook: 'documentAttributes' },
  { type: 'database', apiType: 'database', hook: 'databaseAttributes' },
  { type: 'aamva', apiType: 'aamva', hook: 'aamvaAttributes' },
  { type: 'phone_number', apiType: 'phone-number', hook: 'phoneNumberAttributes' },
  { type: 'email_address', apiType: 'email-address', hook: 'emailAddressAttributes' },
  { type: 'government_id_nfc', apiType: 'government-id-nfc', hook: 'governmentIdNfcAttributes' },
  { type: 'crypto_wallet', apiType: 'crypto-wallet', hook: 'cryptoWalletAttributes' },
  { type: 'database_business', apiType: 'database-business', hook: 'databaseBusinessAttributes' },
  { type: 'business_website', apiType: 'business-website', hook: 'businessWebsiteAttributes' },
] as const satisfies readonly {
  type: Phase5VerificationType;
  apiType: ApiVerificationType;
  hook: string;
}[];

const COMMON = new Set(['status', 'checks', 'created-at', 'updated-at']);

/** The type attributes of the golden fixture of `apiType`. */
export function fixtureAttributes(apiType: ApiVerificationType): Record<string, unknown> {
  const url = new URL(
    `../../../../contracts/fixtures/api/verification-${apiType}.json`,
    import.meta.url,
  );
  const document = JSON.parse(readFileSync(url, 'utf8')) as {
    data: { attributes: Record<string, unknown> };
  };
  return Object.fromEntries(
    Object.entries(document.data.attributes).filter(([name]) => !COMMON.has(name)),
  );
}

/** A module standing in for `services/attributes/<api-type>.ts`: its hook loads the fixture. */
export function fixtureAttributeModule(
  apiType: ApiVerificationType,
  exportName: string,
): Record<string, VerificationAttributeHook> {
  return {
    [exportName]: {
      load: () => Promise.resolve(fixtureAttributes(apiType)),
      mask: (attributes, mask) => mask.attributes(attributes),
    },
  };
}

const PII = new Set(PII_VERIFICATION_ATTRIBUTES);

/** `attributes` as a principal without `pii:view` must see them (C53.7). */
export function maskedFixtureAttributes(apiType: ApiVerificationType): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fixtureAttributes(apiType)).map(([name, value]) => {
      if (!PII.has(name)) {
        return [name, value];
      }
      if (name === 'fields' && typeof value === 'object' && value !== null) {
        return [name, Object.fromEntries(Object.keys(value).map((field) => [field, null]))];
      }
      return [name, null];
    }),
  );
}

/**
 * The PII attribute values of the fixture that are not `null` and long enough (three characters
 * or more, so not `sex: "X"`) to search a serialized body for: what masking must remove.
 */
export function piiValuesOf(apiType: ApiVerificationType): string[] {
  return Object.entries(fixtureAttributes(apiType))
    .filter(([name, value]) => PII.has(name) && value !== null)
    .flatMap(([, value]) =>
      typeof value === 'object' && value !== null
        ? Object.values(value as Record<string, unknown>).filter(
            (member): member is string => typeof member === 'string',
          )
        : typeof value === 'string'
          ? [value]
          : [],
    )
    .filter((value) => value.length >= 3);
}
