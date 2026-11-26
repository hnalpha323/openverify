/**
 * The sandbox lists (C76.6, C77.5, C82.4, decision 14): `openverify-sandbox` (sanctions) and
 * `openverify-sandbox-pep` (PEP), in the normalised import format, which `seed:dev` imports so a
 * fresh sandbox stack answers without any download. Both are static synthetic data and never
 * stale (V03). Their magic values are fixed and obviously fictional; filler entries generated from
 * fixed seeds give the lists realistic key frequencies (C78.3: a key is rare at 2% of the names).
 *
 * `openverify-sandbox` has versions for the monitoring e2e (C89.2): version 2 adds the monitored
 * person, version 3 changes that person's birth date (a new content hash, so a dismissal lapses)
 * and version 4 adds a programme only (a new risk-data hash, for notify-on-change, V06).
 */
import type { WatchlistImport, WatchlistRecord } from '../record/index.js';
import { PUBLISHED_TEST_ADDRESSES, syntheticCryptoAddress } from './crypto-addresses.js';
import { OFAC_LIST_NAMES } from './formats/ofac.js';
import { normalisedImport } from './normalised.js';
import { syntheticPeps } from './peps.js';
import { seededRandom } from './random.js';
import { syntheticWatchlist } from './records.js';

/** The sandbox sources' manifest ids (C76.1). */
export const OPENVERIFY_SANDBOX_SOURCE = 'openverify-sandbox';
export const OPENVERIFY_SANDBOX_PEP_SOURCE = 'openverify-sandbox-pep';

/** The versions of `openverify-sandbox`; `seed:dev` imports version 1. */
export const SANDBOX_LIST_VERSIONS = [1, 2, 3, 4] as const;
export type SandboxListVersion = (typeof SANDBOX_LIST_VERSIONS)[number];

/** A sandbox person and the public query fields that screen it (C79.1, C80.5). */
export interface SandboxPerson {
  readonly entryId: string;
  readonly givenName: string;
  readonly middleName: string | null;
  readonly familyName: string;
  /** `YYYY-MM-DD`, or `null` when the entry records none. */
  readonly birthdate: string | null;
  readonly country: string;
  readonly query: Readonly<Record<string, string>>;
}

/** The magic values of `openverify-sandbox` (C82.4), documented in `docs/checks/sandbox-providers.md`. */
export interface SandboxWatchlistMagic {
  /** A listed person (every version). */
  readonly listedPerson: SandboxPerson & {
    readonly passport: string;
    readonly cyrillicName: string;
  };
  /** The person version 2 adds; `birthdate` is version 2's, `changedBirthdate` version 3's. */
  readonly monitoredPerson: SandboxPerson & {
    readonly changedBirthdate: string;
    readonly addedProgram: string;
  };
  /** "Sandbox Sanctioned Holdings Ltd" with its LEI. */
  readonly business: {
    readonly entryId: string;
    readonly name: string;
    readonly lei: string;
    readonly registrationNumber: string;
    readonly country: string;
    readonly query: Readonly<Record<string, string>>;
  };
  /** The vessel with IMO `9999993`. */
  readonly vessel: {
    readonly entryId: string;
    readonly name: string;
    readonly imo: string;
    readonly query: Readonly<Record<string, string>>;
  };
  /**
   * K19 (Workflow 9D): "Corvanel Sectoral Ironworks", an entity listed only on a list other than the
   * SDN List (OFAC's Consolidated, non-SDN Sectoral Sanctions Identifications List), so the console's
   * "Other lists" shows a non-blocking listing for what it is (owner decision 9 after Workflow 6B).
   */
  readonly otherListsEntity: {
    readonly entryId: string;
    readonly name: string;
    readonly list: string;
    readonly program: string;
    readonly query: Readonly<Record<string, string>>;
  };
  /** "Sandbox Listed Party" and its published test addresses. */
  readonly cryptoParty: {
    readonly entryId: string;
    readonly name: string;
    readonly addresses: readonly { readonly raw: string; readonly ticker: string }[];
    readonly query: Readonly<Record<string, string>>;
  };
}

