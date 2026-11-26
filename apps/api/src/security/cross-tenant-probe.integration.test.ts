/**
 * C240.7 (review P24; Workflow 11A integration-11a): the generated cross-tenant probe. On Postgres
 * (Testcontainers), it walks every server-API operation of `docs/api/openapi.json` whose path holds an
 * id parameter and calls it with organisation B's API key on organisation A's ids, seeded per
 * resource family (the id prefix the parameter's schema names). Each answers 404, and the answer is
 * the one a made-up id of the same family gets, with the request's own `instance` and `requestId`
 * left aside, so no answer tells B that A's object exists; every Connect operation answers the one
 * generic Connect 404 (C232.8).
 *
 * The file is named `.integration.test.ts` so that it runs in the Testcontainers project (the unit
 * suite leaves that suffix out); the plan's name was `cross-tenant-probe.test.ts`. A family 11A does
 * not seed yet is listed in {@link CARRIED_FAMILIES} with the Workflow that seeds it: the probe fails
 * on a path whose family is neither seeded nor listed, so a new route cannot slip past it. The
 * dashboard and flow operations (a user session and a flow session, not a key) are 11B's to add.
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { API_SCOPES, CONNECT_NOT_FOUND_PROBLEM, newId } from '@openverify/contracts';
import {
  createApiKey,
  createConsentRecord,
  createVerification,
  insertPendingAccountExport,
  generateApiKey,
  runMigrations,
  setDefaultKeyring,
  type Db,
} from '@openverify/db';
import {
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createContainer, type Container } from '../container.js';
import { seedConnection, seedShareToken } from '../services/connect/consent.test-support.js';
import { createRecordingQueue } from '../test-support/fakes.js';
import { syntheticEnv } from '../test-support/env.js';

const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** The families 11A seeds in organisation A. */
const SEEDED_FAMILIES: ReadonlySet<string> = new Set([
  'inq',
  'itmpl',
  'itmplv',
  'acc',
  'ver',
  'iqse',
  'key',
  'wbh',
  'evt',
  'cxn',
  'cnst',
  'cnsr',
  // Workflow 11B (integration-11b, KP11-10): the access export, and the families a plain create of
  // A's makes (C240.7).
  'aexp',
  'env',
  'acctp',
  'txntp',
  'grqt',
  'wfl',
  'cqueue',
  'ctmpl',
  'cslap',
  'theset',
]);

/**
 * The id families the probe does not seed yet, each with the Workflow that adds its seed (C240.7;
 * verification V14). integration-11b (Workflow 11B, KP11-10) seeded the 11B families and the
 * families one plain create of A's makes; the rest need a published version, a run, a list item
 * kind, a case, a graph result, an import or a delivery made through several routes each, and are
 * carried to Workflow 11F with that reason.
 */
const CARRIED = [
  'accac',
  'alog',
  'aud',
  'cact',
  'cap',
  'case',
  'catt',
  'cblk',
  'ccal',
  'cexp',
  'cscm',
  'ctmplv',
  'dev',
  'dply',
  'exp',
  'gn',
  'grphq',
  'grqtv',
  'libf',
  'lic',
  'lidf',
  'liea',
  'lifc',
  'ligin',
  'ligl',
  'liif',
  'liip',
  'lin',
  'lipn',
  'lis',
  'lisb',
  'lmt',
  'lst',
  'mprt',
  'rbulk',
  'rep',
  'rptp',
  'rptpv',
  'self',
  'tsa',
  'txn',
  'txnf',
  'txntpv',
  'wfr',
  'wfv',
  'whd',
  // Path parameters that are names, not ids (a workflow secret's or recipe's key, a field key).
  'name:key',
  'name:fieldKey',
  // Workflow 11B Stage 1b (D): an export's listed file, a `file_` or `txnf_` id (amendment 48).
  'name:fileId',
];
/**
 * Operations on a seeded family that are frozen at 501 until their owner builds them (Workflow 11B
 * Stage 1b, `foundation-11b`'s named borrowed edit): while one answers 501 to A's id and to a
 * made-up id alike it tells B nothing, and is listed apart; once built it must answer the 404 like
 * every other operation (the entry may stay, it no longer applies).
 */
