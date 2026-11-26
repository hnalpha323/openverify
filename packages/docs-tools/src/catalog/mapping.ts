/**
 * C280 and C281.1's `mapping.md`: the mapping from the source vendor's public API, generated from
 * `docs/research/persona-surface.md` (the surface index) and `docs/api/openapi.json`, with the
 * vendor-naming switch of `src/switches.ts` (C280.6, Q8). With the switch off (the committed
 * value) the page is `docs/migration/from-hosted-api.md`, it names no vendor, and every source
 * identifier that names the vendor, its version and signature headers and its host are written by
 * role. The CLI has no `--vendor-name` flag: the committed switch rules (Workflow 11E Stage 1a
 * amendment 16), and only 11G turns it on under the owner's grant.
 *
 * Every identifier of the index's six machine sections gets a row: its OpenVerify counterpart by
 * an automatic rule (the same check id, verification type, report type, list kind, event name or
 * path), or by an entry of `mapping-data.ts`, or "not available" with a reason code. An identifier
 * with neither fails {@link mappingFindings}, and so does an entry the rules no longer need.
 */
import {
  CHECK_REGISTRY,
  LIST_KIND_REGISTRY,
  REPORT_REGISTRY,
  VERIFICATION_TYPES,
} from '@openverify/core';
import { EVENT_NAMES } from '@openverify/contracts';
import { DOCS_SWITCHES, migrationPagePath, type DocsSwitches } from '../switches.js';
import type { CheckFinding, GeneratedFile, Repository } from '../types.js';
import { vendorNameFindings } from '../vendor-name.js';
import { OPENAPI_PATH } from './api-reference.js';
import {
  MAPPING_OVERRIDES,
  MAPPING_PREFIXES,
  MAPPING_SECTIONS,
  REASON_CODES,
  type MappingOverride,
  type MappingSection,
  type ReasonCode,
} from './mapping-data.js';
import { cell, code, table } from './markdown.js';

export const SURFACE_PATH = 'docs/research/persona-surface.md';
export const CONNECT_MAPPING_PATH = 'docs/connect/mapping.md';

/** The surface index's `##` headings, by the start of their text. */
const SECTION_HEADINGS: Readonly<Record<MappingSection, string>> = Object.freeze({
  checks: 'Verification checks',
  'verification-types': 'Verification types',
  'report-types': 'Report types',
  'list-item-types': 'List-item types',
  'webhook-events': 'Webhook events',
  paths: 'API resources (path files)',
});

const SECTION_TITLES: Readonly<Record<MappingSection, string>> = Object.freeze({
  checks: 'Verification checks',
  'verification-types': 'Verification types',
  'report-types': 'Report types',
  'list-item-types': 'List-item types',
  'webhook-events': 'Webhook events',
  paths: 'API resources (path files)',
});

/** The index's later prose sections (bullets with "built", "kept" and "not built" notes). */
const PROSE_HEADINGS = ['Signal, session', 'Template, flow', 'Android SDK', 'Connect'] as const;

export interface SurfaceIdentifier {
  readonly identifier: string;
  /** What follows the identifier on its line (such as "(sunset)"), or empty. */
  readonly remark: string;
}

export interface SurfaceIndex {
  /** The index's first heading's first word: the source vendor's name (printed only while the switch is on). */
  readonly vendor: string;
  readonly version: string;
  readonly sections: Readonly<Record<MappingSection, readonly SurfaceIdentifier[]>>;
  /** Each prose section's heading and its bullets. */
  readonly prose: readonly {
    readonly heading: string;
    /** The section's first paragraph: where it came from and where its mapping is recorded. */
    readonly intro: string;
    readonly bullets: readonly string[];
  }[];
}