/** The magic values of `openverify-sandbox-pep` (C82.4): fictional office holders and one relative. */
export interface SandboxPepMagic {
  readonly headOfGovernment: SandboxPerson & { readonly pepClass: 1 };
  /** The relative: the head of government's spouse, holding no position. */
  readonly spouse: SandboxPerson & { readonly relationOf: string };
  readonly formerMinister: SandboxPerson & { readonly pepClass: 1; readonly endedOn: string };
  readonly ambassador: SandboxPerson & { readonly pepClass: 2 };
  readonly internationalOrganisationHead: SandboxPerson & { readonly pepClass: 2 };
  readonly stateEnterpriseBoardMember: SandboxPerson & { readonly pepClass: 3 };
  readonly mayor: SandboxPerson & { readonly pepClass: 4 };
}

/** The programme every magic sanctions entry is listed under. */
const SANDBOX_PROGRAM = 'SANDBOX-PROGRAM-1';

const personQuery = (
  given: string,
  family: string,
  birthdate: string | null,
  middle: string | null = null,
): Readonly<Record<string, string>> =>
  Object.freeze({
    'name-first': given,
    ...(middle === null ? {} : { 'name-middle': middle }),
    'name-last': family,
    ...(birthdate === null ? {} : { birthdate }),
  });

export const SANDBOX_WATCHLIST_MAGIC: SandboxWatchlistMagic = Object.freeze({
  listedPerson: {
    entryId: 'SBX-1001',
    givenName: 'Avery',
    middleName: 'Sandbox',
    familyName: 'Quillfeather',
    birthdate: '1980-04-12',
    country: 'GB',
    passport: 'SBXP12345',
    cyrillicName: 'Эйвери Сэндбокс Квиллфезер',
    query: personQuery('Avery', 'Quillfeather', '1980-04-12', 'Sandbox'),
  },
  monitoredPerson: {
    entryId: 'SBX-1002',
    givenName: 'Rowan',
    middleName: null,
    familyName: 'Fixturedale',
    birthdate: '1975-09-30',
    changedBirthdate: '1975-10-30',
    addedProgram: 'SANDBOX-PROGRAM-2',
    country: 'FR',
    // No birth date: version 3 changes it, and the run must still find the entry for the dismissal
    // of version 2's match to lapse (C75.8, C89.2) rather than lose it to a date penalty.
    query: personQuery('Rowan', 'Fixturedale', null),
  },
  business: {
    entryId: 'SBX-2001',
    name: 'Sandbox Sanctioned Holdings Ltd',
    lei: '5299000SANDBOXLEI047',
    registrationNumber: 'SBX00000001',
    country: 'GB',
    query: Object.freeze({
      term: 'Sandbox Sanctioned Holdings Ltd',
      lei: '5299000SANDBOXLEI047',
    }),
  },
  vessel: {
    entryId: 'SBX-3001',
    name: 'Sandbox Voyager',
    imo: '9999993',
    query: Object.freeze({ term: 'Sandbox Voyager', 'imo-number': '9999993' }),
  },
  otherListsEntity: {
    entryId: 'SBX-2003',
    name: 'Corvanel Sectoral Ironworks',
    list: OFAC_LIST_NAMES.consolidated,
    program: 'SANDBOX-SSI-1',
    query: Object.freeze({ term: 'Corvanel Sectoral Ironworks' }),
  },
  cryptoParty: {
    entryId: 'SBX-2002',
    name: 'Sandbox Listed Party',
    addresses: Object.freeze([
      { raw: PUBLISHED_TEST_ADDRESSES.eip55Example, ticker: 'ETH' },
      { raw: PUBLISHED_TEST_ADDRESSES.bip173P2wpkh, ticker: 'XBT' },
      {
        raw: syntheticCryptoAddress(seededRandom('openverify-sandbox/crypto-party'), 'tron').raw,
        ticker: 'USDT',
      },
    ]),
    query: Object.freeze({ 'crypto-address': PUBLISHED_TEST_ADDRESSES.eip55Example }),
  },
});

