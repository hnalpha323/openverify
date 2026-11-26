/**
 * Report template configuration (plan C71.2, C79-C82): `reportTemplateConfigSchema(type)`, strict
 * and kebab-case, and the resolved configuration a version serves. The defaults, with their basis
 * and source, are `REPORT_CONFIG_DEFAULTS` in `@openverify/core`; every value is provisional.
 *
 * Rules that need more than the body (a source the manifest does not know, a sandbox-only source
 * in production, an empty list, a list age below a source's refresh interval) are the publish
 * rules of C71.2, answered 422 with their problem codes; so an empty `search-lists` passes here.
 */
import {
  ADVERSE_MEDIA_CATEGORIES,
  BIRTHDATE_MATCHING_MODES,
  BUSINESS_COUNTRY_FIELDS,
  BUSINESS_ENTITY_KINDS,
  CUSTOM_MIN_SCORE_RANGE,
  LIST_LIMITS,
  PEP_CLASSES,
  PERSON_COUNTRY_FIELDS,
  REPORT_CONFIG_BOUNDS,
  REPORT_FILTER_MODES,
  REPORT_REGISTRY,
  REPORT_TYPES,
  reportConfigDefaultValues,
  typoBudgetSchema,
  type ReportType,
} from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';

/** A manifest source id (C76.1), such as `ofac-sdn` or `openverify-sandbox`. */
export const watchlistSourceIdSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'must be a source id such as ofac-sdn')
  .max(64);

/** C106.2 (a C70.2 amendment): a report source is a watchlist source or one of the operator's lists. */
export const reportSourceIdSchema = z.union([watchlistSourceIdSchema, idSchema('lst')]);

const MAX_SEARCH_LISTS = 32;

/** Distinct values; an empty list is the publish rule's to refuse (V01). */
const distinct = <Item extends z.ZodType>(item: Item, min = 0, max = 32) =>
  z
    .array(item)
    .min(min)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'must not contain duplicates');

const bounded = (key: keyof typeof REPORT_CONFIG_BOUNDS) =>
  z.int().min(REPORT_CONFIG_BOUNDS[key].min).max(REPORT_CONFIG_BOUNDS[key].max);

/** C79.1: a preset, or `custom` with its own minimum and rules. */
export const nameMatchingConfigSchema = z.discriminatedUnion('preset', [
  z.strictObject({ preset: z.literal('exact') }),
  z.strictObject({ preset: z.literal('strict') }),
  z.strictObject({ preset: z.literal('tolerant') }),
  z.strictObject({
    preset: z.literal('custom'),
    'min-score': z.number().min(CUSTOM_MIN_SCORE_RANGE.min).max(CUSTOM_MIN_SCORE_RANGE.max),
    'allow-nicknames': z.boolean().optional(),
    'allow-variants': z.boolean().optional(),
    'typo-budget': typoBudgetSchema.optional(),
  }),
]);

/** C71.2: a recurrable type's monitoring keys. */
const MONITORING = {
  'recurrence-interval-days': bounded('recurrence-interval-days').nullable(),
  'pause-on-match': z.boolean(),
  'resume-delay-minutes': bounded('resume-delay-minutes'),
};

/** C71.2: a type that does not recur runs once. */
const ONE_OFF = {
  'recurrence-interval-days': z.null({ error: 'this report type does not recur' }),
};

const LISTS = {
  'search-lists': distinct(watchlistSourceIdSchema, 0, MAX_SEARCH_LISTS),
  'max-list-age-hours': bounded('max-list-age-hours'),
};

const PERSON_DATES = {
  'birthdate-matching': z.enum(BIRTHDATE_MATCHING_MODES),
  'birthdate-filter': z.enum(REPORT_FILTER_MODES),
};

const MEDIA = {
  ...MONITORING,
  categories: distinct(z.enum(ADVERSE_MEDIA_CATEGORIES), 1, ADVERSE_MEDIA_CATEGORIES.length),
  'max-article-age-days': bounded('max-article-age-days'),
  'allowed-countries': distinct(countryCodeSchema, 1, 300).nullable(),
};

