/**
 * C279.1 and C279.2: `docs/checks/catalog.md`, generated from `CHECK_REGISTRY`,
 * `REPORT_REGISTRY` and `SIGNAL_REGISTRY` (`@openverify/core`), the configuration defaults the
 * workers merge, the lists', graph's and transactions' registries, the calibration reports'
 * summary blocks and `docs/checks/limits.json` (ours, keyed by registry id). C279.4: it says only
 * what those state. The vendor-name column is rendered only while the vendor-naming switch is on.
 */
import {
  CHECK_REGISTRY,
  FIELD_SCHEMA_TYPES,
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  GRAPH_MAX_HOPS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  LIST_MATCH_CONSTANTS,
  LIST_MATCH_METHODS,
  LIST_NOT_APPLICABLE_REASONS,
  LIST_UNSCREENED_REASONS,
  PHASE5_CHECK_CONFIG_DEFAULTS,
  REPORT_CONFIG_DEFAULTS,
  REPORT_REGISTRY,
  SELFIE_CHECK_CONFIG_DEFAULTS,
  SIGNAL_REGISTRY,
  TRANSACTION_LIMITS,
  VERIFICATION_TYPES,
  type CheckDefinition,
} from '@openverify/core';
import { DOCS_SWITCHES, type DocsSwitches } from '../switches.js';
import type { CheckFinding, GeneratedFile, Repository } from '../types.js';
import {
  CALIBRATION_SOURCES,
  figureForm,
  grouped,
  readCalibrationReports,
  type CalibrationReference,
  type CalibrationReport,
  type CalibrationRow,
} from './calibration.js';
import { code, list, table } from './markdown.js';

export const CATALOG_PATH = 'docs/checks/catalog.md';
export const LIMITS_PATH = 'docs/checks/limits.json';

/** C279.1's family pages, frozen by contracts-11e (Workflow 11E Stage 1a amendment 7). */
export const FAMILY_PAGES: Readonly<Record<string, string>> = Object.freeze({
  government_id: 'docs/checks/government-id.md',
  government_id_nfc: 'docs/checks/nfc.md',
  selfie: 'docs/checks/selfie.md',
  document: 'docs/checks/document.md',
  database: 'docs/checks/database.md',
  aamva: 'docs/checks/database.md',
  database_business: 'docs/checks/business.md',
  business_website: 'docs/checks/business.md',
  crypto_wallet: 'docs/checks/crypto-wallet.md',
  phone_number: 'docs/checks/contact.md',
  email_address: 'docs/checks/contact.md',
});

/** `docs/checks/limits.json`: what each registry id does not detect. */
export interface CheckLimits {
  readonly checks: Readonly<Record<string, string>>;
  readonly reports: Readonly<Record<string, string>>;
  readonly signals: Readonly<Record<string, string>>;
}

export interface CatalogOptions {
  readonly switches?: DocsSwitches;
  /** The source API's names per check id, for the vendor-name column (C279.2). */
  readonly vendorNames?: Readonly<Record<string, readonly string[]>>;
}

const SECTIONS = ['checks', 'reports', 'signals'] as const;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string');

/** The limits file, or `null` when it is not `{checks, reports, signals}` of strings. */
function parseLimits(repo: Repository): CheckLimits | null {
  if (!repo.exists(LIMITS_PATH)) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(repo.readText(LIMITS_PATH));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return SECTIONS.every((section) => isStringRecord(record[section]))
    ? (record as unknown as CheckLimits)
    : null;
}

export const readLimits: (repo: Repository) => CheckLimits = (repo) =>
  parseLimits(repo) ?? { checks: {}, reports: {}, signals: {} };

const registryIds = (): Readonly<Record<(typeof SECTIONS)[number], readonly string[]>> => ({
  checks: CHECK_REGISTRY.map((check) => check.id),
  reports: Object.keys(REPORT_REGISTRY),
  signals: SIGNAL_REGISTRY.map((signal) => signal.name),
});

const SECTION_NOUN = { checks: 'check', reports: 'report type', signals: 'signal' } as const;