const holder = <Class extends 1 | 2 | 3 | 4>(
  entryId: string,
  givenName: string,
  familyName: string,
  birthdate: string,
  country: string,
  pepClass: Class,
) => ({
  entryId,
  givenName,
  middleName: null,
  familyName,
  birthdate,
  country,
  pepClass,
  query: personQuery(givenName, familyName, birthdate),
});

export const SANDBOX_PEP_MAGIC: SandboxPepMagic = Object.freeze({
  headOfGovernment: holder('Q-test-1001', 'Marlowe', 'Testerton', '1968-03-14', 'GB', 1),
  spouse: {
    entryId: 'Q-test-1002',
    givenName: 'Imogen',
    middleName: null,
    familyName: 'Testerton',
    birthdate: '1970-07-22',
    country: 'GB',
    relationOf: 'Q-test-1001',
    query: personQuery('Imogen', 'Testerton', '1970-07-22'),
  },
  formerMinister: {
    ...holder('Q-test-1003', 'Corin', 'Fixtureworth', '1959-11-02', 'GB', 1),
    endedOn: '2026-02-28',
  },
  ambassador: holder('Q-test-1004', 'Tamsin', 'Samplewick', '1972-05-19', 'FR', 2),
  internationalOrganisationHead: holder('Q-test-1005', 'Orla', 'Mockfield', '1965-12-08', 'IE', 2),
  stateEnterpriseBoardMember: holder('Q-test-1006', 'Idris', 'Sandmoor', '1977-01-25', 'NL', 3),
  mayor: holder('Q-test-1007', 'Wren', 'Stubhollow', '1981-08-30', 'NZ', 4),
});

/** The publication time of each version: fixed, as the data is static (and never stale, V03). */
const PUBLISHED_AT: Readonly<Record<SandboxListVersion, string>> = {
  1: '2026-01-01T00:00:00Z',
  2: '2026-01-02T00:00:00Z',
  3: '2026-01-03T00:00:00Z',
  4: '2026-01-04T00:00:00Z',
};
const PEP_PUBLISHED_AT = '2026-01-01T00:00:00Z';

type Name = WatchlistRecord['names'][number];

const latin = (
  full: string,
  primary: boolean,
  quality: Name['quality'] = 'strong',
  parts: Name['parts'] = [],
): Name => ({ full, parts, script: 'latin', quality, primary });

const empty = {
  birth_dates: [],
  birth_places: [],
  identifiers: [],
  addresses: [],
  crypto_addresses: [],
  programs: [],
  positions: [],
  relations: [],
} satisfies Partial<WatchlistRecord>;

function listedPerson(): WatchlistRecord {
  const person = SANDBOX_WATCHLIST_MAGIC.listedPerson;
  const [cyrillicGiven = '', cyrillicMiddle = '', cyrillicFamily = ''] =
    person.cyrillicName.split(' ');
  return {
    ...empty,
    entry_id: person.entryId,
    kind: 'individual',
    names: [
      latin('Avery Sandbox Quillfeather', true, 'strong', [
        { role: 'given', value: person.givenName },
        { role: 'middle', value: 'Sandbox' },
        { role: 'family', value: person.familyName },
      ]),
      {
        full: person.cyrillicName,
        parts: [
          { role: 'given', value: cyrillicGiven },
          { role: 'middle', value: cyrillicMiddle },
          { role: 'family', value: cyrillicFamily },
        ],
        script: 'cyrillic',
        quality: 'strong',
        primary: false,
      },
      latin('Avy Quill', false, 'weak'),
    ],
    birth_dates: [{ value: '1980-04-12', precision: 'day' }],
    birth_places: ['Sandbox City'],
    countries: [{ code: person.country, role: 'nationality' }],
    gender: 'female',
    identifiers: [{ kind: 'passport', value: person.passport, country: person.country }],
    addresses: [
      { country: 'GB', city: 'Sandbox City', postcode: 'SB1 1ZZ', lines: ['1 Synthetic Lane'] },
    ],
    programs: [SANDBOX_PROGRAM],
    listed_at: '2025-06-01',
    remarks: 'Sandbox entry: every value in it is fictional.',
  };
}

