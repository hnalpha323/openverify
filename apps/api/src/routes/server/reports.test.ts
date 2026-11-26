/**
 * C72.1, C72.2, C72.5, C73.7, C74.2, C74.5 (Workflow 6A Stage 3, `api-reports`): creating,
 * reading, listing, tagging and monitoring reports through the server API, with the linking
 * scopes, the limits, masking and the 410 of a redacted report. Templates are seeded as rows (the
 * template routes are their owner's). Synthetic values only.
 */
import { createAccount } from '@openverify/db';
import { createTestInquiry, seedReport, seedReportTemplate, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDenyRateLimiter, type RecordingReportRunQueue } from '../../test-support/fakes.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let runs: RecordingReportRunQueue;
let watchlistTemplate: string;
let recurringTemplate: string;
let emailTemplate: string;
let archivedTemplate: string;

const QUERY = { 'name-first': 'Avery', 'name-last': 'Synthetic' };

beforeAll(async () => {
  api = await createTestApi();
  runs = api.deps.reportRuns as RecordingReportRunQueue;
  const env = api.environmentId;
  const lists = { 'search-lists': ['openverify-sandbox'] };
  watchlistTemplate = (await seedReportTemplate(api.database.db, env, { config: lists }))
    .templateId;
  recurringTemplate = (
    await seedReportTemplate(api.database.db, env, {
      config: { ...lists, 'recurrence-interval-days': 7 },
    })
  ).templateId;
  emailTemplate = (await seedReportTemplate(api.database.db, env, { reportType: 'email-address' }))
    .templateId;
  archivedTemplate = (
    await seedReportTemplate(api.database.db, env, { config: lists, status: 'archived' })
  ).templateId;
}, 60_000);

afterAll(async () => {
  await api.close();
});

function create(
  attributes: Record<string, unknown>,
  options: { token?: string; meta?: Record<string, unknown>; type?: string } = {},
) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    headers: bearer(options.token ?? api.token),
    payload: {
      data: {
        type: options.type ?? 'report/watchlist',
        attributes: { 'report-template-id': watchlistTemplate, query: QUERY, ...attributes },
      },
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    },
  });
}

const post = (path: string, payload: Record<string, unknown> = {}, token = api.token) =>
  api.app.inject({ method: 'POST', url: `/api/v1${path}`, headers: bearer(token), payload });
const get = (path: string, token = api.token) =>
  api.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: bearer(token) });