/** C279.1: every registry id has exactly one entry, and the file holds no other. */
export const limitsFindings: (repo: Repository) => readonly CheckFinding[] = (repo) => {
  const finding = (message: string): CheckFinding => ({
    rule: 'catalog-limits',
    path: LIMITS_PATH,
    message,
    severity: 'error',
  });
  const limits = parseLimits(repo);
  if (limits === null) {
    return [finding('limits.json is not {checks, reports, signals} of strings')];
  }
  const ids = registryIds();
  return SECTIONS.flatMap((section) => {
    const known = new Set(ids[section]);
    const present = Object.keys(limits[section]);
    return [
      ...ids[section]
        .filter((id) => !Object.hasOwn(limits[section], id))
        .map((id) => finding(`no entry for ${SECTION_NOUN[section]} ${id}`)),
      ...present
        .filter((id) => !known.has(id))
        .map((id) => finding(`an entry for an unknown ${SECTION_NOUN[section]} ${id}`)),
      ...present
        .filter((id) => (limits[section][id] ?? '').trim() === '')
        .map((id) => finding(`an empty entry for ${id}`)),
    ];
  });
};

/** Whether `id` appears in `text` as a word (not inside a longer snake_case id). */
function mentions(text: string, id: string): boolean {
  const word = (character: string): boolean => /^[A-Za-z0-9_]$/.test(character);
  for (let at = text.indexOf(id); at >= 0; at = text.indexOf(id, at + 1)) {
    if (!word(text.charAt(at - 1)) && !word(text.charAt(at + id.length))) {
      return true;
    }
  }
  return false;
}

/** C279.1: every family page mentions every id of its family. */
export const familyPageFindings: (repo: Repository) => readonly CheckFinding[] = (repo) =>
  CHECK_REGISTRY.flatMap((check): CheckFinding[] => {
    const page = FAMILY_PAGES[check.verificationType];
    if (page === undefined) {
      return [
        {
          rule: 'catalog-family-pages',
          path: CATALOG_PATH,
          message: `no family page for ${check.verificationType}`,
          severity: 'error',
        },
      ];
    }
    const text = repo.exists(page) ? repo.readText(page) : '';
    return mentions(text, check.id)
      ? []
      : [
          {
            rule: 'catalog-family-pages',
            path: page,
            message: `${page} does not mention ${check.id}`,
            severity: 'error',
          },
        ];
  });

/** A scalar default as text; anything else as its JSON. */
function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

/** A default as the page prints it. */
function formatDefault(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.every((item) => typeof item === 'string')
      ? `[${value.join(', ')}]`
      : value
          .map((group) =>
            typeof group === 'object' && group !== null
              ? `{${Object.entries(group as Record<string, unknown>)
                  .map(([key, item]) => `${key}: ${scalar(item)}`)
                  .join(', ')}}`
              : scalar(group),
          )
          .join(' or ');
  }
  return value === null ? 'null' : scalar(value);
}

/** The defaults a worker merges for one check, by key (Phase 3, Phase 4, Phase 5 tables). */
function checkDefaults(id: string): Readonly<Record<string, unknown>> {
  const entries: [string, unknown][] = [
    ...Object.entries(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[id] ?? {}),
    ...Object.entries(SELFIE_CHECK_CONFIG_DEFAULTS[id] ?? {}).map(
      ([key, entry]): [string, unknown] => [key, entry.value],
    ),
    ...Object.entries(PHASE5_CHECK_CONFIG_DEFAULTS[id] ?? {}).map(
      ([key, entry]): [string, unknown] => [key, entry.value],
    ),
  ];
  return Object.fromEntries(entries);
}

/** The keys of a check's `configSchema` (a zod object), in their declared order. */
function configKeys(check: CheckDefinition): readonly string[] {
  const schema: unknown = check.configSchema;
  if (typeof schema !== 'object' || schema === null || !('shape' in schema)) {
    return [];
  }
  const shape = schema.shape;
  return typeof shape === 'object' && shape !== null ? Object.keys(shape) : [];
}

function configuration(check: CheckDefinition): string {
  const defaults = checkDefaults(check.id);
  const keys = configKeys(check);
  return keys.length === 0
    ? 'none'
    : keys
        .map((key) =>
          Object.hasOwn(defaults, key)
            ? `${code(key)} ${formatDefault(defaults[key])}`
            : `${code(key)} (no default)`,
        )
        .join('; ');
}

const UNIT_SUFFIX: Readonly<Record<string, string>> = {
  ms: ' ms',
  s: ' s',
  'per-s': ' a second',
  'per-hour': ' an hour',
  percent: '%',
  mib: ' MiB',
};