function monitoredPerson(version: SandboxListVersion): WatchlistRecord {
  const person = SANDBOX_WATCHLIST_MAGIC.monitoredPerson;
  return {
    ...empty,
    entry_id: person.entryId,
    kind: 'individual',
    names: [
      latin('Rowan Fixturedale', true, 'strong', [
        { role: 'given', value: person.givenName },
        { role: 'family', value: person.familyName },
      ]),
    ],
    birth_dates: [
      {
        value: version >= 3 ? person.changedBirthdate : (person.birthdate ?? ''),
        precision: 'day',
      },
    ],
    countries: [{ code: person.country, role: 'nationality' }],
    gender: 'male',
    programs: version >= 4 ? [SANDBOX_PROGRAM, person.addedProgram] : [SANDBOX_PROGRAM],
    listed_at: '2026-01-02',
  };
}

function magicEntities(): WatchlistRecord[] {
  const { business, vessel, cryptoParty, otherListsEntity } = SANDBOX_WATCHLIST_MAGIC;
  return [
    {
      ...empty,
      entry_id: business.entryId,
      kind: 'entity',
      names: [latin(business.name, true)],
      countries: [{ code: business.country, role: 'registration' }],
      identifiers: [
        { kind: 'lei', value: business.lei },
        {
          kind: 'registration_number',
          value: business.registrationNumber,
          country: business.country,
        },
        { kind: 'website', value: 'sanctioned-holdings.example' },
      ],
      programs: [SANDBOX_PROGRAM],
      listed_at: '2025-06-01',
    },
    {
      ...empty,
      entry_id: cryptoParty.entryId,
      kind: 'entity',
      names: [latin(cryptoParty.name, true)],
      countries: [{ code: 'GB', role: 'registration' }],
      crypto_addresses: cryptoParty.addresses.map(({ raw, ticker }) => ({ raw, ticker })),
      programs: [SANDBOX_PROGRAM],
      listed_at: '2025-06-01',
    },
    {
      ...empty,
      entry_id: otherListsEntity.entryId,
      kind: 'entity',
      names: [latin(otherListsEntity.name, true)],
      countries: [{ code: 'GB', role: 'registration' }],
      programs: [otherListsEntity.program],
      // K19: on a list other than the SDN List only, so "Other lists" names it (decision 9 after 6B).
      list_memberships: [{ list: otherListsEntity.list, program: otherListsEntity.program }],
      listed_at: '2025-06-01',
    },
    {
      ...empty,
      entry_id: vessel.entryId,
      kind: 'vessel',
      names: [latin(vessel.name, true)],
      countries: [{ code: 'GB', role: 'registration' }],
      identifiers: [
        { kind: 'imo', value: vessel.imo },
        { kind: 'mmsi', value: '100999993' },
      ],
      programs: [SANDBOX_PROGRAM],
      listed_at: '2025-06-01',
    },
  ];
}

/** Filler entries from a fixed seed, numbered after the magic ones. */
const fillers = (): WatchlistRecord[] =>
  syntheticWatchlist({
    seed: 'openverify-sandbox/fillers',
    individuals: 45,
    entities: 15,
    vessels: 2,
    aircraft: 2,
    firstNumber: 5001,
    hanNames: false,
  });