/** Parses the surface index: the six machine sections' identifiers and the prose sections. */
export function parseSurface(text: string): SurfaceIndex {
  const sections = Object.fromEntries(
    MAPPING_SECTIONS.map((key) => [key, [] as SurfaceIdentifier[]]),
  ) as Record<MappingSection, SurfaceIdentifier[]>;
  const prose: { heading: string; intro: string; bullets: string[] }[] = [];
  let machine: MappingSection | null = null;
  let current: { heading: string; intro: string; bullets: string[] } | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      machine = MAPPING_SECTIONS.find((key) => heading.startsWith(SECTION_HEADINGS[key])) ?? null;
      current = PROSE_HEADINGS.some((start) => heading.startsWith(start))
        ? { heading, intro: '', bullets: [] }
        : null;
      if (current !== null) {
        prose.push(current);
      }
      continue;
    }
    if (machine !== null && line.startsWith('- `')) {
      const end = line.indexOf('`', 3);
      if (end > 3) {
        sections[machine].push({
          identifier: line.slice(3, end),
          remark: line.slice(end + 1).trim(),
        });
      }
    } else if (current !== null && line.startsWith('- ')) {
      current.bullets.push(line.slice(2).trim());
    } else if (
      current !== null &&
      current.intro === '' &&
      current.bullets.length === 0 &&
      line.trim() !== ''
    ) {
      current.intro = line.trim();
    } else if (current !== null && line.startsWith('  ') && current.bullets.length > 0) {
      const last = current.bullets.pop() ?? '';
      current.bullets.push(`${last} ${line.trim()}`);
    }
  }
  const version = /\(version `([^`]+)`\)/.exec(text)?.[1] ?? 'unknown';
  const vendor = /^# (\S+)/m.exec(text)?.[1] ?? 'the source vendor';
  return { vendor, version, sections, prose };
}

/** One identifier's row: a counterpart, or a reason, or neither (a finding). */
export interface MappingRow {
  readonly section: MappingSection;
  readonly identifier: string;
  readonly remark: string;
  readonly counterpart: string | null;
  readonly reason: ReasonCode | null;
  readonly note: string;
  /** How the row was decided: an automatic rule, an exact entry, a prefix entry or an inherited reason. */
  readonly source: 'rule' | 'entry' | 'prefix' | 'inherited' | 'missing';
}

const normalisePath = (path: string): string =>
  path.replace(/^\/api\/v1\//, '').replace(/\{[^}]+\}/g, '{}');

function openApiPaths(repo: Repository): ReadonlyMap<string, string> {
  if (!repo.exists(OPENAPI_PATH)) {
    return new Map();
  }
  const document = JSON.parse(repo.readText(OPENAPI_PATH)) as { paths?: Record<string, unknown> };
  return new Map(Object.keys(document.paths ?? {}).map((path) => [normalisePath(path), path]));
}

const snake = (text: string): string => text.replaceAll('-', '_');

/** A verification type of ours for a source type, its plural forms included. */
function verificationType(identifier: string): string | null {
  const types: readonly string[] = VERIFICATION_TYPES;
  const forms = [identifier, identifier.replace(/s$/, ''), identifier.replace(/es$/, '')];
  return forms.map(snake).find((form) => types.includes(form)) ?? null;
}

/** The automatic counterpart of `identifier` in `section`, or `null`. */
function automatic(
  section: MappingSection,
  identifier: string,
  paths: ReadonlyMap<string, string>,
): { counterpart: string; note: string } | null {
  switch (section) {
    case 'checks':
      return CHECK_REGISTRY.some((check) => check.id === identifier)
        ? { counterpart: code(identifier), note: 'the same check id' }
        : null;
    case 'verification-types': {
      const type = verificationType(identifier);
      return type === null ? null : { counterpart: code(type), note: 'verification type' };
    }
    case 'report-types':
      return Object.hasOwn(REPORT_REGISTRY, identifier)
        ? { counterpart: code(`report/${identifier}`), note: 'the same report type' }
        : null;
    case 'list-item-types': {
      const kind = Object.values(LIST_KIND_REGISTRY).find((item) => item.plural === identifier);
      return kind === undefined
        ? null
        : {
            counterpart: code(`/api/v1/list-item/${kind.plural}`),
            note: `list kind \`${kind.kind}\``,
          };
    }
    case 'webhook-events':
      return (EVENT_NAMES as readonly string[]).includes(identifier)
        ? { counterpart: code(identifier), note: 'the same event name' }
        : null;
    case 'paths': {
      const path = paths.get(normalisePath(identifier));
      return path === undefined ? null : { counterpart: code(path), note: 'the same path family' };
    }
  }
}

