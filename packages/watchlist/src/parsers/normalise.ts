/**
 * C77.1, C77.2: what every publisher parser shares on the way to the frozen record: cleaned text,
 * a name's writing system, ISO 3166-1 alpha-2 codes from the country names the UN, UK and OFAC
 * lists print, partial dates, publication timestamps, and the last step that drops duplicates and
 * validates a record against `watchlistRecordSchema`, refusing (`schema`) with the entry's ordinal
 * and the field's path, never a value.
 */
import { WRITING_SYSTEMS, writingSystemsOf, type WritingSystem } from '@openverify/checks';
import {
  canonicalJson,
  watchlistRecordSchema,
  type IDENTIFIER_KINDS,
  type WatchlistEntryKind,
  type WatchlistListMembership,
  type WatchlistRecord,
} from '../record/index.js';
import { WatchlistParseError } from './errors.js';

type RecordName = WatchlistRecord['names'][number];
type BirthDate = WatchlistRecord['birth_dates'][number];

/** A record before duplicates are dropped and the schema checks it. */
export interface RecordDraft {
  readonly entry_id: string;
  readonly kind: WatchlistEntryKind;
  readonly names: readonly RecordName[];
  readonly birth_dates?: readonly BirthDate[];
  readonly birth_places?: readonly string[];
  readonly countries?: WatchlistRecord['countries'];
  readonly gender?: WatchlistRecord['gender'];
  readonly identifiers?: WatchlistRecord['identifiers'];
  readonly addresses?: WatchlistRecord['addresses'];
  readonly crypto_addresses?: WatchlistRecord['crypto_addresses'];
  readonly programs?: readonly string[];
  readonly listed_at?: string;
  readonly positions?: WatchlistRecord['positions'];
  readonly relations?: WatchlistRecord['relations'];
  readonly remarks?: string;
  /** Owner decision 9 after 6B; left out of the record when empty. */
  readonly list_memberships?: readonly WatchlistListMembership[];
  readonly relative_of_class?: number;
}

const WHITESPACE = /\s+/gu;

/** Trims and collapses whitespace; `null` for nothing but whitespace (the schema needs text). */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = value.replace(WHITESPACE, ' ').trim();
  return text === '' ? null : text;
}

/** `value` cut to `max` UTF-16 code units, never inside a surrogate pair (remarks only). */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const last = value.charCodeAt(max - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** The writing system most of a name's letters use (C58's set); `other` when it has none. */
export function nameScript(full: string): WritingSystem {
  const counts = new Map<WritingSystem, number>();
  for (const character of full) {
    for (const system of writingSystemsOf(character)) {
      counts.set(system, (counts.get(system) ?? 0) + 1);
    }
  }
  let best: WritingSystem = 'other';
  let most = 0;
  for (const system of WRITING_SYSTEMS) {
    const count = counts.get(system) ?? 0;
    if (count > most) {
      best = system;
      most = count;
    }
  }
  return best;
}

/** A record name from a publisher's text; `null` when the text is empty. */
export function recordName(
  full: string | null | undefined,
  options: {
    readonly parts?: RecordName['parts'];
    readonly quality?: RecordName['quality'];
    readonly primary?: boolean;
  } = {},
): RecordName | null {
  const text = cleanText(full);
  if (text === null) {
    return null;
  }
  const parts = (options.parts ?? []).flatMap((part) => {
    const value = cleanText(part.value);
    return value === null ? [] : [{ role: part.role, value }];
  });
  return {
    full: text,
    parts,
    script: nameScript(text),
    quality: options.quality ?? 'strong',
    primary: options.primary ?? false,
  };
}

/**
 * Two-letter codes that are not ISO 3166-1 countries: user-assigned ranges (AA, QM-QZ, XA-XZ
 * but XK, ZZ), exceptional reservations (AC, CP, CQ, DG, EA, IC, TA) and unions (EU, EZ, UN).
 */
