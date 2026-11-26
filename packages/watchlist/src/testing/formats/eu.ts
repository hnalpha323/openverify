/**
 * The EU Financial Sanctions Files' XML 1.1 (C77.2, C77.5), written from synthetic records.
 *
 * Mapping: the entry id is `sanctionEntity/@logicalId`; persons are `subjectType` `person`, every
 * other kind `enterprise`; each name is a `nameAlias` with `strong`; partial birth dates fill only
 * the known parts (`circa` for a range); passports, national ids, tax ids and registration numbers
 * are `identification`s with their codes, other identifiers `other`. The EU file carries no crypto
 * address, so none is written.
 */
import type { WatchlistRecord } from '../../record/index.js';
import { countryName } from './countries.js';
import { countriesWith, partOf, type RecordIdentifier } from './parts.js';
import { element, renderXml } from './xml.js';

/** The FSF export namespace. */
export const EU_FSF_NAMESPACE = 'http://eu.europa.ec/fpi/fsd/export';

export interface EuFsfOptions {
  /** `export/@generationDate`, an ISO 8601 date-time with its offset. */
  readonly generationDate: string;
  /** `export/@globalFileId`, the file's numeric id. */
  readonly globalFileId: number;
}

const LANGUAGES: Readonly<Record<string, string>> = { cyrillic: 'RU', arabic: 'AR', han: 'ZH' };
const IDENTIFICATION_TYPES: Readonly<Record<string, readonly [string, string]>> = {
  passport: ['passport', 'National passport'],
  national_id: ['id', 'National identification card'],
  tax_id: ['tin', 'Tax identification number'],
  registration_number: ['regnumber', 'Registration Number'],
};

const upperName = (code: string): string => countryName(code).toUpperCase();

function identification(identifier: RecordIdentifier, logicalId: number) {
  const [code, description] = IDENTIFICATION_TYPES[identifier.kind] ?? [
    'other',
    identifier.kind.replaceAll('_', ' ').toUpperCase(),
  ];
  return element('identification', {
    diplomatic: false,
    knownExpired: false,
    knownFalse: false,
    reportedLost: false,
    revokedByIssuer: false,
    issuedBy: '',
    issuedDate: '',
    validFrom: '',
    validTo: '',
    latinNumber: '',
    nameOnDocument: '',
    identificationTypeCode: code,
    identificationTypeDescription: description,
    region: '',
    number: identifier.value,
    countryIso2Code: identifier.country ?? '',
    countryDescription: identifier.country === undefined ? '' : upperName(identifier.country),
    regulationLanguage: 'en',
    logicalId,
  });
}

/** The FSF XML 1.1 file of `records` (persons, and every other kind as an enterprise). */
export function euFsfXml(records: readonly WatchlistRecord[], options: EuFsfOptions): string {
  let nextId = 0;
  const id = (): number => (nextId += 1);
  const entities = records.map((record, index) => {
    const person = record.kind === 'individual';
    const program = record.programs[0] ?? 'SYNTHETIC';
    return element(
      'sanctionEntity',
      {
        designationDetails: '',
        unitedNationId: '',
        euReferenceNumber: `EU.${String(index + 1)}.${String(10 + (index % 90))}`,
        logicalId: record.entry_id,
      },
      record.remarks === undefined ? null : element('remark', {}, record.remarks),
      element(
        'regulation',
        {
          regulationType: 'regulation',
          organisationType: 'council',
          publicationDate: record.listed_at,
          entryIntoForceDate: record.listed_at,
          numberTitle: `SYNTHETIC/${program}`,
          programme: program,
          logicalId: id(),
        },
        element('publicationUrl', {}, `https://regulations.example/${program.toLowerCase()}`),
      ),
      element('subjectType', {
        code: person ? 'person' : 'enterprise',
        classificationCode: person ? 'P' : 'E',
      }),
      ...record.names.map((name) =>
        element('nameAlias', {
          firstName: partOf(name, 'given') ?? '',
          middleName: partOf(name, 'middle') ?? '',
          lastName: partOf(name, 'family') ?? '',
          wholeName: name.full,
          function: '',
          gender:
            person && name.primary && record.gender !== undefined
              ? record.gender === 'female'
                ? 'F'
                : 'M'
              : '',
          title: '',
          nameLanguage: LANGUAGES[name.script] ?? '',
          strong: name.quality === 'strong',
          regulationLanguage: 'en',
          logicalId: id(),
        }),
      ),
      ...countriesWith(record, ['nationality', 'citizenship']).map((code) =>
        element('citizenship', {
          region: '',
          countryIso2Code: code,
          countryDescription: upperName(code),
          regulationLanguage: 'en',
          logicalId: id(),
        }),
      ),
      ...record.birth_dates.map((date) => {
        const [year = '', month = '', day = ''] = date.value.split('-');
        return element('birthdate', {
          circa: date.range !== undefined,
          calendarType: 'GREGORIAN',
          city: record.birth_places[0] ?? '',
          zipCode: '',
          birthdate: date.precision === 'day' ? date.value : null,
          dayOfMonth: day === '' ? '' : String(Number(day)),
          monthOfYear: month === '' ? '' : String(Number(month)),
          year,
          region: '',
          place: '',
          countryIso2Code: '',
          countryDescription: '',
          regulationLanguage: 'en',
          logicalId: id(),
        });
      }),
      ...record.identifiers.map((identifier) => identification(identifier, id())),
      ...record.addresses.map((address) =>
        element('address', {
          city: address.city ?? '',
          street: address.lines.join(', '),
          poBox: '',
          zipCode: address.postcode ?? '',
          regulationLanguage: 'en',
          region: '',
          place: '',
          asAtListingTime: false,
          contactInfo: '',
          countryIso2Code: address.country ?? '',
          countryDescription: address.country === undefined ? '' : upperName(address.country),
          logicalId: id(),
        }),
      ),
    );
  });
  return renderXml(
    element(
      'export',
      {
        xmlns: EU_FSF_NAMESPACE,
        generationDate: options.generationDate,
        globalFileId: options.globalFileId,
      },
      ...entities,
    ),
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  );
}