function prefixEntry(section: MappingSection, identifier: string): MappingOverride | null {
  const prefixes = Object.keys(MAPPING_PREFIXES[section])
    .filter((prefix) => identifier.startsWith(prefix))
    .sort((a, b) => b.length - a.length);
  const prefix = prefixes[0];
  return prefix === undefined ? null : (MAPPING_PREFIXES[section][prefix] ?? null);
}

/** A reason inherited from the object an identifier belongs to (a report type, a verification type). */
function inherited(
  section: MappingSection,
  identifier: string,
): { reason: ReasonCode; note: string } | { counterpart: string; note: string } | null {
  if (section === 'webhook-events' && identifier.startsWith('report/')) {
    const type = identifier.slice('report/'.length, identifier.lastIndexOf('.'));
    const entry = MAPPING_OVERRIDES['report-types'][type];
    if (entry !== undefined && 'reason' in entry) {
      return { reason: entry.reason, note: `the report type \`${type}\` is not available` };
    }
    if (Object.hasOwn(REPORT_REGISTRY, type)) {
      return null;
    }
  }
  if (section === 'paths') {
    const match = /^verification\/([a-z-]+)\/\{[^}]+\}$/.exec(identifier);
    if (match?.[1] !== undefined) {
      const type = verificationType(match[1]);
      if (type !== null) {
        return {
          counterpart: code('/api/v1/verifications/{id}'),
          note: `one read route for every verification type (\`${type}\`)`,
        };
      }
      const entry =
        MAPPING_OVERRIDES['verification-types'][match[1]] ??
        prefixEntry('verification-types', match[1]);
      if (entry !== null && 'reason' in entry) {
        return {
          reason: entry.reason,
          note: `the verification type \`${match[1]}\` is not available`,
        };
      }
    }
  }
  return null;
}

/** Every identifier of the six machine sections with its row. */
export function mappingRows(repo: Repository): readonly MappingRow[] {
  if (!repo.exists(SURFACE_PATH)) {
    return [];
  }
  const surface = parseSurface(repo.readText(SURFACE_PATH));
  const paths = openApiPaths(repo);
  return MAPPING_SECTIONS.flatMap((section) =>
    surface.sections[section].map(({ identifier, remark }): MappingRow => {
      const base = { section, identifier, remark };
      const rule = automatic(section, identifier, paths);
      if (rule !== null) {
        return {
          ...base,
          counterpart: rule.counterpart,
          reason: null,
          note: rule.note,
          source: 'rule',
        };
      }
      const exact = MAPPING_OVERRIDES[section][identifier];
      const prefix = prefixEntry(section, identifier);
      const chosen = exact ?? prefix ?? inherited(section, identifier);
      const source = exact !== undefined ? 'entry' : prefix !== null ? 'prefix' : 'inherited';
      if (chosen === null) {
        return { ...base, counterpart: null, reason: null, note: '', source: 'missing' };
      }
      return 'reason' in chosen
        ? { ...base, counterpart: null, reason: chosen.reason, note: chosen.note, source }
        : { ...base, counterpart: chosen.counterpart, reason: null, note: chosen.note, source };
    }),
  );
}

/** C280.1: every identifier has a row, and the table holds no entry its rules no longer need. */
export function mappingFindings(repo: Repository): readonly CheckFinding[] {
  const rows = mappingRows(repo);
  const finding = (message: string): CheckFinding => ({
    rule: 'catalog-mapping',
    path: SURFACE_PATH,
    message,
    severity: 'error',
  });
  const listed = new Map<MappingSection, Set<string>>(
    MAPPING_SECTIONS.map((section) => [
      section,
      new Set(rows.filter((row) => row.section === section).map((row) => row.identifier)),
    ]),
  );
  return [
    ...rows
      .filter((row) => row.source === 'missing')
      .map((row) => finding(`${row.section} ${row.identifier} has no counterpart and no reason`)),
    ...MAPPING_SECTIONS.flatMap((section) =>
      Object.keys(MAPPING_OVERRIDES[section]).flatMap((identifier) => {
        if (!(listed.get(section)?.has(identifier) ?? false)) {
          return [
            finding(`${section} ${identifier} has an entry but the index no longer lists it`),
          ];
        }
        const row = rows.find((item) => item.section === section && item.identifier === identifier);
        return row?.source === 'rule'
          ? [finding(`${section} ${identifier} has an entry its automatic rule now maps (stale)`)]
          : [];
      }),
    ),
  ];
}

