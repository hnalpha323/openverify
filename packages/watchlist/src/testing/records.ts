/**
 * Synthetic list entries in the frozen normalised record (C77.1, C77.5): fictional persons,
 * companies, vessels and aircraft generated from a seed, each valid under `watchlistRecordSchema`.
 * The first entries of each kind always carry the features the parsers, the matcher and the sync
 * must handle (original-script names, a weak alias, partial and ranged birth dates, every
 * identifier kind, crypto addresses whose ticker does not name the chain, an address that fails its
 * checksum), so a small list covers them whatever the seed; later entries are drawn at random.
 * Each entry draws from its own forked stream, so changing one count leaves the others alone.
 */
import type { WatchlistRecord } from '../record/index.js';
import { syntheticCryptoAddress } from './crypto-addresses.js';
import {
  syntheticAircraftSerial,
  syntheticAircraftTail,
  syntheticBic,
  syntheticDomain,
  syntheticImo,
  syntheticLei,
  syntheticMmsi,
  syntheticNationalId,
  syntheticPassportNumber,
  syntheticRegistrationNumber,
  syntheticTaxId,
} from './identifiers.js';
import {
  fictionalCompanyName,
  fictionalFamilyName,
  fictionalGivenName,
  fictionalHanName,
  fictionalPersonName,
  fictionalPlace,
  fictionalVesselName,
  type FictionalPersonName,
} from './names.js';
import { seededRandom, type SeededRandom } from './random.js';

/**
 * How entry ids look, so a writer can put each where its publisher does (C77.1): OFAC and EU
 * numeric ids, the UK's `SYN0001` unique ids, UN references (`SYi.001`, `SYe.001`), or our own
 * `SYN-1001`.
 */
export const SYNTHETIC_ID_STYLES = ['synthetic', 'ofac', 'eu', 'uk', 'un'] as const;
export type SyntheticIdStyle = (typeof SYNTHETIC_ID_STYLES)[number];

/** The programme names synthetic entries are listed under. */
export const SYNTHETIC_PROGRAMS: readonly string[] = [
  'SYNTHETIC-ALPHA',
  'SYNTHETIC-BETA',
  'SYNTHETIC-GAMMA',
  'SYNTHETIC-DELTA',
];

/** The countries synthetic entries are tied to (ISO 3166-1 alpha-2). */
export const SYNTHETIC_COUNTRIES: readonly string[] = [
  'GB',
  'FR',
  'DE',
  'ES',
  'IT',
  'NL',
  'SE',
  'PL',
  'PT',
  'IE',
  'CA',
  'AU',
  'NZ',
  'JP',
  'BR',
  'ZA',
  'KE',
  'IN',
  'SG',
  'MX',
];

export interface SyntheticWatchlistOptions {
  readonly seed: string;
  /** Persons (default 6). */
  readonly individuals?: number;
  /** Companies (default 3). */
  readonly entities?: number;
  /** Vessels (default 1). */
  readonly vessels?: number;
  /** Aircraft (default 1). */
  readonly aircraft?: number;
  /** Entry id style (default `synthetic`). */
  readonly idStyle?: SyntheticIdStyle;
  /** The first entry number (default 1); later lists of one source continue the numbering. */
  readonly firstNumber?: number;
  /**
   * Whether the second person carries a Han name (default `true`). Han names are built from common
   * characters, so they are real-name-shaped; committed lists leave them out (C89.1).
   */
  readonly hanNames?: boolean;
}

/** The entry id of the `number`-th entry of a kind in a style. */
export function syntheticEntryId(
  style: SyntheticIdStyle,
  kind: WatchlistRecord['kind'],
  number: number,
): string {
  if (!Number.isInteger(number) || number < 1 || number > 99_999) {
    throw new RangeError('an entry number is an integer from 1 to 99999');
  }
  switch (style) {
    case 'synthetic':
      return `SYN-${String(1000 + number)}`;
    case 'ofac':
      return String(900_000 + number);
    case 'eu':
      return String(700_000 + number);
    case 'uk':
      return `SYN${String(number).padStart(4, '0')}`;
    case 'un':
      return `SY${kind === 'individual' ? 'i' : 'e'}.${String(number).padStart(3, '0')}`;
  }
}

