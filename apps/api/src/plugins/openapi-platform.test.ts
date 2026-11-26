import type { SwaggerTransform } from '@fastify/swagger';
import type { RouteOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { documentServerApiPlatform, markServerApiOperations } from './openapi-platform.js';

const MARK = 'x-openverify-server-api';

const identity: SwaggerTransform = ({ schema, url }) => ({ schema, url });

function transformed(config: RouteOptions['config']) {
  const route = { method: 'GET', url: '/x', handler: () => null, config } as RouteOptions;
  return markServerApiOperations(identity)({
    schema: { summary: 'x' },
    url: '/x',
    route,
    openapiObject: {},
  }).schema as Record<string, unknown>;
}

describe('markServerApiOperations', () => {
  it('marks routes authenticated with an API key or a user session, the server API', () => {
    expect(transformed(undefined)[MARK]).toBe(true);
    expect(transformed({ auth: 'api-key' })[MARK]).toBe(true);
  });

  it('leaves public and session-token routes unmarked', () => {
    expect(transformed({ public: true })[MARK]).toBeUndefined();
    expect(transformed({ auth: 'session-token' })[MARK]).toBeUndefined();
  });
});

describe('documentServerApiPlatform', () => {
  it('returns a document without paths, or without marked operations, as it is', () => {
    const empty = { openapi: '3.1.0' };
    const unmarked = { paths: { '/health': { get: { responses: {} } }, '/odd': null } };

    expect(documentServerApiPlatform(empty)).toBe(empty);
    expect(documentServerApiPlatform(unmarked)).toBe(unmarked);
  });

  it('keeps referenced responses, other paths and existing components', () => {
    const document = {
      paths: {
        '/api/v1/things': {
          post: {
            [MARK]: true,
            responses: { 201: { $ref: '#/components/responses/Made' }, 503: 'odd' },
          },
        },
        '/odd': null,
      },
      components: { responses: { Made: { description: 'Made' } }, headers: 'odd' },
    };

    const result = documentServerApiPlatform(document) as unknown as {
      paths: Record<string, { post?: Record<string, unknown> } | null>;
      components: Record<string, Record<string, unknown>>;
    };

    const post = result.paths['/api/v1/things']?.post ?? {};
    expect(post).not.toHaveProperty(MARK);
    expect(post.responses).toMatchObject({
      201: { $ref: '#/components/responses/Made' },
      503: 'odd',
      400: { $ref: '#/components/responses/UnsupportedApiVersion' },
      409: { $ref: '#/components/responses/IdempotencyKeyInUse' },
      422: { $ref: '#/components/responses/IdempotencyKeyReused' },
      429: { $ref: '#/components/responses/RateLimited' },
    });
    expect(Object.keys(post.responses as object)).toEqual([
      '201',
      '400',
      '409',
      '422',
      '429',
      '503',
    ]);
    expect(post.parameters).toEqual([
      { $ref: '#/components/parameters/OpenVerifyVersion' },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ]);
    expect(result.paths['/odd']).toBeNull();
    expect(result.components.responses).toHaveProperty('Made');
    expect(result.components.responses).toHaveProperty('RateLimited');
    expect(result.components.headers).toHaveProperty('OpenVerifyVersion');
    expect(document.paths['/api/v1/things'].post).toHaveProperty(MARK);
  });

  it('keeps headers a response already declares, and adds only the version on reads', () => {
    const document = {
      paths: {
        '/api/v1/things': {
          get: {
            [MARK]: true,
            parameters: [{ in: 'query', name: 'page[size]' }],
            responses: { 200: { description: 'OK', headers: { Link: { schema: {} } } } },
          },
        },
      },
    };

    const result = documentServerApiPlatform(document) as unknown as {
      paths: Record<string, { get: { parameters: unknown[]; responses: Record<string, Json> } }>;
    };

    const get = result.paths['/api/v1/things']?.get;
    expect(get?.parameters).toEqual([
      { in: 'query', name: 'page[size]' },
      { $ref: '#/components/parameters/OpenVerifyVersion' },
    ]);
    expect(Object.keys(get?.responses['200']?.headers ?? {})).toEqual([
      'Link',
      'OpenVerify-Version',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ]);
    expect(Object.keys(get?.responses ?? {})).toEqual(['200', '400', '429']);
  });
});

interface Json {
  headers?: Record<string, unknown>;
}
