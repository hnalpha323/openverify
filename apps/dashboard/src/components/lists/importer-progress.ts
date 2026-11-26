import type { ImporterResource } from '@openverify/contracts';
import type { ListKind } from '@openverify/core';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/**
 * An import's counts in words (C100.1, H30): what it imported of the file's rows, the rows
 * repeated within the file, those already in the list, and the errors. A pending import has
 * counted nothing yet.
 */
export function importerProgress(attributes: ImporterResource['attributes']): string {
  if (attributes.status === 'pending') {
    return 'Not finished yet.';
  }
  const parts = [
    `${attributes['successful-count'].toLocaleString('en-US')} of ${plural(attributes['row-count'], 'row', 'rows')} imported`,
  ];
  if (attributes['duplicate-count'] > 0) {
    parts.push(`${attributes['duplicate-count'].toLocaleString('en-US')} repeated in the file`);
  }
  if (attributes['already-present-count'] > 0) {
    parts.push(
      `${attributes['already-present-count'].toLocaleString('en-US')} already in the list`,
    );
  }
  if (attributes['error-count'] > 0) {
    parts.push(plural(attributes['error-count'], 'error', 'errors'));
  }
  return parts.join('; ');
}

/** C100.3: the header row a file of each kind with an importer must have. */
export const IMPORT_COLUMNS: Readonly<Partial<Record<ListKind, string>>> = Object.freeze({
  'browser-fingerprint': 'value',
  'device-fingerprint': 'value',
  country: 'country_code',
  'email-address': 'value,match_type',
  geolocation: 'latitude,longitude,radius_meters',
  'government-id-number': 'id_number,id_class',
  field: 'field_value',
  'ip-address': 'value',
  name: 'name_first,name_last',
  'phone-number': 'value',
  string: 'value',
});