describe('POST /reports (C72.1)', () => {
  it('creates a pending report with its initial run enqueued and a new home account', async () => {
    const before = runs.jobs.length;
    const response = await create({});
    const document = expectStatus(response, 201);
    expect(response.headers.location).toBe(`/api/v1/reports/${document.data.id}`);
    expect(document.data).toMatchObject({
      type: 'report/watchlist',
      attributes: {
        status: 'pending',
        origin: 'api',
        query: QUERY,
        'query-sources': { 'name-first': 'request', 'name-last': 'request' },
        'has-match': false,
        'report-template-version-name': 'v1',
        'is-recurring': false,
        'matched-lists': null,
      },
    });
    const relationships = document.data as unknown as {
      relationships: { account: { data: { id: string } | null }; accounts: { data: unknown[] } };
    };
    expect(relationships.relationships.account.data?.id).toMatch(/^acc_/);
    expect(relationships.relationships.accounts.data).toHaveLength(1);
    expect(runs.jobs.slice(before)).toEqual([
      expect.objectContaining({ environmentId: api.environmentId, reportId: document.data.id }),
    ]);
    expect(api.audit.entries.map((entry) => entry.action)).toContain('report.created');
  });

  it('links no account when auto-create-account is false, and a recurring report schedules its next run', async () => {
    const none = expectStatus(await create({}, { meta: { 'auto-create-account': false } }), 201);
    expect(
      (none.data as unknown as { relationships: { account: { data: unknown } } }).relationships
        .account.data,
    ).toBeNull();
    const recurring = expectStatus(
      await create(
        { 'report-template-id': recurringTemplate },
        { meta: { 'auto-create-account': false } },
      ),
      201,
    );
    expect(recurring.data.attributes).toMatchObject({ 'is-recurring': true });
    expect(recurring.data.attributes['next-run-at']).toBe(
      new Date(api.clock.now().getTime() + 7 * 86_400_000).toISOString(),
    );
  });

  it('links a given account and an inquiry, each needing its scope (C72.2)', async () => {
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const linked = expectStatus(
      await create({ 'account-id': account.id, 'inquiry-id': inquiry.id }),
      201,
    );
    const relationships = (
      linked.data as unknown as {
        relationships: { account: { data: { id: string } }; inquiry: { data: { id: string } } };
      }
    ).relationships;
    expect(relationships.account.data.id).toBe(account.id);
    expect(relationships.inquiry.data.id).toBe(inquiry.id);
    const writeOnly = await api.newApiKey(api.environmentId, { scopes: ['reports:write'] });
    expect((await create({ 'account-id': account.id }, { token: writeOnly })).statusCode).toBe(403);
    expect((await create({ 'inquiry-id': inquiry.id }, { token: writeOnly })).statusCode).toBe(403);
    expect((await create({ 'inquiry-id': testId('inq') })).statusCode).toBe(404);
    expect((await create({ 'account-id': testId('acc') })).statusCode).toBe(404);
  });

  it('answers the same 403 for a known and an unknown reference id without accounts:read (V14)', async () => {
    await createAccount(api.database.db, api.environmentId, {
      id: testId('acc'),
      referenceId: 'synthetic-known-ref',
    });
    const writeOnly = await api.newApiKey(api.environmentId, { scopes: ['reports:write'] });
    const known = await create(
      {},
      { token: writeOnly, meta: { 'auto-create-account-reference-id': 'synthetic-known-ref' } },
    );
    const unknown = await create(
      {},
      { token: writeOnly, meta: { 'auto-create-account-reference-id': 'synthetic-unknown-ref' } },
    );
    expect(known.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(403);
    const withoutRequest = (body: Record<string, unknown>) => {
      const rest = { ...body };
      delete rest.requestId;
      return rest;
    };
    expect(withoutRequest(known.json())).toEqual(withoutRequest(unknown.json()));
    const reused = expectStatus(
      await create({}, { meta: { 'auto-create-account-reference-id': 'synthetic-known-ref' } }),
      201,
    );
    const again = expectStatus(
      await create({}, { meta: { 'auto-create-account-reference-id': 'synthetic-known-ref' } }),
      201,
    );
    const homeOf = (document: typeof reused) =>
      (document.data as unknown as { relationships: { account: { data: { id: string } } } })
        .relationships.account.data.id;
    expect(homeOf(reused)).toBe(homeOf(again));
  });

  it('answers 410 for a redacted inquiry or account (P06)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    await api.database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      inquiry.id,
    ]);
    expect((await create({ 'inquiry-id': inquiry.id })).statusCode).toBe(410);
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    await api.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      account.id,
    ]);
    expect((await create({ 'account-id': account.id })).statusCode).toBe(410);
  });

  it('answers 422 report_query_invalid with pointers for a query problem, 400 for anything else', async () => {
    const invalid = await create({ query: { 'name-first': 'Avery', birthdate: 'yesterday' } });
    expect(invalid.statusCode).toBe(422);
    const problem = invalid.json<{ code: string; errors: { pointer: string }[] }>();
    expect(problem.code).toBe('report_query_invalid');
    expect(problem.errors.map((error) => error.pointer)).toContain(
      '/data/attributes/query/birthdate',
    );
    expect((await create({ 'reference-id': 'synthetic-legacy' })).statusCode).toBe(400);
    expect((await create({ 'report-template-id': 'not-an-id' })).statusCode).toBe(400);
  });

  it('refuses an unknown, archived or mismatched template (C72.4)', async () => {
    const unknown = await create({ 'report-template-id': testId('rptp') });
    expect(unknown.json()).toMatchObject({ status: 422, code: 'report_template_not_published' });
    const archived = await create({ 'report-template-id': archivedTemplate });
    expect(archived.json()).toMatchObject({ code: 'report_template_not_published' });
    const mismatch = await create({ 'report-template-id': emailTemplate });
    expect(mismatch.json()).toMatchObject({ status: 422, code: 'report_type_mismatch' });
  });
});