const NOT_COUNTRIES = /^(?:A[AC]|C[PQ]|DG|E[AUZ]|IC|Q[M-Z]|TA|UN|X[A-JL-Z]|ZZ)$/u;

/** Official long forms the lists print that `Intl.DisplayNames` does not give (ours). */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'Russian Federation': 'RU',
  'Korea, North': 'KP',
  "Democratic People's Republic of Korea": 'KP',
  "Korea, Democratic People's Republic of": 'KP',
  'Korea, South': 'KR',
  'Republic of Korea': 'KR',
  'Korea, Republic of': 'KR',
  'Iran (Islamic Republic of)': 'IR',
  'Iran, Islamic Republic of': 'IR',
  'Syrian Arab Republic': 'SY',
  'Venezuela (Bolivarian Republic of)': 'VE',
  'Bolivia (Plurinational State of)': 'BO',
  'United Republic of Tanzania': 'TZ',
  'Republic of Moldova': 'MD',
  "Lao People's Democratic Republic": 'LA',
  'Viet Nam': 'VN',
  Turkey: 'TR',
  'Democratic Republic of the Congo': 'CD',
  'Congo, Democratic Republic of the': 'CD',
  'Republic of the Congo': 'CG',
  'Congo, Republic of the': 'CG',
  Congo: 'CG',
  'Ivory Coast': 'CI',
  'Czech Republic': 'CZ',
  Swaziland: 'SZ',
  Macedonia: 'MK',
  'The former Yugoslav Republic of Macedonia': 'MK',
  'State of Palestine': 'PS',
  Palestine: 'PS',
  'Holy See': 'VA',
  'Micronesia (Federated States of)': 'FM',
  'Micronesia, Federated States of': 'FM',
  'United Kingdom of Great Britain and Northern Ireland': 'GB',
  'United States of America': 'US',
  'Brunei Darussalam': 'BN',
  'Cabo Verde': 'CV',
  'Kyrgyz Republic': 'KG',
  'Slovak Republic': 'SK',
  'Hong Kong': 'HK',
  Macao: 'MO',
  Macau: 'MO',
  'East Timor': 'TL',
});

/** A country name's lookup key: no marks, case or punctuation, `&` as `and`, `st` as `saint`. */
function countryKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(WHITESPACE)
    .filter((word) => word !== '' && word !== 'the')
    .map((word) => (word === 'st' ? 'saint' : word))
    .join(' ');
}

interface CountryIndex {
  readonly codes: ReadonlySet<string>;
  readonly byName: ReadonlyMap<string, string | null>;
}

let countryIndex: CountryIndex | undefined;

/** Built once from `Intl`: canonical codes only, so a deprecated alias never makes a name ambiguous. */
function countries(): CountryIndex {
  if (countryIndex !== undefined) {
    return countryIndex;
  }
  const display = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const codes = new Set<string>();
  const byName = new Map<string, string | null>();
  const add = (name: string, code: string) => {
    const key = countryKey(name);
    const known = byName.get(key);
    byName.set(key, known === undefined || known === code ? code : null);
  };
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = NOT_COUNTRIES.test(code) ? undefined : display.of(code);
      if (name === undefined || Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) {
        continue;
      }
      codes.add(code);
      add(name, code);
      const open = name.indexOf(' (');
      if (open > 0 && name.endsWith(')')) {
        add(name.slice(0, open), code);
        add(name.slice(open + 2, -1), code);
      }
    }
  }
  for (const [name, code] of Object.entries(COUNTRY_ALIASES)) {
    byName.set(countryKey(name), code);
  }
  countryIndex = { codes, byName };
  return countryIndex;
}

const TWO_LETTERS = /^[A-Za-z]{2}$/u;

/**
 * The ISO 3166-1 alpha-2 code of a code or an English country name as the lists print it
 * (`Russian Federation`, `Korea, North`, `Iran (Islamic Republic of)`); `null` when the value is
 * empty, unknown or names more than one country. Names come from `Intl.DisplayNames`, plus the
 * official long forms it lacks.
 */