/** Whether `text` names the vendor (the vendor-name test's own rule). */
const namesVendor = (text: string): boolean => vendorNameFindings('', text).length > 0;

/** A source identifier as the page prints it: by role while the switch is off and it names the vendor. */
function sourceCell(identifier: string, switches: DocsSwitches): string {
  return !switches.vendorNaming && namesVendor(identifier)
    ? 'an identifier that names the source vendor (written by role while the vendor-naming switch is off)'
    : code(identifier);
}

/** Prose copied from the index, with the vendor's name written by role while the switch is off. */
function byRole(text: string, switches: DocsSwitches): string {
  if (switches.vendorNaming || !namesVendor(text)) {
    return text;
  }
  return text
    .split(/(\s+)/)
    .map((word) => (namesVendor(word) ? 'the source vendor' : word))
    .join('');
}

const CONCERNS: readonly (readonly [string, string, string, string])[] = [
  [
    'Base path',
    "the source vendor's host, under `/api/v1`",
    "`/api/v1/` on the operator's own host",
    'Change the host; most path families keep their names (the tables below).',
  ],
  [
    'Authentication',
    '`Authorization: Bearer <token>`',
    '`Authorization: Bearer` with an API key (`ov_sbx_…` or `ov_prod_…`), scoped, with an optional address allowlist and expiry ([API keys](../settings/api-keys.md))',
    'Issue new keys; map each integration to the scopes it needs ([the API reference](../api/README.md)).',
  ],
  [
    'Version header',
    "the source API's version header, dated values",
    '`OpenVerify-Version`, dated values (C12)',
    'Pin a version explicitly on both sides.',
  ],
  [
    'Key casing',
    'a request header chooses camel, kebab or snake casing',
    'kebab-case attributes only',
    'A client that relies on camel or snake casing needs a mapping layer.',
  ],
  [
    'Idempotency',
    '`Idempotency-Key` header',
    '`Idempotency-Key`, answers kept 24 hours (C12)',
    'The same header; the API reference says which operations take it.',
  ],
  [
    'Pagination',
    '`page[after]`, `page[before]`, `page[size]`',
    '`page[after]`, `page[size]`, and `page[before]` on one list only (`GET /api/v1/inquiries` has none)',
    'Backward paging needs a change.',
  ],
  [
    'Webhook signature',
    "the source API's signature header: `t=<unix>,v1=<hmac>`",
    '`OpenVerify-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, one `v1` per active secret during rotation',
    'The same scheme under another header name and secret; `@openverify/node` verifies it.',
  ],
  [
    'Ids',
    '`<prefix>_` followed by a random string',
    '`<prefix>_<ULID>` (`inq`, `itmpl`, `acc`, `ver`, `rep`, …)',
    'Source ids cannot become OpenVerify ids: carry them in `reference-id` or an account field and keep a mapping table.',
  ],
  [
    'Checks and reports',
    'names in example payloads',
    'the [check catalog](../checks/catalog.md)',
    'The tables below map each name; a result is never migrated as a passed check.',
  ],
  [
    'Events',
    'resource events, `report/<type>.<action>` for reports',
    '`EVENT_NAMES` (`@openverify/contracts`), the Connect events of C239 among them',
    'Re-subscribe each webhook by name ([the API reference](../api/README.md#webhook-events)).',
  ],
];