const FROZEN_OPERATIONS: ReadonlySet<string> = new Set<string>([
  // Empty since integration-11b: dsar-export built the export's create, which answers B the 404.
]);
const CARRIED_FAMILIES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    CARRIED.map((family) => [
      family,
      '11F (C240.7): needs a multi-route seed (version, run, item kind, case, result, import or delivery)',
    ]),
  ),
);

interface Operation {
  method: (typeof METHODS)[number];
  path: string;
  /** Each path parameter with its id family (the prefix its schema names, or `name:<param>`). */
  params: { name: string; family: string }[];
}

interface OpenApiParameter {
  in: string;
  name: string;
  schema?: { pattern?: string };
}

interface OpenApi {
  paths: Record<string, Partial<Record<string, { parameters?: OpenApiParameter[] }>>>;
}

/** Every server-API operation with an id parameter, from the committed OpenAPI document. */
function operations(): Operation[] {
  const document = JSON.parse(
    readFileSync(new URL('../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
  ) as OpenApi;
  const found: Operation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (
      !path.includes('{') ||
      path.startsWith('/api/v1/dashboard') ||
      path.startsWith('/api/v1/flow')
    ) {
      continue;
    }
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const params = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => {
          const prefix = /^\^\(?([a-z]+)_/.exec(parameter.schema?.pattern ?? '')?.[1];
          return { name: parameter.name, family: prefix ?? `name:${parameter.name}` };
        });
      found.push({ method, path, params });
    }
  }
  return found;
}

let postgres: StartedPostgreSqlContainer;
let container: Container;
let app: ReturnType<Container['buildApp']>;
/** Organisation A's seeded id of each family. */
const seeds = new Map<string, string>();
let tokenB = '';

