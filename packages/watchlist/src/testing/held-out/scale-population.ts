/**
 * Owner decision 5 after Workflow 6B (H21, V12): a held-out set that can measure false alerts.
 * The 6B set's list is sparse in name space (fictional names, each rare), so no customer could
 * alert on it. These populations are drawn from a heavy-headed (Zipf-like) law over name forms,
 * so common names are common, as on real lists and among real customers:
 *
 * - **listed persons and companies**, each with one variant case (order swap, dropped and added
 *   middle names, initials, a typo, an adjacent transposition, a legal form written another way);
 *   the benchmark embeds them in the 100,000- and 2,000,000-name performance tables, where the
 *   document-frequency bound of retrieval acts;
 * - **customers**, persons and companies, drawn from the same law with no listed identity.
 *
 * **Ground truth is by construction.** A case's expected entry is the identity it was varied from.
 * A customer alert is false: no customer was generated as a variant of a listed identity. A
 * namesake is a false alert, as screening practice counts it, except a customer equal to a listed
 * entry in name and birth date (a company: in name, and in country when the customer states one),
 * whom no screening on those fields can tell apart: `indistinguishableCustomers` finds them, and
 * they are reported apart from the false-alert rate.
 *
 * Generated at evaluation time from the evaluation seed and never committed. `watchlist-matcher`
 * never reads this folder, and this folder never reads `src/{names,translit,keys,score,match}`.
 */
import type { WatchlistRecord } from '../../record/index.js';
import { SYNTHETIC_LEGAL_FORMS, fictionalFamilyName, fictionalGivenName } from '../names.js';
import { seededRandom, type SeededRandom } from '../random.js';
import { SYNTHETIC_COUNTRIES } from '../records.js';
import { formsByScript, type VariantGroup } from './groups.js';
import { initialOf, otherLegalForm, withTypo, type TypoKind } from './variants.js';

/** One name form a law draws: its Latin spellings, the first the usual one. */
export interface LawForm {
  readonly latin: readonly string[];
}

/** A heavy-headed law over person name forms; given and family names are ranked apart. */
export interface PersonNameLaw {
  given(random: SeededRandom): LawForm;
  family(random: SeededRandom): LawForm;
}

/** A company name a law draws. */
export interface CompanyForm {
  /** The distinctive words. */
  readonly words: readonly string[];
  /** A generic word (`Holdings`), or `null`. */
  readonly generic: string | null;
  /** The legal form as written. */
  readonly legalForm: string;
}

/** A heavy-headed law over company names. */
export interface CompanyNameLaw {
  name(random: SeededRandom): CompanyForm;
}

/** The person variant sources of the scale population, taken in turn. */
export const SCALE_PERSON_SOURCES = [
  'exact',
  'order_swap',
  'dropped_middle',
  'added_middle',
  'initials',
  'typo',
  'transposition',
] as const;

/** The company variant sources of the scale population, taken in turn. */
export const SCALE_COMPANY_SOURCES = ['exact', 'typo', 'transposition', 'legal_form'] as const;

export type ScaleVariantSource =
  (typeof SCALE_PERSON_SOURCES)[number] | (typeof SCALE_COMPANY_SOURCES)[number];

/** The typo or transposition a case carries, and the length of the token before it. */
export interface ScaleEdit {
  readonly kind: TypoKind;
  readonly length: number;
}

/** One query aimed at a listed identity. */
export interface ScaleCase {
  readonly id: string;
  readonly subject: 'person' | 'business';
  readonly variantSource: ScaleVariantSource;
  /** The query in the public request shape (`watchlist` or `business-watchlist`). */
  readonly query: Readonly<Record<string, string>>;
  readonly expectedEntryId: string;
  readonly edit: ScaleEdit | null;
}

/** One customer, never listed. */
export interface ScaleCustomer {
  readonly id: string;
  readonly subject: 'person' | 'business';
  readonly query: Readonly<Record<string, string>>;
}

export interface ScalePopulation {
  readonly seed: string;
  /** The listed persons, then the listed companies. */
  readonly entries: readonly WatchlistRecord[];
  readonly cases: readonly ScaleCase[];
  /** The person customers, then the company customers. */
  readonly customers: readonly ScaleCustomer[];
}

export interface ScalePopulationOptions {
  /** The evaluation seed. */
  readonly seed: string;
  readonly persons: number;
  readonly companies: number;
  readonly customers: number;
  readonly businessCustomers: number;
  /** The person name law; the benchmark passes its table's own law. */
  readonly law: PersonNameLaw;
  /** The company name law (default `zipfCompanyLaw` from the seed). */
  readonly companyLaw?: CompanyNameLaw;
  /** The share of persons with a middle name, listed and customers alike (default 0.3). */
  readonly middleShare?: number;
  /** The share of listed persons whose entry carries their birth date (default 0.85). */
  readonly birthDateShare?: number;
  /** The prefix of every id (default `HZ-`); the tables' own entries never carry it. */
  readonly idPrefix?: string;
}

