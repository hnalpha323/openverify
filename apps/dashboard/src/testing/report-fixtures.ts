/**
 * C86: reports as the console's tests receive them, built on the golden API fixtures
 * (`contracts/fixtures/api/report-<type>.json`, `report-history.json`), as the API serves them
 * to an operator with `pii:view`, or masked (C70.3) as it serves them to one without: every
 * attribute `PII_REPORT_ATTRIBUTES` names `null`, the `query` member by member. Every value in
 * the fixtures is synthetic.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PII_REPORT_ATTRIBUTES,
  dashboardReportDocumentSchema,
  dashboardReportListDocumentSchema,
  reportActionResourceSchema,
  reportResourceSchema,
  reportRunResourceSchema,
  reportTemplateListDocumentSchema,
  reportTemplateResourceSchema,
  resolveReportTemplateConfig,
  type ReportActionResource,
  type ReportTemplateResource,
  type ReportResourceType,
  type ReportRunResource,
} from '@openverify/contracts';
import { REPORT_REGISTRY, type ReportType } from '@openverify/core';
import type {
  DashboardReportDocument,
  DashboardReportListDocument,
  Report,
  ReportHistoryEntry,
} from '../lib/report-documents';

// Not `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'fixtures',
  'api',
);

const read = (file: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as unknown;

/** Synthetic ids of the report tests. */
export const REPORT_IDS = {
  report: 'rep_01M5Y5Z4002GV576EACWSHT2BK',
  otherReport: 'rep_01M5Y5Z4002GV576EACWSHT2BM',
  template: 'rptp_01M5Y5Z400VF5JFP7ER3C45AY2',
  version: 'rptpv_01M5Y5Z400BSXX21JQ991CDRK5',
  match: 'rpm_01M5Y5Z4000JENGH3PCW0AWCA2',
  run: 'rpr_01M5Y5Z400GEABT3VJDCS4CSVV',
  laterRun: 'rpr_01M5Y5Z400GEABT3VJDCS4CSVW',
  action: 'ract_01M5Y5Z4003ZHHNS59F1VMEPT4',
  user: 'usr_01M5CJXHG03PHEQZPRWAH2RXM5',
  account: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
  inquiry: 'inq_01M5CJXJF84MR3PHJHBHKQ4ZC9',
} as const;

const PII: ReadonlySet<string> = new Set(PII_REPORT_ATTRIBUTES);

/** The golden report of `type`, as the API serves it with `pii:view`. */
export function goldenReport(type: ReportType): Report {
  const { data } = read(`report-${type}.json`) as { data: unknown };
  return reportResourceSchema.parse(data);
}

/** `attributes` as the API masks them (C70.3): `query` member-wise, any other PII member whole. */
export function maskedAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => {
      if (!PII.has(name) || value === null || value === undefined) {
        return [name, value];
      }
      if (name === 'query' && typeof value === 'object') {
        return [name, Object.fromEntries(Object.keys(value).map((member) => [member, null]))];
      }
      return [name, null];
    }),
  );
}

export interface ReportOptions {
  /** `REPORT_IDS.report` by default. */
  readonly id?: string;
  /** As the API serves it to an operator without `pii:view`. */
  readonly masked?: boolean;
  /** Merged over the golden attributes. */
  readonly attributes?: Record<string, unknown>;
  /** Merged over the golden relationships. */
  readonly relationships?: Record<string, unknown>;
}

/** The golden report of `type`, changed as `options` say, checked against the contract. */
export function report(type: ReportType, options: ReportOptions = {}): Report {
  const golden = goldenReport(type);
  const attributes: Record<string, unknown> = { ...golden.attributes, ...options.attributes };
  return reportResourceSchema.parse({
    ...golden,
    id: options.id ?? REPORT_IDS.report,
    attributes: options.masked === true ? maskedAttributes(attributes) : attributes,
    relationships: { ...golden.relationships, ...options.relationships },
  });
}

/** A report with no run finished yet: `pending`, its results empty (C70.2). */
export function pendingReport(type: ReportType, options: ReportOptions = {}): Report {
  const golden = goldenReport(type);
  const empty = Object.fromEntries(
    Object.entries(golden.attributes).map(([name, value]) => [
      name,
      Array.isArray(value) ? [] : value,
    ]),
  );
  return report(type, {
    ...options,
    attributes: {
      ...empty,
      status: 'pending',
      'completed-at': null,
      'has-match': false,
      query: golden.attributes.query,
      'query-sources': golden.attributes['query-sources'],
      coverage: null,
      ...options.attributes,
    },
  });
}

