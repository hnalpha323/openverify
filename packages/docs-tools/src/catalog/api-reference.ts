/**
 * C279.3: `docs/api/README.md`, generated from `docs/api/openapi.json` (unchanged), the route
 * table of {@link routeTableFor} (each route's `config.scopes`), the rate-limit plugin's route
 * constants and the three rate-limit maps of `@openverify/contracts`, the event names and their
 * committed samples. Routes declare no problem codes, so the page gives the problem document's
 * shape and a link to each family's page (review F18; per-route codes are deferred, C286).
 *
 * Rate policies: the plugin binds `api`, `flow-ip`, `flow-session` and a few flow policies by
 * route (`apps/api/src/plugins/rate-limit.ts`); every other policy is a call in a handler or a
 * service, and no table maps a route to it, so those are listed with their limit and window and
 * no route (Workflow 11E Stage 1a amendment 6; the missing declaration is 11F's, fix-server).
 */
import {
  EVENT_NAMES,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_WINDOWS,
} from '@openverify/contracts';
import type { CheckFinding, GeneratedFile, Repository } from '../types.js';
import { code, list, sorted, table } from './markdown.js';
import type { RouteTable } from './route-table.js';

export const API_README_PATH = 'docs/api/README.md';
export const OPENAPI_PATH = 'docs/api/openapi.json';
const SAMPLES_DIR = 'contracts/fixtures/api';

/**
 * Ours (docs-catalog): the page under `docs/` that describes each OpenAPI tag's resources and the
 * problems its routes answer. A test holds every tag of the document to an entry and every entry
 * to a page that exists.
 */
export const TAG_PAGES: Readonly<Record<string, string>> = Object.freeze({
  system: 'docs/self-hosting/monitoring.md',
  'inquiry-templates': 'docs/flows/README.md',
  'inquiry-template-versions': 'docs/flows/README.md',
  deployments: 'docs/flows/README.md',
  'theme-sets': 'docs/themes/README.md',
  inquiries: 'docs/flows/README.md',
  'inquiry-sessions': 'docs/flow/README.md',
  devices: 'docs/checks/signals.md',
  decisions: 'docs/compliance/automated-decisions.md',
  verifications: 'docs/checks/catalog.md',
  accounts: 'docs/graph/README.md',
  webhooks: 'docs/settings/webhooks.md',
  events: 'docs/settings/webhooks.md',
  'api-keys': 'docs/settings/api-keys.md',
  'api-logs': 'docs/settings/README.md',
  'rate-limits': 'docs/settings/README.md',
  connect: 'docs/connect/README.md',
  'account-exports': 'docs/compliance/README.md',
  'user-audit-logs': 'docs/settings/audit-log.md',
  reports: 'docs/reports/README.md',
  'report-templates': 'docs/reports/README.md',
  lists: 'docs/lists/README.md',
  'list-items': 'docs/lists/README.md',
  'list-matches': 'docs/lists/README.md',
  importers: 'docs/lists/importers.md',
  'transaction-types': 'docs/transactions/README.md',
  'transaction-type-versions': 'docs/transactions/README.md',
  transactions: 'docs/transactions/README.md',
  'graph-query-templates': 'docs/graph/README.md',
  'graph-queries': 'docs/graph/README.md',
  workflows: 'docs/workflows/errors.md',
  'workflow-versions': 'docs/workflows/README.md',
  'workflow-recipes': 'docs/workflows/recipes.md',
  'workflow-runs': 'docs/workflows/README.md',
  'account-actions': 'docs/workflows/triggers.md',
  'workflow-secrets': 'docs/workflows/secrets.md',
  sandbox: 'docs/workflows/messaging.md',
  cases: 'docs/cases/README.md',
  'case-templates': 'docs/cases/templates.md',
  'case-actions': 'docs/cases/workflows.md',
  'case-queues': 'docs/cases/queues.md',
  'case-assignment-policies': 'docs/cases/queues.md',
  'case-sla-policies': 'docs/cases/sla.md',
  'case-calendars': 'docs/cases/sla.md',
  analytics: 'docs/analytics/README.md',
  exports: 'docs/analytics/exports.md',
  flow: 'docs/flow/README.md',
  dashboard: 'docs/settings/README.md',
});

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Parameter {
  readonly $ref?: string;
  readonly name?: string;
  readonly in?: string;
}

interface Operation {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly parameters?: readonly Parameter[];
  readonly security?: readonly Record<string, unknown>[];
}

interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly security?: readonly Record<string, unknown>[];
  readonly components?: {
    readonly parameters?: Readonly<Record<string, Record<string, unknown>>>;
    readonly schemas?: Readonly<Record<string, Record<string, unknown>>>;
  };
}

interface DocumentedOperation {
  readonly method: string;
  readonly path: string;
  readonly tag: string;
  readonly operation: Operation;
}

function readDocument(repo: Repository): OpenApiDocument | null {
  if (!repo.exists(OPENAPI_PATH)) {
    return null;
  }
  const value = JSON.parse(repo.readText(OPENAPI_PATH)) as unknown;
  return typeof value === 'object' && value !== null && 'paths' in value
    ? (value as OpenApiDocument)
    : null;
}

function operationsOf(document: OpenApiDocument): readonly DocumentedOperation[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method): DocumentedOperation[] => {
      const operation = item[method];
      if (typeof operation !== 'object' || operation === null) {
        return [];
      }
      const typed = operation as Operation;
      return [
        {
          method: method.toUpperCase(),
          path,
          tag: typed.tags?.[0] ?? 'untagged',
          operation: typed,
        },
      ];
    }),
  );
}

/** `/a/{id}/b` as Fastify writes it, `/a/:id/b`. */
const fastifyUrl = (path: string): string => path.replace(/\{([^}]+)\}/g, ':$1');

const parameterNames = (document: OpenApiDocument, operation: Operation): readonly string[] =>
  (operation.parameters ?? []).flatMap((parameter) => {
    if (parameter.$ref !== undefined) {
      const name = document.components?.parameters?.[parameter.$ref.split('/').pop() ?? '']?.name;
      return typeof name === 'string' ? [name] : [];
    }
    return parameter.name === undefined ? [] : [parameter.name];
  });

const securityOf = (
  document: OpenApiDocument,
  operation: Operation,
): readonly Record<string, unknown>[] => operation.security ?? document.security ?? [];

/** The scope cell: the route's scopes, `public`, `flow session`, or `not read`. */
function scopeCell(
  document: OpenApiDocument,
  item: DocumentedOperation,
  routes: RouteTable | null,
): string {
  const route = routes?.routes.find(
    (entry) => entry.method === item.method && entry.url === fastifyUrl(item.path),
  );
  if (route === undefined) {
    return 'not read';
  }
  if (route.scopes !== null && route.scopes.length > 0) {
    return route.scopes.map(code).join(', ');
  }
  const security = securityOf(document, item.operation);
  if (route.public || security.length === 0) {
    return 'public';
  }
  return security.some((scheme) => 'sessionToken' in scheme) ? 'flow session' : 'in the handler';
}

/** The policies the rate-limit plugin applies to one route (its hooks, read as a table). */
function policiesOf(
  document: OpenApiDocument,
  item: DocumentedOperation,
  routes: RouteTable | null,
): readonly string[] {
  if (routes === null) {
    return [];
  }
  const { constants } = routes;
  const url = fastifyUrl(item.path);
  const security = securityOf(document, item.operation);
  const principal = security.some((scheme) => 'apiKey' in scheme || 'userSession' in scheme);
  if (!url.startsWith(constants.flowPrefix)) {
    return principal ? ['api'] : [];
  }
  const post = item.method === 'POST';
  const session = security.some((scheme) => 'sessionToken' in scheme);
  return [
    'flow-ip',
    ...(post && (url === constants.oneTimeLinkRedeem || constants.handoffTokenRoutes.includes(url))
      ? ['one-time-link-redeem']
      : []),
    ...(post && url === constants.handoffs ? ['flow-handoffs-ip'] : []),
    ...(session ? ['flow-session'] : []),
    ...(session && post && url === constants.signals ? ['flow-signals'] : []),
    ...(session && post && url === constants.handoffs ? ['flow-handoffs'] : []),
    ...(session && post && constants.integrityRoutes.includes(url) ? ['flow-integrity'] : []),
    ...(session && post && url === constants.sandboxChip ? ['flow-sandbox-chip'] : []),
  ];
}

/** The plugin-bound policies, which the per-route column names. */
const PLUGIN_POLICIES: readonly string[] = [
  'api',
  'flow-ip',
  'flow-session',
  'one-time-link-redeem',
  'flow-signals',
  'flow-handoffs',
  'flow-handoffs-ip',
  'flow-integrity',
  'flow-sandbox-chip',
];

