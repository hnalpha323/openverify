/**
 * OFAC's enhanced XML (C77.2, C77.5): the SDN list (served as the single member of
 * `SDN_ENHANCED.ZIP`) and the Consolidated (non-SDN) list, written from synthetic records.
 *
 * Mapping: the entry id is `entity/@id` and `generalInfo/identityId`; each Latin name is a `name`
 * (aliases `A.K.A.`, weak ones `isLowQuality`), and original-script names are further
 * `translation`s of the primary name, as OFAC writes them; birth dates carry `valueDate` bounds
 * (`isApproximate` for circa); countries, gender, websites, e-mail, BIC, aircraft numbers and
 * digital currency addresses are `feature`s; passports, national and tax ids, registration
 * numbers, LEIs, IMO (`IMO <n>`) and MMSI are `identityDocument`s; list memberships are the
 * entity's `sanctionsList`s (beside the SDN List on the SDN file), and its programmes its
 * `sanctionsProgram`s, which OFAC ties to no list.
 */
import type { WatchlistRecord } from '../../record/index.js';
import { countryName, ofacPrintedDate } from './countries.js';
import {
  SCRIPT_LABELS,
  lowerBound,
  originalScriptNames,
  partOf,
  primaryName,
  upperBound,
  type RecordName,
} from './parts.js';
import { element, renderXml, textElement, type XmlElement } from './xml.js';
import { singleMemberZip } from './zip.js';

/** The enhanced XSD's target namespace. */
export const OFAC_ENHANCED_NAMESPACE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ENHANCED_XML';

/** The SDN list or the Consolidated (non-SDN) list. */
export type OfacList = 'sdn' | 'consolidated';

export interface OfacOptions {
  /** `publicationInfo/dataAsOf`, an ISO 8601 date-time. */
  readonly dataAsOf: string;
  /** Default `sdn`. */
  readonly list?: OfacList;
}

/** The list name each file writes for an entry without list memberships. */
export const OFAC_LIST_NAMES: Readonly<Record<OfacList, string>> = Object.freeze({
  sdn: 'SDN List',
  consolidated: 'Sectoral Sanctions Identifications List',
});
const LIST_NAMES = OFAC_LIST_NAMES;
const ENTITY_TYPES: Readonly<Record<WatchlistRecord['kind'], string>> = {
  individual: 'Individual',
  entity: 'Entity',
  vessel: 'Vessel',
  aircraft: 'Aircraft',
};
const WHOLE_NAME_PARTS: Readonly<Record<WatchlistRecord['kind'], string>> = {
  individual: 'Entity Name',
  entity: 'Entity Name',
  vessel: 'Vessel Name',
  aircraft: 'Aircraft Name',
};
const PART_TYPES: Readonly<Record<string, string>> = {
  given: 'First Name',
  family: 'Last Name',
  middle: 'Middle Name',
  patronymic: 'Patronymic',
};
const COUNTRY_FEATURES: Readonly<Record<string, string>> = {
  nationality: 'Nationality Country',
  citizenship: 'Citizenship Country',
  residence: 'Residency Country',
  registration: 'Nationality of Registration',
};
const IDENTIFIER_FEATURES: Readonly<Record<string, string>> = {
  website: 'Website',
  email: 'Email Address',
  swift_bic: 'SWIFT/BIC',
  aircraft_serial: "Aircraft Manufacturer's Serial Number (MSN)",
  aircraft_tail: 'Aircraft Tail Number',
};
const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  passport: 'Passport',
  national_id: 'National ID No.',
  tax_id: 'Tax ID No.',
  registration_number: 'Registration Number',
  lei: 'Legal Entity Number',
  imo: 'Vessel Registration Identification',
  mmsi: 'MMSI',
  other: 'Identification Number',
};
/** Feature type ids: OFAC's are reference values; these are our own, stable across files. */
const FEATURE_TYPE_IDS: Readonly<Record<string, number>> = {
  Birthdate: 8,
  'Place of Birth': 9,
  'Nationality Country': 10,
  'Citizenship Country': 11,
  'Residency Country': 12,
  'Nationality of Registration': 13,
  'Vessel Flag': 3,
  Gender: 224,
  Website: 14,
  'Email Address': 21,
  'SWIFT/BIC': 15,
  "Aircraft Manufacturer's Serial Number (MSN)": 50,
  'Aircraft Tail Number': 64,
};
const DIGITAL_CURRENCY_TYPE_ID = 345;