/** The full shape of each type's configuration (C71.2, C79-C82). */
const SHAPES = {
  watchlist: {
    ...MONITORING,
    ...LISTS,
    'name-matching': nameMatchingConfigSchema,
    ...PERSON_DATES,
    'country-fields': distinct(z.enum(PERSON_COUNTRY_FIELDS), 1, PERSON_COUNTRY_FIELDS.length),
    'country-filter': z.enum(REPORT_FILTER_MODES),
    'screen-weak-aliases': z.boolean(),
  },
  'business-watchlist': {
    ...MONITORING,
    ...LISTS,
    'name-matching': nameMatchingConfigSchema,
    'country-fields': distinct(z.enum(BUSINESS_COUNTRY_FIELDS), 1, BUSINESS_COUNTRY_FIELDS.length),
    'country-filter': z.enum(REPORT_FILTER_MODES),
    'screen-weak-aliases': z.boolean(),
    'entity-kinds': distinct(z.enum(BUSINESS_ENTITY_KINDS), 1, BUSINESS_ENTITY_KINDS.length),
  },
  'crypto-address-watchlist': { ...MONITORING, ...LISTS },
  'politically-exposed-person': {
    ...MONITORING,
    ...LISTS,
    'name-matching': nameMatchingConfigSchema,
    'pep-classes': distinct(
      z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      1,
      PEP_CLASSES.length,
    ),
    'include-relatives': z.boolean(),
    'include-unknown-class': z.boolean(),
    'default-country': countryCodeSchema.nullable(),
    ...PERSON_DATES,
    'keep-without-birthdate': z.boolean(),
  },
  'adverse-media': MEDIA,
  'business-adverse-media': MEDIA,
  'email-address': {
    ...ONE_OFF,
    'min-domain-age-days': bounded('min-domain-age-days'),
    'young-domain-days': bounded('young-domain-days'),
  },
  'phone-number': { ...ONE_OFF },
  'address-lookup': { ...ONE_OFF, 'send-addressee': z.boolean() },
  // C106.1 (Phase 7): nothing to configure beyond the one-off schedule.
  'ip-address': { ...ONE_OFF },
  // C106.2 (Workflow 7B): recurring; `list-ids` pins 1-20 lists, or is `null` to read each query's.
  'custom-list': {
    ...MONITORING,
    'list-ids': distinct(idSchema('lst'), 1, LIST_LIMITS.reportLists).nullable(),
  },
} as const satisfies Record<ReportType, z.ZodRawShape>;

const partial = (shape: z.ZodRawShape) =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(shape).map(([key, member]) => [key, (member as z.ZodType).optional()]),
    ),
  );

/** C71.2: what a template or version may set, per type; every key optional. */
export const REPORT_TEMPLATE_CONFIG_SCHEMAS: Readonly<Record<ReportType, z.ZodType>> =
  Object.freeze(
    Object.fromEntries(
      REPORT_TYPES.map((type) => [type, partial(SHAPES[type])]),
    ) as unknown as Record<ReportType, z.ZodType>,
  );

/** C71.2: what a version serves, every key resolved (the source lists pinned at creation). */
export const RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS: Readonly<Record<ReportType, z.ZodType>> =
  Object.freeze(
    Object.fromEntries(
      REPORT_TYPES.map((type) => [type, z.strictObject(SHAPES[type])]),
    ) as unknown as Record<ReportType, z.ZodType>,
  );

/** C71.2: the template configuration schema of a type. */
export function reportTemplateConfigSchema(type: ReportType): z.ZodType {
  return REPORT_TEMPLATE_CONFIG_SCHEMAS[type];
}

/** C71.2: the resolved configuration schema of a type. */
export function resolvedReportTemplateConfigSchema(type: ReportType): z.ZodType {
  return RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS[type];
}

/**
 * The configuration with every default applied (C71.2). The source lists are resolved into
 * explicit ids when the template or version is created, so a list type's stored configuration
 * always holds `search-lists`.
 * @throws {z.ZodError} when the result is not a resolved configuration of the type (a list type
 *   without its pinned `search-lists`, or a key the type does not take).
 */
export function resolveReportTemplateConfig(
  type: ReportType,
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const defaults = Object.fromEntries(
    Object.entries(reportConfigDefaultValues(type)).filter(
      // `null` stands for "resolved at creation" (C71.2): it is never served.
      ([key, value]) => !(key === 'search-lists' && value === null),
    ),
  );
  const resolved = { ...defaults, ...config };
  resolvedReportTemplateConfigSchema(type).parse(resolved);
  return resolved;
}

/** Whether a type schedules runs (C71.2): only recurrable types take a recurrence. */
export function reportTypeRecurs(type: ReportType): boolean {
  return REPORT_REGISTRY[type].recurrable;
}
