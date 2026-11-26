import {
  API_LOG_MAX_BODY_BYTES,
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  newId,
  PII_SIGNAL_ATTRIBUTES,
  PII_VERIFICATION_ATTRIBUTES,
} from '@openverify/contracts';
import { BUILTIN_ROLES, PERMISSIONS, type Permission } from '@openverify/core';
import type { ApiLog } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import type { UserPrincipal } from '../ports.js';
import { multipart } from '../test-support/harness.js';
import {
  apiLogResource,
  apiLogResponseBody,
  apiLogValue,
  describeMultipartBody,
  maskPersonalData,
  multipartLogValue,
  resourceIdOf,
} from './api-logs.js';

// Synthetic values only: every C31.5 extraction attribute, named after itself.
const EXTRACTION: Readonly<Record<string, string>> = Object.fromEntries(
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map((name) => [name, `synthetic-${name}`]),
);
const MASKED_EXTRACTION = Object.fromEntries(
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map((name) => [name, null]),
);
const SOURCES = { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] };

/** A `GET /verifications/:id` answer for a government ID, as an unmasked API key gets it. */
const verificationAnswer = () => ({
  data: {
    type: 'verification/government-id',
    id: 'ver_1',
    attributes: { status: 'passed', ...EXTRACTION, 'extraction-sources': SOURCES },
  },
});

/** A `GET /events` answer whose payload carries the verification (C31.6, 2B F005). */
const eventsAnswer = () => ({
  data: [
    {
      type: 'event',
      id: 'evt_1',
      attributes: { name: 'verification.passed', payload: verificationAnswer() },
    },
  ],
  included: [{ type: 'verification/government-id', id: 'ver_1', attributes: { ...EXTRACTION } }],
});

