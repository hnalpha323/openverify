/**
 * C78.8 (H21, V12): the held-out evaluation set, generated at evaluation time from the seed
 * `evaluation-6` chooses and never committed: a list of fictional persons and companies, queries
 * that vary each listed name (recall per variant source), and a customer population (precision and
 * alerts per 1,000 customers). Cross-script cases come only from the groups the `--hold-out <seed>`
 * build drops and from our own transliteration rules. `watchlist-matcher` never reads this folder,
 * and this folder never reads `src/score` or `src/match`. It is not re-exported from the testing
 * entry point: `evaluation-6`'s scripts in this package import it by path.
 *
 * Group cases combine two real name forms of held-out groups (a given name and a surname), so a
 * case may spell a name some real person bears; that is why the set is generated at evaluation time
 * and only aggregates are published.
 */
import type { WatchlistImport, WatchlistRecord } from '../../record/index.js';
import { fictionalCompanyName, fictionalPersonName, type FictionalPersonName } from '../names.js';
import { normalisedImport } from '../normalised.js';
import { seededRandom, type SeededRandom } from '../random.js';
import { SYNTHETIC_COUNTRIES } from '../records.js';
import { formsByScript, heldOutGroups, type VariantGroup } from './groups.js';
import { syntheticCustomers, type SyntheticCustomer } from './population.js';
import {
  TYPO_KINDS,
  cyrillicToLatin,
  initialOf,
  latinToCyrillic,
  otherLegalForm,
  withTypo,
  type VariantSource,
} from './variants.js';

export * from './variants.js';
export * from './groups.js';
export * from './population.js';
export * from './scale-population.js';

/** The source id of the held-out list. */
export const HELD_OUT_SOURCE = 'evaluation-held-out';

export interface HeldOutOptions {
  /** `evaluation-6`'s seed: it picks the held-out groups and draws everything else. */
  readonly seed: string;
  /** Listed persons (default 200). */
  readonly persons?: number;
  /** Listed companies (default 100). */
  readonly companies?: number;
  /** Customers (default 1,000). */
  readonly customers?: number;
  /** The parsed rigour groups; without them the set has no group cases. */
  readonly groups?: readonly VariantGroup[];
  /** Cases per held-out source when groups are given (default 100 each). */
  readonly groupCases?: number;
  /** Whether person queries carry the listed birth date (default false: names only). */
  readonly withBirthdates?: boolean;
}

/** One query and the entry it should find. */
export interface HeldOutCase {
  readonly id: string;
  readonly subject: 'person' | 'business';
  readonly variantSource: VariantSource;
  /** The query in the public request shape (`watchlist` or `business-watchlist`). */
  readonly query: Readonly<Record<string, string>>;
  readonly expectedEntryId: string;
  /** The variant groups the case draws on (empty unless a group case). */
  readonly groupIds: readonly string[];
}

export interface HeldOutSet {
  readonly seed: string;
  /** The listed entries, in the normalised import format. */
  readonly list: WatchlistImport;
  readonly cases: readonly HeldOutCase[];
  readonly customers: readonly SyntheticCustomer[];
  /** Every held-out group id the cases draw on (none may survive in the measured build, V12). */
  readonly heldOutGroupIds: readonly string[];
}

/** The person sources, taken in turn; a tenth of the persons are listed in Cyrillic only. */
const PERSON_SOURCES = [
  'exact',
  'typo',
  'order_swap',
  'dropped_middle',
  'initials',
  'joined_tokens',
  'split_tokens',
  'own_transliteration',
] as const satisfies readonly VariantSource[];
const COMPANY_SOURCES = ['exact', 'typo', 'legal_form'] as const satisfies readonly VariantSource[];

type Name = WatchlistRecord['names'][number];
type Query = Record<string, string>;

const pad = (value: number): string => String(value).padStart(5, '0');
const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const date = (random: SeededRandom): string =>
  `${String(random.between(1950, 2000))}-${String(random.between(1, 12)).padStart(2, '0')}-${String(random.between(1, 28)).padStart(2, '0')}`;

