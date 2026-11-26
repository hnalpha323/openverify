/**
 * C279.3: the routes as the API registers them, read without a code change (Workflow 11E Stage 1a
 * amendment 6). Scopes live only in each route's `config.scopes` (`openapi.test.ts` keeps them
 * out of the served document), so {@link collectRouteTable} runs `route-table-collector.ts` in a
 * child Node process: it builds the app in memory as `apps/api/src/openapi.test.ts` does (no
 * database touched, the environment that writes `docs/api/openapi.json`), records every route
 * through an `onRoute` hook, and prints the table with the rate-limit plugin's route constants.
 *
 * Building the API takes 8-10 s alone and met a 50 s guard at a load of 40 in Workflow 11E's
 * Validation, so no test builds it (integration-11e): `docs:catalog`'s `routes` step (the CLI's
 * `routes` command) writes the table to `docs/api/route-table.json`, as `openapi:write` writes
 * `openapi.json`, and the catalog renders from that committed file ({@link routeTableFor}). A test
 * holds the file to every operation `openapi.json` documents; a scope change alone shows as a diff
 * after `docs:catalog`, which the Validation runs. A repository without the file (a fixture) gets
 * `null`, and the page says the scope was not read.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { GeneratedFile, Repository } from '../types.js';

/** One registered route: its method, Fastify URL, `config.scopes` and `config.public`. */
export interface RouteEntry {
  readonly method: string;
  readonly url: string;
  readonly scopes: readonly string[] | null;
  readonly public: boolean;
}

/** The route constants the rate-limit plugin binds its flow policies to. */
export interface RateLimitRouteConstants {
  readonly flowPrefix: string;
  readonly oneTimeLinkRedeem: string;
  readonly signals: string;
  readonly handoffs: string;
  readonly handoffTokenRoutes: readonly string[];
  readonly integrityRoutes: readonly string[];
  readonly sandboxChip: string;
}

export interface RouteTable {
  readonly routes: readonly RouteEntry[];
  readonly constants: RateLimitRouteConstants;
}

/** The collector script, beside this file. */
export const ROUTE_TABLE_COLLECTOR = path.join(import.meta.dirname, 'route-table-collector.ts');
/**
 * The child's own guard. Only the writer runs the real collector (no test does), so it is not
 * bound by the tests' 60 s hang guard: 8-10 s alone, and more than 50 s at a load of 40.
 */
export const ROUTE_TABLE_TIMEOUT_MS = 300_000;

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

function isRoute(value: unknown): value is RouteEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const route = value as Record<string, unknown>;
  return (
    isString(route.method) &&
    isString(route.url) &&
    (route.scopes === null || isStringList(route.scopes)) &&
    typeof route.public === 'boolean'
  );
}

function isConstants(value: unknown): value is RateLimitRouteConstants {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const constants = value as Record<string, unknown>;
  return (
    ['flowPrefix', 'oneTimeLinkRedeem', 'signals', 'handoffs', 'sandboxChip'].every((key) =>
      isString(constants[key]),
    ) &&
    isStringList(constants.handoffTokenRoutes) &&
    isStringList(constants.integrityRoutes)
  );
}

/** The collector's output, or `null` when it is not a route table. */
export const parseRouteTable: (text: string) => RouteTable | null = (text) => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const table = value as Record<string, unknown>;
  return Array.isArray(table.routes) && table.routes.every(isRoute) && isConstants(table.constants)
    ? { routes: table.routes, constants: table.constants }
    : null;
};

/** The committed route table (`docs:catalog`'s `routes` step writes it; the catalog renders from it). */
export const ROUTE_TABLE_PATH = 'docs/api/route-table.json';

/** A list as the committed file holds it: one space-separated string (no list of plain values). */
const joined = (values: readonly string[]): string => values.join(' ');
const split = (value: string): string[] => (value === '' ? [] : value.split(' '));

/**
 * The committed file's text for `table`: `JSON.stringify` with two spaces, every list of plain
 * values written as one space-separated string (scopes and URLs hold no space), so prettier's
 * JSON formatting leaves it as it is (it would fold a short list onto one line).
 */
export const serializeRouteTable: (table: RouteTable) => string = (table) =>
  `${JSON.stringify(
    {
      routes: table.routes.map((route) => ({
        method: route.method,
        url: route.url,
        scopes: route.scopes === null ? null : joined(route.scopes),
        public: route.public,
      })),
      constants: {
        ...table.constants,
        handoffTokenRoutes: joined(table.constants.handoffTokenRoutes),
        integrityRoutes: joined(table.constants.integrityRoutes),
      },
    },
    null,
    2,
  )}\n`;

/** The committed file's table, or `null` when the text is not one. */
export const parseCommittedRouteTable: (text: string) => RouteTable | null = (text) => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const table = value as Record<string, unknown>;
  const constants = table.constants as Record<string, unknown> | undefined;
  if (
    !Array.isArray(table.routes) ||
    typeof constants !== 'object' ||
    !isString(constants.handoffTokenRoutes) ||
    !isString(constants.integrityRoutes)
  ) {
    return null;
  }
  const routes = (table.routes as unknown[]).map((route): unknown => {
    const entry = route as Record<string, unknown> | null;
    return typeof entry === 'object' && entry !== null && isString(entry.scopes)
      ? { ...entry, scopes: split(entry.scopes) }
      : entry;
  });
  return parseRouteTable(
    JSON.stringify({
      routes,
      constants: {
        ...constants,
        handoffTokenRoutes: split(constants.handoffTokenRoutes),
        integrityRoutes: split(constants.integrityRoutes),
      },
    }),
  );
};

/**
 * Runs `collector` (the real `route-table-collector.ts` by default) against the API under `root`
 * in a child Node process; throws with its stderr when it fails. Only `docs:catalog`'s `routes`
 * step runs the real collector, never a test.
 */
export const collectRouteTable: (root: string, collector?: string) => RouteTable = (
  root,
  collector = ROUTE_TABLE_COLLECTOR,
) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('OPENVERIFY_') && key !== 'NODE_OPTIONS',
    ),
  );
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--no-warnings',
      '--conditions=@openverify/source',
      '--import',
      path.join(import.meta.dirname, '../../scripts/register-ts.mjs'),
      collector,
      root,
    ],
    {
      cwd: path.join(root, 'apps/api'),
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: ROUTE_TABLE_TIMEOUT_MS,
    },
  );
  const table = result.status === 0 ? parseRouteTable(result.stdout) : null;
  if (table === null) {
    throw new Error(
      `the route table collector failed (status ${String(result.status)}): ${result.stderr.slice(-2000)}`,
    );
  }
  return table;
};

/** The committed route table, freshly collected from the API under `root` (the writer's input). */
export const renderRouteTable: (root: string) => GeneratedFile = (root) => ({
  path: ROUTE_TABLE_PATH,
  content: serializeRouteTable(collectRouteTable(root)),
});

/**
 * The route table the catalog renders from: the committed `docs/api/route-table.json`, or `null`
 * when the repository holds none (a fixture), so the page says the scope was not read.
 */
export const routeTableFor: (repo: Repository) => RouteTable | null = (repo) =>
  repo.exists(ROUTE_TABLE_PATH) ? parseCommittedRouteTable(repo.readText(ROUTE_TABLE_PATH)) : null;