/** A sampler of ranks 0 to `size - 1` with weights `1 / (rank + 1) ** exponent`. */
export function zipfRank(size: number, exponent = 1): (random: SeededRandom) => number {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('the range is empty');
  }
  const cumulative = new Float64Array(size);
  let total = 0;
  for (let rank = 0; rank < size; rank += 1) {
    total += 1 / (rank + 1) ** exponent;
    cumulative[rank] = total;
  }
  return (random) => {
    const target = random.next() * total;
    let low = 0;
    let high = size - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((cumulative[middle] ?? total) <= target) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  };
}

/** A law drawing `items` by Zipf ranks, one rank order per role, each shuffled by the seed. */
function rankedLaw<Item>(
  random: SeededRandom,
  items: readonly Item[],
  roles: readonly string[],
  exponent: number,
): Record<string, (stream: SeededRandom) => Item> {
  const draw = zipfRank(items.length, exponent);
  const positions = items.map((_, index) => index);
  return Object.fromEntries(
    roles.map((role) => {
      const order = random.fork(role).shuffle(positions);
      return [role, (stream: SeededRandom) => items[order[draw(stream)] ?? 0] as Item];
    }),
  );
}

/** A Zipf law over the groups' single-word Latin forms and fictional names. */
export function zipfPersonLaw(options: {
  readonly seed: string;
  readonly groups?: readonly VariantGroup[];
  readonly fictional?: number;
  readonly exponent?: number;
}): PersonNameLaw {
  const random = seededRandom(`held-out/scale/person-law/${options.seed}`);
  const items: LawForm[] = (options.groups ?? []).flatMap((group) => {
    const { latin } = formsByScript(group);
    return latin.length === 0 ? [] : [{ latin }];
  });
  const names = random.fork('fictional');
  for (let index = 0; index < (options.fictional ?? 2000); index += 1) {
    const token = index % 2 === 0 ? fictionalGivenName(names) : fictionalFamilyName(names);
    items.push({ latin: [token.latin] });
  }
  const law = rankedLaw(random, items, ['given', 'family'], options.exponent ?? 1);
  const given = law.given;
  const family = law.family;
  if (given === undefined || family === undefined) {
    throw new Error('a person law needs both roles');
  }
  return { given, family };
}

/** Generic words of company names (our own list), drawn by their own law. */
const COMPANY_GENERIC_WORDS: readonly string[] = [
  'Holdings',
  'Trading',
  'Group',
  'International',
  'Industries',
  'Capital',
  'Logistics',
  'Shipping',
  'Energy',
  'Resources',
  'Ventures',
  'Systems',
  'Services',
  'Investments',
  'Engineering',
  'Partners',
];

/** A Zipf law over fictional distinctive words, generic words and legal forms. */
export function zipfCompanyLaw(options: {
  readonly seed: string;
  readonly words?: number;
  readonly exponent?: number;
}): CompanyNameLaw {
  const random = seededRandom(`held-out/scale/company-law/${options.seed}`);
  const names = random.fork('words');
  const words = new Set<string>();
  const wanted = options.words ?? 4000;
  for (let attempt = 0; words.size < wanted && attempt < wanted * 20; attempt += 1) {
    words.add(fictionalGivenName(names).latin);
  }
  const exponent = options.exponent ?? 1;
  const word = rankedLaw(random, [...words], ['word'], exponent).word;
  const generic = rankedLaw(random, COMPANY_GENERIC_WORDS, ['generic'], exponent).generic;
  const form = rankedLaw(random, SYNTHETIC_LEGAL_FORMS, ['form'], exponent).form;
  if (word === undefined || generic === undefined || form === undefined) {
    throw new Error('a company law needs its words, generic words and legal forms');
  }
  return {
    name: (stream) => ({
      words: Array.from({ length: stream.chance(0.4) ? 2 : 1 }, () => word(stream)),
      generic: stream.chance(0.6) ? generic(stream) : null,
      legalForm: form(stream),
    }),
  };
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');
const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const birthdate = (random: SeededRandom): string =>
  `${String(random.between(1940, 2005))}-${pad(random.between(1, 12), 2)}-${pad(random.between(1, 28), 2)}`;

/** A form's usual spelling, capitalised as a list prints it. */
const usual = (form: LawForm): string => capitalise(form.latin[0] ?? '');
/** Any of a form's spellings, as a customer may write it. */
const anySpelling = (random: SeededRandom, form: LawForm): string =>
  capitalise(random.pick(form.latin.length === 0 ? [''] : form.latin));

/** Draws until `accept` holds: a typo needs a token of three characters or more. */
function drawUntil<Value>(draw: () => Value, accept: (value: Value) => boolean): Value {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const value = draw();
    if (accept(value)) {
      return value;
    }
  }
  throw new RangeError('the law gives no name a typo can be made in');
}