const history = read('report-history.json') as { data: unknown[] };

/** A run of the report (C74.2), from the golden history, changed as `attributes` say. */
export function reportRun(
  attributes: Partial<ReportRunResource['attributes']> = {},
  options: { readonly id?: string; readonly reportType?: ReportResourceType } = {},
): ReportRunResource {
  const golden = reportRunResourceSchema.parse(
    history.data.find((entry) => (entry as { type: string }).type === 'report-run'),
  );
  return reportRunResourceSchema.parse({
    ...golden,
    id: options.id ?? golden.id,
    attributes: { ...golden.attributes, ...attributes },
    relationships: {
      report: {
        data: { type: options.reportType ?? 'report/watchlist', id: REPORT_IDS.report },
      },
    },
  });
}

/** An action of the report (C74.2), from the golden history, changed as `attributes` say. */
export function reportAction(
  attributes: Partial<ReportActionResource['attributes']> = {},
  options: { readonly id?: string; readonly reportType?: ReportResourceType } = {},
): ReportActionResource {
  const golden = reportActionResourceSchema.parse(
    history.data.find((entry) => (entry as { type: string }).type === 'report-action'),
  );
  return reportActionResourceSchema.parse({
    ...golden,
    id: options.id ?? golden.id,
    attributes: { ...golden.attributes, ...attributes },
    relationships: {
      report: {
        data: { type: options.reportType ?? 'report/watchlist', id: REPORT_IDS.report },
      },
    },
  });
}

/** `GET /dashboard/reports/:id` of `data`, with its history newest first. */
export function dashboardReport(
  data: Report,
  included: readonly ReportHistoryEntry[] = [],
): DashboardReportDocument {
  return dashboardReportDocumentSchema.parse({ data, included });
}

/** `GET /dashboard/reports`. */
export function reportList(
  data: readonly Report[],
  next: string | null = null,
): DashboardReportListDocument {
  return dashboardReportListDocumentSchema.parse({ data, links: { next } });
}

const ID = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/;
/** A vocabulary code (`open`, `name_fuzzy`, `jaro-winkler`): never a personal value. */
const CODE = /^[a-z_-]+$/;

function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(strings);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

/**
 * The golden report's PII values distinctive enough to search a page or a payload for: every
 * string of its PII attributes (query values, matched and list entry names, article titles and
 * URLs, positions, addresses, wallet addresses) of four characters or more, less ids,
 * vocabulary codes and the values its unmasked attributes also say (a source id, a date).
 */
export function reportPiiValues(type: ReportType): string[] {
  const golden = goldenReport(type);
  const plain = new Set(
    strings(maskedAttributes(golden.attributes)).concat(strings(golden.relationships)),
  );
  return [
    ...new Set(
      Object.entries(golden.attributes)
        .filter(([name]) => PII.has(name))
        .flatMap(([, value]) => strings(value)),
    ),
  ].filter(
    (value) => value.length >= 4 && !ID.test(value) && !CODE.test(value) && !plain.has(value),
  );
}

/** The list types' sandbox source (C71.3), so a template's resolved config parses. */
function searchLists(type: ReportType): Record<string, unknown> {
  const kind = REPORT_REGISTRY[type].sourceKind;
  return kind === null
    ? {}
    : { 'search-lists': [kind === 'pep' ? 'openverify-sandbox-pep' : 'openverify-sandbox'] };
}

/** A report template of `type` with its published version 1 (C71.1), resolved. */
export function reportTemplate(
  type: ReportType,
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly status?: 'active' | 'archived';
  } = {},
): ReportTemplateResource {
  return reportTemplateResourceSchema.parse({
    type: 'report-template',
    id: options.id ?? REPORT_IDS.template,
    attributes: {
      'report-type': type,
      name: options.name ?? `Default ${type.replaceAll('-', ' ')}`,
      status: options.status ?? 'active',
      'current-version': {
        id: REPORT_IDS.version,
        'version-number': 1,
        config: resolveReportTemplateConfig(type, searchLists(type)),
        'created-at': '2026-10-27T09:00:00.000Z',
        'published-at': '2026-10-27T09:00:00.000Z',
      },
      'created-at': '2026-10-27T09:00:00.000Z',
      'updated-at': '2026-10-27T09:00:00.000Z',
    },
  });
}

/** `GET /report-templates`. */
export function reportTemplateList(
  data: readonly ReportTemplateResource[],
  next: string | null = null,
) {
  return reportTemplateListDocumentSchema.parse({ data, links: { next } });
}