describe('report limits (C72.5)', () => {
  it('answers 429 with Retry-After beyond the environment rate', async () => {
    const limited = await createTestApi({ rateLimiter: createDenyRateLimiter(12) });
    try {
      const template = await seedReportTemplate(limited.database.db, limited.environmentId, {
        config: { 'search-lists': ['openverify-sandbox'] },
      });
      const response = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: bearer(limited.token),
        payload: {
          data: {
            type: 'report/watchlist',
            attributes: { 'report-template-id': template.templateId, query: QUERY },
          },
        },
      });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('12');
    } finally {
      await limited.close();
    }
  });

  it('refuses a recurring report beyond the recurring cap, and a media one beyond the media runs per day', async () => {
    const capped = await createTestApi((defaults) => ({
      reportLimits: {
        ...defaults.reportLimits,
        maxRecurringPerEnvironment: 1,
        maxMediaRunsPerDay: 1,
      },
    }));
    try {
      const env = capped.environmentId;
      const recurring = await seedReportTemplate(capped.database.db, env, {
        config: { 'search-lists': ['openverify-sandbox'], 'recurrence-interval-days': 1 },
      });
      const body = (templateId: string, type = 'report/watchlist', query: unknown = QUERY) => ({
        data: { type, attributes: { 'report-template-id': templateId, query } },
        meta: { 'auto-create-account': false },
      });
      const send = (payload: Record<string, unknown>) =>
        capped.app.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: bearer(capped.token),
          payload,
        });
      expect((await send(body(recurring.templateId))).statusCode).toBe(201);
      const beyond = await send(body(recurring.templateId));
      expect(beyond.json()).toMatchObject({ status: 422, code: 'report_recurring_limit' });
      const other = await capped.newTenant();
      const media = await seedReportTemplate(capped.database.db, other.environmentId, {
        reportType: 'adverse-media',
        config: { 'recurrence-interval-days': 1 },
      });
      const sendOther = (payload: Record<string, unknown>) =>
        capped.app.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: bearer(other.token),
          payload,
        });
      const mediaBody = body(media.templateId, 'report/adverse-media', {
        term: 'Synthetic Person',
      });
      expect((await sendOther(mediaBody)).statusCode).toBe(201);
      expect((await sendOther(mediaBody)).json()).toMatchObject({ code: 'report_recurring_limit' });
    } finally {
      await capped.close();
    }
  });
});

describe('GET /reports and /reports/:id (C72.1, C70.3)', () => {
  it('masks the query without pii:view and lists with the public filters', async () => {
    const created = expectStatus(await create({}, { meta: { 'auto-create-account': false } }), 201);
    const id = created.data.id;
    const viewer = api.newUserToken(api.environmentId, { permissions: ['reports:read'] });
    const masked = expectStatus(await get(`/reports/${id}`, viewer), 200);
    expect(masked.data.attributes.query).toEqual({ 'name-first': null, 'name-last': null });
    const full = expectStatus(await get(`/reports/${id}`), 200);
    expect(full.data.attributes.query).toEqual(QUERY);
    expect((await get(`/reports/${testId('rep')}`)).statusCode).toBe(404);
    const ready = await seedReport(api.database.db, api.environmentId, {
      templateId: watchlistTemplate,
      versionId: (
        created.data as unknown as {
          relationships: { 'report-template-version': { data: { id: string } } };
        }
      ).relationships['report-template-version'].data.id,
      status: 'ready',
    });
    const noMatch = expectStatus(await get('/reports?filter[has-match]=false'), 200) as unknown as {
      data: { id: string; attributes: { status: string } }[];
    };
    expect(noMatch.data.map((report) => report.id)).toContain(ready);
    expect(noMatch.data.every((report) => report.attributes.status === 'ready')).toBe(true);
    const pending = expectStatus(
      await get('/reports?filter[status]=pending&page[size]=2'),
      200,
    ) as unknown as {
      data: { attributes: { status: string } }[];
      links: { next: string | null };
    };
    expect(pending.data).toHaveLength(2);
    expect(pending.links.next).toMatch(
      /^\/api\/v1\/reports\?filter%5Bstatus%5D|filter\[status\]=pending/,
    );
    const typed = expectStatus(
      await get('/reports?filter[type]=report/email-address'),
      200,
    ) as unknown as {
      data: unknown[];
    };
    expect(typed.data).toEqual([]);
    expect((await get('/reports?page[after]=' + testId('rep'))).statusCode).toBe(400);
  });
});