function windowText(seconds: number): string {
  if (seconds === 60) return 'a minute';
  if (seconds === 3600) return 'an hour';
  if (seconds === 86_400) return 'a day';
  if (seconds % 3600 === 0) return `${String(seconds / 3600)} hours`;
  if (seconds % 60 === 0) return `${String(seconds / 60)} minutes`;
  return `${String(seconds)} seconds`;
}

function tagSection(
  document: OpenApiDocument,
  tag: string,
  operations: readonly DocumentedOperation[],
  routes: RouteTable | null,
): string[] {
  const page = TAG_PAGES[tag];
  return [
    `### ${code(tag)}`,
    '',
    page === undefined
      ? `${String(operations.length)} operations.`
      : `${String(operations.length)} operations. Family page: [${page.slice('docs/'.length)}](../${page.slice('docs/'.length)}).`,
    '',
    table(
      ['Method', 'Path', 'Summary', 'Scope', 'Idempotency-Key', 'Paginated', 'Rate policies'],
      operations.map((item) => {
        const names = parameterNames(document, item.operation);
        return [
          item.method,
          code(item.path),
          item.operation.summary ?? '-',
          scopeCell(document, item, routes),
          names.includes('Idempotency-Key') ? 'yes' : '-',
          names.some((name) => name.startsWith('page[')) ? 'yes' : '-',
          list(policiesOf(document, item, routes).map(code), '-'),
        ];
      }),
    ),
    '',
  ];
}

/** The committed event samples by event name (each `event-*.json` under `contracts/fixtures/api/`). */
function eventSamples(repo: Repository): ReadonlyMap<string, readonly string[]> {
  const samples = new Map<string, string[]>();
  for (const file of repo.listFiles(SAMPLES_DIR)) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (!name.startsWith('event-') || !name.endsWith('.json')) {
      continue;
    }
    const value = JSON.parse(repo.readText(file)) as {
      data?: { attributes?: { name?: unknown } };
    };
    const event = value.data?.attributes?.name;
    if (typeof event === 'string') {
      samples.set(event, [...(samples.get(event) ?? []), file]);
    }
  }
  return samples;
}

