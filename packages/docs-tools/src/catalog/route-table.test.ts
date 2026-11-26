/**
 * C279.3's route table as a committed input (Workflow 11E, integration-11e; a Validation fix):
 * building the API in a child process took 8-10 s alone but met its 50 s guard at a load of 40 in
 * the all-packages call, so the catalog renders from `docs/api/route-table.json`, which only
 * `docs:catalog` writes (its `routes` step runs the collector). These tests never build the API:
 * the collector is a fake script in a temporary directory.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryRepository, createRepository, REPOSITORY_ROOT } from '../repository.js';
import { OPENAPI_PATH } from './api-reference.js';
import {
  ROUTE_TABLE_PATH,
  collectRouteTable,
  parseCommittedRouteTable,
  routeTableFor,
  serializeRouteTable,
  type RouteTable,
} from './route-table.js';

const TABLE: RouteTable = {
  routes: [
    { method: 'GET', url: '/api/v1/inquiries', scopes: ['inquiries:read'], public: false },
    {
      method: 'POST',
      url: '/api/v1/inquiries',
      scopes: ['inquiries:write', 'inquiries:read'],
      public: false,
    },
    { method: 'GET', url: '/health', scopes: null, public: true },
    { method: 'GET', url: '/api/v1/empty', scopes: [], public: false },
  ],
  constants: {
    flowPrefix: '/api/v1/flow',
    oneTimeLinkRedeem: '/api/v1/flow/one-time-links/redeem',
    signals: '/api/v1/flow/signals',
    handoffs: '/api/v1/flow/handoffs',
    handoffTokenRoutes: ['/api/v1/flow/handoffs/a', '/api/v1/flow/handoffs/b'],
    integrityRoutes: [],
    sandboxChip: '/api/v1/flow/sandbox-chip',
  },
};

/** A collector script that prints `stdout` and exits with `code`. */
function fakeCollector(stdout: string, code = 0): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'docs-tools-routes-'));
  const file = path.join(directory, 'collector.mjs');
  writeFileSync(
    file,
    `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${String(code)};\n`,
  );
  return file;
}

describe('the committed route table', () => {
  it('round-trips through its committed form, which holds no list of plain values', () => {
    const text = serializeRouteTable(TABLE);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toMatch(/\[\s*"/);
    expect(parseCommittedRouteTable(text)).toEqual(TABLE);
  });

  it('refuses a text that is not a committed route table', () => {
    expect(parseCommittedRouteTable('not json')).toBeNull();
    expect(parseCommittedRouteTable('{"routes": 1}')).toBeNull();
  });

  it('is what the catalog reads, from any repository that holds it', () => {
    const repo = createMemoryRepository({ [ROUTE_TABLE_PATH]: serializeRouteTable(TABLE) });
    expect(routeTableFor(repo)).toEqual(TABLE);
    expect(routeTableFor(createMemoryRepository({}))).toBeNull();
  });

  it('is committed and holds a route for every operation openapi.json documents', () => {
    const repo = createRepository(REPOSITORY_ROOT);
    const table = routeTableFor(repo);
    expect(table).not.toBeNull();
    const registered = new Set(
      (table?.routes ?? []).map((route) => `${route.method} ${route.url}`),
    );
    const document = JSON.parse(repo.readText(OPENAPI_PATH)) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const missing = Object.entries(document.paths).flatMap(([url, item]) =>
      Object.keys(item)
        .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map((method) => `${method.toUpperCase()} ${url.replace(/\{([^}]+)\}/g, ':$1')}`)
        .filter((operation) => !registered.has(operation)),
    );
    expect(missing).toEqual([]);
  });
});

describe('collectRouteTable', () => {
  it("reads the collector's table", () => {
    expect(collectRouteTable(REPOSITORY_ROOT, fakeCollector(JSON.stringify(TABLE)))).toEqual(TABLE);
  });

  it('throws when the collector fails or prints something else', () => {
    expect(() => collectRouteTable(REPOSITORY_ROOT, fakeCollector('', 3))).toThrow(
      /route table collector failed/,
    );
    expect(() => collectRouteTable(REPOSITORY_ROOT, fakeCollector('nonsense'))).toThrow(
      /route table collector failed/,
    );
  });
});
