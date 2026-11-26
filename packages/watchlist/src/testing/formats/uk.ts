/**
 * The FCDO UK Sanctions List XML (C77.2, C77.5), written from synthetic records.
 *
 * Mapping: the entry id is `UniqueID`; a person's given name is `Name1`, a middle name `Name2` and
 * the family name `Name6` (any other name whole in `Name6`); aliases carry `AliasStrength`
 * (`Good`, or `Low` for a weak one); original-script names are `NonLatinName`s; dates are
 * `dd/mm/yyyy` with `dd` and `mm` for unknown parts; vessels are `Ship`s with their IMO numbers;
 * crypto addresses are `CryptoWalletAddress`es (the file names no ticker).
 */
import type { WatchlistRecord } from '../../record/index.js';
import { countryName, ukDate } from './countries.js';
import {
  countriesWith,
  identifiersOf,
  latinAliases,
  originalScriptNames,
  partOf,
  primaryName,
  type RecordName,
} from './parts.js';
import { element, renderXml, textElement, type XmlElement } from './xml.js';

export interface UkOptions {
  /** `DateGenerated`, as `YYYY-MM-DD` (written `dd/mm/yyyy`). */
  readonly dateGenerated: string;
}

const KINDS: Readonly<Record<WatchlistRecord['kind'], string>> = {
  individual: 'Individual',
  entity: 'Entity',
  vessel: 'Ship',
  aircraft: 'Entity',
};
const NON_LATIN: Readonly<Record<string, readonly [string, string]>> = {
  cyrillic: ['Cyrillic', 'Russian'],
  arabic: ['Arabic', 'Arabic'],
  han: ['Chinese', 'Chinese'],
};

/** A list wrapper (`Names`) around items, or nothing when there are none. */
const wrap = (name: string, items: readonly (XmlElement | null)[]): XmlElement | null =>
  items.some((item) => item !== null) ? element(name, {}, ...items) : null;

function nameRow(record: WatchlistRecord, name: RecordName, type: string): XmlElement {
  const given = partOf(name, 'given');
  const family = partOf(name, 'family');
  const parted = record.kind === 'individual' && given !== null && family !== null;
  return element(
    'Name',
    {},
    textElement('Name1', parted ? given : null),
    textElement('Name2', parted ? partOf(name, 'middle') : null),
    textElement('Name6', parted ? family : name.full),
    textElement('NameType', type),
    type === 'Alias'
      ? textElement('AliasStrength', name.quality === 'weak' ? 'Low' : 'Good')
      : null,
  );
}

function designation(record: WatchlistRecord, index: number): XmlElement {
  const primary = primaryName(record);
  const values = (kind: Parameters<typeof identifiersOf>[1]) =>
    identifiersOf(record, kind).map((identifier) => identifier.value);
  const individual =
    record.kind === 'individual'
      ? element(
          'IndividualDetails',
          {},
          element(
            'Individual',
            {},
            wrap(
              'DOBs',
              record.birth_dates.map((date) => textElement('DOB', ukDate(date.value))),
            ),
            wrap(
              'Nationalities',
              countriesWith(record, ['nationality', 'citizenship']).map((code) =>
                textElement('Nationality', countryName(code)),
              ),
            ),
            wrap(
              'PassportDetails',
              values('passport').map((value) =>
                element('Passport', {}, textElement('PassportNumber', value)),
              ),
            ),
            wrap(
              'NationalIdentifierDetails',
              values('national_id').map((value) =>
                element('NationalIdentifier', {}, textElement('NationalIdentifierNumber', value)),
              ),
            ),
            wrap(
              'BirthDetails',
              record.birth_places.map((place) =>
                element('Location', {}, textElement('TownOfBirth', place)),
              ),
            ),
            record.gender === undefined
              ? null
              : element(
                  'Genders',
                  {},
                  textElement('Gender', record.gender === 'female' ? 'Female' : 'Male'),
                ),
          ),
        )
      : null;
  const entity =
    record.kind === 'entity' || record.kind === 'aircraft'
      ? wrap('EntityDetails', [
          wrap('Entity', [
            wrap(
              'BusinessRegistrationNumbers',
              values('registration_number').map((value) =>
                textElement('BusinessRegistrationNumber', value),
              ),
            ),
          ]),
        ])
      : null;
  const ship =
    record.kind === 'vessel'
      ? element(
          'ShipDetails',
          {},
          element(
            'Ship',
            {},
            wrap(
              'IMONumbers',
              values('imo').map((value) => textElement('IMONumber', value)),
            ),
            wrap(
              'CurrentBelievedFlagOfShips',
              countriesWith(record, ['registration']).map((code) =>
                textElement('CurrentBelievedFlagOfShip', countryName(code)),
              ),
            ),
          ),
        )
      : null;
  return element(
    'Designation',
    {},
    textElement('LastUpdated', record.listed_at === undefined ? null : ukDate(record.listed_at)),
    textElement('DateDesignated', record.listed_at === undefined ? null : ukDate(record.listed_at)),
    textElement('UniqueID', record.entry_id),
    textElement('OFSIGroupID', 90_000 + index),
    element('UNReferenceNumber'),
    element(
      'Names',
      {},
      nameRow(record, primary, 'Primary Name'),
      ...latinAliases(record).map((alias) => nameRow(record, alias, 'Alias')),
    ),
    wrap(
      'NonLatinNames',
      originalScriptNames(record).map((name) => {
        const [type, language] = NON_LATIN[name.script] ?? ['Other', 'Other'];
        return element(
          'NonLatinName',
          {},
          textElement('NameNonLatinScript', name.full),
          textElement('NonLatinScriptType', type),
          textElement('NonLatinScriptLanguage', language),
        );
      }),
    ),
    textElement('RegimeName', record.programs[0] ?? null),
    textElement('IndividualEntityShip', KINDS[record.kind]),
    textElement('DesignationSource', 'UK'),
    textElement('SanctionsImposed', 'Asset freeze'),
    textElement('OtherInformation', record.remarks),
    wrap(
      'Addresses',
      record.addresses.map((address) =>
        element(
          'Address',
          {},
          ...address.lines.map((line, position) =>
            textElement(`AddressLine${String(position + 1)}`, line),
          ),
          textElement('AddressLine6', address.city),
          textElement('AddressPostalCode', address.postcode),
          textElement(
            'AddressCountry',
            address.country === undefined ? null : countryName(address.country),
          ),
        ),
      ),
    ),
    wrap(
      'EmailAddresses',
      values('email').map((value) => textElement('EmailAddress', value)),
    ),
    wrap(
      'Websites',
      values('website').map((value) => textElement('Website', value)),
    ),
    individual,
    entity,
    ship,
    wrap(
      'CryptoWalletAddresses',
      record.crypto_addresses.map((address) => textElement('CryptoWalletAddress', address.raw)),
    ),
  );
}

/** `UK-Sanctions-List.xml` of `records`. */
export function ukSanctionsListXml(
  records: readonly WatchlistRecord[],
  options: UkOptions,
): string {
  return renderXml(
    element(
      'Designations',
      {
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      },
      textElement('DateGenerated', ukDate(options.dateGenerated)),
      ...records.map(designation),
    ),
    '<?xml version="1.0" encoding="utf-8"?>',
  );
}
