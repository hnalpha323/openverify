/**
 * A report template's configuration in words (C71.2, C79-C82, C86): every key with what it does,
 * each value, the defaults with their basis and source, an API pointer inside the configuration,
 * and every problem a publish can meet (C71.2, C72.4).
 *
 * The test (`config-words.test.ts`) reads the keys from core's `REPORT_CONFIG_DEFAULTS` of every
 * type and the publish codes from the contracts' problem codes, so a key or code added there
 * without words here fails it. This module holds no server-only import: the editor uses it too.
 */
import {
  NAME_MATCHING_PRESET_MINIMUMS,
  REPORT_CONFIG_DEFAULTS,
  type ReportType,
} from '@openverify/core';
import type { DisplayProblem } from '../../lib/action-state';

export type ConfigKey =
  | 'recurrence-interval-days'
  | 'pause-on-match'
  | 'resume-delay-minutes'
  | 'search-lists'
  | 'max-list-age-hours'
  | 'name-matching'
  | 'birthdate-matching'
  | 'birthdate-filter'
  | 'country-fields'
  | 'country-filter'
  | 'screen-weak-aliases'
  | 'entity-kinds'
  | 'pep-classes'
  | 'include-relatives'
  | 'include-unknown-class'
  | 'default-country'
  | 'keep-without-birthdate'
  | 'categories'
  | 'max-article-age-days'
  | 'allowed-countries'
  | 'min-domain-age-days'
  | 'young-domain-days'
  | 'send-addressee'
  | 'list-ids';

interface KeyWords {
  readonly label: string;
  readonly meaning: string;
}

/** C71.2, C79-C82: what each key does. */
export const CONFIG_KEY_WORDS: Readonly<Record<ConfigKey, KeyWords>> = Object.freeze({
  'recurrence-interval-days': {
    label: 'Recurrence',
    meaning: 'Each report runs again every this many days; null runs it once.',
  },
  'pause-on-match': {
    label: 'Pause on match',
    meaning:
      'A run that brings a new open match pauses monitoring until every open match is reviewed.',
  },
  'resume-delay-minutes': {
    label: 'Resume delay',
    meaning:
      'Once every open match is reviewed, a report paused on a match runs again after this delay.',
  },
  'search-lists': {
    label: 'Lists searched',
    meaning:
      'The sources screened, pinned when the version is saved. Leave it out to pin every enabled source of the type’s kind.',
  },
  'max-list-age-hours': {
    label: 'Maximum list age',
    meaning:
      'A selected source not checked successfully within this many hours (or its own stale limit) makes the report error list_stale.',
  },
  'name-matching': {
    label: 'Name matching',
    meaning: 'The preset: exact, strict, tolerant, or custom with its own minimum score and rules.',
  },
  'birthdate-matching': {
    label: 'Birth date agreement',
    meaning: 'What counts as the same birth date.',
  },
  'birthdate-filter': {
    label: 'Birth date filter',
    meaning:
      'What a disagreeing birth date does: nothing, lowers the score, or drops the candidate.',
  },
  'country-fields': {
    label: 'Countries compared',
    meaning: 'The entry’s countries compared with the query’s country.',
  },
  'country-filter': {
    label: 'Country filter',
    meaning: 'What a disagreeing country does: nothing, lowers the score, or drops the candidate.',
  },
  'screen-weak-aliases': {
    label: 'Screen weak aliases',
    meaning:
      'A weak alias matches only with an exact birth date or an agreeing identifier, at a fixed 0.90.',
  },
  'entity-kinds': {
    label: 'Entity kinds',
    meaning:
      'The entries screened by name; an IMO, MMSI or aircraft identifier searches vessels or aircraft whatever this says.',
  },
  'pep-classes': { label: 'PEP classes', meaning: 'The classes of office holders screened.' },
  'include-relatives': {
    label: 'Include relatives',
    meaning: 'Also screens the relatives the install synced.',
  },
  'include-unknown-class': {
    label: 'Include positions without a class',
    meaning: 'Also screens positions the class table does not place.',
  },
  'default-country': {
    label: 'Default country',
    meaning: 'The country assumed when the query states none.',
  },
  'keep-without-birthdate': {
    label: 'Keep holders without a birth date',
    meaning: 'A holder with no recorded birth date is not filtered out.',
  },
  categories: {
    label: 'Categories',
    meaning: 'The lexicon categories searched and counted.',
  },
  'max-article-age-days': {
    label: 'Maximum article age',
    meaning: 'Measured on the date GDELT saw the article.',
  },
  'allowed-countries': {
    label: 'Allowed source countries',
    meaning: 'Keeps only articles from these source countries.',
  },
  'min-domain-age-days': {
    label: 'Minimum domain age',
    meaning: 'A custom domain younger than this gives domain_recently_registered (low).',
  },
  'young-domain-days': {
    label: 'Young domain',
    meaning: 'A custom domain younger than this gives young_domain (medium).',
  },
  'send-addressee': {
    label: 'Send the addressee',
    meaning: 'Sends the addressee to the address provider; by default only the address is sent.',
  },
  // C106.2 (Workflow 7B).
  'list-ids': {
    label: 'Lists',
    meaning:
      'The lists every report of this template screens; without them each report names its own.',
  },
});