describe('apiLogValue', () => {
  it('redacts secret-bearing keys at any depth and keeps everything else', () => {
    expect(apiLogValue({ a: [{ token: 't', keep: 1 }], 'flow-url': 'https://x/#y' })).toEqual({
      a: [{ token: '[REDACTED]', keep: 1 }],
      'flow-url': '[REDACTED]',
    });
  });

  it('stores nothing for a missing value', () => {
    expect(apiLogValue(undefined)).toBeNull();
  });

  it('keeps values up to 64 KiB whole', () => {
    const value = { text: 'a'.repeat(API_LOG_MAX_BODY_BYTES - 20) };

    expect(apiLogValue(value)).toEqual(value);
  });

  it('replaces larger values with a preview that fits in 64 KiB, cut on a character', () => {
    const value = { text: `${'é'.repeat(40_000)}"\\${'z'.repeat(10)}` };
    const json = JSON.stringify(value);

    const stored = apiLogValue(value) as {
      truncated: true;
      'byte-length': number;
      preview: string;
    };

    expect(stored.truncated).toBe(true);
    expect(stored['byte-length']).toBe(Buffer.byteLength(json));
    expect(json.startsWith(stored.preview)).toBe(true);
    expect(stored.preview).not.toContain('�');
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(API_LOG_MAX_BODY_BYTES);
  });

  it('builds the preview of a truncated value from its PII-masked JSON (2B F008)', () => {
    const value = {
      data: Array.from({ length: 1_000 }, (_, index) => ({
        id: `inq_${String(index)}`,
        attributes: { fields: { name_first: 'Synthetic-Jane' }, note: 'synthetic note' },
      })),
    };

    const stored = apiLogValue(value) as { 'byte-length': number; preview: string };

    expect(stored['byte-length']).toBe(Buffer.byteLength(JSON.stringify(value)));
    expect(stored.preview).toMatch(
      /^\{"data":\[\{"id":"inq_0","attributes":\{"fields":\{"name_first":null\},"note":null\}/,
    );
    expect(stored.preview).not.toMatch(/Synthetic-Jane|synthetic note/);
  });

  it('builds the preview of a truncated answer without the extraction of a government ID (G001)', () => {
    const value = {
      data: Array.from({ length: 200 }, (_, index) => ({
        ...eventsAnswer().data[0],
        id: `evt_${String(index)}`,
      })),
    };

    const stored = apiLogValue(value) as { truncated: true; preview: string };

    expect(stored.truncated).toBe(true);
    expect(stored.preview).toContain('"name-last":null');
    expect(stored.preview).not.toContain('synthetic-');
  });

  it('keeps the preview within 64 KiB when escaping makes it longer', () => {
    const value = { text: '"'.repeat(70_000) };

    const stored = apiLogValue(value);

    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(API_LOG_MAX_BODY_BYTES);
  });
});

describe('apiLogResponseBody', () => {
  it('parses and redacts JSON and problem documents', () => {
    expect(apiLogResponseBody('{"secret":"s"}', 'application/json; charset=utf-8')).toEqual({
      secret: '[REDACTED]',
    });
    expect(apiLogResponseBody(Buffer.from('{"status":404}'), 'application/problem+json')).toEqual({
      status: 404,
    });
  });

  it.each([
    ['an empty body', '', 'application/json'],
    ['no body', undefined, 'application/json'],
    ['a body that is not JSON', 'oops', 'application/json'],
    ['a text body', 'words', 'text/plain'],
    ['a body without a type', '{}', undefined],
    ['a stream', { pipe: () => undefined }, 'application/json'],
  ])('stores nothing for %s', (_label, payload, type) => {
    expect(apiLogResponseBody(payload, type)).toBeNull();
  });
});

describe('describeMultipartBody', () => {
  it('lists each part with its name, file name, type, size and digest', async () => {
    const body = await multipart({
      kind: 'front',
      file: { bytes: new Uint8Array([1, 2, 3]), filename: 'f.png', type: 'image/png' },
    });

    const parts = await describeMultipartBody(body.payload, body.headers['content-type']);

    expect(parts).toEqual([
      {
        name: 'kind',
        filename: null,
        'content-type': null,
        size: 5,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      },
      {
        name: 'file',
        filename: 'f.png',
        'content-type': 'image/png',
        size: 3,
        sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      },
    ]);
  });

  it('answers null for a body that is not valid multipart', async () => {
    await expect(
      describeMultipartBody(Buffer.from('garbage'), 'multipart/form-data; boundary=x'),
    ).resolves.toBeNull();
  });
});

describe('maskPersonalData: an uploaded file’s name (rule 11, C100.2, C105.2)', () => {
  it('nulls each multipart part’s filename and keeps its name, type and size', async () => {
    const body = await multipart({
      'data[attributes][list-id]': 'lst_1',
      'data[attributes][file]': {
        bytes: new TextEncoder().encode('value\r\nlisted@example.com\r\n'),
        filename: 'blocked-synthetic-person.csv',
        type: 'text/csv',
      },
    });
    const stored = multipartLogValue(
      await describeMultipartBody(body.payload, body.headers['content-type']),
    );

    expect(maskPersonalData(stored)).toEqual({
      parts: [
        { name: 'data[attributes][list-id]', filename: null, 'content-type': null, size: 5 },
        { name: 'data[attributes][file]', filename: null, 'content-type': 'text/csv', size: 27 },
      ],
    });
  });
});

describe('maskPersonalData: the Workflow 7A PII (C107.5, P07)', () => {
  it('nulls every PII_SIGNAL_ATTRIBUTES member of a resource, keeping the derived facts', () => {
    const attributes = Object.fromEntries(PII_SIGNAL_ATTRIBUTES.map((name) => [name, 'value']));

    const masked = maskPersonalData({
      data: { type: 'network', id: 'net_1', attributes: { ...attributes, 'country-code': 'ZZ' } },
      included: [
        {
          type: 'device',
          attributes: { 'browser-fingerprint': 'a'.repeat(64), 'device-class': 'b'.repeat(64) },
        },
      ],
    }) as {
      data: { attributes: Record<string, unknown> };
      included: { attributes: Record<string, unknown> }[];
    };

    for (const name of PII_SIGNAL_ATTRIBUTES) {
      expect(masked.data.attributes[name], name).toBeNull();
    }
    expect(masked.data.attributes['country-code']).toBe('ZZ');
    expect(masked.included[0]?.attributes).toEqual({
      'browser-fingerprint': null,
      'device-class': 'b'.repeat(64),
    });
  });
});

describe('maskPersonalData', () => {
  it('nulls field values, notes, addresses and user agents at any depth', () => {
    expect(
      maskPersonalData({
        data: {
          attributes: { fields: { a: 1, b: 'x' }, note: 'n', status: 'created' },
        },
        included: [{ attributes: { 'ip-address': '203.0.113.1', 'user-agent': 'UA' } }],
        fields: null,
      }),
    ).toEqual({
      data: { attributes: { fields: { a: null, b: null }, note: null, status: 'created' } },
      included: [{ attributes: { 'ip-address': null, 'user-agent': null } }],
      fields: null,
    });
  });

  it('leaves values without personal data as they are', () => {
    expect(maskPersonalData('text')).toBe('text');
    expect(maskPersonalData([1, { a: 2 }])).toEqual([1, { a: 2 }]);
  });

  it('nulls the C31.5 extraction attributes of every resource, at any depth, and keeps their sources (G001)', () => {
    expect(maskPersonalData(verificationAnswer())).toEqual({
      data: {
        type: 'verification/government-id',
        id: 'ver_1',
        attributes: { status: 'passed', ...MASKED_EXTRACTION, 'extraction-sources': SOURCES },
      },
    });
    const events = maskPersonalData(eventsAnswer()) as ReturnType<typeof eventsAnswer>;
    expect(events.data[0]?.attributes.payload.data.attributes).toEqual({
      status: 'passed',
      ...MASKED_EXTRACTION,
      'extraction-sources': SOURCES,
    });
    expect(events.included[0]?.attributes).toEqual(MASKED_EXTRACTION);
    expect(JSON.stringify(events)).not.toContain('synthetic-');
  });

  it('nulls every Phase 5 PII attribute of a resource in data, included and event payloads, and keeps the others (C53.7)', () => {
    const attributes = {
      status: 'passed',
      ...Object.fromEntries(PII_VERIFICATION_ATTRIBUTES.map((name) => [name, `synthetic-${name}`])),
      fields: { name: 'synthetic-name', issuer: 'synthetic-issuer' },
      'associated-persons': [{ 'name-first': 'synthetic-first', 'name-last': 'synthetic-last' }],
      'chain-id': 'eip155:1',
      'confirmed-at': '2026-10-20T12:00:00.000Z',
    };
    const resource = { type: 'verification/database-business', id: 'ver_2', attributes };
    const masked = maskPersonalData({
      data: resource,
      included: [resource],
      event: { attributes: { payload: { data: resource } } },
    });

    expect(JSON.stringify(masked)).not.toContain('synthetic-');
    const expected = {
      ...Object.fromEntries(PII_VERIFICATION_ATTRIBUTES.map((name) => [name, null])),
      status: 'passed',
      fields: { name: null, issuer: null },
      'associated-persons': null,
      'chain-id': 'eip155:1',
      'confirmed-at': '2026-10-20T12:00:00.000Z',
    };
    expect(masked).toEqual({
      data: { ...resource, attributes: expected },
      included: [{ ...resource, attributes: expected }],
      event: { attributes: { payload: { data: { ...resource, attributes: expected } } } },
    });
  });

  it('nulls a phone number or email address member at any depth, as request bodies carry them (C55.11)', () => {
    expect(
      maskPersonalData({
        'phone-number': '+15555550123',
        data: { attributes: { 'email-address': 'person@example.test', sends: 1 } },
        list: [{ 'phone-number': '+15555550124' }],
      }),
    ).toEqual({
      'phone-number': null,
      data: { attributes: { 'email-address': null, sends: 1 } },
      list: [{ 'phone-number': null }],
    });
  });

  it('masks extraction names only as resource attributes, not as other keys', () => {
    expect(maskPersonalData({ birthdate: 'x', meta: { sex: 'y' } })).toEqual({
      birthdate: 'x',
      meta: { sex: 'y' },
    });
  });
});

describe('apiLogResource (C12, C15, C31.6)', () => {
  const developer = (permissions: Iterable<Permission>): UserPrincipal => ({
    kind: 'user',
    userId: 'usr_1',
    userSessionId: 'uss_1',
    organizationId: 'org_1',
    environmentId: 'env_1',
    environmentKind: 'sandbox',
    permissions: new Set(permissions),
    mfaSatisfied: true,
  });
  const row = (responseBody: unknown): ApiLog => ({
    id: newId('alog'),
    environmentId: 'env_1',
    method: 'GET',
    path: '/api/v1/verifications/ver_1',
    route: '/api/v1/verifications/:id',
    status: 200,
    durationMs: 12,
    requestId: 'req_1',
    idempotencyKey: null,
    apiKeyId: newId('key'),
    userId: null,
    resourceId: 'ver_1',
    subjectIds: ['ver_1'],
    ip: '203.0.113.7',
    userAgent: 'synthetic-agent',
    query: null,
    requestBody: null,
    responseBody,
    createdAt: new Date('2026-10-21T00:00:00.000Z'),
    updatedAt: new Date('2026-10-21T00:00:00.000Z'),
  });

  it('serves a reader without pii:view (the Developer role) the stored extraction masked (G001)', () => {
    const reader = developer(BUILTIN_ROLES.developer.permissions);
    expect(reader.permissions.has('pii:view')).toBe(false);
    expect(reader.permissions.has('api-logs:read')).toBe(true);

    for (const answer of [verificationAnswer(), eventsAnswer()]) {
      const resource = apiLogResource(row(answer), reader);
      expect(JSON.stringify(resource.attributes['response-body'])).not.toContain('synthetic-');
    }
  });

  it('serves the stored extraction whole to a reader with pii:view', () => {
    const resource = apiLogResource(row(verificationAnswer()), developer(PERMISSIONS));
    expect(resource.attributes['response-body']).toEqual(verificationAnswer());
  });
});

describe('resourceIdOf', () => {
  it('takes the id of a single resource answer, else the path id, else none', () => {
    expect(resourceIdOf({ data: { id: 'inq_1', type: 'inquiry' } }, { id: 'inq_2' })).toBe('inq_1');
    expect(resourceIdOf({ data: [{ id: 'inq_1' }] }, { id: 'inq_2' })).toBe('inq_2');
    expect(resourceIdOf(null, undefined)).toBeNull();
    expect(resourceIdOf({ data: { id: 7 } }, { other: 'x' })).toBeNull();
  });
});
