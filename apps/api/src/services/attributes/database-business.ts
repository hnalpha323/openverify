/**
 * C52.8, C53.7, C54.1: the `database-business` verification's attributes: the business as the user
 * entered it (the inputs body's names; its `country-code` served as `address-country-code`), and
 * the register's record it was judged against (`business_registry_records`: the record id, legal
 * name and status from the sealed summary, the source from the row). Every member is present,
 * `null` when absent. The PII members (the name, address and persons, since a sole trader's are a
 * person's; the register's legal name likewise) are masked for a principal without `pii:view`, and
 * `null` once the inquiry is redacted (C53.6); the source, which is not PII, stays.
 */
import { getBusinessRegistryRecord, getVerificationInputs, openBusinessRegistryRecord } from '@openverify/db';
import { textOrNull } from './database.js';
import type { VerificationAttributeHook } from './index.js';

/** The entered members served as they were entered. */
const ENTERED = [
  'business-name',
  'registration-number',
  'lei',
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
] as const;

/** The entered persons, each member as entered; `null` without any. */
function personsOf(value: unknown): Record<string, string | null>[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.flatMap((person: unknown) => {
    if (typeof person !== 'object' || person === null) {
      return [];
    }
    const entered = person as Record<string, unknown>;
    const birthdate = textOrNull(entered.birthdate);
    return [
      {
        'name-first': textOrNull(entered['name-first']),
        'name-last': textOrNull(entered['name-last']),
        ...(birthdate === null ? {} : { birthdate }),
      },
    ];
  });
}

export const databaseBusinessAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const { environmentId, id } = verification;
    const inputs = await getVerificationInputs(db, environmentId, id);
    const values = inputs?.values ?? null;
    const row = await getBusinessRegistryRecord(db, environmentId, id);
    const record = await openBusinessRegistryRecord(db, environmentId, id);
    return {
      ...Object.fromEntries(ENTERED.map((name) => [name, textOrNull(values?.[name])])),
      'address-country-code': textOrNull(values?.['country-code']),
      'associated-persons': personsOf(values?.['associated-persons']),
      'registry-record-id': record?.recordId ?? null,
      'registry-legal-name': record?.legalName ?? null,
      'registry-source': row?.source ?? null,
      'registry-status': record?.status ?? null,
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
