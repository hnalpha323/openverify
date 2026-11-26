import {
  API_VERSION_HEADER,
  API_VERSIONS,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  PROBLEM_MEDIA_TYPE,
  RATE_LIMIT_LIMIT_HEADER,
  RATE_LIMIT_REMAINING_HEADER,
  RATE_LIMIT_RESET_HEADER,
  RETRY_AFTER_HEADER,
} from '@openverify/contracts';
import { setDefaultKeyring } from '@openverify/db';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import {
  compactOpenApi,
  OPENAPI_SNAPSHOT_PATH,
  OPENAPI_WRITE_ENV,
  renderOpenApiDocument,
} from './test-support/openapi.js';
import { createRecordingQueue } from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';

// C55.11: the sandbox SMS sender is bound, so the document lists the sandbox-only SMS sink.
const container = createContainer(
  loadConfig(syntheticEnv({ OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox' })),
  {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  },
);

afterAll(async () => {
  await container.close();
  setDefaultKeyring(undefined);
});

type Json = Record<string, unknown>;

/** The document as the server serves it. */
let app: ReturnType<typeof container.buildApp>;
let served: string;
let document: Json;

// One app serves every test: building it and serving the document is this file's whole cost, and
// doing it per test took over 60 s at a load of 47. The check compares compact texts (content and
// key order) and never formats the 8 MB document: Prettier alone took 4.6 s of CPU, and the hook
// passed its 120 s guard at a load of about 20 in the 9C validation. format:check keeps the file's
// layout; openapi:write formats it when it writes.
beforeAll(async () => {
  app = container.buildApp();
  const response = await app.inject({ url: '/openapi.json' });
  served = response.body;
  document = response.json<Json>();
});

describe('OpenAPI document', () => {
  it('matches the committed docs/api/openapi.json (pnpm --filter @openverify/api openapi:write)', async () => {
    if (process.env[OPENAPI_WRITE_ENV] === '1') {
      writeFileSync(OPENAPI_SNAPSHOT_PATH, await renderOpenApiDocument(app));
    }
    const current =
      compactOpenApi(readFileSync(OPENAPI_SNAPSHOT_PATH, 'utf8')) === compactOpenApi(served);
    expect(current, 'docs/api/openapi.json is out of date: run openapi:write').toBe(true);
  });

  it('is the /openapi.json the server serves, as JSON', () => {
    expect(JSON.parse(served)).toEqual(document);
  });
});

/** Every `$ref` under `value` that names nothing in `root`, with the JSON pointer of its holder. */
function unresolvedRefs(root: unknown, value: unknown = root, at = ''): string[] {
  const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unresolvedRefs(root, item, `${at}/${String(index)}`));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const own: string[] = [];
  const ref = (value as Record<string, unknown>).$ref;
  if (typeof ref === 'string') {
    let target: unknown = ref.startsWith('#') ? root : undefined;
    for (const part of ref
      .replace(/^#\/?/, '')
      .split('/')
      .filter((each) => each !== '')) {
      const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
      target =
        typeof target === 'object' && target !== null && Object.hasOwn(target, key)
          ? (target as Record<string, unknown>)[key]
          : undefined;
    }
    if (target === undefined) {
      own.push(`${at}: ${ref}`);
    }
  }
  return [
    ...own,
    ...Object.entries(value).flatMap(([key, child]) =>
      unresolvedRefs(root, child, `${at}/${escape(key)}`),
    ),
  ];
}

describe('every $ref of the committed document resolves (Workflow 8C review K8-15)', () => {
  it('finds a reference that names nothing', () => {
    const bad = {
      components: { schemas: { Known: { type: 'string' }, 'a/b': { type: 'string' } } },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { $ref: '#/components/schemas/Known' },
              '201': { $ref: '#/components/schemas/a~1b' },
              '400': { $ref: '#/components/schemas/__shared' },
            },
          },
        },
      },
    };
    expect(unresolvedRefs(bad)).toEqual([
      '/paths/~1x/get/responses/400: #/components/schemas/__shared',
    ]);
  });

  it('holds none in docs/api/openapi.json', () => {
    const committed: unknown = JSON.parse(readFileSync(OPENAPI_SNAPSHOT_PATH, 'utf8'));
    expect(JSON.stringify(committed)).toContain('"$ref"');
    expect(unresolvedRefs(committed)).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------------
// The served document, read as plain JSON. `$ref`s into `components` are followed.

interface Operation {
  method: string;
  path: string;
  operation: Json;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value`, or what its `$ref` names in this document. */
function resolve(value: unknown): Json {
  if (!isRecord(value)) {
    throw new Error(`not an object: ${JSON.stringify(value)}`);
  }
  const ref = value.$ref;
  if (typeof ref !== 'string') {
    return value;
  }
  let target: unknown = document;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    target = isRecord(target) ? target[part] : undefined;
  }
  if (target === undefined) {
    throw new Error(`${ref} names nothing in the document`);
  }
  return resolve(target);
}

function operations(): Operation[] {
  const paths = document.paths as Record<string, Record<string, Json>>;
  return Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      method: method.toUpperCase(),
      path,
      operation,
    })),
  );
}

/** The server API: what C12 applies to. The flow and dashboard APIs are not part of it. */
const isServerApi = ({ path }: Operation) =>
  path.startsWith('/api/v1/') &&
  !path.startsWith('/api/v1/flow/') &&
  !path.startsWith('/api/v1/dashboard/');

const serverOperations = () => operations().filter(isServerApi);
const otherOperations = () => operations().filter((operation) => !isServerApi(operation));
const isWrite = ({ method }: Operation) => method === 'POST' || method === 'PATCH';
const label = ({ method, path }: Operation) => `${method} ${path}`;

function headerParameters({ operation }: Operation): Map<string, Json> {
  const parameters = (operation.parameters ?? []) as unknown[];
  return new Map(
    parameters
      .map(resolve)
      .filter((parameter) => parameter.in === 'header')
      .map((parameter) => [String(parameter.name).toLowerCase(), parameter]),
  );
}

function responses({ operation }: Operation): Map<string, Json> {
  return new Map(
    Object.entries(operation.responses as Json).map(([status, response]) => [
      status,
      resolve(response),
    ]),
  );
}

function responseHeaders(response: Json): Map<string, Json> {
  return new Map(
    Object.entries((response.headers ?? {}) as Json).map(([name, header]) => [
      name.toLowerCase(),
      resolve(header),
    ]),
  );
}

const PLATFORM_RESPONSE_HEADERS = [
  API_VERSION_HEADER,
  RATE_LIMIT_LIMIT_HEADER,
  RATE_LIMIT_REMAINING_HEADER,
  RATE_LIMIT_RESET_HEADER,
];

const problemType = (slug: string) => `https://openverify.dev/problems/${slug}`;

describe('named components (C50.6)', () => {
  const TYPES = [
    'GovernmentId',
    'Selfie',
    'Document',
    'Database',
    'Aamva',
    'PhoneNumber',
    'EmailAddress',
    'GovernmentIdNfc',
    'CryptoWallet',
    'DatabaseBusiness',
    'BusinessWebsite',
  ];

  it('names each verification resource type, full and as the flow serves it', () => {
    const schemas = Object.keys((document.components as Json).schemas as Json);

    for (const type of TYPES) {
      expect(schemas).toContain(`${type}Verification`);
      expect(schemas).toContain(`Flow${type}Verification`);
    }
  });
});

describe('C12 platform behaviour of every server API operation (2B F026)', () => {
  it('lists the server API operations it checks', () => {
    expect(serverOperations().length).toBeGreaterThan(60);
    expect(serverOperations().map(label)).toContain('POST /api/v1/inquiries');
  });

  it('declares the optional OpenVerify-Version request header, naming the versions', () => {
    for (const operation of serverOperations()) {
      const parameter = headerParameters(operation).get(API_VERSION_HEADER);
      expect(parameter, label(operation)).toMatchObject({ in: 'header', required: false });
      expect(parameter?.schema, label(operation)).toMatchObject({ enum: [...API_VERSIONS] });
      expect(String(parameter?.description), label(operation)).toContain('unsupported-api-version');
    }
  });

  it('declares Idempotency-Key on POST and PATCH only, with the idempotency problems', () => {
    for (const operation of serverOperations()) {
      const parameter = headerParameters(operation).get(IDEMPOTENCY_KEY_HEADER);
      if (!isWrite(operation)) {
        expect(parameter, label(operation)).toBeUndefined();
        continue;
      }
      expect(parameter, label(operation)).toMatchObject({
        in: 'header',
        required: false,
        schema: { type: 'string', minLength: 1, maxLength: 255 },
      });
      expect(String(parameter?.description), label(operation)).toContain('idempotency-key-reused');
      expect(String(parameter?.description), label(operation)).toContain('idempotency-key-in-use');
      const statuses = responses(operation);
      expect(statuses.has('409'), label(operation)).toBe(true);
      expect(statuses.has('422'), label(operation)).toBe(true);
      for (const [status, response] of statuses) {
        if (status.startsWith('2')) {
          expect(responseHeaders(response).has(IDEMPOTENT_REPLAYED_HEADER), label(operation)).toBe(
            true,
          );
        }
      }
    }
  });

  it('declares OpenVerify-Version and the RateLimit headers on every response', () => {
    for (const operation of serverOperations()) {
      for (const [status, response] of responses(operation)) {
        const headers = responseHeaders(response);
        for (const name of PLATFORM_RESPONSE_HEADERS) {
          expect(headers.get(name)?.schema, `${label(operation)} ${status} ${name}`).toBeDefined();
        }
      }
    }
  });

  it('declares 429 rate-limited with Retry-After, and 400 for an unsupported version', () => {
    for (const operation of serverOperations()) {
      const statuses = responses(operation);
      const tooMany = statuses.get('429');
      expect(tooMany, label(operation)).toBeDefined();
      expect(String(tooMany?.description), label(operation)).toContain('rate-limited');
      expect(responseHeaders(tooMany ?? {}).get(RETRY_AFTER_HEADER)?.schema).toMatchObject({
        type: 'integer',
      });
      expect(Object.keys((tooMany?.content ?? {}) as Json)).toEqual([PROBLEM_MEDIA_TYPE]);
      expect(statuses.has('400'), label(operation)).toBe(true);
    }
  });

  it('names each problem type it documents', () => {
    const text = JSON.stringify(document.components);
    for (const slug of [
      'rate-limited',
      'unsupported-api-version',
      'idempotency-key-reused',
      'idempotency-key-in-use',
    ]) {
      expect(text).toContain(problemType(slug));
    }
  });

  it('leaves the flow, dashboard and system operations alone', () => {
    for (const operation of otherOperations()) {
      expect(headerParameters(operation).has(API_VERSION_HEADER), label(operation)).toBe(false);
      expect(headerParameters(operation).has(IDEMPOTENCY_KEY_HEADER), label(operation)).toBe(false);
      for (const [status, response] of responses(operation)) {
        expect(
          responseHeaders(response).has(API_VERSION_HEADER),
          `${label(operation)} ${status}`,
        ).toBe(false);
      }
    }
    expect(JSON.stringify(document)).not.toContain('x-openverify-');
  });
});

describe('redaction statuses (2B F027)', () => {
  const find = (method: string, path: string) => {
    const found = operations().find((o) => o.method === method && o.path === path);
    if (found === undefined) {
      throw new Error(`${method} ${path} is not documented`);
    }
    return found;
  };

  it('documents the 503 of a redaction that could not delete every file', () => {
    for (const path of ['/api/v1/inquiries/{id}/redact', '/api/v1/accounts/{id}/redact']) {
      expect(responses(find('POST', path)).has('503'), path).toBe(true);
    }
  });

  it('documents 410 redacted on every route that refuses a redacted inquiry', () => {
    for (const [method, path] of [
      ['PATCH', '/api/v1/inquiries/{id}'],
      ['POST', '/api/v1/inquiries/{id}/resume'],
      ['POST', '/api/v1/inquiries/{id}/generate-one-time-link'],
      ['POST', '/api/v1/flow/consent'],
      ['POST', '/api/v1/flow/verifications'],
      ['POST', '/api/v1/flow/verifications/{id}/files'],
      ['POST', '/api/v1/flow/verifications/{id}/submit'],
    ] as const) {
      expect(responses(find(method, path)).has('410'), `${method} ${path}`).toBe(true);
    }
  });
});

describe('the dashboard file content (C52.4, C54.2)', () => {
  it('documents an image, the PNG previews among them, or a PDF attachment, each as binary', () => {
    const operation = operations().find(
      ({ method, path }) => method === 'GET' && path === '/api/v1/dashboard/files/{id}/content',
    );
    const content = responses(
      operation ?? { method: '', path: '', operation: { responses: {} } },
    ).get('200')?.content as Json | undefined;

    expect(Object.keys(content ?? {}).sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    for (const media of Object.values(content ?? {})) {
      expect((media as Json).schema).toEqual({ type: 'string', format: 'binary' });
    }
  });
});