describe('tags (C9) and monitoring (C74.5)', () => {
  it('adds, removes and sets tags, with no report event', async () => {
    const id = expectStatus(await create({}), 201).data.id;
    const before = api.events.events.length;
    const added = expectStatus(
      await post(`/reports/${id}/add-tag`, { meta: { 'tag-name': 'Priority' } }),
      200,
    );
    expect(added.data.attributes.tags).toEqual(['Priority']);
    const set = expectStatus(
      await post(`/reports/${id}/set-tags`, { meta: { 'tag-names': ['a', 'b'] } }),
      200,
    );
    expect(set.data.attributes.tags).toEqual(['a', 'b']);
    const removed = expectStatus(
      await post(`/reports/${id}/remove-tag`, { meta: { 'tag-name': 'A' } }),
      200,
    );
    expect(removed.data.attributes.tags).toEqual(['b']);
    expect(
      api.events.events.slice(before).filter((event) => event.name.startsWith('report/')),
    ).toEqual([]);
  });

  it('pauses, resumes and runs a recurring report, refusing what does not apply', async () => {
    const once = expectStatus(await create({}), 201).data.id;
    expect((await post(`/reports/${once}/pause`)).json()).toMatchObject({
      status: 409,
      code: 'report_no_scheduled_run',
    });
    expect((await post(`/reports/${once}/resume`)).json()).toMatchObject({
      code: 'report_no_scheduled_run',
    });
    const id = expectStatus(await create({ 'report-template-id': recurringTemplate }), 201).data.id;
    const paused = expectStatus(await post(`/reports/${id}/pause`), 200);
    expect(paused.data.attributes).toMatchObject({
      'paused-reason': 'operator',
      'is-recurring': false,
    });
    expect(paused.data.attributes['next-run-at']).not.toBeNull();
    const resumed = expectStatus(await post(`/reports/${id}/resume`), 200);
    expect(resumed.data.attributes).toMatchObject({ 'paused-at': null, 'is-recurring': true });
    // R005: a next run still ahead is kept, not pushed out by a whole interval.
    expect(resumed.data.attributes['next-run-at']).toBe(paused.data.attributes['next-run-at']);
    const before = runs.jobs.length;
    expectStatus(await post(`/reports/${id}/run`), 200);
    expect(runs.jobs.slice(before)).toEqual([expect.objectContaining({ reportId: id })]);
    const emailReport = expectStatus(
      await create(
        {
          'report-template-id': emailTemplate,
          query: { 'email-address': 'synthetic@example.com' },
        },
        { type: 'report/email-address' },
      ),
      201,
    ).data.id;
    expect((await post(`/reports/${emailReport}/run`)).json()).toMatchObject({
      status: 409,
      code: 'report_not_recurrable',
    });
    const history = expectStatus(await get(`/reports/${id}/history`), 200) as unknown as {
      data: { type: string; attributes: Record<string, unknown> }[];
    };
    expect(
      history.data.map((entry) => [
        entry.type,
        entry.attributes['action-type'] ?? entry.attributes['run-type'],
      ]),
    ).toEqual([
      ['report-action', 'run'],
      ['report-run', 'manual'],
      ['report-action', 'resume'],
      ['report-action', 'pause'],
      ['report-run', 'initial'],
    ]);
    const page = expectStatus(await get(`/reports/${id}/history?page[size]=2`), 200) as unknown as {
      data: { id: string }[];
      links: { next: string | null };
    };
    expect(page.data).toHaveLength(2);
    expect(page.links.next).toContain(`page[after]=${page.data[1]?.id ?? ''}`);
  });

  it('answers 410 report_redacted for a change of a redacted report (H23)', async () => {
    const id = expectStatus(await create({ 'report-template-id': recurringTemplate }), 201).data.id;
    await api.database.client.query(`update reports set redacted_at = now() where id = $1`, [id]);
    expect(
      (await post(`/reports/${id}/add-tag`, { meta: { 'tag-name': 'x' } })).json(),
    ).toMatchObject({
      status: 410,
      code: 'report_redacted',
    });
    expect((await post(`/reports/${id}/run`)).json()).toMatchObject({ code: 'report_redacted' });
    expect((await post(`/reports/${id}/pause`)).json()).toMatchObject({ code: 'report_redacted' });
  });
});

describe('processing-mode sync (C72.1)', () => {
  it('answers with the report once its initial run completed', async () => {
    const response = create(
      {},
      { meta: { 'processing-mode': 'sync', 'auto-create-account': false } },
    );
    // A worker of our own completes the run while the request waits.
    const finish = (async () => {
      for (let tries = 0; tries < 40; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const job = runs.jobs.at(-1);
        if (job !== undefined) {
          await api.database.client.query(
            `update reports set status = 'ready', completed_at = now() where id = $1 and status = 'pending'`,
            [job.reportId],
          );
        }
      }
    })();
    const document = expectStatus(await response, 201);
    expect(document.data.attributes.status).toBe('ready');
    await finish;
  });
});
