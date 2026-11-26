/**
 * C77.2: the FCDO UK Sanctions List parser (`UK-Sanctions-List.xml`, schema
 * `SanctionsListSchema-4.33.3.xsd`, read at SHA-256 `073d5db3…108a` on 2026-10-27). OFSI's
 * Consolidated List closed on 2026-01-28 and is never read (C76.1).
 *
 * - `DateGenerated` (`dd/mm/yyyy`) is the publication time, at day precision.
 * - Each `Designation` is one entry, keyed by its `UniqueID`; `IndividualEntityShip` gives the
 *   kind (`Ship` is a vessel).
 * - `Name1` to `Name6` make a name; for an individual `Name6` is the family name, `Name1` the given
 *   name and the others middle names. `NameType` `Primary Name` is primary; `AliasStrength` with
 *   "low" is weak. Each non-Latin name is a name too.
 * - DOBs (`dd/mm/yyyy`, unknown parts as `dd`, `mm` or `00`), nationalities, the town and country
 *   of birth, passports, national identifiers, business registration numbers, IMO numbers, the
 *   believed flag, websites, email addresses, addresses and crypto wallet addresses follow. The
 *   list gives no chain or currency for a wallet, so its ticker is {@link UNLABELLED_CRYPTO_TICKER}.
 */
import {
  WATCHLIST_RECORD_LIMITS,
  type WatchlistEntryKind,
  type WatchlistRecord,
} from '../record/index.js';
import type { ByteSource, XmlElement } from '../xml/index.js';
import { elementsAt, textAt, textsAt } from './elements.js';
import { WatchlistParseError } from './errors.js';
import {
  parseXmlList,
  type ListParseOptions,
  type WatchlistParse,
  type XmlListFormat,
} from './list.js';
import {
  birthDate,
  countryCode,
  dayMonthYear,
  publicationTime,
  recordName,
  truncateText,
  type RecordDraft,
} from './normalise.js';

/** The ticker of a crypto address whose list names no currency (the UK's wallets). */
export const UNLABELLED_CRYPTO_TICKER = 'unlabelled';

/** Parses a UK Sanctions List XML document. */
export function parseUkSanctionsList(
  source: ByteSource,
  options: ListParseOptions,
): WatchlistParse {
  return parseXmlList(source, UK_SANCTIONS_LIST_FORMAT, options);
}

interface UkState {
  publishedAt: string | null;
}

const UK_SANCTIONS_LIST_FORMAT: XmlListFormat<UkState> = {
  label: 'UK Sanctions List XML',
  root: 'Designations',
  namespace: null,
  entries: ['Designations/Designation'],
  headers: ['Designations/DateGenerated'],
  start: () => ({ publishedAt: null }),
  header(state, _path, element) {
    state.publishedAt = publicationTime(textAt(element));
  },
  entry: (_state, element, ordinal) => ukEntry(element, ordinal),
  publication: (state) => ({ publishedAt: state.publishedAt }),
};

const KINDS: Readonly<Record<string, WatchlistEntryKind>> = Object.freeze({
  individual: 'individual',
  entity: 'entity',
  ship: 'vessel',
});

const GENDERS: Readonly<Record<string, NonNullable<WatchlistRecord['gender']>>> = Object.freeze({
  male: 'male',
  female: 'female',
});

type Country = WatchlistRecord['countries'][number];
type Identifier = WatchlistRecord['identifiers'][number];
type NamePart = WatchlistRecord['names'][number]['parts'][number];

/** `Name1` to `Name6`; for an individual, `Name6` is the family name and `Name1` the given name. */
function ukName(name: XmlElement, individual: boolean): RecordDraft['names'][number] | null {
  const values = [1, 2, 3, 4, 5, 6].map((index) => textAt(name, `Name${String(index)}`));
  const parts: NamePart[] = individual
    ? values.flatMap((value, index): NamePart[] => {
        if (value === null) {
          return [];
        }
        return [{ role: index === 0 ? 'given' : index === 5 ? 'family' : 'middle', value }];
      })
    : [];
  return recordName(values.flatMap((value) => value ?? []).join(' '), {
    parts,
    quality: (textAt(name, 'AliasStrength') ?? '').toLowerCase().includes('low')
      ? 'weak'
      : 'strong',
    primary: (textAt(name, 'NameType') ?? '').toLowerCase() === 'primary name',
  });
}