/** A row's headline figure as its report writes it, with its unit; `-` without one. */
function figure(row: CalibrationRow, report: CalibrationReport): string {
  if (row.median === null) {
    return '-';
  }
  const form = figureForm(row.median, row.unit, report.prose) ?? String(row.median);
  const suffix = UNIT_SUFFIX[row.unit ?? ''] ?? '';
  return form.endsWith('%') ? form : `${form}${suffix}`;
}

function gapText(row: CalibrationRow, report: CalibrationReport): string {
  if (row.gap === null) {
    return '-';
  }
  const form = figureForm(row.gap, row.unit, report.prose) ?? String(row.gap);
  const signed = row.gap > 0 && !form.startsWith('+') ? `+${form}` : form;
  return `${signed}${UNIT_SUFFIX[row.unit ?? ''] ?? ''}`;
}

const reportName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function citation(
  references: readonly CalibrationReference[] | undefined,
  reports: ReadonlyMap<string, CalibrationReport>,
): string {
  if (references === undefined || references.length === 0) {
    return '-';
  }
  return references
    .map((reference) => {
      const target = reports.get(reference.report);
      const link = `[${reportName(reference.report)}](../calibration/${reportName(reference.report)})`;
      const rows = reference.rows.flatMap((id) => {
        const row = target?.summary?.rows.find((item) => item.id === id);
        return row === undefined || target === undefined
          ? []
          : [
              row.median === null
                ? `${code(id)} ${row.verdict}`
                : `${code(id)} ${figure(row, target)}, ${row.verdict}`,
            ];
      });
      return rows.length === 0 ? link : `${link}: ${rows.join('; ')}`;
    })
    .join('<br>');
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

function checkTables(
  limits: CheckLimits,
  reports: ReadonlyMap<string, CalibrationReport>,
  options: CatalogOptions,
): string[] {
  const vendor = (options.switches ?? DOCS_SWITCHES).vendorNaming;
  const headers = [
    'Check',
    ...(vendor ? ['Source API name'] : []),
    'Tier',
    'Type',
    'Stage',
    'Inputs',
    'Model',
    'Configuration (default)',
    'Calibration',
    'Does not detect',
  ];
  return VERIFICATION_TYPES.flatMap((type) => {
    const checks = CHECK_REGISTRY.filter((check) => check.verificationType === type);
    const page = FAMILY_PAGES[type] ?? '';
    const pageName = page.slice(page.lastIndexOf('/') + 1);
    return [
      `## ${code(type)}`,
      '',
      `${String(checks.length)} checks. Family page: [${pageName}](${pageName}).`,
      '',
      table(
        headers,
        checks.map((check) => [
          code(check.id),
          ...(vendor ? [list((options.vendorNames?.[check.id] ?? []).map(code), '-')] : []),
          check.alternateTier === undefined ? check.tier : `${check.tier}/${check.alternateTier}`,
          check.checkType,
          check.stage,
          check.inputs.join(', '),
          yesNo(check.modelBased),
          configuration(check),
          citation(CALIBRATION_SOURCES.checks[check.id], reports),
          limits.checks[check.id] ?? '-',
        ]),
      ),
      '',
    ];
  });
}

function reportTables(
  limits: CheckLimits,
  reports: ReadonlyMap<string, CalibrationReport>,
): string[] {
  return Object.values(REPORT_REGISTRY).flatMap((entry) => {
    const defaults = Object.entries(REPORT_CONFIG_DEFAULTS[entry.type]).map(
      ([key, item]) => `${code(key)} ${formatDefault(item.value)} (${item.basis})`,
    );
    const inputs = [
      entry.sourceKind === null ? null : `list source kind ${code(entry.sourceKind)}`,
      entry.requiredProviderKind === null
        ? null
        : `required provider kind ${code(entry.requiredProviderKind)}`,
      entry.optionalProviderKinds.length === 0
        ? null
        : `optional provider kinds ${entry.optionalProviderKinds.map(code).join(', ')}`,
      entry.usesDns ? 'DNS' : null,
      entry.needsCryptoAddresses ? 'crypto addresses' : null,
    ].filter((item): item is string => item !== null);
    return [
      `### ${code(entry.type)}`,
      '',
      table(
        ['Member', 'Value'],
        [
          ['Resource type', code(entry.resourceType)],
          ['Tiers', `${entry.tiers.join(', ')}: ${entry.tierNote}`],
          ['Stage', `${entry.stage} (GA condition: ${entry.gaCondition})`],
          ['Inputs', list(inputs, 'the query only')],
          ['Recurrable', yesNo(entry.recurrable)],
          ['Review', entry.review],
          ['Configuration (default, basis)', list(defaults)],
          ['Events', entry.events.map(code).join(', ')],
          ['Calibration', citation(CALIBRATION_SOURCES.reports[entry.type], reports)],
          ['Does not detect', limits.reports[entry.type] ?? '-'],
          ['Page', `[${entry.type}.md](../reports/${entry.type}.md)`],
        ],
      ),
      '',
    ];
  });
}

function signalTable(limits: CheckLimits): string[] {
  return [
    table(
      [
        'Signal',
        'Public',
        'Tier',
        'Stage',
        'Layer',
        'Collection',
        'Inputs',
        'Decisive alone',
        'Does not detect',
      ],
      SIGNAL_REGISTRY.map((signal) => [
        code(signal.name),
        yesNo(signal.public),
        signal.tier,
        signal.stage,
        signal.layer,
        signal.collectionTier,
        signal.inputs.join(', '),
        yesNo(signal.decisiveAlone),
        limits.signals[signal.name] ?? '-',
      ]),
    ),
    '',
  ];
}

const constants = (record: Readonly<Record<string, number>>): string =>
  Object.entries(record)
    .map(([key, value]) => `${code(key)} ${String(value)}`)
    .join(', ');

function workflow7bSections(): string[] {
  const kinds = Object.values(LIST_KIND_REGISTRY);
  return [
    '## Lists, the graph and transactions',
    '',
    'The `custom-list` report and the completion screening read lists; the graph and transactions are not report types and run no check, so they are listed here for their kinds and caps only.',
    '',
    '### Lists',
    '',
    `${String(kinds.length)} kinds (\`LIST_KIND_REGISTRY\`). The match method of each kind is in [the lists page](../lists/README.md#kinds).`,
    '',
    table(
      ['Kind', 'Item id prefix', 'CSV importer', 'Biometric', 'Screened by `screen: all`'],
      kinds.map((kind) => [
        code(kind.kind),
        code(kind.itemPrefix),
        yesNo(kind.importer),
        yesNo(kind.biometric),
        yesNo(kind.screenedByAll),
      ]),
    ),
    '',
    `- Match methods (\`LIST_MATCH_METHODS\`): ${LIST_MATCH_METHODS.map(code).join(', ')}.`,
    `- A list that could not be read is \`unscreened\` with one of (\`LIST_UNSCREENED_REASONS\`): ${LIST_UNSCREENED_REASONS.map(code).join(', ')}; never "no match".`,
    `- A list the subject has no value for is \`not-applicable\` with: ${LIST_NOT_APPLICABLE_REASONS.map(code).join(', ')}.`,
    `- Caps (\`LIST_LIMITS\`): ${constants(LIST_LIMITS)}.`,
    `- Method constants (\`LIST_MATCH_CONSTANTS\`): ${Object.entries(LIST_MATCH_CONSTANTS)
      .map(([key, item]) => `${code(key)} ${formatDefault(item.value)} (${item.basis})`)
      .join(', ')}.`,
    '',
    '### Graph',
    '',
    table(
      ['Kind', 'Code', 'Strength', 'Identifies a person', 'Needs device recognition'],
      Object.values(GRAPH_KIND_REGISTRY).map((kind) => [
        code(kind.kind),
        String(kind.code),
        kind.strength,
        yesNo(kind.identifiesPerson),
        yesNo(kind.needsDeviceRecognition),
      ]),
    ),
    '',
    `- Hops (\`GRAPH_MAX_HOPS\`): ${GRAPH_MAX_HOPS.join(', ')}.`,
    `- Caps (\`GRAPH_LIMITS\`): ${constants(GRAPH_LIMITS)}.`,
    '- See [the graph page](../graph/README.md).',
    '',
    '### Transactions',
    '',
    `- Field types (\`FIELD_SCHEMA_TYPES\`): ${FIELD_SCHEMA_TYPES.map(code).join(', ')}.`,
    `- Caps (\`TRANSACTION_LIMITS\`): ${constants(TRANSACTION_LIMITS)}.`,
    '- See [the transactions page](../transactions/README.md).',
    '',
  ];
}

function machineText(report: CalibrationReport): string {
  const machine = report.summary?.machine;
  return machine === null || machine === undefined
    ? 'not given in the block'
    : `${machine.cpu}, ${String(machine['logical-cpus'])} logical CPUs, ${String(machine['memory-gib'])} GiB, ${machine['disk-class']}`;
}

function calibrationSection(reports: readonly CalibrationReport[]): string[] {
  return [
    '## Calibration reports',
    '',
    "Every row of every report's summary block, each figure printed as the report's own text writes it. A figure holds only on the report's data, machine and load; read the report before relying on it.",
    '',
    ...reports.flatMap((report) => {
      const summary = report.summary;
      const name = reportName(report.path);
      if (summary === null) {
        return [`### [${name}](../calibration/${name})`, '', 'No valid summary block.', ''];
      }
      return [
        `### [${name}](../calibration/${name})`,
        '',
        `Workflow ${summary.workflow}, ${summary.status}; head ${summary.head === null ? 'not given' : code(summary.head.slice(0, 9))}; machine: ${machineText(report)}.`,
        '',
        table(
          ['Row', 'What', 'Verdict', 'Figure', 'Budget', 'Gap'],
          summary.rows.map((row) => [
            code(row.id),
            row.title,
            row.verdict,
            figure(row, report),
            row.budget === null
              ? '-'
              : `${row.budget.metric} ${row.budget.comparison} ${grouped(String(row.budget.value))}${UNIT_SUFFIX[row.budget.unit] ?? ''}`,
            gapText(row, report),
          ]),
        ),
        '',
      ];
    }),
  ];
}

/** Renders `docs/checks/catalog.md` from the repository's facts; never writes it. */
export const renderCheckCatalog: (repo: Repository, options?: CatalogOptions) => GeneratedFile = (
  repo,
  options = {},
) => {
  const limits = readLimits(repo);
  const reports = readCalibrationReports(repo);
  const byPath = new Map(reports.map((report) => [report.path, report]));
  const content = [
    '# Check catalog',
    '',
    '<!-- Generated by `pnpm --filter @openverify/docs-tools docs:catalog` (packages/docs-tools/src/catalog/); do not edit by hand. -->',
    '',
    `Every check (\`CHECK_REGISTRY\`, ${String(CHECK_REGISTRY.length)}), report type (\`REPORT_REGISTRY\`, ${String(Object.keys(REPORT_REGISTRY).length)}) and signal (\`SIGNAL_REGISTRY\`, ${String(SIGNAL_REGISTRY.length)}) as the registries in \`@openverify/core\` state them, with the configuration defaults the workers merge, the calibration reports' summary blocks and what each does not detect ([limits.json](limits.json), ours). The catalog says only what those state (C279.4); each family page is the full description.`,
    '',
    '- **Tier** (ADR 0002): R real, deterministic logic over values; H heuristic; A adapter to a provider. Two letters name a secondary tier. Every H, A/H and H/A check and every model-based one is `beta`.',
    '- **Model**: whether a learned model can decide the check.',
    '- **Configuration (default)**: the keys a template may set; a key with no default applies only when a template sets it.',
    '- **Calibration**: the report and the rows that measure it, each with its figure and verdict. `-`: no report measures it. A cited report with no row: no variant was built to trip it, or the report measures it without a row of its own.',
    '- IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0): the network signals and the `ip-address` report read DB-IP Lite.',
    '',
    ...checkTables(limits, byPath, options),
    '## Report types',
    '',
    '`REPORT_REGISTRY` records no model flag, so no model row is rendered for a report type. Each page under [docs/reports/](../reports/README.md) is the full description.',
    '',
    ...reportTables(limits, byPath),
    ...workflow7bSections(),
    '## Signals',
    '',
    'See [signals](signals.md) for the null reasons, review rules and collection tiers.',
    '',
    ...signalTable(limits),
    ...calibrationSection(reports),
  ].join('\n');
  return { path: CATALOG_PATH, content: `${content.trimEnd()}\n` };
};