const CONNECT_ROWS: readonly (readonly [string, string, string])[] = [
  [
    'scope `connect.read`',
    '`connect-connections:read`, `connect-share-tokens:read`',
    'renamed (connect R19)',
  ],
  [
    'scope `connect.write`',
    '`connect-connections:write`, `connect-share-tokens:write`',
    'renamed; redeeming is `connect-share-tokens:redeem` and peeking `connect-share-tokens:peek` (ours, narrower)',
  ],
  ['scope `connect_connection.read`', '`connect-connections:read`', 'renamed'],
  [
    'scope `connect_connection.write`',
    '`connect-connections:write`',
    "renamed; activation is the console's, with a second factor (C231.3)",
  ],
  [
    'scope `connect_share_token.read`',
    '`connect-share-tokens:read`; `peek-source-data` needs `connect-share-tokens:peek`',
    'renamed',
  ],
  [
    'scope `connect_share_token.write`',
    '`connect-share-tokens:write`; redeeming needs `connect-share-tokens:redeem`',
    'renamed',
  ],
  [
    'the mobile SDK option `shareToken` (and `fieldMappings`)',
    "not on the client: the customer's server creates the inquiry with `meta.share-token-id`, and the SDK renders the `share_consent` step it is given",
    'no token reaches the client (C238.5, C238.7)',
  ],
  [
    'the hosted flow entry with `inquiry-id` and `share-token`',
    "`meta.share-token-id` on the inquiry create, then the flow's `share-consent` step",
    'no token in any URL (C238.5; review H24)',
  ],
];

function countsTable(rows: readonly MappingRow[]): string {
  return table(
    ['Section', 'Identifiers', 'Mapped', ...REASON_CODES.map(code)],
    MAPPING_SECTIONS.map((section) => {
      const own = rows.filter((row) => row.section === section);
      return [
        SECTION_TITLES[section],
        String(own.length),
        String(own.filter((row) => row.counterpart !== null).length),
        ...REASON_CODES.map((reason) => String(own.filter((row) => row.reason === reason).length)),
      ];
    }),
  );
}

function sectionTable(rows: readonly MappingRow[], switches: DocsSwitches): string {
  return table(
    ['Source identifier', 'OpenVerify', 'Reason code', 'Note'],
    rows.map((row) => [
      sourceCell(row.identifier, switches) +
        (row.remark === '' ? '' : ` ${byRole(row.remark, switches)}`),
      row.counterpart ?? 'not available',
      row.reason === null ? '-' : code(row.reason),
      row.note === '' ? '-' : row.note,
    ]),
  );
}

function proseRows(bullet: string, switches: DocsSwitches): readonly string[] {
  const colon = bullet.indexOf(': ');
  const [label, rest] =
    colon < 0 ? [bullet, ''] : [bullet.slice(0, colon), bullet.slice(colon + 2)];
  return [byRole(label, switches), rest === '' ? '-' : byRole(rest, switches)];
}

const NOT_AFFILIATED =
  'OpenVerify is not affiliated with, endorsed by or sponsored by the vendor whose public API this page maps, or any other identity-verification vendor.';

