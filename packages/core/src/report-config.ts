/**
 * Report template configuration vocabulary and defaults (plan C71.2, C79-C82). The template
 * schema itself is `reportTemplateConfigSchema(type)` in `@openverify/contracts`; this module
 * holds what the domain shares: the option values, the bounds and every default with its basis
 * and source. Every value is provisional (C71.2); the resolved configuration is served.
 */
import type { ThresholdBasis } from './check-config/basis.js';
import type { ReportType } from './report-registry.js';

/** C79.1: what counts as a birthdate agreement. */
export const BIRTHDATE_MATCHING_MODES = [
  'exact_date',
  'exact_year',
  'year_plus_minus_one',
] as const;
export type BirthdateMatchingMode = (typeof BIRTHDATE_MATCHING_MODES)[number];

/** C79.1: a disagreeing qualifier is ignored, lowers the score (default) or drops the candidate. */
export const REPORT_FILTER_MODES = ['off', 'penalty', 'strict'] as const;
export type ReportFilterMode = (typeof REPORT_FILTER_MODES)[number];

/** C79.1: the person countries a `watchlist` compares with the query's country. */
export const PERSON_COUNTRY_FIELDS = [
  'birthplace',
  'citizenship',
  'nationality',
  'residency',
] as const;
export type PersonCountryField = (typeof PERSON_COUNTRY_FIELDS)[number];

/** C79.2 (ours): the entity countries a `business-watchlist` compares. */
export const BUSINESS_COUNTRY_FIELDS = ['registration', 'address'] as const;
export type BusinessCountryField = (typeof BUSINESS_COUNTRY_FIELDS)[number];

/** C79.2: the entry kinds a `business-watchlist` searches by name. */
export const BUSINESS_ENTITY_KINDS = ['entity', 'vessel', 'aircraft'] as const;
export type BusinessEntityKind = (typeof BUSINESS_ENTITY_KINDS)[number];

/** C80.2: the PEP classes, numbered as the public definitions number them. */
export const PEP_CLASSES = [1, 2, 3, 4] as const;
export type PepClass = (typeof PEP_CLASSES)[number];

/**
 * C81.5 (ours): the adverse-media categories of the authored lexicon
 * (`packages/checks/src/reports/media/`, `risk-logic`). Ids only; the terms are the lexicon's.
 */
export const ADVERSE_MEDIA_CATEGORIES = [
  'financial_crime',
  'fraud',
  'corruption',
  'money_laundering',
  'terrorism',
  'organised_crime',
  'narcotics',
  'violent_crime',
  'cybercrime',
  'property_crime',
  'regulatory',
  'financial_difficulty',
] as const;
export type AdverseMediaCategory = (typeof ADVERSE_MEDIA_CATEGORIES)[number];

/** C71.2, C79-C82: the bounds of the numeric keys, inclusive. */
export const REPORT_CONFIG_BOUNDS = Object.freeze({
  'recurrence-interval-days': { min: 1, max: 365 },
  'resume-delay-minutes': { min: 0, max: 1440 },
  'max-list-age-hours': { min: 1, max: 720 },
  'max-article-age-days': { min: 1, max: 90 },
  'min-domain-age-days': { min: 1, max: 3650 },
  'young-domain-days': { min: 1, max: 3650 },
} as const);

/** A configuration value a default can take. */
export type ReportConfigValue =
  | number
  | boolean
  | string
  | null
  | readonly string[]
  | readonly number[]
  | Readonly<Record<string, string | number | boolean>>;

/** A default with its basis and where its value comes from (C71.2, as `ConfigDefault`). */
export interface ReportConfigDefault {
  readonly value: ReportConfigValue;
  readonly basis: ThresholdBasis;
  readonly source: string;
}

function ours(value: ReportConfigValue, source: string): ReportConfigDefault {
  return Object.freeze({ value, basis: 'provisional', source });
}

type DefaultsTable = Readonly<Record<string, ReportConfigDefault>>;
const table = (entries: Record<string, ReportConfigDefault>): DefaultsTable =>
  Object.freeze(entries);

/** Every type is one-off unless its template schedules it (C71.2). */
const ONE_OFF = {
  'recurrence-interval-days': ours(null, 'C71.2: one-off unless the template schedules runs'),
};

/** C71.2, decision 5: the monitoring keys of a recurrable type. */
const MONITORING = {
  ...ONE_OFF,
  'pause-on-match': ours(
    false,
    'C71.2, decision 5: monitoring continues through a hit; true pauses as the public legacy types do',
  ),
  'resume-delay-minutes': ours(
    30,
    'C71.2: the public 30-minute delay before the next run once every hit is reviewed (M5)',
  ),
};

const RESOLVED_LISTS = ours(
  null,
  'C71.2: resolved into explicit source ids when the template or version is created, then pinned',
);