const isConfigKey = (key: string): key is ConfigKey => Object.hasOwn(CONFIG_KEY_WORDS, key);

/** C79.1: the name-matching sub-keys. */
const NAME_MATCHING_WORDS: Readonly<Record<string, string>> = Object.freeze({
  preset: 'preset',
  'min-score': 'minimum score',
  'allow-nicknames': 'nicknames',
  'allow-variants': 'spelling variants',
  'typo-budget': 'typo budget',
});

const ENUM_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'birthdate-matching': {
    exact_date: 'Exact date',
    exact_year: 'Exact year',
    year_plus_minus_one: 'Year ± 1',
  },
  'birthdate-filter': {
    off: 'Off: a disagreement is ignored',
    penalty: 'Penalty: a disagreement lowers the score',
    strict: 'Strict: a disagreeing candidate is dropped',
  },
});
const FILTER_KEYS = ['birthdate-filter', 'country-filter'];

/** `financial_crime` → `Financial crime`; ids are snake_case words. */
const humanise = (id: string) => {
  const words = id.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};
const sentenceList = (values: readonly string[]) =>
  values.map((value, index) => (index === 0 ? humanise(value) : value.replaceAll('_', ' ')));

function nameMatchingWords(value: Readonly<Record<string, unknown>>): string {
  const preset = value.preset;
  if (preset === 'exact') {
    return 'Exact: a list name equal to a subject name, no score';
  }
  if (preset === 'strict' || preset === 'tolerant') {
    const minimum = NAME_MATCHING_PRESET_MINIMUMS[preset];
    return `${humanise(preset)}, minimum score ${String(minimum?.value)}`;
  }
  const parts = [`Custom, minimum score ${String(value['min-score'])}`];
  if (typeof value['allow-nicknames'] === 'boolean') {
    parts.push(value['allow-nicknames'] ? 'nicknames allowed' : 'no nicknames');
  }
  if (typeof value['allow-variants'] === 'boolean') {
    parts.push(value['allow-variants'] ? 'spelling variants allowed' : 'no spelling variants');
  }
  if (typeof value['typo-budget'] === 'string') {
    parts.push(`typo budget ${value['typo-budget']}`);
  }
  return parts.join('; ');
}

const UNITS: Readonly<Record<string, string>> = Object.freeze({
  'max-list-age-hours': 'hours',
  'resume-delay-minutes': 'minutes',
  'max-article-age-days': 'days',
  'min-domain-age-days': 'days',
  'young-domain-days': 'days',
});