type Name = WatchlistRecord['names'][number];
type Identifier = WatchlistRecord['identifiers'][number];
type Crypto = WatchlistRecord['crypto_addresses'][number];

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** A calendar date between two years (days up to 28, so every month has them). */
function randomDate(random: SeededRandom, fromYear: number, toYear: number): string {
  return `${String(random.between(fromYear, toYear))}-${pad2(random.between(1, 12))}-${pad2(random.between(1, 28))}`;
}

function programs(random: SeededRandom): string[] {
  return random.sample(SYNTHETIC_PROGRAMS, random.between(1, 2));
}

function address(random: SeededRandom, country: string): WatchlistRecord['addresses'][number] {
  return {
    country,
    city: fictionalPlace(random),
    postcode: `SY${String(random.between(10, 99))} ${String(random.between(1, 9))}ZZ`,
    lines: [`${String(random.between(1, 200))} ${fictionalFamilyName(random).latin} Street`],
  };
}

const latinName = (
  full: string,
  quality: Name['quality'],
  primary: boolean,
  parts: Name['parts'] = [],
): Name => ({ full, parts, script: 'latin', quality, primary });

/** A name the list does not hold yet (redrawn from the entry's stream until it is new). */
function unique<Value>(used: Set<string>, draw: () => Value, fullOf: (value: Value) => string) {
  for (;;) {
    const value = draw();
    const full = fullOf(value);
    if (!used.has(full)) {
      used.add(full);
      return value;
    }
  }
}

function personParts(person: FictionalPersonName, script: 'latin' | 'cyrillic'): Name['parts'] {
  const form = (token: FictionalPersonName['given']): string =>
    script === 'latin' ? token.latin : token.cyrillic;
  return [
    { role: 'given', value: form(person.given) },
    ...(person.middle === null ? [] : [{ role: 'middle' as const, value: form(person.middle) }]),
    { role: 'family', value: form(person.family) },
  ];
}

const fullOf = (parts: Name['parts']): string => parts.map((part) => part.value).join(' ');

function individualNames(
  random: SeededRandom,
  index: number,
  used: Set<string>,
  han: boolean,
): Name[] {
  if (index === 1 && han) {
    const han = unique(
      used,
      () => fictionalHanName(random),
      (name) => name.latin,
    );
    const [family = '', given = ''] = han.latin.split(' ');
    return [
      latinName(han.latin, 'strong', true, [
        { role: 'family', value: family },
        { role: 'given', value: given },
      ]),
      { full: han.han, parts: [], script: 'han', quality: 'strong', primary: false },
    ];
  }
  const person = unique(
    used,
    () => fictionalPersonName(random, { middle: index === 0 || random.chance(0.3) }),
    (name) => fullOf(personParts(name, 'latin')),
  );
  const latin = personParts(person, 'latin');
  const names: Name[] = [latinName(fullOf(latin), 'strong', true, latin)];
  if (index === 0 || random.chance(0.3)) {
    const cyrillic = personParts(person, 'cyrillic');
    names.push({
      full: fullOf(cyrillic),
      parts: cyrillic,
      script: 'cyrillic',
      quality: 'strong',
      primary: false,
    });
  }
  if (index === 2 || random.chance(0.15)) {
    names.push({
      full: `${person.given.arabic} ${person.family.arabic}`,
      parts: [],
      script: 'arabic',
      quality: 'strong',
      primary: false,
    });
  }
  if (index === 0 || random.chance(0.1)) {
    names.push(
      latinName(`${fictionalGivenName(random).latin} ${person.family.latin}`, 'weak', false),
    );
  }
  if (random.chance(0.1)) {
    names.push(
      latinName(`${person.given.latin} ${fictionalFamilyName(random).latin}`, 'strong', false),
    );
  }
  return names;
}

function birthDates(random: SeededRandom, index: number): WatchlistRecord['birth_dates'] {
  if (index === 0) {
    return [{ value: randomDate(random, 1950, 2000), precision: 'day' }];
  }
  if (index === 1) {
    const year = random.between(1950, 2000);
    return [
      {
        value: String(year),
        precision: 'year',
        range: { from: String(year - 1), to: String(year + 1) },
      },
    ];
  }
  if (index === 2) {
    return [{ value: randomDate(random, 1950, 2000).slice(0, 7), precision: 'month' }];
  }
  const draw = random.next();
  if (draw < 0.6) {
    return [{ value: randomDate(random, 1950, 2000), precision: 'day' }];
  }
  if (draw < 0.8) {
    return [{ value: String(random.between(1950, 2000)), precision: 'year' }];
  }
  return draw < 0.9
    ? [{ value: randomDate(random, 1950, 2000).slice(0, 7), precision: 'month' }]
    : [];
}