function person(
  entryId: string,
  names: readonly Name[],
  birthdate: string,
  country: string,
): WatchlistRecord {
  return {
    entry_id: entryId,
    kind: 'individual',
    names: [...names],
    birth_dates: [{ value: birthdate, precision: 'day' }],
    birth_places: [],
    countries: [{ code: country, role: 'nationality' }],
    identifiers: [],
    addresses: [],
    crypto_addresses: [],
    programs: ['EVALUATION'],
    listed_at: '2025-01-01',
    positions: [],
    relations: [],
  };
}

const latinName = (given: string, middle: string | null, family: string): Name => ({
  full: [given, middle, family].filter((part) => part !== null).join(' '),
  parts: [
    { role: 'given', value: given },
    ...(middle === null ? [] : [{ role: 'middle' as const, value: middle }]),
    { role: 'family', value: family },
  ],
  script: 'latin',
  quality: 'strong',
  primary: true,
});

const nameQuery = (first: string, middle: string | null, last: string): Query => ({
  'name-first': first,
  ...(middle === null ? {} : { 'name-middle': middle }),
  'name-last': last,
});

/** A Latin-listed person's query for a source. */
function personQuery(
  random: SeededRandom,
  name: FictionalPersonName,
  source: VariantSource,
): Query {
  const given = name.given.latin;
  const middle = name.middle?.latin ?? null;
  const family = name.family.latin;
  switch (source) {
    case 'typo':
      return nameQuery(given, middle, withTypo(random, family, random.pick(TYPO_KINDS)));
    case 'order_swap':
      return nameQuery(family, middle, given);
    case 'dropped_middle':
      return nameQuery(given, null, family);
    case 'initials':
      return nameQuery(initialOf(given), middle, family);
    case 'joined_tokens':
      return nameQuery(given, null, `${middle ?? ''}${family.toLowerCase()}`);
    case 'split_tokens': {
      const [head = '', ...tail] = name.family.syllables;
      return nameQuery(given, middle, `${capitalise(head)} ${capitalise(tail.join(''))}`);
    }
    case 'own_transliteration':
      return nameQuery(
        latinToCyrillic(given),
        middle === null ? null : latinToCyrillic(middle),
        latinToCyrillic(family),
      );
    default:
      return nameQuery(given, middle, family);
  }
}