const TYPO_KINDS_WITHOUT_TRANSPOSITION = ['substitute', 'insert', 'delete'] as const;

const nameQuery = (first: string, middle: string | null, last: string): Record<string, string> => ({
  'name-first': first,
  ...(middle === null ? {} : { 'name-middle': middle }),
  'name-last': last,
});

function individual(
  entryId: string,
  name: { given: string; middle: string | null; family: string },
  dates: readonly string[],
  country: string,
): WatchlistRecord {
  return {
    entry_id: entryId,
    kind: 'individual',
    names: [
      {
        full: [name.given, name.middle, name.family].filter((part) => part !== null).join(' '),
        parts: [
          { role: 'given', value: name.given },
          ...(name.middle === null ? [] : [{ role: 'middle' as const, value: name.middle }]),
          { role: 'family', value: name.family },
        ],
        script: 'latin',
        quality: 'strong',
        primary: true,
      },
    ],
    birth_dates: dates.map((value) => ({ value, precision: 'day' as const })),
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

const companyText = (company: CompanyForm, legalForm: string | null = company.legalForm): string =>
  [...company.words, company.generic, legalForm].filter((part) => part !== null).join(' ');

/** The listed population, its cases and the customers. */
export function generateScalePopulation(options: ScalePopulationOptions): ScalePopulation {
  const random = seededRandom(`held-out/scale/${options.seed}`);
  const prefix = options.idPrefix ?? 'HZ-';
  const middleShare = options.middleShare ?? 0.3;
  const birthDateShare = options.birthDateShare ?? 0.85;
  const { law } = options;
  const companyLaw = options.companyLaw ?? zipfCompanyLaw({ seed: options.seed });
  const entries: WatchlistRecord[] = [];
  const cases: ScaleCase[] = [];
  const addCase = (item: Omit<ScaleCase, 'id'>): void => {
    cases.push({ id: `${prefix}Q-${pad(cases.length + 1, 6)}`, ...item });
  };

  for (let index = 0; index < options.persons; index += 1) {
    const stream = random.fork(`person-${String(index)}`);
    const source = SCALE_PERSON_SOURCES[index % SCALE_PERSON_SOURCES.length] ?? 'exact';
    const given = usual(law.given(stream));
    const typed = source === 'typo' || source === 'transposition';
    const family = typed
      ? drawUntil(
          () => usual(law.family(stream)),
          (token) => token.length >= 3,
        )
      : usual(law.family(stream));
    const middle =
      source === 'dropped_middle'
        ? usual(law.given(stream))
        : source !== 'added_middle' && stream.chance(middleShare)
          ? usual(law.given(stream))
          : null;
    const date = birthdate(stream);
    const entryId = `${prefix}P-${pad(index + 1, 6)}`;
    entries.push(
      individual(
        entryId,
        { given, middle, family },
        stream.chance(birthDateShare) ? [date] : [],
        stream.pick(SYNTHETIC_COUNTRIES),
      ),
    );
    let query: Record<string, string>;
    let edit: ScaleEdit | null = null;
    switch (source) {
      case 'order_swap':
        query = nameQuery(family, middle, given);
        break;
      case 'dropped_middle':
        query = nameQuery(given, null, family);
        break;
      case 'added_middle':
        query = nameQuery(given, usual(law.given(stream)), family);
        break;
      case 'initials':
        query = nameQuery(initialOf(given), middle, family);
        break;
      case 'typo':
      case 'transposition': {
        const kind =
          source === 'typo' ? stream.pick(TYPO_KINDS_WITHOUT_TRANSPOSITION) : 'transpose';
        edit = { kind, length: family.length };
        query = nameQuery(given, middle, withTypo(stream, family, kind));
        break;
      }
      default:
        query = nameQuery(given, middle, family);
    }
    addCase({
      subject: 'person',
      variantSource: source,
      query: { ...query, birthdate: date },
      expectedEntryId: entryId,
      edit,
    });
  }

  for (let index = 0; index < options.companies; index += 1) {
    const stream = random.fork(`company-${String(index)}`);
    const source = SCALE_COMPANY_SOURCES[index % SCALE_COMPANY_SOURCES.length] ?? 'exact';
    const typed = source === 'typo' || source === 'transposition';
    const company = typed
      ? drawUntil(
          () => companyLaw.name(stream),
          (name) => (name.words[0] ?? '').length >= 3,
        )
      : companyLaw.name(stream);
    const entryId = `${prefix}C-${pad(index + 1, 6)}`;
    entries.push({
      ...individual(entryId, { given: '', middle: null, family: '' }, [], 'GB'),
      kind: 'entity',
      names: [
        {
          full: companyText(company),
          parts: [],
          script: 'latin',
          quality: 'strong',
          primary: true,
        },
      ],
      countries: [{ code: stream.pick(SYNTHETIC_COUNTRIES), role: 'registration' }],
    });
    let term = companyText(company);
    let edit: ScaleEdit | null = null;
    if (typed) {
      const [first = '', ...rest] = company.words;
      const kind = source === 'typo' ? stream.pick(TYPO_KINDS_WITHOUT_TRANSPOSITION) : 'transpose';
      edit = { kind, length: first.length };
      term = companyText({ ...company, words: [withTypo(stream, first, kind), ...rest] });
    } else if (source === 'legal_form') {
      term = companyText(company, otherLegalForm(stream, company.legalForm));
    }
    addCase({
      subject: 'business',
      variantSource: source,
      query: { term },
      expectedEntryId: entryId,
      edit,
    });
  }

  const customers: ScaleCustomer[] = [];
  for (let index = 0; index < options.customers; index += 1) {
    const stream = random.fork(`customer-${String(index)}`);
    const given = anySpelling(stream, law.given(stream));
    const family = anySpelling(stream, law.family(stream));
    const middle = stream.chance(middleShare) ? anySpelling(stream, law.given(stream)) : null;
    const date = birthdate(stream);
    customers.push({
      id: `${prefix}K-${pad(index + 1, 7)}`,
      subject: 'person',
      query: {
        ...nameQuery(given, middle, family),
        birthdate: date,
        ...(stream.chance(0.5) ? { 'address-country-code': stream.pick(SYNTHETIC_COUNTRIES) } : {}),
      },
    });
  }
  for (let index = 0; index < options.businessCustomers; index += 1) {
    const stream = random.fork(`business-${String(index)}`);
    const term = companyText(companyLaw.name(stream));
    customers.push({
      id: `${prefix}B-${pad(index + 1, 7)}`,
      subject: 'business',
      query: {
        term,
        ...(stream.chance(0.5) ? { 'address-country-code': stream.pick(SYNTHETIC_COUNTRIES) } : {}),
      },
    });
  }

  return { seed: options.seed, entries, cases, customers };
}

/** A name as a sorted bag of folded tokens: what screening on the name alone can compare. */
export function nameKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '')
    .sort()
    .join(' ');
}