export function countryCode(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (text === null) {
    return null;
  }
  const index = countries();
  if (TWO_LETTERS.test(text)) {
    const code = text.toUpperCase();
    return index.codes.has(code) ? code : null;
  }
  return index.byName.get(countryKey(text)) ?? null;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` from numbers, or `null` when a part is out of range. */
export function partialDate(
  year: number | null | undefined,
  month?: number | null,
  day?: number | null,
): string | null {
  if (year === null || year === undefined || !Number.isInteger(year) || year < 1 || year > 9999) {
    return null;
  }
  if (month === null || month === undefined) {
    return pad(year, 4);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (day === null || day === undefined) {
    return `${pad(year, 4)}-${pad(month, 2)}`;
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A `YYYY-MM-DD` date that exists, or null. */
export function calendarDate(value: string | null | undefined): string | null {
  const match = value === null || value === undefined ? null : CALENDAR_DATE.exec(value);
  return match === null ? null : partialDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const PARTIAL_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u;
const PRECISION_BY_LENGTH = { 4: 'year', 7: 'month', 10: 'day' } as const;

/**
 * A birth date from a partial date; `circa` widens it to a range of a year either side (C78.4
 * reads ranges, and a circa date is one).
 */
export function birthDate(
  value: string | null,
  options: { readonly circa?: boolean; readonly range?: { from: string; to: string } } = {},
): BirthDate | null {
  if (value === null || !PARTIAL_DATE.test(value)) {
    return null;
  }
  const precision = PRECISION_BY_LENGTH[value.length as 4 | 7 | 10];
  const year = Number(value.slice(0, 4));
  const range =
    options.range ??
    (options.circa === true
      ? { from: pad(Math.max(1, year - 1), 4), to: pad(Math.min(9999, year + 1), 4) }
      : undefined);
  return range === undefined ? { value, precision } : { value, precision, range };
}

const DATE_TIME =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/u;
const DAY_MONTH_YEAR = /^(\d{2})\/(\d{2})\/(\d{4})$/u;

/**
 * An ISO 8601 UTC timestamp from an `xsd:dateTime` (with or without an offset; none means UTC),
 * an `xsd:date` or a `dd/mm/yyyy` date; `null` for anything else.
 */
export function publicationTime(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (text === null) {
    return null;
  }
  const dated = DAY_MONTH_YEAR.exec(text);
  if (dated !== null) {
    const date = partialDate(Number(dated[3]), Number(dated[2]), Number(dated[1]));
    return date === null ? null : `${date}T00:00:00.000Z`;
  }
  const match = DATE_TIME.exec(text);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone] =
    match;
  const date = partialDate(Number(year), Number(month), Number(day));
  if (date === null || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return null;
  }
  const millis = fraction === '' ? '.000' : fraction.slice(0, 4).padEnd(4, '0');
  const parsed = Date.parse(`${date}T${hour}:${minute}:${second}${millis}${zone ?? 'Z'}`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

const PLACEHOLDER_DATE = /^(\d{2}|dd)\/(\d{2}|mm)\/(\d{4})$/iu;

/**
 * A UK-style `dd/mm/yyyy` date whose unknown parts are written `dd`, `mm` or `00`, as a partial
 * date; `null` when the year is unknown or a part is out of range.
 */
export function dayMonthYear(value: string | null | undefined): string | null {
  const text = cleanText(value);
  const match = text === null ? null : PLACEHOLDER_DATE.exec(text);
  if (match === null) {
    return null;
  }
  const known = (part: string | undefined): number | null =>
    part === undefined || !/^\d{2}$/u.test(part) || part === '00' ? null : Number(part);
  const month = known(match[2]);
  return partialDate(Number(match[3]), month, month === null ? null : known(match[1]));
}

type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

const IMO_WORD = /\bimo\b/u;

/**
 * C77.1: the identifier kind a publisher's document type names, read by keyword (OFAC has 109
 * types, the EU and UN their own words); `other` for anything else, which C78.3 stores but does
 * not retrieve.
 */
export function identifierKindOf(type: string | null | undefined): IdentifierKind {
  const key = (cleanText(type) ?? '').toLowerCase().replaceAll('\u2019', "'");
  const has = (...words: string[]) => words.some((word) => key.includes(word));
  if (has('passport')) {
    return 'passport';
  }
  if (has('mmsi')) {
    return 'mmsi';
  }
  if (has('swift')) {
    return 'swift_bic';
  }
  if (has('legal entity') || key === 'lei') {
    return 'lei';
  }
  if (has('tax', 'fiscal')) {
    return 'tax_id';
  }
  if (IMO_WORD.test(key)) {
    return 'imo';
  }
  if (has('aircraft') && has('serial')) {
    return 'aircraft_serial';
  }
  if (has('tail number')) {
    return 'aircraft_tail';
  }
  if (
    has('registration', 'company number', 'commercial registry', 'incorporation', 'social credit')
  ) {
    return 'registration_number';
  }
  if (has('national id', 'identification', 'identity', 'id card', 'cedula', 'personal id')) {
    return 'national_id';
  }
  return 'other';
}

function unique<Item>(items: readonly Item[] | undefined): Item[] {
  const seen = new Set<string>();
  const kept: Item[] = [];
  for (const item of items ?? []) {
    const key = canonicalJson(item);
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(item);
    }
  }
  return kept;
}

function uniqueNames(names: readonly RecordName[]): RecordName[] {
  const kept = new Map<string, RecordName>();
  for (const name of names) {
    const key = canonicalJson([name.full, name.script, name.quality]);
    const known = kept.get(key);
    kept.set(
      key,
      known === undefined ? name : { ...known, primary: known.primary || name.primary },
    );
  }
  return [...kept.values()];
}

/**
 * Drops duplicate names (by text, script and quality, keeping any primary flag), countries,
 * identifiers, dates, places, addresses, crypto addresses and programmes, then validates the
 * record. `ordinal` is the entry's position in the publication, which a refusal names.
 * @throws {WatchlistParseError} `schema`, naming the ordinal and the field's path only.
 */
export function finishRecord(draft: RecordDraft, ordinal: number): WatchlistRecord {
  const candidate = {
    entry_id: draft.entry_id,
    kind: draft.kind,
    names: uniqueNames(draft.names),
    birth_dates: unique(draft.birth_dates),
    birth_places: unique(draft.birth_places),
    countries: unique(draft.countries),
    ...(draft.gender === undefined ? {} : { gender: draft.gender }),
    identifiers: unique(draft.identifiers),
    addresses: unique(draft.addresses),
    crypto_addresses: unique(draft.crypto_addresses),
    programs: unique(draft.programs),
    ...(draft.listed_at === undefined ? {} : { listed_at: draft.listed_at }),
    positions: unique(draft.positions),
    relations: unique(draft.relations),
    ...(draft.remarks === undefined ? {} : { remarks: draft.remarks }),
    // Owner decision 9 after 6B: absent rather than empty, so the record keeps its hashes.
    ...(draft.list_memberships === undefined || draft.list_memberships.length === 0
      ? {}
      : { list_memberships: unique(draft.list_memberships) }),
    ...(draft.relative_of_class === undefined
      ? {}
      : { relative_of_class: draft.relative_of_class }),
  };
  const parsed = watchlistRecordSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }
  const issue = parsed.error.issues[0];
  const path = issue === undefined || issue.path.length === 0 ? 'record' : issue.path.join('.');
  throw new WatchlistParseError(
    'schema',
    `entry ${String(ordinal)}: ${path}: ${issue?.message ?? 'invalid'}`,
  );
}