const SANCTIONS_LISTS = {
  'search-lists': RESOLVED_LISTS,
  'max-list-age-hours': ours(
    48,
    'C71.2, C76.1: the sanctions sources go stale after 48 h without a successful check (H02, F02)',
  ),
};

const PERSON_DATES = {
  'birthdate-matching': ours(
    'year_plus_minus_one',
    'C79.1: the public default, a birth year within one year either side',
  ),
  'birthdate-filter': ours('penalty', 'C79.1, decision 24: a disagreement lowers the score'),
};

const MEDIA = {
  ...MONITORING,
  categories: ours([...ADVERSE_MEDIA_CATEGORIES], 'C81.5: every category of the authored lexicon'),
  'max-article-age-days': ours(90, "C81.5: GDELT DOC 2.0's rolling three-month window"),
  'allowed-countries': ours(null, 'C81.5: articles from every source country'),
};

const WEAK_ALIASES = ours(
  false,
  'C78.4, decision 16 (H10): weak aliases are not screened unless the template turns them on',
);

/** C71.2, C79-C82: every key's default, per type. */
export const REPORT_CONFIG_DEFAULTS: Readonly<Record<ReportType, DefaultsTable>> = Object.freeze({
  watchlist: table({
    ...MONITORING,
    ...SANCTIONS_LISTS,
    'name-matching': ours({ preset: 'tolerant' }, 'C79.1: the research sanctions alert level'),
    ...PERSON_DATES,
    'country-fields': ours([...PERSON_COUNTRY_FIELDS], 'C79.1: every country of the public option'),
    'country-filter': ours('penalty', 'C79.1, decision 24: a disagreement lowers the score'),
    'screen-weak-aliases': WEAK_ALIASES,
  }),
  'business-watchlist': table({
    ...MONITORING,
    ...SANCTIONS_LISTS,
    'name-matching': ours({ preset: 'strict' }, 'C79.2: the public business default (H11)'),
    'country-fields': ours([...BUSINESS_COUNTRY_FIELDS], 'C79.2 (ours): registration and address'),
    'country-filter': ours('penalty', 'C79.2, decision 24: a disagreement lowers the score'),
    'screen-weak-aliases': WEAK_ALIASES,
    'entity-kinds': ours(
      ['entity'],
      'C79.2: businesses by name; an identifier query also searches vessels and aircraft (H06)',
    ),
  }),
  'crypto-address-watchlist': table({ ...MONITORING, ...SANCTIONS_LISTS }),
  'politically-exposed-person': table({
    ...MONITORING,
    'search-lists': RESOLVED_LISTS,
    'max-list-age-hours': ours(
      192,
      "C71.2, C76.1: wikidata-pep's weekly full pass plus a day (H02, F02)",
    ),
    'name-matching': ours({ preset: 'strict' }, 'C80.5: the research PEP alert level, 0.85'),
    'pep-classes': ours([1, 2], 'C80.5: the public default, classes 1 and 2'),
    'include-relatives': ours(false, 'C80.3, C80.5: relatives only when the template asks'),
    'include-unknown-class': ours(false, 'C80.5: a position without a class is left out'),
    'default-country': ours(null, 'C80.5: without a country, every country matches'),
    ...PERSON_DATES,
    'keep-without-birthdate': ours(
      true,
      'C80.5: a PEP with no recorded birthdate is kept, as the public PEP report keeps it',
    ),
  }),
  'adverse-media': table(MEDIA),
  'business-adverse-media': table(MEDIA),
  'email-address': table({
    ...ONE_OFF,
    'min-domain-age-days': ours(
      30,
      'C82.1 (H07): a custom domain younger than this gives domain_recently_registered (low)',
    ),
    'young-domain-days': ours(
      365,
      'C82.1 (H07): a custom domain younger than this gives young_domain (medium)',
    ),
  }),
  'phone-number': table(ONE_OFF),
  'address-lookup': table({
    ...ONE_OFF,
    'send-addressee': ours(
      false,
      'C82.3, decision 42 (P16): the address vendor never receives the addressee unless asked',
    ),
  }),
  // C106.1 (Phase 7): one-off; the network sources it reads are the install's, not configured.
  'ip-address': table(ONE_OFF),
  // C106.2 (Workflow 7B): recurring reports run on their interval; re-screening on a list change
  // waits for Phase 8 (C110).
  'custom-list': table({
    ...MONITORING,
    'list-ids': ours(
      null,
      'C106.2: the lists pinned on the template; null leaves them to each report query',
    ),
  }),
});

/** The default values of one type's keys, for resolving a template's configuration. */
export function reportConfigDefaultValues(
  type: ReportType,
): Readonly<Record<string, ReportConfigValue>> {
  return Object.fromEntries(
    Object.entries(REPORT_CONFIG_DEFAULTS[type]).map(([key, entry]) => [key, entry.value]),
  );
}