function problemSection(document: OpenApiDocument): string[] {
  const schema = document.components?.schemas?.ProblemInput;
  const properties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
  return [
    '## Problems',
    '',
    'Every error is an RFC 9457 problem document (`application/problem+json`), the `ProblemInput` schema of the document:',
    '',
    table(
      ['Member', 'Type', 'Required'],
      Object.entries(properties).map(([name, property]) => [
        code(name),
        typeof property.type === 'string' ? property.type : 'see the schema',
        required.includes(name) ? 'yes' : '-',
      ]),
    ),
    '',
    "Routes declare no problem codes, so this page has no per-route problem column (review F18; declaring them is deferred, C286): each tag's section links its family's page, which describes the resources and, where it lists them, their problem codes.",
    '',
  ];
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function headerSection(document: OpenApiDocument): string[] {
  const parameters = document.components?.parameters ?? {};
  const pageParameters = [
    ...new Set(
      operationsOf(document).flatMap((item) =>
        parameterNames(document, item.operation).filter((name) => name.startsWith('page[')),
      ),
    ),
  ].sort();
  const version = parameters.OpenVerifyVersion;
  const versions = ((version?.schema as { enum?: unknown } | undefined)?.enum ?? []) as unknown[];
  const idempotency = parameters.IdempotencyKey;
  return [
    '## Versions, idempotency and pagination',
    '',
    `- **${code('OpenVerify-Version')}** (request and response header): ${textOf(version?.description)} Versions: ${list(versions.map((item) => code(String(item))))}.`,
    `- **${code('Idempotency-Key')}**: ${textOf(idempotency?.description)} The column "Idempotency-Key" below says which operations accept it.`,
    `- **Pagination**: the page parameters the document declares are ${list(pageParameters.map(code))}; the column "Paginated" says which operations take one.`,
    '- **Rate limits**: a response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` for the tightest limit that applied; over a limit the request answers 429 with `Retry-After`. When the limiter is unavailable the plugin-bound policies fail open (C12).',
    '',
  ];
}

function rateLimitSection(): string[] {
  return [
    '## Rate policies',
    '',
    `${String(RATE_LIMIT_POLICIES.length)} policies (\`RATE_LIMIT_POLICIES\`, with \`RATE_LIMIT_DEFAULTS\` and \`RATE_LIMIT_POLICY_WINDOWS\`, \`@openverify/contracts\`). The rate-limit plugin binds the first group to routes by prefix or by route, as the table above names them. Every other policy is applied by a call in a handler or a service, and no table maps a route to it, so it is listed here with its limit and window only (a per-route declaration is 11F's, \`fix-server\`).`,
    '',
    table(
      ['Policy', 'Default limit', 'Window', 'Bound by'],
      sorted(
        RATE_LIMIT_POLICIES.map((policy) => ({ policy, plugin: PLUGIN_POLICIES.includes(policy) })),
        (item) => `${item.plugin ? '0' : '1'}${item.policy}`,
      ).map((item) => [
        code(item.policy),
        String(RATE_LIMIT_DEFAULTS[item.policy]),
        windowText(RATE_LIMIT_POLICY_WINDOWS[item.policy]),
        item.plugin ? 'the rate-limit plugin' : 'a handler or service (no route table)',
      ]),
    ),
    '',
  ];
}

function eventSection(repo: Repository): string[] {
  const samples = eventSamples(repo);
  return [
    '## Webhook events',
    '',
    `${String(EVENT_NAMES.length)} event names (\`EVENT_NAMES\`, \`@openverify/contracts\`); a webhook subscribes to them by name, and each delivery is signed (see [webhooks](../settings/webhooks.md)). A sample is a committed fixture the API's tests hold; an event without one has none committed.`,
    '',
    table(
      ['Event', 'Sample'],
      sorted([...EVENT_NAMES], (name) => name).map((name) => [
        code(name),
        list(
          (samples.get(name) ?? []).map(
            (file) => `[${file.slice(file.lastIndexOf('/') + 1)}](../../${file})`,
          ),
          '-',
        ),
      ]),
    ),
    '',
  ];
}

/** Renders `docs/api/README.md`; `null` without the OpenAPI document. Never writes. */
export const renderApiReference: (
  repo: Repository,
  routes: RouteTable | null,
) => GeneratedFile | null = (repo, routes) => {
  const document = readDocument(repo);
  if (document === null) {
    return null;
  }
  const operations = operationsOf(document);
  const tags = [...new Set(operations.map((item) => item.tag))];
  const content = [
    '# API reference',
    '',
    '<!-- Generated by `pnpm --filter @openverify/docs-tools docs:catalog` (packages/docs-tools/src/catalog/); do not edit by hand. -->',
    '',
    `The OpenAPI 3.1 document is [openapi.json](openapi.json) (${String(Object.keys(document.paths).length)} paths, ${String(operations.length)} operations), generated from the routes' zod schemas. This page adds what the document does not carry: each route's scope (its \`config.scopes\`, read from the routes as the API registers them), whether it takes an \`Idempotency-Key\`, whether it is paginated, and the rate policies the rate-limit plugin binds to it.`,
    '',
    "- **Scope**: the API-key scopes the route requires (any one of them); `public`: no credential; `flow session`: the flow session token; `in the handler`: the route declares no `config.scopes`, needs an API key or a console session, and checks any scope it needs in its handler (see the operation's description in openapi.json); `not read`: no registered route was found for the documented operation.",
    '- **Authentication**: `Authorization: Bearer` with an API key or a console user session, or a flow session token on the flow routes; see [API keys](../settings/api-keys.md).',
    '',
    ...headerSection(document),
    '## Operations by tag',
    '',
    ...tags.flatMap((tag) =>
      tagSection(
        document,
        tag,
        operations.filter((item) => item.tag === tag),
        routes,
      ),
    ),
    ...rateLimitSection(),
    ...problemSection(document),
    ...eventSection(repo),
  ].join('\n');
  return { path: API_README_PATH, content: `${content.trimEnd()}\n` };
};

/** Every tag of the document has a page, and every page exists. */
export const apiReferenceFindings: (repo: Repository) => readonly CheckFinding[] = (repo) => {
  const document = readDocument(repo);
  const finding = (message: string): CheckFinding => ({
    rule: 'catalog-api-reference',
    path: API_README_PATH,
    message,
    severity: 'error',
  });
  const tags =
    document === null ? [] : [...new Set(operationsOf(document).map((item) => item.tag))];
  return [
    ...tags
      .filter((tag) => TAG_PAGES[tag] === undefined)
      .map((tag) => finding(`no page for the tag ${tag}`)),
    ...[...new Set(Object.values(TAG_PAGES))]
      .filter((page) => !repo.exists(page))
      .map((page) => finding(`${page} does not exist`)),
  ];
};
