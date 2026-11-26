/**
 * The UN Security Council Consolidated List's XML (C77.2, C77.5), written from synthetic records.
 *
 * Mapping: the entry id is `REFERENCE_NUMBER` (a numeric `DATAID` beside it); a person's given name
 * is `FIRST_NAME`, a middle name `SECOND_NAME` and the family name the next field, a company's name
 * `FIRST_NAME`; the first original-script name is `NAME_ORIGINAL_SCRIPT`; Latin aliases carry a
 * `QUALITY` (`Low` for a weak one; strong ones cycle through `Good`, `a.k.a.` and an empty value,
 * as the published file does); a day-precision birth date is `EXACT` with its `DATE`, a circa
 * range `APPROXIMATELY` with its `YEAR`, and anything else `EXACT` with its `YEAR`. The UN file
 * carries no crypto address, so none is written.
 */
import type { WatchlistRecord } from '../../record/index.js';
import { countryName } from './countries.js';
import { countriesWith, latinAliases, originalScriptNames, partOf, primaryName } from './parts.js';
import { element, renderXml, textElement, type XmlElement } from './xml.js';

export interface UnOptions {
  /** `CONSOLIDATED_LIST/@dateGenerated`, an ISO 8601 date-time. */
  readonly dateGenerated: string;
}

const STRONG_QUALITIES = ['Good', 'a.k.a.', ''] as const;
const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  passport: 'Passport',
  national_id: 'National Identification Number',
};

function dateOfBirth(date: WatchlistRecord['birth_dates'][number]): XmlElement {
  if (date.range !== undefined) {
    return element(
      'INDIVIDUAL_DATE_OF_BIRTH',
      {},
      textElement('TYPE_OF_DATE', 'APPROXIMATELY'),
      textElement('YEAR', date.value.slice(0, 4)),
    );
  }
  return element(
    'INDIVIDUAL_DATE_OF_BIRTH',
    {},
    textElement('TYPE_OF_DATE', 'EXACT'),
    date.precision === 'day'
      ? textElement('DATE', date.value)
      : textElement('YEAR', date.value.slice(0, 4)),
  );
}

function entry(record: WatchlistRecord, index: number): XmlElement {
  const person = record.kind === 'individual';
  const prefix = person ? 'INDIVIDUAL' : 'ENTITY';
  const primary = primaryName(record);
  const given = partOf(primary, 'given');
  const middle = partOf(primary, 'middle');
  const family = partOf(primary, 'family');
  const parted = person && given !== null && family !== null;
  let strong = 0;
  const aliases = latinAliases(record).map((alias) => {
    const quality = alias.quality === 'weak' ? 'Low' : (STRONG_QUALITIES[strong++ % 3] ?? 'Good');
    return element(
      `${prefix}_ALIAS`,
      {},
      element('QUALITY', {}, quality),
      textElement('ALIAS_NAME', alias.full),
    );
  });
  return element(
    prefix,
    {},
    textElement('DATAID', 6_900_001 + index),
    textElement('VERSIONNUM', 1),
    textElement('FIRST_NAME', parted ? given : primary.full),
    textElement('SECOND_NAME', parted ? (middle ?? family) : null),
    textElement('THIRD_NAME', parted && middle !== null ? family : null),
    textElement('UN_LIST_TYPE', record.programs[0] ?? null),
    textElement('REFERENCE_NUMBER', record.entry_id),
    textElement('LISTED_ON', record.listed_at),
    textElement('NAME_ORIGINAL_SCRIPT', originalScriptNames(record)[0]?.full),
    textElement('COMMENTS1', record.remarks),
    ...(person
      ? countriesWith(record, ['nationality', 'citizenship']).map((code) =>
          element('NATIONALITY', {}, textElement('VALUE', countryName(code))),
        )
      : []),
    element('LIST_TYPE', {}, textElement('VALUE', 'UN List')),
    element('LAST_DAY_UPDATED', {}, textElement('VALUE', record.listed_at)),
    ...aliases,
    ...record.addresses.map((address) =>
      element(
        `${prefix}_ADDRESS`,
        {},
        textElement('STREET', address.lines.join(', ') || null),
        textElement('CITY', address.city),
        textElement('ZIP_CODE', address.postcode),
        textElement('COUNTRY', address.country === undefined ? null : countryName(address.country)),
      ),
    ),
    ...(person ? record.birth_dates.map(dateOfBirth) : []),
    ...(person
      ? record.birth_places.map((place) =>
          element('INDIVIDUAL_PLACE_OF_BIRTH', {}, textElement('CITY', place)),
        )
      : []),
    ...(person
      ? record.identifiers.flatMap((identifier) => {
          const type = DOCUMENT_TYPES[identifier.kind];
          return type === undefined
            ? []
            : [
                element(
                  'INDIVIDUAL_DOCUMENT',
                  {},
                  textElement('TYPE_OF_DOCUMENT', type),
                  textElement('NUMBER', identifier.value),
                  textElement(
                    'ISSUING_COUNTRY',
                    identifier.country === undefined ? null : countryName(identifier.country),
                  ),
                ),
              ];
        })
      : []),
    element('SORT_KEY'),
    element('SORT_KEY_LAST_MOD'),
  );
}

/** `consolidated.xml` of `records` (individuals, and every other kind as an entity). */
export function unConsolidatedXml(records: readonly WatchlistRecord[], options: UnOptions): string {
  const numbered = records.map((record, index) => ({ record, index }));
  return renderXml(
    element(
      'CONSOLIDATED_LIST',
      {
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xsi:noNamespaceSchemaLocation': 'https://www.un.org/sc/resources/sc-sanctions.xsd',
        dateGenerated: options.dateGenerated,
      },
      element(
        'INDIVIDUALS',
        {},
        ...numbered
          .filter(({ record }) => record.kind === 'individual')
          .map(({ record, index }) => entry(record, index)),
      ),
      element(
        'ENTITIES',
        {},
        ...numbered
          .filter(({ record }) => record.kind !== 'individual')
          .map(({ record, index }) => entry(record, index)),
      ),
    ),
  );
}