/** A configuration value in words; a value it has no words for is shown as its JSON. */
export function describeConfigValue(key: string, value: unknown): string {
  if (key === 'recurrence-interval-days') {
    if (value === null) {
      return 'Runs once';
    }
    return typeof value === 'number' ? `Every ${String(value)} days` : JSON.stringify(value);
  }
  if (key === 'allowed-countries' && value === null) {
    return 'Any country';
  }
  if (value === null) {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number' && UNITS[key] !== undefined) {
    return `${String(value)} ${UNITS[key]}`;
  }
  if (key === 'name-matching' && typeof value === 'object' && !Array.isArray(value)) {
    return nameMatchingWords(value as Record<string, unknown>);
  }
  if (typeof value === 'string') {
    const words = ENUM_WORDS[FILTER_KEYS.includes(key) ? 'birthdate-filter' : key]?.[value];
    return words ?? value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'None';
    }
    if (key === 'pep-classes') {
      return `Classes ${value.join(', ')}`;
    }
    if (['country-fields', 'entity-kinds', 'categories'].includes(key)) {
      return sentenceList(value as string[]).join(', ');
    }
    return value.map(String).join(', ');
  }
  return JSON.stringify(value);
}

/**
 * A served configuration as a record. The contract types a version's `config` per report type
 * (a union the type cannot narrow), and the API serves an object; anything else reads as empty.
 */
export function configRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A JSON value with object keys sorted, so two equal values compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    member !== null && typeof member === 'object' && !Array.isArray(member)
      ? Object.fromEntries(
          Object.entries(member as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : member,
  );
}

/**
 * What a version sets (the editor starts from it): its resolved configuration less the keys at
 * their default, compared by value. The pinned `search-lists` is always kept (C71.2): its default
 * means "resolved when the version is saved".
 */
export function explicitConfig(
  type: ReportType,
  resolved: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const defaults = REPORT_CONFIG_DEFAULTS[type];
  return Object.fromEntries(
    Object.entries(resolved).filter(
      ([key, value]) =>
        key === 'search-lists' ||
        defaults[key] === undefined ||
        canonical(defaults[key].value) !== canonical(value),
    ),
  );
}

export interface ResolvedConfigRow {
  readonly key: string;
  readonly label: string;
  readonly meaning: string;
  readonly value: string;
  readonly isDefault: boolean;
  /** The default in words, or `null` when none applies (the pinned source lists). */
  readonly defaultValue: string | null;
  readonly basis: string | null;
  readonly source: string | null;
}

/** The resolved configuration beside the editor: every key in words with its default (C71.2). */
export function resolvedConfigRows(
  type: ReportType,
  resolved: Readonly<Record<string, unknown>>,
): ResolvedConfigRow[] {
  const defaults = REPORT_CONFIG_DEFAULTS[type];
  const keys = [
    ...Object.keys(defaults).filter((key) => Object.hasOwn(resolved, key)),
    ...Object.keys(resolved).filter((key) => defaults[key] === undefined),
  ];
  return keys.map((key) => {
    const words = isConfigKey(key) ? CONFIG_KEY_WORDS[key] : { label: key, meaning: '' };
    const entry = defaults[key];
    const pinned = key === 'search-lists';
    return {
      key,
      label: words.label,
      meaning: words.meaning,
      value: describeConfigValue(key, resolved[key]),
      isDefault:
        !pinned && entry !== undefined && canonical(entry.value) === canonical(resolved[key]),
      defaultValue: pinned || entry === undefined ? null : describeConfigValue(key, entry.value),
      basis: entry?.basis ?? null,
      source: entry?.source ?? null,
    };
  });
}

const decode = (segment: string) => segment.replaceAll('~1', '/').replaceAll('~0', '~');

/**
 * A JSON Pointer inside the configuration (`/search-lists/1`) in words; an item of the source
 * lists is named by the id at that place in `searchLists`, when known.
 */