/** A version of `openverify-sandbox`, validated. */
export function openverifySandboxList(version: SandboxListVersion = 1): WatchlistImport {
  return normalisedImport(OPENVERIFY_SANDBOX_SOURCE, PUBLISHED_AT[version], [
    listedPerson(),
    ...(version >= 2 ? [monitoredPerson(version)] : []),
    ...magicEntities(),
    ...fillers(),
  ]);
}

function pepHolder(
  person: SandboxPerson,
  position: { id: string; label: string; pepClass: 1 | 2 | 3 | 4; start: string; end?: string },
  positionCountry: string | null = person.country,
): WatchlistRecord {
  return {
    ...empty,
    entry_id: person.entryId,
    kind: 'individual',
    names: [
      latin(`${person.givenName} ${person.familyName}`, true, 'strong', [
        { role: 'given', value: person.givenName },
        { role: 'family', value: person.familyName },
      ]),
    ],
    birth_dates: person.birthdate === null ? [] : [{ value: person.birthdate, precision: 'day' }],
    countries: [{ code: person.country, role: 'citizenship' }],
    positions: [
      {
        position: position.id,
        label: position.label,
        pep_class: position.pepClass,
        country: positionCountry,
        start: position.start,
        end: position.end ?? null,
        in_office: position.end === undefined ? 'yes' : 'no',
      },
    ],
  };
}

/** `openverify-sandbox-pep`, validated. */
export function openverifySandboxPepList(): WatchlistImport {
  const P = SANDBOX_PEP_MAGIC;
  const spouse: WatchlistRecord = {
    ...empty,
    entry_id: P.spouse.entryId,
    kind: 'individual',
    names: [
      latin(`${P.spouse.givenName} ${P.spouse.familyName}`, true, 'strong', [
        { role: 'given', value: P.spouse.givenName },
        { role: 'family', value: P.spouse.familyName },
      ]),
    ],
    birth_dates: [{ value: P.spouse.birthdate ?? '', precision: 'day' }],
    countries: [{ code: P.spouse.country, role: 'citizenship' }],
    gender: 'female',
    relations: [{ relation: 'spouse', entity_id: P.spouse.relationOf }],
    // Owner decision 9 after 6B: the class of the PEP it relates to, as a PEP pass derives it.
    relative_of_class: P.headOfGovernment.pepClass,
  };
  return normalisedImport(OPENVERIFY_SANDBOX_PEP_SOURCE, PEP_PUBLISHED_AT, [
    pepHolder(P.headOfGovernment, {
      id: 'Q-test-2001',
      label: 'Synthetic Head of Government',
      pepClass: 1,
      start: '2023-05-01',
    }),
    spouse,
    pepHolder(P.formerMinister, {
      id: 'Q-test-2002',
      label: 'Synthetic Minister of Testing',
      pepClass: 1,
      start: '2019-02-01',
      end: P.formerMinister.endedOn,
    }),
    pepHolder(P.ambassador, {
      id: 'Q-test-2003',
      label: 'Synthetic Ambassador',
      pepClass: 2,
      start: '2022-09-01',
    }),
    pepHolder(
      P.internationalOrganisationHead,
      {
        id: 'Q-test-2004',
        label: 'Synthetic Secretary-General of an International Organisation',
        pepClass: 2,
        start: '2024-01-15',
      },
      null,
    ),
    pepHolder(P.stateEnterpriseBoardMember, {
      id: 'Q-test-2005',
      label: 'Synthetic State Enterprise Board Member',
      pepClass: 3,
      start: '2021-06-01',
    }),
    pepHolder(P.mayor, {
      id: 'Q-test-2006',
      label: 'Synthetic Mayor',
      pepClass: 4,
      start: '2024-07-01',
    }),
    ...syntheticPeps({ seed: 'openverify-sandbox-pep/fillers', count: 55, firstNumber: 5001 }),
  ]);
}