const customerName = (customer: ScaleCustomer): string =>
  customer.subject === 'business'
    ? (customer.query.term ?? '')
    : [customer.query['name-first'], customer.query['name-middle'], customer.query['name-last']]
        .filter((part) => part !== undefined)
        .join(' ');

/**
 * The customers no screening on their fields can tell apart from a listed entry: a person equal to
 * an individual in name and birth date; a company equal to an entity in name, and in country when
 * the customer states one. Customer id to the first such entry's id.
 */
export function indistinguishableCustomers(
  customers: readonly ScaleCustomer[],
  entries: Iterable<WatchlistRecord>,
): Map<string, string> {
  const wanted = new Map<string, string[]>();
  const want = (key: string, id: string): void => {
    wanted.set(key, [...(wanted.get(key) ?? []), id]);
  };
  for (const customer of customers) {
    const name = nameKey(customerName(customer));
    if (customer.subject === 'person') {
      if (customer.query.birthdate !== undefined) {
        want(`P|${name}|${customer.query.birthdate}`, customer.id);
      }
    } else {
      want(`B|${name}|${customer.query['address-country-code'] ?? '*'}`, customer.id);
    }
  }
  const found = new Map<string, string>();
  const take = (key: string, entryId: string): void => {
    for (const id of wanted.get(key) ?? []) {
      if (!found.has(id)) {
        found.set(id, entryId);
      }
    }
  };
  for (const entry of entries) {
    for (const listed of entry.names) {
      const name = nameKey(listed.full);
      if (entry.kind === 'individual') {
        for (const date of entry.birth_dates) {
          take(`P|${name}|${date.value}`, entry.entry_id);
        }
      } else if (entry.kind === 'entity') {
        take(`B|${name}|*`, entry.entry_id);
        for (const country of entry.countries) {
          if (country.code !== null) {
            take(`B|${name}|${country.code}`, entry.entry_id);
          }
        }
      }
    }
  }
  return new Map([...found].sort(([left], [right]) => left.localeCompare(right)));
}