function individual(
  random: SeededRandom,
  entryId: string,
  index: number,
  used: Set<string>,
  han: boolean,
): WatchlistRecord {
  const country = random.pick(SYNTHETIC_COUNTRIES);
  const identifiers: Identifier[] = [];
  if (index === 0 || random.chance(0.4)) {
    identifiers.push({ kind: 'passport', value: syntheticPassportNumber(random), country });
  }
  if (index === 0) {
    identifiers.push({ kind: 'national_id', value: syntheticNationalId(random), country });
  }
  if (index === 1) {
    identifiers.push({ kind: 'tax_id', value: syntheticTaxId(random), country });
  }
  const crypto: Crypto[] =
    index === 0
      ? [
          syntheticCryptoAddress(random, 'evm_checksummed', 'ETH'),
          syntheticCryptoAddress(random, 'tron', 'USDT'),
          syntheticCryptoAddress(random, 'bitcoin_p2wpkh'),
        ]
      : random.chance(0.15)
        ? [
            syntheticCryptoAddress(
              random,
              random.pick(['evm_lower', 'bitcoin_p2pkh', 'tron'] as const),
            ),
          ]
        : [];
  const gender: WatchlistRecord['gender'] =
    index === 0
      ? 'female'
      : index === 1
        ? 'male'
        : random.chance(0.7)
          ? random.pick(['female', 'male'] as const)
          : undefined;
  return {
    entry_id: entryId,
    kind: 'individual',
    names: individualNames(random, index, used, han),
    birth_dates: birthDates(random, index),
    birth_places: index === 0 || random.chance(0.5) ? [fictionalPlace(random)] : [],
    countries: [
      { code: country, role: 'nationality' },
      ...(index === 0
        ? [
            { code: random.pick(SYNTHETIC_COUNTRIES), role: 'citizenship' as const },
            { code: null, role: 'residence' as const },
          ]
        : []),
    ],
    ...(gender === undefined ? {} : { gender }),
    identifiers,
    addresses: index === 0 || random.chance(0.3) ? [address(random, country)] : [],
    crypto_addresses: crypto.map(({ raw, ticker }) => ({ raw, ticker })),
    programs: programs(random),
    listed_at: randomDate(random, 2015, 2025),
    positions: [],
    relations: [],
    ...(index === 0 ? { remarks: 'Synthetic entry: every value in it is fictional.' } : {}),
  };
}

/** A Bitcoin address with one character changed, so its checksum fails (kept raw, C79.3). */
function brokenChecksum(random: SeededRandom): Crypto {
  const valid = syntheticCryptoAddress(random, 'bitcoin_p2pkh').raw;
  const replacement = valid.charAt(10) === 'Z' ? 'Y' : 'Z';
  return { raw: `${valid.slice(0, 10)}${replacement}${valid.slice(11)}`, ticker: 'XBT' };
}

function entity(
  random: SeededRandom,
  entryId: string,
  index: number,
  used: Set<string>,
): WatchlistRecord {
  const company = unique(
    used,
    () => fictionalCompanyName(random),
    (name) => name.full,
  );
  const country = random.pick(SYNTHETIC_COUNTRIES);
  const names: Name[] = [latinName(company.full, 'strong', true)];
  if (index === 0) {
    names.push(latinName(fictionalCompanyName(random).full, 'strong', false));
    names.push(latinName(company.words[0] ?? company.full, 'weak', false));
  }
  const identifiers: Identifier[] = [];
  if (index === 0 || random.chance(0.5)) {
    identifiers.push({
      kind: 'registration_number',
      value: syntheticRegistrationNumber(random),
      country,
    });
  }
  if (index === 0 || random.chance(0.3)) {
    identifiers.push({ kind: 'lei', value: syntheticLei(random) });
  }
  if (index === 0 || random.chance(0.2)) {
    const domain = syntheticDomain(random);
    identifiers.push({ kind: 'website', value: domain });
    if (index === 0) {
      identifiers.push({ kind: 'email', value: `office@${domain}` });
    }
  }
  if (index === 0) {
    identifiers.push({ kind: 'tax_id', value: syntheticTaxId(random), country });
    identifiers.push({ kind: 'swift_bic', value: syntheticBic(random, country) });
  }
  const crypto: Crypto[] =
    index === 0
      ? [
          syntheticCryptoAddress(random, 'tron', 'USDT'),
          syntheticCryptoAddress(random, 'bitcoin_p2pkh'),
          brokenChecksum(random),
          syntheticCryptoAddress(random, 'unclassified'),
        ]
      : random.chance(0.2)
        ? [
            syntheticCryptoAddress(
              random,
              random.pick(['evm_lower', 'bitcoin_cash', 'monero'] as const),
            ),
          ]
        : [];
  return {
    entry_id: entryId,
    kind: 'entity',
    names,
    birth_dates: [],
    birth_places: [],
    countries: [
      { code: country, role: 'registration' },
      { code: random.pick(SYNTHETIC_COUNTRIES), role: 'address' },
    ],
    identifiers,
    addresses: index === 0 || random.chance(0.5) ? [address(random, country)] : [],
    crypto_addresses: crypto.map(({ raw, ticker }) => ({ raw, ticker })),
    programs: programs(random),
    listed_at: randomDate(random, 2015, 2025),
    positions: [],
    relations: [],
  };
}