/**
 * The lists an entity is written on: its list memberships (owner decision 9 after 6B), beside the
 * SDN List on the SDN file; an entry without memberships is on the file's own list.
 */
function listsOf(record: WatchlistRecord, list: OfacList): string[] {
  const memberships = [...new Set((record.list_memberships ?? []).map((item) => item.list))];
  if (memberships.length === 0) {
    return [LIST_NAMES[list]];
  }
  return list === 'sdn' ? [LIST_NAMES.sdn, ...memberships] : memberships;
}

/** The ISO codes a list mentions, each with the `refId` of its Country reference value. */
function countryReferences(records: readonly WatchlistRecord[]): ReadonlyMap<string, number> {
  const codes = new Set<string>();
  for (const record of records) {
    record.countries.forEach((country) => country.code !== null && codes.add(country.code));
    record.identifiers.forEach(
      (identifier) => identifier.country !== undefined && codes.add(identifier.country),
    );
    record.addresses.forEach(
      (address) => address.country !== undefined && codes.add(address.country),
    );
  }
  return new Map([...codes].sort().map((code, index) => [code, 1001 + index] as const));
}

/** One writer run: element ids count up from 1, so a file is reproducible. */
function writer(list: OfacList, references: ReadonlyMap<string, number>) {
  let nextId = 0;
  const id = (): number => (nextId += 1);

  const translation = (name: RecordName, primary: boolean, kind: WatchlistRecord['kind']) => {
    const parts =
      name.parts.length === 0
        ? [{ type: WHOLE_NAME_PARTS[kind], value: name.full }]
        : name.parts.flatMap((part) => {
            const type = PART_TYPES[part.role];
            return type === undefined ? [] : [{ type, value: part.value }];
          });
    return element(
      'translation',
      { id: id() },
      textElement('isPrimary', String(primary)),
      element('script', {}, SCRIPT_LABELS[name.script] ?? 'Other'),
      textElement('formattedFirstName', partOf(name, 'given')),
      textElement('formattedLastName', partOf(name, 'family')),
      textElement('formattedFullName', name.full),
      element(
        'nameParts',
        {},
        ...parts.map((part) =>
          element(
            'namePart',
            { id: id() },
            element('type', {}, part.type),
            textElement('value', part.value),
          ),
        ),
      ),
    );
  };

  const country = (name: string, code: string) =>
    element(name, { refId: references.get(code) }, countryName(code));

  const feature = (
    type: string,
    value: string,
    extra: XmlElement | null = null,
    valueRefId?: number,
  ) =>
    element(
      'feature',
      { id: id() },
      element('type', { featureTypeId: FEATURE_TYPE_IDS[type] ?? DIGITAL_CURRENCY_TYPE_ID }, type),
      textElement('versionId', id()),
      textElement('value', value),
      textElement('valueRefId', valueRefId),
      extra,
      element('reliability', {}, 'Reliable'),
    );

  const birthDate = (date: WatchlistRecord['birth_dates'][number]) => {
    const circa = date.range !== undefined;
    return feature(
      'Birthdate',
      circa ? `circa ${ofacPrintedDate(date.value)}` : ofacPrintedDate(date.value),
      element(
        'valueDate',
        {},
        textElement('fromDateBegin', lowerBound(date.range?.from ?? date.value)),
        textElement('fromDateEnd', lowerBound(date.range?.from ?? date.value)),
        textElement('toDateBegin', upperBound(date.range?.to ?? date.value)),
        textElement('toDateEnd', upperBound(date.range?.to ?? date.value)),
        textElement('isApproximate', String(circa)),
        textElement('isDateRange', 'false'),
      ),
    );
  };

  return (record: WatchlistRecord): XmlElement => {
    const primary = primaryName(record);
    const originals = originalScriptNames(record).filter((name) => name !== primary);
    const names = record.names
      .filter((name) => name.script === 'latin' || name === primary)
      .map((name) =>
        element(
          'name',
          { id: id() },
          textElement('isPrimary', String(name === primary)),
          name === primary ? null : element('aliasType', {}, 'A.K.A.'),
          textElement('isLowQuality', String(name.quality === 'weak')),
          element(
            'translations',
            {},
            translation(name, true, record.kind),
            ...(name === primary
              ? originals.map((original) => translation(original, false, record.kind))
              : []),
          ),
        ),
      );
    const features = [
      ...record.birth_dates.map(birthDate),
      ...record.birth_places.map((place) => feature('Place of Birth', place)),
      ...record.countries.flatMap((country) => {
        const type =
          record.kind === 'vessel' && country.role === 'registration'
            ? 'Vessel Flag'
            : COUNTRY_FEATURES[country.role];
        return country.code === null || type === undefined
          ? []
          : [feature(type, countryName(country.code), null, references.get(country.code))];
      }),
      ...(record.gender === undefined
        ? []
        : [feature('Gender', record.gender === 'female' ? 'Female' : 'Male')]),
      ...record.identifiers.flatMap((identifier) => {
        const type = IDENTIFIER_FEATURES[identifier.kind];
        return type === undefined ? [] : [feature(type, identifier.value)];
      }),
      ...record.crypto_addresses.map((address) =>
        feature(`Digital Currency Address - ${address.ticker}`, address.raw),
      ),
    ];
    const documents = record.identifiers.flatMap((identifier) => {
      const type = DOCUMENT_TYPES[identifier.kind];
      return type === undefined
        ? []
        : [
            element(
              'identityDocument',
              { id: id() },
              element('type', {}, type),
              textElement(
                'documentNumber',
                identifier.kind === 'imo' ? `IMO ${identifier.value}` : identifier.value,
              ),
              textElement('isValid', 'true'),
              identifier.country === undefined
                ? null
                : country('issuingCountry', identifier.country),
            ),
          ];
    });
    const addresses = record.addresses.map((address) =>
      element(
        'address',
        { id: id() },
        address.country === undefined ? null : country('country', address.country),
        element(
          'translations',
          {},
          element(
            'translation',
            { id: id() },
            textElement('isPrimary', 'true'),
            element('script', {}, 'Latin'),
            element(
              'addressParts',
              {},
              ...[
                ...address.lines.map((line) => ['ADDRESS1', line] as const),
                ...(address.city === undefined ? [] : [['CITY', address.city] as const]),
                ...(address.postcode === undefined
                  ? []
                  : [['POSTAL CODE', address.postcode] as const]),
              ].map(([type, value]) =>
                element(
                  'addressPart',
                  { id: id() },
                  element('type', {}, type),
                  textElement('value', value),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return element(
      'entity',
      { id: record.entry_id },
      element(
        'generalInfo',
        {},
        textElement('identityId', record.entry_id),
        element('entityType', {}, ENTITY_TYPES[record.kind]),
        textElement('remarks', record.remarks),
      ),
      element(
        'sanctionsLists',
        {},
        ...listsOf(record, list).map((name) =>
          element('sanctionsList', { id: id(), datePublished: record.listed_at }, name),
        ),
      ),
      element(
        'sanctionsPrograms',
        {},
        ...record.programs.map((program) => element('sanctionsProgram', { id: id() }, program)),
      ),
      element('sanctionsTypes', {}, element('sanctionsType', { id: id() }, 'Block')),
      element('names', {}, ...names),
      element('addresses', {}, ...addresses),
      element('features', {}, ...features),
      element('identityDocuments', {}, ...documents),
    );
  };
}

/** `SDN_ENHANCED.XML` or `CONS_ENHANCED.XML` of `records`. */
export function ofacEnhancedXml(records: readonly WatchlistRecord[], options: OfacOptions): string {
  const list = options.list ?? 'sdn';
  const references = countryReferences(records);
  const entity = writer(list, references);
  return renderXml(
    element(
      'sanctionsData',
      {
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
        xmlns: OFAC_ENHANCED_NAMESPACE,
      },
      element(
        'publicationInfo',
        {},
        textElement('dataAsOf', options.dataAsOf),
        element(
          'filters',
          {},
          element('sanctionsLists', {}, element('sanctionsList', {}, LIST_NAMES[list])),
        ),
      ),
      element(
        'referenceValues',
        {},
        ...[...references].map(([code, refId]) =>
          element(
            'referenceValue',
            { refId },
            textElement('type', 'Country'),
            textElement('value', countryName(code)),
            textElement('isoCode', code),
          ),
        ),
      ),
      element('entities', {}, ...records.map(entity)),
    ),
    '<?xml version="1.0" encoding="utf-8"?>',
  );
}

/** `SDN_ENHANCED.ZIP`: one member, `SDN_ENHANCED.XML`. */
export function ofacSdnEnhancedZip(
  records: readonly WatchlistRecord[],
  options: Omit<OfacOptions, 'list'>,
): Uint8Array {
  return singleMemberZip(
    'SDN_ENHANCED.XML',
    new TextEncoder().encode(ofacEnhancedXml(records, { ...options, list: 'sdn' })),
  );
}