export function generateHeldOutSet(options: HeldOutOptions): HeldOutSet {
  const random = seededRandom(`held-out/${options.seed}`);
  const entries: WatchlistRecord[] = [];
  const cases: HeldOutCase[] = [];
  const used = new Set<string>();
  const addCase = (
    subject: HeldOutCase['subject'],
    variantSource: VariantSource,
    query: Query,
    expectedEntryId: string,
    groupIds: readonly string[] = [],
  ): void => {
    cases.push({
      id: `HO-${pad(cases.length + 1)}`,
      subject,
      variantSource,
      query,
      expectedEntryId,
      groupIds,
    });
  };
  const withDate = (query: Query, birthdate: string): Query =>
    options.withBirthdates === true ? { ...query, birthdate } : query;

  for (let index = 0; index < (options.persons ?? 200); index += 1) {
    const stream = random.fork(`person-${String(index)}`);
    let name = fictionalPersonName(stream, { middle: true });
    while (used.has(name.family.latin)) {
      name = fictionalPersonName(stream, { middle: true });
    }
    used.add(name.family.latin);
    const entryId = `HO-P-${pad(index + 1)}`;
    const birthdate = date(stream);
    const country = stream.pick(SYNTHETIC_COUNTRIES);
    if (index % 10 === 9) {
      const tokens = [name.given, name.middle ?? name.given, name.family].map((t) => t.cyrillic);
      entries.push(
        person(
          entryId,
          [{ ...latinName(tokens[0] ?? '', tokens[1] ?? '', tokens[2] ?? ''), script: 'cyrillic' }],
          birthdate,
          country,
        ),
      );
      const scheme = stream.pick(['german', 'french'] as const);
      const [first = '', middle = '', last = ''] = tokens.map((t) => cyrillicToLatin(t, scheme));
      addCase(
        'person',
        'own_transliteration',
        withDate(nameQuery(first, middle, last), birthdate),
        entryId,
      );
      continue;
    }
    entries.push(
      person(
        entryId,
        [latinName(name.given.latin, name.middle?.latin ?? null, name.family.latin)],
        birthdate,
        country,
      ),
    );
    const source = PERSON_SOURCES[index % PERSON_SOURCES.length] ?? 'exact';
    addCase('person', source, withDate(personQuery(stream, name, source), birthdate), entryId);
  }

  for (let index = 0; index < (options.companies ?? 100); index += 1) {
    const stream = random.fork(`company-${String(index)}`);
    let company = fictionalCompanyName(stream);
    while (used.has(company.full)) {
      company = fictionalCompanyName(stream);
    }
    used.add(company.full);
    const entryId = `HO-C-${pad(index + 1)}`;
    entries.push({
      ...person(entryId, [], '2000-01-01', stream.pick(SYNTHETIC_COUNTRIES)),
      kind: 'entity',
      names: [{ full: company.full, parts: [], script: 'latin', quality: 'strong', primary: true }],
      birth_dates: [],
      countries: [{ code: stream.pick(SYNTHETIC_COUNTRIES), role: 'registration' }],
    });
    const words = [...company.words, ...(company.generic === null ? [] : [company.generic])];
    const source = COMPANY_SOURCES[index % COMPANY_SOURCES.length] ?? 'exact';
    const term =
      source === 'typo'
        ? [
            withTypo(stream, words[0] ?? '', stream.pick(TYPO_KINDS)),
            ...words.slice(1),
            company.legalForm,
          ].join(' ')
        : source === 'legal_form'
          ? [...words, otherLegalForm(stream, company.legalForm)]
              .filter((part) => part !== null)
              .join(' ')
          : company.full;
    addCase('business', source, { term }, entryId);
  }

  const groupIds = new Set<string>();
  const held = heldOutGroups(options.groups ?? [], options.seed).map((group) => ({
    group,
    ...formsByScript(group),
  }));
  const groupStream = random.fork('groups');
  const groupCase = (
    source: 'held_out_group_cross_script' | 'held_out_group_same_script',
    usable: typeof held,
    listedForm: (forms: (typeof held)[number]) => string,
    queryForm: (forms: (typeof held)[number]) => string,
  ): void => {
    if (usable.length < 2) {
      return;
    }
    for (let count = 0; count < (options.groupCases ?? 100); count += 1) {
      const [given, family] = groupStream.sample(usable, 2);
      if (given === undefined || family === undefined) {
        return;
      }
      const entryId = `HO-G-${pad(entries.length + 1)}`;
      const birthdate = date(groupStream);
      entries.push(
        person(
          entryId,
          [latinName(capitalise(listedForm(given)), null, capitalise(listedForm(family)))],
          birthdate,
          groupStream.pick(SYNTHETIC_COUNTRIES),
        ),
      );
      const ids = [given.group.id, family.group.id];
      ids.forEach((id) => groupIds.add(id));
      addCase(
        'person',
        source,
        withDate(
          nameQuery(capitalise(queryForm(given)), null, capitalise(queryForm(family))),
          birthdate,
        ),
        entryId,
        ids,
      );
    }
  };
  groupCase(
    'held_out_group_cross_script',
    held.filter((forms) => forms.latin.length > 0 && forms.other.length > 0),
    (forms) => forms.latin[0] ?? '',
    (forms) => groupStream.pick(forms.other),
  );
  groupCase(
    'held_out_group_same_script',
    held.filter((forms) => forms.latin.length > 1),
    (forms) => forms.latin[0] ?? '',
    (forms) => groupStream.pick(forms.latin.slice(1)),
  );

  return {
    seed: options.seed,
    list: normalisedImport(HELD_OUT_SOURCE, '2026-01-01T00:00:00Z', entries),
    cases,
    customers: syntheticCustomers({
      seed: `${options.seed}/customers`,
      count: options.customers ?? 1000,
      ...(options.groups === undefined ? {} : { groups: options.groups }),
    }),
    heldOutGroupIds: [...groupIds],
  };
}