function vessel(random: SeededRandom, entryId: string, used: Set<string>): WatchlistRecord {
  const name = unique(
    used,
    () => fictionalVesselName(random),
    (full) => full,
  );
  return {
    entry_id: entryId,
    kind: 'vessel',
    names: [latinName(name, 'strong', true)],
    birth_dates: [],
    birth_places: [],
    countries: [{ code: random.pick(SYNTHETIC_COUNTRIES), role: 'registration' }],
    identifiers: [
      { kind: 'imo', value: syntheticImo(random) },
      { kind: 'mmsi', value: syntheticMmsi(random) },
    ],
    addresses: [],
    crypto_addresses: [],
    programs: programs(random),
    listed_at: randomDate(random, 2015, 2025),
    positions: [],
    relations: [],
  };
}

function aircraft(random: SeededRandom, entryId: string, used: Set<string>): WatchlistRecord {
  const name = unique(
    used,
    () => `${fictionalGivenName(random).latin} ${random.pick(['Airliner', 'Freighter', 'Jet'])}`,
    (full) => full,
  );
  return {
    entry_id: entryId,
    kind: 'aircraft',
    names: [latinName(name, 'strong', true)],
    birth_dates: [],
    birth_places: [],
    countries: [{ code: random.pick(SYNTHETIC_COUNTRIES), role: 'registration' }],
    identifiers: [
      { kind: 'aircraft_serial', value: syntheticAircraftSerial(random) },
      { kind: 'aircraft_tail', value: syntheticAircraftTail(random) },
    ],
    addresses: [],
    crypto_addresses: [],
    programs: programs(random),
    listed_at: randomDate(random, 2015, 2025),
    positions: [],
    relations: [],
  };
}

/** A synthetic list: persons, then companies, vessels and aircraft. */
export function syntheticWatchlist(options: SyntheticWatchlistOptions): WatchlistRecord[] {
  const random = seededRandom(`watchlist/${options.seed}`);
  const style = options.idStyle ?? 'synthetic';
  const used = new Set<string>();
  const kinds: WatchlistRecord['kind'][] = [
    ...Array<WatchlistRecord['kind']>(options.individuals ?? 6).fill('individual'),
    ...Array<WatchlistRecord['kind']>(options.entities ?? 3).fill('entity'),
    ...Array<WatchlistRecord['kind']>(options.vessels ?? 1).fill('vessel'),
    ...Array<WatchlistRecord['kind']>(options.aircraft ?? 1).fill('aircraft'),
  ];
  const seen = { individual: 0, entity: 0, vessel: 0, aircraft: 0 };
  return kinds.map((kind, position) => {
    const number = (options.firstNumber ?? 1) + position;
    const entryId = syntheticEntryId(style, kind, number);
    const stream = random.fork(`entry-${String(number)}`);
    const index = seen[kind];
    seen[kind] += 1;
    switch (kind) {
      case 'individual':
        return individual(stream, entryId, index, used, options.hanNames ?? true);
      case 'entity':
        return entity(stream, entryId, index, used);
      case 'vessel':
        return vessel(stream, entryId, used);
      case 'aircraft':
        return aircraft(stream, entryId, used);
    }
  });
}
