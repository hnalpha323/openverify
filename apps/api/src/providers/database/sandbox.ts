/**
 * C59.2: the sandbox database provider, for sandbox environments only (configuration refuses it in
 * production, C63). It returns a record, not a verdict, so the real C58 matching runs on it: by
 * default the record echoes the values it was asked about, and a magic token in the inquiry's
 * `reference-id` changes it. Records are never authoritative, so a miss goes to review. The
 * tokens, listed in `docs/checks/sandbox-providers.md`, are whole tokens of the lower-cased
 * reference id (as the selfie tokens are); when several are present, the first in
 * {@link SANDBOX_DATABASE_MAGIC}'s order decides:
 *
 * | Token | The record |
 * |---|---|
 * | `sandbox-database-not-found` | none (`not_found`) |
 * | `sandbox-database-name-mismatch` | another surname |
 * | `sandbox-database-nickname` | the formal given name of an entered nickname (Bob: Robert), or a nickname of an entered formal name |
 * | `sandbox-database-address-mismatch` | another street and postal code |
 * | `sandbox-database-address-variant` | the address with its abbreviations swapped (Street: St, Apt: Apartment) |
 * | `sandbox-database-birthdate-mismatch` | the birth date a year later |
 * | `sandbox-database-birthdate-partial` | the birth year and month only |
 * | `sandbox-database-no-birthdate` | no birth date (a thin file) |
 *
 * It never returns an identification number, only that the one it was given matched.
 */
import { foldText, nicknamePairs } from '@openverify/checks';
import type {
  DatabaseLookupRequest,
  DatabaseLookupResult,
  DatabaseRecord,
  SandboxDatabaseProvider,
} from '../../ports.js';

/** The magic tokens, in precedence order, each written `sandbox-database-<token>`. */
export const SANDBOX_DATABASE_MAGIC = Object.freeze([
  'not-found',
  'name-mismatch',
  'nickname',
  'address-mismatch',
  'address-variant',
  'birthdate-mismatch',
  'birthdate-partial',
  'no-birthdate',
] as const);
export type SandboxDatabaseMagic = (typeof SANDBOX_DATABASE_MAGIC)[number];

/** Each token, whole: after the start or a character that is not a letter or digit. */
const TOKEN_PATTERNS: Readonly<Record<SandboxDatabaseMagic, RegExp>> = Object.freeze({
  'not-found': /(?:^|[^a-z0-9])sandbox-database-not-found(?![a-z0-9-])/,
  'name-mismatch': /(?:^|[^a-z0-9])sandbox-database-name-mismatch(?![a-z0-9-])/,
  nickname: /(?:^|[^a-z0-9])sandbox-database-nickname(?![a-z0-9-])/,
  'address-mismatch': /(?:^|[^a-z0-9])sandbox-database-address-mismatch(?![a-z0-9-])/,
  'address-variant': /(?:^|[^a-z0-9])sandbox-database-address-variant(?![a-z0-9-])/,
  'birthdate-mismatch': /(?:^|[^a-z0-9])sandbox-database-birthdate-mismatch(?![a-z0-9-])/,
  'birthdate-partial': /(?:^|[^a-z0-9])sandbox-database-birthdate-partial(?![a-z0-9-])/,
  'no-birthdate': /(?:^|[^a-z0-9])sandbox-database-no-birthdate(?![a-z0-9-])/,
});

/** The token that decides, by precedence; `null` when none is present. */
function magicOf(referenceId: string | null): SandboxDatabaseMagic | null {
  const reference = referenceId?.toLowerCase() ?? '';
  return SANDBOX_DATABASE_MAGIC.find((token) => TOKEN_PATTERNS[token].test(reference)) ?? null;
}

/** The members of a record that echo a value of the same name. */
const ECHOED: ReadonlySet<string> = new Set([
  'name-first',
  'name-middle',
  'name-last',
  'birthdate',
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
  'phone-number',
  'email-address',
]);

type MutableRecord = { -readonly [Name in keyof DatabaseRecord]: DatabaseRecord[Name] };

/** The values asked about, as the source holds them; a number only as whether it matched. */
function echo(fields: DatabaseLookupRequest['fields']): MutableRecord {
  const record: MutableRecord & Record<string, string | boolean | undefined> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'identification-number') {
      record['identification-number-match'] = true;
    } else if (ECHOED.has(name)) {
      record[name] = value;
    }
  }
  return record;
}