function ukEntry(element: XmlElement, ordinal: number): RecordDraft {
  const kind = KINDS[(textAt(element, 'IndividualEntityShip') ?? '').toLowerCase()];
  if (kind === undefined) {
    throw new WatchlistParseError(
      'schema',
      `entry ${String(ordinal)}: the designation is not an individual, an entity or a ship`,
    );
  }
  const names = [
    ...elementsAt(element, 'Names', 'Name').map((name) => ukName(name, kind === 'individual')),
    ...textsAt(element, 'NonLatinNames', 'NonLatinName', 'NameNonLatinScript').map((full) =>
      recordName(full),
    ),
  ].flatMap((name) => name ?? []);
  const countries: Country[] = [];
  const identifiers: Identifier[] = [];
  const addCountries = (role: Country['role'], values: readonly string[]) => {
    for (const value of values) {
      const code = countryCode(value);
      if (code !== null) {
        countries.push({ code, role });
      }
    }
  };
  const addIdentifiers = (kind: Identifier['kind'], values: readonly string[]) => {
    identifiers.push(...values.map((value) => ({ kind, value })));
  };
  const individuals = elementsAt(element, 'IndividualDetails', 'Individual');
  const births = individuals.flatMap((individual) =>
    elementsAt(individual, 'BirthDetails', 'Location'),
  );
  const ships = elementsAt(element, 'ShipDetails', 'Ship');
  addCountries(
    'nationality',
    individuals.flatMap((individual) => textsAt(individual, 'Nationalities', 'Nationality')),
  );
  addCountries(
    'birth',
    births.flatMap((birth) => textsAt(birth, 'CountryOfBirth')),
  );
  addCountries(
    'registration',
    ships.flatMap((ship) =>
      textsAt(ship, 'CurrentBelievedFlagOfShips', 'CurrentBelievedFlagOfShip'),
    ),
  );
  addIdentifiers(
    'passport',
    individuals.flatMap((individual) =>
      textsAt(individual, 'PassportDetails', 'Passport', 'PassportNumber'),
    ),
  );
  addIdentifiers(
    'national_id',
    individuals.flatMap((individual) =>
      textsAt(
        individual,
        'NationalIdentifierDetails',
        'NationalIdentifier',
        'NationalIdentifierNumber',
      ),
    ),
  );
  addIdentifiers(
    'registration_number',
    textsAt(
      element,
      'EntityDetails',
      'Entity',
      'BusinessRegistrationNumbers',
      'BusinessRegistrationNumber',
    ),
  );
  addIdentifiers(
    'imo',
    ships.flatMap((ship) => textsAt(ship, 'IMONumbers', 'IMONumber')),
  );
  addIdentifiers('website', textsAt(element, 'Websites', 'Website'));
  addIdentifiers('email', textsAt(element, 'EmailAddresses', 'EmailAddress'));
  const addresses = elementsAt(element, 'Addresses', 'Address').flatMap((address) => {
    const country = countryCode(textAt(address, 'AddressCountry'));
    const postcode = textAt(address, 'AddressPostalCode');
    const lines = [1, 2, 3, 4, 5, 6].flatMap(
      (index) => textAt(address, `AddressLine${String(index)}`) ?? [],
    );
    if (country !== null) {
      countries.push({ code: country, role: 'address' });
    }
    return country === null && postcode === null && lines.length === 0
      ? []
      : [
          {
            ...(country === null ? {} : { country }),
            ...(postcode === null ? {} : { postcode }),
            lines,
          },
        ];
  });
  const listedAt = dayMonthYear(textAt(element, 'DateDesignated'));
  const remarks = textAt(element, 'OtherInformation');
  const gender = individuals
    .flatMap((individual) => textsAt(individual, 'Genders', 'Gender'))
    .flatMap((value) => GENDERS[value.toLowerCase()] ?? [])[0];
  return {
    entry_id: textAt(element, 'UniqueID') ?? '',
    kind,
    names,
    birth_dates: individuals
      .flatMap((individual) => textsAt(individual, 'DOBs', 'DOB'))
      .flatMap((value) => birthDate(dayMonthYear(value)) ?? []),
    birth_places: births.flatMap((birth) => textsAt(birth, 'TownOfBirth')),
    countries,
    ...(gender === undefined ? {} : { gender }),
    identifiers,
    addresses,
    crypto_addresses: textsAt(element, 'CryptoWalletAddresses', 'CryptoWalletAddress').map(
      (raw) => ({ raw, ticker: UNLABELLED_CRYPTO_TICKER }),
    ),
    programs: textsAt(element, 'RegimeName'),
    ...(listedAt === null ? {} : { listed_at: listedAt }),
    ...(remarks === null
      ? {}
      : { remarks: truncateText(remarks, WATCHLIST_RECORD_LIMITS.remarks) }),
  };
}
