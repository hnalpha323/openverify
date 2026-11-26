/** C279.3: the generated API reference, over fixtures (the real tree's page is held in index.test.ts, which reads the route table once). */
import { RATE_LIMIT_POLICIES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../repository.js';
import {
  API_README_PATH,
  OPENAPI_PATH,
  TAG_PAGES,
  apiReferenceFindings,
  renderApiReference,
} from './api-reference.js';
import { parseRouteTable, type RouteTable } from './route-table.js';

const document = {
  openapi: '3.1.0',
  info: { title: 'OpenVerify API', version: '0.0.0' },
  security: [{ apiKey: [] }, { userSession: [] }],
  components: {
    parameters: {
      OpenVerifyVersion: {
        name: 'OpenVerify-Version',
        in: 'header',
        description: 'The API version to serve.',
        schema: { type: 'string', enum: ['2026-10-01'] },
      },
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        description: 'Makes the request safe to retry for 24 hours.',
      },
    },
    schemas: {
      ProblemInput: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    '/api/v1/inquiries': {
      get: {
        tags: ['inquiries'],
        summary: 'List inquiries',
        parameters: [
          { in: 'query', name: 'page[size]' },
          { in: 'query', name: 'page[after]' },
        ],
        responses: {},
      },
      post: {
        tags: ['inquiries'],
        summary: 'Create an inquiry',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        responses: {},
      },
    },
    '/api/v1/inquiries/{id}': {
      get: { tags: ['inquiries'], summary: 'Retrieve an inquiry', responses: {} },
    },
    '/api/v1/flow/signals': {
      post: {
        tags: ['flow'],
        summary: 'Send signals',
        security: [{ sessionToken: [] }],
        responses: {},
      },
    },
    '/api/v1/flow/handoffs/redeem': {
      post: { tags: ['flow'], summary: 'Redeem a handoff', security: [], responses: {} },
    },
    '/health': { get: { tags: ['system'], summary: 'Liveness', security: [], responses: {} } },
  },
};

const routes: RouteTable = {
  routes: [
    { method: 'GET', url: '/api/v1/inquiries', scopes: ['inquiries:read'], public: false },
    { method: 'POST', url: '/api/v1/inquiries', scopes: ['inquiries:write'], public: false },
    { method: 'GET', url: '/api/v1/inquiries/:id', scopes: ['inquiries:read'], public: false },
    { method: 'POST', url: '/api/v1/flow/signals', scopes: null, public: false },
    { method: 'POST', url: '/api/v1/flow/handoffs/redeem', scopes: null, public: true },
    { method: 'GET', url: '/health', scopes: null, public: true },
  ],
  constants: {
    flowPrefix: '/api/v1/flow/',
    oneTimeLinkRedeem: '/api/v1/flow/one-time-links/redeem',
    signals: '/api/v1/flow/signals',
    handoffs: '/api/v1/flow/handoffs',
    handoffTokenRoutes: ['/api/v1/flow/handoffs/preview', '/api/v1/flow/handoffs/redeem'],
    integrityRoutes: ['/api/v1/flow/integrity-challenges'],
    sandboxChip: '/api/v1/flow/verifications/:id/sandbox-chip',
  },
};

const repo = createMemoryRepository({
  [OPENAPI_PATH]: JSON.stringify(document),
  'contracts/fixtures/api/event-inquiry-completed.json': JSON.stringify({
    data: { type: 'event', attributes: { name: 'inquiry.completed' } },
  }),
});

const render = (table: RouteTable | null = routes): string =>
  renderApiReference(repo, table)?.content ?? '';

describe('renderApiReference', () => {
  it('writes docs/api/README.md, the same bytes twice', () => {
    expect(renderApiReference(repo, routes)?.path).toBe(API_README_PATH);
    expect(render()).toBe(render());
  });

  it('groups every operation by tag, with its scope, idempotency and pagination', () => {
    const page = render();
    expect(page).toContain('\n### `inquiries`');
    expect(page).toContain(
      '| GET | `/api/v1/inquiries` | List inquiries | `inquiries:read` | - | yes |',
    );
    expect(page).toContain(
      '| POST | `/api/v1/inquiries` | Create an inquiry | `inquiries:write` | yes | - |',
    );
    expect(page).toContain('| GET | `/health` | Liveness | public | - | - |');
  });

  it('names the rate policies the plugin binds to each route', () => {
    const page = render();
    expect(page).toMatch(/\| POST \| `\/api\/v1\/inquiries` \|[^\n]*\| `api` \|/);
    expect(page).toMatch(
      /\| POST \| `\/api\/v1\/flow\/signals` \|[^\n]*\| `flow-ip`, `flow-session`, `flow-signals` \|/,
    );
    expect(page).toMatch(
      /\| POST \| `\/api\/v1\/flow\/handoffs\/redeem` \|[^\n]*\| `flow-ip`, `one-time-link-redeem` \|/,
    );
  });

  it('lists every rate policy with its limit and window, an hour read as an hour', () => {
    const page = render();
    for (const policy of RATE_LIMIT_POLICIES) {
      expect(page).toContain(`| \`${policy}\` |`);
    }
    expect(page).toMatch(/\| `importers` \| 10 \| an hour \|/);
  });

  it('describes the version header, the problem shape and the events with their samples', () => {
    const page = render();
    expect(page).toContain('`OpenVerify-Version`');
    expect(page).toContain('`2026-10-01`');
    expect(page).toContain('| `type` | string |');
    expect(page).toContain(
      '`inquiry.completed` | [event-inquiry-completed.json](../../contracts/fixtures/api/event-inquiry-completed.json)',
    );
  });

  it('says so when the route table could not be read, never inventing a scope', () => {
    const page = render(null);
    expect(page).toContain('| GET | `/api/v1/inquiries` | List inquiries | not read |');
  });

  it('renders nothing without the OpenAPI document', () => {
    expect(renderApiReference(createMemoryRepository({}), routes)).toBeNull();
  });
});

describe('the tag pages', () => {
  it('maps a tag to a page under docs/', () => {
    expect(Object.keys(TAG_PAGES).length).toBeGreaterThan(40);
    for (const page of Object.values(TAG_PAGES)) {
      expect(page).toMatch(/^docs\/.+\.md$/);
    }
  });

  it('reports a tag without a page and a page that does not exist', () => {
    const messages = apiReferenceFindings(repo).map((finding) => finding.message);
    expect(messages).toContain(`${TAG_PAGES.inquiries ?? 'inquiries page'} does not exist`);
    const unknown = createMemoryRepository({
      [OPENAPI_PATH]: JSON.stringify({
        ...document,
        paths: { '/x': { get: { tags: ['no-such-tag'], responses: {} } } },
      }),
    });
    expect(apiReferenceFindings(unknown).map((finding) => finding.message)).toContain(
      'no page for the tag no-such-tag',
    );
  });
});

describe('parseRouteTable', () => {
  it('reads the collector output and refuses anything else', () => {
    expect(parseRouteTable(JSON.stringify(routes))).toEqual(routes);
    expect(parseRouteTable('not json')).toBeNull();
    expect(parseRouteTable(JSON.stringify({ routes: [{ method: 1 }], constants: {} }))).toBeNull();
  });
});