/** Renders the migration page (`docs/migration/from-hosted-api.md` while the switch is off). */
export function renderMigration(
  repo: Repository,
  switches: DocsSwitches = DOCS_SWITCHES,
): GeneratedFile | null {
  if (!repo.exists(SURFACE_PATH)) {
    return null;
  }
  const surface = parseSurface(repo.readText(SURFACE_PATH));
  const rows = mappingRows(repo);
  const content = [
    switches.vendorNaming
      ? `# Migrating from ${surface.vendor}`
      : '# Migrating from a hosted identity-verification API',
    '',
    '<!-- Generated by `pnpm --filter @openverify/docs-tools docs:catalog` (packages/docs-tools/src/catalog/); do not edit by hand. -->',
    '',
    NOT_AFFILIATED,
    '',
    `This page maps the public identifiers of a hosted identity-verification API (the "source API") to OpenVerify's, from the identifier index \`docs/research/persona-surface.md\` (the source's OpenAPI repository at version \`${surface.version}\` and its public pages, identifiers only) and OpenVerify's [OpenAPI document](../api/openapi.json). A row says where behaviour corresponds, or why it does not; it never claims that results are equivalent (C280.7). Identifiers are quoted as behaviour; no text of the source is copied.`,
    '',
    switches.vendorNaming
      ? 'The vendor-naming switch is on (Q8 granted): source identifiers are written as they are.'
      : "The vendor-naming switch is off (Q8 pending): the page names no vendor, and a source identifier that contains the vendor's name (its version and signature header names, its host, one verification type) is written by its role.",
    '',
    '## Concerns',
    '',
    table(
      ['Concern', 'Source API', 'OpenVerify', 'Migration note'],
      CONCERNS.map((row) => [...row]),
    ),
    '',
    '## What does not migrate',
    '',
    "- Historical captures and results are imported, if at all, as account fields or attachments labelled with their source, never as passed checks: they were not produced by OpenVerify's checks (rule 5, ADR 0002).",
    '- A cloned-result route does not exist between platforms: Connect shares verifications between two organisations of one OpenVerify install only ([limits of sharing](../connect/limits.md)).',
    '- Source ids do not carry over; keep them in `reference-id` or an account field with a mapping table.',
    '',
    '## Counts',
    '',
    countsTable(rows),
    '',
    "Reason codes (C280.1): `next-release`, planned for the next release; `not-planned`, not in OpenVerify's plan; `licensed-data`, needs a licensed data source or an operator contract (OpenVerify ships adapters plus a deterministic sandbox provider for those it builds, rule 5); `vendor-retiring`, the source is retiring it.",
    '',
    ...MAPPING_SECTIONS.flatMap((section) => [
      `## ${SECTION_TITLES[section]}`,
      '',
      sectionTable(
        rows.filter((row) => row.section === section),
        switches,
      ),
      '',
    ]),
    ...surface.prose.flatMap((section) => [
      `## ${byRole(section.heading, switches)}`,
      '',
      `From the identifier index, as it records them: ${byRole(section.intro, switches)}`,
      '',
      table(
        ['Item', 'Identifiers, and how OpenVerify serves them where the index says'],
        section.bullets.map((bullet) => proseRows(bullet, switches)),
      ),
      '',
    ]),
    '## Connect: scopes and entry points (C280.1)',
    '',
    table(
      ['Source', 'OpenVerify', 'Note'],
      CONNECT_ROWS.map((row) => [...row]),
    ),
    '',
  ].join('\n');
  return { path: migrationPagePath(switches), content: `${content.trimEnd()}\n` };
}

/** Renders `docs/connect/mapping.md`: the index's Connect paths against OpenVerify's, and the Connect table. */
export function renderConnectMapping(
  repo: Repository,
  switches: DocsSwitches = DOCS_SWITCHES,
): GeneratedFile | null {
  if (!repo.exists(SURFACE_PATH)) {
    return null;
  }
  const paths = openApiPaths(repo);
  const surface = parseSurface(repo.readText(SURFACE_PATH));
  const connect = surface.prose.find((section) => section.heading.startsWith('Connect'));
  const resources = (connect?.bullets ?? [])
    .filter((bullet) => bullet.startsWith('`connect/'))
    .map((bullet) => bullet.slice(1, bullet.indexOf('`', 1)))
    .filter((identifier) => !identifier.includes('.'));
  const content = [
    '# Mapping from the source API (Connect)',
    '',
    '<!-- Generated by `pnpm --filter @openverify/docs-tools docs:catalog` (packages/docs-tools/src/catalog/); do not edit by hand. -->',
    '',
    NOT_AFFILIATED,
    '',
    `The source API's ${String(resources.length)} Connect paths against OpenVerify's, from the identifier index and [the OpenAPI document](../api/openapi.json); the whole mapping is [the migration page](../migration/${migrationPagePath(switches).split('/').pop() ?? ''}). A row says where behaviour corresponds, never that results are equivalent.`,
    '',
    table(
      ['Source path', 'OpenVerify'],
      resources.map((resource) => [
        code(resource),
        cell(
          paths.has(normalisePath(resource))
            ? code(paths.get(normalisePath(resource)) ?? '')
            : 'not available',
        ),
      ]),
    ),
    '',
    "Ours, beside them (each with its reason in [connections](connections.md), [share tokens](share-tokens.md) and [consent](consent.md)): `POST /api/v1/connect/connections/{id}/share-policy` (versioned policies), the console's activation with a second factor, `/api/v1/connect/consent-records` (attest, retrieve, withdraw) and the flow's `share-consent` exits.",
    '',
    '## Scopes and entry points',
    '',
    table(
      ['Source', 'OpenVerify', 'Note'],
      CONNECT_ROWS.map((row) => [...row]),
    ),
    '',
  ].join('\n');
  return { path: CONNECT_MAPPING_PATH, content: `${content.trimEnd()}\n` };
}
