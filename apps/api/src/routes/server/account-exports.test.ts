/**
 * C253.1, C253.5, C253.7 (Workflow 11B, `dsar-export`): the access export's four routes over the
 * test API (PGlite, in-memory storage): 202 with the export pending, 409 for a second, the
 * `account-export` policy counted under the environment id first (429 past it, 503
 * `account_export_unavailable` without its store), `account-access:export` and `pii:view` for a key,
 * the step-up for a user, another environment's export the generic 404; once cut, the manifest and a
 * listed file served whole and never cached, an unlisted file 404. Synthetic values only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountExportJob } from '../../jobs/account-export-queues.js';
import type { RateLimiter } from '../../ports.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import { cutAccountExport } from '../../services/account-export/cut.js';
import { accountExportStores } from '../../services/account-export/store.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { seedPiiSubject, type SeededPiiSubject } from '../../services/redaction.test-support.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;
let subject: SeededPiiSubject;
/** What the test's rate limiter answers next: allow, refuse, or no answer (the store is down). */
let limiter: 'allow' | 'refuse' | 'down';
const consumed: { key: string; name: string }[] = [];

const rateLimiter: RateLimiter = {
  consume: (key, rule) => {
    consumed.push({ key, name: rule.name });
    if (limiter === 'down') {
      return Promise.reject(new Error('synthetic store outage'));
    }
    return Promise.resolve({
      allowed: limiter === 'allow',
      limit: rule.limit,
      remaining: limiter === 'allow' ? rule.limit - 1 : 0,
      resetAt: new Date('2026-11-13T13:00:00.000Z'),
      retryAfterSeconds: limiter === 'allow' ? 0 : 600,
    });
  },
};

/** The `account-export` producer: the jobs the create's admission enqueued. */
const enqueued: AccountExportJob[] = [];
const accountExports = {
  enqueueAccountExport: (job: AccountExportJob) => {
    enqueued.push(job);
    return Promise.resolve();
  },
};

beforeAll(async () => {
  api = await createInquiryTestApi({ rateLimiter, accountExports });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  limiter = 'allow';
  consumed.length = 0;
  enqueued.length = 0;
  subject = await seedPiiSubject({
    db: api.database.db,
    storage: api.storage,
    keyring: api.deps.keyring,
    environmentId: api.environmentId,
  });
});

const create = (accountId: string, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/accounts/${accountId}/export`,
    headers: bearer(token),
    payload: {},
  });

const get = (url: string, token = api.token) =>
  api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) });

const problemOf = (response: { statusCode: number; body: string }) =>
  `${String(response.statusCode)}:${String((JSON.parse(response.body) as { code?: string }).code)}`;

const cut = (exportId: string) =>
  cutAccountExport(
    {
      db: api.database.db,
      clock: api.clock,
      logger: createCapturingLogger(),
      storage: api.storage,
      keyring: api.deps.keyring,
      store: accountExportStores,
    },
    api.environmentId,
    exportId,
  );

describe('POST /accounts/:id/export (C253.1, C253.5, C253.7)', () => {
  it('answers 202 with the export pending, counted under the environment id, and 409 for a second', async () => {
    const document = expectStatus(await create(subject.accountId), 202);

    expect(document.data).toMatchObject({
      type: 'account-export',
      attributes: { status: 'pending', 'ready-at': null, 'item-count': null },
      relationships: { account: { data: { type: 'account', id: subject.accountId } } },
    });
    expect(consumed.filter((call) => call.name === 'account-export')).toEqual([
      { key: api.environmentId, name: 'account-export' },
    ]);
    // C251.1: admitted after the commit, its job enqueued by the export's id.
    expect(enqueued).toEqual([{ environmentId: api.environmentId, exportId: document.data.id }]);
    expect(problemOf(await create(subject.accountId))).toBe('409:account_export_pending');
  });

  it('answers 429 past the policy and 503 account_export_unavailable without its store', async () => {
    limiter = 'refuse';
    expect((await create(subject.accountId)).statusCode).toBe(429);
    limiter = 'down';
    expect(problemOf(await create(subject.accountId))).toBe('503:account_export_unavailable');
  });

  it('refuses a key without account-access:export or without pii:view, and a user without the step-up', async () => {
    const readOnly = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    expect((await create(subject.accountId, readOnly)).statusCode).toBe(403);
    const masked = await api.newApiKey(api.environmentId, { piiMasked: true });
    expect((await create(subject.accountId, masked)).statusCode).toBe(403);
    const user = api.newUserToken(api.environmentId);
    expect(problemOf(await create(subject.accountId, user))).toBe('403:step_up_required');
  });

  it('answers the generic 404 for an account of another environment', async () => {
    const other = await api.newTenant();
    expect((await create(subject.accountId, other.token)).statusCode).toBe(404);
  });

  it('answers the generic 404 for an account it cannot see before the policy, even without its store (rule 22)', async () => {
    const other = await api.newTenant();
    limiter = 'down';

    expect((await create(subject.accountId, other.token)).statusCode).toBe(404);
    expect((await create('acc_01M5CN0000000000000011BD98', other.token)).statusCode).toBe(404);
    expect(consumed.filter((call) => call.name === 'account-export')).toEqual([]);
  });
});

describe('GET /account-exports/:id, its manifest and its files (C253.1, C253.2)', () => {
  it('serves a cut export’s manifest and listed files whole and never cached', async () => {
    const { data } = expectStatus(await create(subject.accountId), 202) as {
      data: { id: string };
    };
    expect((await get(`/account-exports/${data.id}/manifest`)).statusCode).toBe(404);

    await cut(data.id);

    const read = expectStatus(await get(`/account-exports/${data.id}`), 200);
    expect(read.data).toMatchObject({ id: data.id, attributes: { status: 'ready' } });
    const manifest = await get(`/account-exports/${data.id}/manifest`);
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['cache-control']).toBe('private, no-store');
    const body = JSON.parse(manifest.body) as {
      'account-id': string;
      files: { id: string; size: number; 'media-type': string }[];
    };
    expect(body['account-id']).toBe(subject.accountId);

    const file = body.files[0];
    expect(file).toBeDefined();
    const served = await get(`/account-exports/${data.id}/files/${file?.id ?? ''}`);
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.byteLength).toBe(file?.size);
    expect(served.headers).toMatchObject({
      'content-type': expect.stringContaining(file?.['media-type'] ?? '') as string,
      'content-disposition': `attachment; filename="${file?.id ?? ''}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    const unlisted = 'file_01M5CN0000000000000011BD99';
    expect((await get(`/account-exports/${data.id}/files/${unlisted}`)).statusCode).toBe(404);

    const other = await api.newTenant();
    expect((await get(`/account-exports/${data.id}`, other.token)).statusCode).toBe(404);
  });
});