export function configPointerLabel(pointer: string, searchLists: readonly string[] = []): string {
  const [key, ...rest] = pointer.split('/').slice(1).map(decode);
  if (key === undefined || key === '') {
    return 'The configuration';
  }
  const label = isConfigKey(key) ? CONFIG_KEY_WORDS[key].label : key;
  const [member] = rest;
  if (member === undefined) {
    return label;
  }
  if (/^\d+$/.test(member)) {
    const index = Number(member);
    const id = key === 'search-lists' ? searchLists[index] : undefined;
    return `${label}, item ${String(index + 1)}${id === undefined ? '' : ` (${id})`}`;
  }
  return `${label}: ${NAME_MATCHING_WORDS[member] ?? member}`;
}

/** C71.2, C72.4: the publish problems with codes of their own. */
export const PUBLISH_PROBLEM_CODES = [
  'watchlist_sources_empty',
  'watchlist_source_unknown',
  'watchlist_source_not_allowed',
] as const;
type PublishProblemCode = (typeof PUBLISH_PROBLEM_CODES)[number];

export interface PublishProblem {
  readonly status: number;
  readonly code: string | null;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
  readonly errors?: readonly { readonly pointer: string; readonly detail: string }[] | undefined;
}

const CONFIG_POINTER = '/data/attributes/config';

const PUBLISH_WORDS: Readonly<Record<PublishProblemCode, { title: string; detail: string }>> =
  Object.freeze({
    watchlist_sources_empty: {
      title: 'The draft selects no list',
      detail:
        'Its reports would screen nothing, and a search of nothing can never answer no match honestly, so it is not published. Add at least one enabled source to search-lists (or leave the key out to pin them all), save the draft, then publish.',
    },
    watchlist_source_unknown: {
      title: 'The draft selects a source the manifest does not know',
      detail:
        'Correct or remove it in search-lists, save the draft, then publish. The watchlist sources page lists every source.',
    },
    watchlist_source_not_allowed: {
      title: 'The draft selects a source it may not screen here',
      detail:
        'A sandbox-only list is never screened in a production environment, and a report type screens only sources of its own kind. Remove it from search-lists, save the draft, then publish.',
    },
  });

const LIST_AGE = {
  title: 'The maximum list age is shorter than a selected source’s refresh interval',
  detail:
    'Such a source would go stale between its refreshes and its reports would error list_stale. Raise max-list-age-hours to at least the interval named below, save the draft, then publish.',
};

const NOT_DRAFT = {
  title: 'This version is no longer a draft',
  detail:
    'Only a draft can be published; it may have been published or superseded since this page was opened. Reload the page.',
};

const isPublishCode = (code: string | null): code is PublishProblemCode =>
  code !== null && (PUBLISH_PROBLEM_CODES as readonly string[]).includes(code);

/**
 * A refused publish in words (C71.2, C72.4): each code's title and what to do, and each error at
 * its place in the configuration, named in words. Any other problem keeps the API's words.
 */
export function publishProblemInWords(
  problem: PublishProblem,
  searchLists: readonly string[],
): DisplayProblem {
  const errors = (problem.errors ?? []).map((error) => ({
    pointer: error.pointer,
    detail: error.pointer.startsWith(CONFIG_POINTER)
      ? `${configPointerLabel(error.pointer.slice(CONFIG_POINTER.length) || '/', searchLists)}: ${error.detail}`
      : error.detail,
  }));
  const ageError = (problem.errors ?? []).some(
    (error) => error.pointer === `${CONFIG_POINTER}/max-list-age-hours`,
  );
  const words = isPublishCode(problem.code)
    ? PUBLISH_WORDS[problem.code]
    : problem.status === 422 && ageError
      ? LIST_AGE
      : problem.status === 409
        ? NOT_DRAFT
        : { title: problem.title, detail: problem.detail };
  return {
    title: words.title,
    ...(words.detail === undefined ? {} : { detail: words.detail }),
    status: problem.status,
    ...(problem.requestId === undefined ? {} : { requestId: problem.requestId }),
    ...(errors.length === 0 ? {} : { errors }),
  };
}