async function keyFor(db: Db, environmentId: string): Promise<{ id: string; token: string }> {
  const key = generateApiKey('sandbox', new TextEncoder().encode(PEPPER));
  const id = newId('key');
  await createApiKey(db, environmentId, {
    id,
    name: 'Probe key',
    prefix: key.prefix,
    secretHash: key.secretHash,
    scopes: API_SCOPES,
  });
  return { id, token: key.token };
}

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  const config = loadConfig(
    syntheticEnv({
      DATABASE_URL: postgres.getConnectionUri(),
      OPENVERIFY_API_KEY_PEPPER: PEPPER,
      OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
      OPENVERIFY_CONNECT_ENABLED: 'true',
    }),
  );
  container = createContainer(config, {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
  });
  await runMigrations(container.db);
  app = container.buildApp();
  const db = container.db;

  // Organisation A, with one object of each family 11A seeds.
  const a = await createTestTenant(db, { kind: 'sandbox' });
  const keyA = await keyFor(db, a.environment.id);
  const { template, inquiry } = await createTestInquiry(db, a.environment.id);
  seeds.set('inq', inquiry.id);
  seeds.set('itmpl', template.id);
  seeds.set('itmplv', template.currentVersion.id);
  seeds.set('key', keyA.id);
  const verification = newId('ver');
  await createVerification(db, a.environment.id, {
    id: verification,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  seeds.set('ver', verification);
  const call = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${keyA.token}`,
        'idempotency-key': `synthetic-probe-seed-${newId('evt')}`,
      },
      ...(payload === undefined ? {} : { payload }),
    });
    expect(response.statusCode, `${method} ${url}: ${response.body}`).toBeLessThan(300);
    return JSON.parse(response.body) as { data: { id: string } | { id: string }[] };
  };
  const first = (answer: { data: { id: string } | { id: string }[] }) =>
    Array.isArray(answer.data) ? (answer.data[0]?.id ?? '') : answer.data.id;
  seeds.set(
    'acc',
    first(
      await call('POST', '/api/v1/accounts', {
        data: { type: 'account', attributes: { 'reference-id': 'probe-account' } },
      }),
    ),
  );
  await call('POST', `/api/v1/inquiries/${inquiry.id}/resume`);
  seeds.set(
    'iqse',
    first(await call('GET', `/api/v1/inquiry-sessions?filter%5Binquiry-id%5D=${inquiry.id}`)),
  );
  seeds.set(
    'wbh',
    first(
      await call('POST', '/api/v1/webhooks', {
        data: {
          type: 'webhook',
          attributes: {
            url: 'https://hooks.example.test/probe',
            'enabled-events': ['inquiry.created'],
          },
        },
      }),
    ),
  );
  seeds.set('evt', first(await call('GET', '/api/v1/events')));

  // Workflow 11B (integration-11b, KP11-10): A's own environment, one object of each family a plain
  // create makes, and an access export of A's account (written directly: the probe's app has no
  // Valkey, so the export's fail-closed rate policy answers 503 to every create).
  seeds.set('env', a.environment.id);
  const created = async (path: string, type: string, attributes: Record<string, unknown>) =>
    first(await call('POST', `/api/v1/${path}`, { data: { type, attributes } }));
  seeds.set('acctp', await created('account-types', 'account-type', { name: 'Probe type' }));
  seeds.set(
    'txntp',
    await created('transaction-types', 'transaction-type', { name: 'Probe transactions' }),
  );
  seeds.set(
    'grqt',
    await created('graph-query-templates', 'graph-query-template', { name: 'Probe query' }),
  );
  seeds.set('wfl', await created('workflows', 'workflow', { name: 'Probe workflow' }));
  seeds.set('cqueue', await created('case-queues', 'case-queue', { name: 'Probe queue' }));
  seeds.set(
    'ctmpl',
    await created('case-templates', 'case-template', { name: 'Probe cases', key: 'PROBE' }),
  );
  seeds.set(
    'cslap',
    await created('case-sla-policies', 'case-sla-policy', {
      name: 'Probe SLA',
      'target-minutes': 60,
    }),
  );
  seeds.set('theset', await created('theme-sets', 'theme-set', { name: 'Probe theme' }));
  const exportId = newId('aexp');
  await insertPendingAccountExport(db, a.environment.id, {
    id: exportId,
    accountId: seeds.get('acc') ?? '',
    creator: { type: 'api-key', id: keyA.id },
    at: new Date('2026-11-14T00:00:00.000Z'),
  });
  seeds.set('aexp', exportId);

  // Connect (the 11A family): A shares with a third organisation C, never with B.
  const c = await createTestTenant(db, { kind: 'sandbox' });
  const connection = await seedConnection(db, {
    sourceOrganizationId: a.organization.id,
    destinationOrganizationId: c.organization.id,
  });
  seeds.set('cxn', connection.id);
  const consent = await createConsentRecord(db, a.environment.id, {
    id: newId('cnsr'),
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: inquiry.id,
    connectionId: connection.id,
    recipientOrganizationId: c.organization.id,
    recipientName: 'Example Partner',
    dataCategories: ['identity-fields', 'check-results'],
    explicitBiometric: false,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    sessionId: newId('iqse'),
    acceptedAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: new Date('2027-11-01T00:00:00.000Z'),
  });
  seeds.set('cnsr', consent.id);
  seeds.set(
    'cnst',
    await seedShareToken(db, {
      sourceEnvironmentId: a.environment.id,
      destinationEnvironmentId: c.environment.id,
      connection,
      consentRecordId: consent.id,
      sourceId: inquiry.id,
    }),
  );

  // Organisation B: its own key, nothing shared with it.
  const b = await createTestTenant(db, { kind: 'sandbox' });
  tokenB = (await keyFor(db, b.environment.id)).token;
}, 120_000);

afterAll(async () => {
  await ifSet(app)?.close();
  await ifSet(container)?.close();
  await ifSet(postgres)?.stop();
  setDefaultKeyring(undefined);
});

/** The answer without what is the request's own: its path, its request id and the ids it named. */
function comparable(body: string, ids: readonly string[] = []): Record<string, unknown> {
  const named = ids.reduce((text, id) => text.replaceAll(id, '<id>'), body);
  const parsed = JSON.parse(named) as Record<string, unknown>;
  delete parsed.instance;
  delete parsed.requestId;
  return parsed;
}

const urlOf = (operation: Operation, value: (family: string) => string) =>
  operation.params.reduce(
    (path, { name, family }) => path.replace(`{${name}}`, encodeURIComponent(value(family))),
    operation.path,
  );

async function asB(operation: Operation, url: string) {
  return app.inject({
    method: operation.method.toUpperCase() as 'GET',
    url,
    headers: {
      authorization: `Bearer ${tokenB}`,
      'idempotency-key': `synthetic-probe-${newId('evt')}`,
    },
    ...(operation.method === 'get' || operation.method === 'delete' ? {} : { payload: {} }),
  });
}

describe('the cross-tenant probe over every server-API path with an id (C240.7)', () => {
  const all = operations();
  const seeded = (operation: Operation) =>
    operation.params.every(({ family }) => SEEDED_FAMILIES.has(family));

  it('knows every family: seeded here, or carried to the Workflow named', () => {
    const unknown = [
      ...new Set(
        all.flatMap(({ params }) =>
          params
            .map(({ family }) => family)
            .filter(
              (family) => !SEEDED_FAMILIES.has(family) && CARRIED_FAMILIES[family] === undefined,
            ),
        ),
      ),
    ];
    expect(unknown).toEqual([]);
    expect(all.filter(seeded).length).toBeGreaterThan(40);
  });

  it('answers B on A’s ids as on made-up ids: 404, with nothing that tells them apart', async () => {
    const differing: string[] = [];
    probed.length = 0;
    validatedFirst.length = 0;
    for (const operation of all.filter(seeded)) {
      const name = `${operation.method.toUpperCase()} ${operation.path}`;
      const realIds = operation.params.map(({ family }) => seeds.get(family) ?? '');
      const fakeIds = operation.params.map(({ family }) => newId(family as 'inq'));
      const real = await asB(
        operation,
        urlOf(
          operation,
          (family) => realIds[operation.params.findIndex((p) => p.family === family)] ?? '',
        ),
      );
      const fake = await asB(
        operation,
        urlOf(
          operation,
          (family) => fakeIds[operation.params.findIndex((p) => p.family === family)] ?? '',
        ),
      );
      const same =
        real.statusCode === fake.statusCode &&
        JSON.stringify(comparable(real.body, realIds)) ===
          JSON.stringify(comparable(fake.body, fakeIds));
      // A write whose empty body (or a read whose missing query) fails validation answers 400 before
      // any lookup, for any id: it tells B nothing, but it is not the 404 (listed apart, for 11B's
      // generated bodies).
      // integration-11b: a refusal of the principal's kind before any lookup (403 "A person publishes a
      // workflow: an API key cannot.") is the same for any id and tells B nothing either.
      if ((real.statusCode === 400 || real.statusCode === 403) && same) {
        validatedFirst.push(name);
        continue;
      }
      if (real.statusCode === 501 && same && FROZEN_OPERATIONS.has(name)) {
        continue;
      }
      if (real.statusCode !== 404) {
        differing.push(`${name}: ${String(real.statusCode)} ${real.body.slice(0, 160)}`);
        continue;
      }
      if (!same) {
        differing.push(`${name}: the answer differs from a made-up id's`);
      }
      if (
        operation.path.startsWith('/api/v1/connect/') &&
        JSON.stringify(comparable(real.body)) !==
          JSON.stringify(comparable(JSON.stringify(CONNECT_NOT_FOUND_PROBLEM)))
      ) {
        differing.push(`${name}: not the one generic Connect 404`);
      }
      probed.push(name);
    }
    expect(differing).toEqual([]);
    // Most of the seeded operations reach the lookup with an empty body and answer the 404.
    expect(probed.length).toBeGreaterThan(validatedFirst.length);
  }, 120_000);
});

/** The operations that answered the 404, and those whose empty body was refused before any lookup. */
const probed: string[] = [];
const validatedFirst: string[] = [];