const folded = (name: string): string => foldText(name).simplified;

/** The first candidate that differs from `value` ignoring case and accents. */
function otherThan(value: string | undefined, candidates: readonly [string, string]): string {
  const [first, second] = candidates;
  return value !== undefined && folded(value) === folded(first) ? second : first;
}

const titleCase = (name: string): string =>
  name.replace(
    /(^|[\s-])(\p{L})/gu,
    (_match, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
  );

/**
 * The formal given name of a listed nickname, else a nickname of a listed formal name, in the
 * table's order; the name itself when the table holds neither.
 */
function nicknameCounterpart(given: string): string {
  const key = folded(given);
  const pairs = nicknamePairs();
  const pair =
    pairs.find((candidate) => folded(candidate.nickname) === key) ??
    pairs.find((candidate) => folded(candidate.formal) === key);
  if (pair === undefined) {
    return given;
  }
  return titleCase(folded(pair.nickname) === key ? pair.formal : pair.nickname);
}

/** Every digit moved by five, so the code differs; a code without digits becomes `99999`. */
function otherPostalCode(code: string): string {
  return /\d/.test(code)
    ? code.replace(/\d/g, (digit) => String((Number(digit) + 5) % 10))
    : '99999';
}

/** Street words and their abbreviations, each way (C58.4 normalises them back). */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map(
  (
    [
      ['street', 'St'],
      ['avenue', 'Ave'],
      ['road', 'Rd'],
      ['boulevard', 'Blvd'],
      ['drive', 'Dr'],
      ['lane', 'Ln'],
      ['court', 'Ct'],
      ['place', 'Pl'],
      ['apartment', 'Apt'],
      ['suite', 'Ste'],
    ] as const
  ).flatMap(([word, short]): [string, string][] => [
    [word, short],
    [short.toLowerCase(), titleCase(word)],
  ]),
);

/** The address line with each listed word swapped for its abbreviation, or back. */
function swapAbbreviations(line: string): string {
  return line
    .split(' ')
    .map((word) => ABBREVIATIONS.get(word.replace(/\.$/, '').toLowerCase()) ?? word)
    .join(' ');
}

/** A full date one year later; 29 February becomes 28 February. */
function yearLater(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return date;
  }
  const [, year = '', month = '', day = ''] = match;
  const next = String(Number(year) + 1).padStart(4, '0');
  return month === '02' && day === '29' ? `${next}-02-28` : `${next}-${month}-${day}`;
}

/** The echo, changed as the token says. */
function recordFor(fields: DatabaseLookupRequest['fields'], magic: SandboxDatabaseMagic | null) {
  const record = echo(fields);
  switch (magic) {
    case 'name-mismatch':
      record['name-last'] = otherThan(record['name-last'], ['Quillfeather', 'Marrowstone']);
      break;
    case 'nickname':
      if (record['name-first'] !== undefined) {
        record['name-first'] = nicknameCounterpart(record['name-first']);
      }
      break;
    case 'address-mismatch':
      record['address-street-1'] = otherThan(record['address-street-1'], [
        '88 Synthetic Lane',
        '99 Placeholder Avenue',
      ]);
      if (record['address-postal-code'] !== undefined) {
        record['address-postal-code'] = otherPostalCode(record['address-postal-code']);
      }
      break;
    case 'address-variant':
      for (const name of ['address-street-1', 'address-street-2'] as const) {
        const line = record[name];
        if (line !== undefined) {
          record[name] = swapAbbreviations(line);
        }
      }
      break;
    case 'birthdate-mismatch':
      if (record.birthdate !== undefined) {
        record.birthdate = yearLater(record.birthdate);
      }
      break;
    case 'birthdate-partial':
      if (record.birthdate !== undefined) {
        record.birthdate = record.birthdate.slice(0, 7);
      }
      break;
    case 'no-birthdate':
      delete record.birthdate;
      break;
    default:
      break;
  }
  return record;
}

/** The sandbox database provider (C59.2). It looks at no country: every one is covered. */
export function createSandboxDatabaseProvider(): SandboxDatabaseProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    lookup: (request, { referenceId }): Promise<DatabaseLookupResult> => {
      const magic = magicOf(referenceId);
      if (magic === 'not-found') {
        return Promise.resolve({ outcome: 'not_found', authoritative: false });
      }
      return Promise.resolve({
        outcome: 'found',
        record: recordFor(request.fields, magic),
        authoritative: false,
      });
    },
  };
}
