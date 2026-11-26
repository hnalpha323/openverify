import {
  defaultInquiryTemplateAttributes,
  eventPayloadSchema,
  inquiryDocumentSchema,
  inquiryListDocumentSchema,
  inquiryTemplateDocumentSchema,
  newId,
  parseFlowUrlFragment,
  resumeInquiryDocumentSchema,
  SESSION_TOKEN_TTL_SECONDS,
} from '@openverify/contracts';
import {
  hashSessionToken,
  resolveInquiryAccount,
  setInquiryTags,
  transitionInquiryStatus,
  updateInquiry,
  updateInquiryTemplate,
} from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountsService } from '../../services/accounts.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  FLOW_PUBLIC_URL,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiries';

function postInquiry(attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url: BASE,
    headers: bearer(token),
    payload: { data: { type: 'inquiry', attributes } },
  });
}

describe('POST /api/v1/inquiries', () => {
  it('creates an inquiry in status created on the template', async () => {
    const templateId = await createTemplate(api);

    const response = await postInquiry({
      'inquiry-template-id': templateId,
      'reference-id': 'customer-user-42',
      fields: { name_first: 'Synthetic', birth_year: 1990, opted_in: true },
    });

    const document = inquiryDocumentSchema.parse(expectStatus(response, 201));
    expect(response.headers.location).toBe(`${BASE}/${document.data.id}`);
    expect(document.data).toMatchObject({
      type: 'inquiry',
      attributes: {
        status: 'created',
        'reference-id': 'customer-user-42',
        fields: { name_first: 'Synthetic', birth_year: 1990, opted_in: true },
      },
      relationships: {
        'inquiry-template': { data: { type: 'inquiry-template', id: templateId } },
        verifications: { data: [] },
      },
    });
  });

  it('defaults the reference id to null and the fields to an empty object', async () => {
    const response = await postInquiry({ 'inquiry-template-id': await createTemplate(api) });

    expect(expectStatus(response, 201).data.attributes).toMatchObject({
      'reference-id': null,
      fields: {},
    });
  });

  it('publishes inquiry.created with the inquiry resource', async () => {
    const id = await createInquiry(api);

    const [event] = api.events.named('inquiry.created').filter((e) => e.payload.data.id === id);
    expect(event?.environmentId).toBe(api.environmentId);
    expect(eventPayloadSchema.parse(event?.payload).data).toMatchObject({
      type: 'inquiry',
      id,
      attributes: { status: 'created' },
    });
  });

  it('creates no inquiry when inquiry.created cannot be written (F014)', async () => {
    const templateId = await createTemplate(api);
    const referenceId = 'f014-inquiry-created';
    api.events.failNext(new Error('events table unavailable'));

    const failed = await postInquiry({
      'inquiry-template-id': templateId,
      'reference-id': referenceId,
    });

    expect(failed.statusCode).toBe(500);
    const { rows } = await api.database.client.query<{ count: number }>(
      'select count(*)::int as count from inquiries where reference_id = $1',
      [referenceId],
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('stores the fields encrypted, never in plaintext', async () => {
    const id = await createInquiry(api, { fields: { name_last: 'Plaintextcheck' } });

    const { rows } = await api.database.client.query<{ fields: string }>(
      'select fields from inquiries where id = $1',
      [id],
    );
    expect(rows[0]?.fields).toMatch(/^ov1\./);
    expect(rows[0]?.fields).not.toContain('Plaintextcheck');
  });

  it('answers 404 for a template of another environment', async () => {
    const other = await api.newTenant();
    const foreignTemplate = await createTemplate(api, other.token);

    const response = await postInquiry({ 'inquiry-template-id': foreignTemplate });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(api.events.named('inquiry.created').map((event) => event.environmentId)).not.toContain(
      other.environmentId,
    );
  });

  it.each([
    ['a missing template id', { 'inquiry-template-id': undefined }],
    ['a malformed template id', { 'inquiry-template-id': 'itmpl_nope' }],
    ['fields that are not snake_case', { fields: { 'First Name': 'x' } }],
    ['a nested field value', { fields: { address: { city: 'x' } } }],
    ['an unknown attribute', { status: 'completed' }],
  ])('rejects %s', async (_label, attributes) => {
    const templateId = await createTemplate(api);

    const response = await postInquiry({ 'inquiry-template-id': templateId, ...attributes });

    expect(response.statusCode).toBe(400);
  });

  it('answers 500 when publishing the event fails', async () => {
    const templateId = await createTemplate(api);
    api.events.failNext(new Error('event store unavailable'));

    const response = await postInquiry({ 'inquiry-template-id': templateId });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });
});

describe('GET /api/v1/inquiries/:id', () => {
  it('returns the inquiry with its verification relationships, oldest first', async () => {
    const id = await createInquiry(api);
    const first = await seedVerification(api, api.environmentId, id, { type: 'government_id' });
    const second = await seedVerification(api, api.environmentId, id, { type: 'selfie' });

    const response = await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) });

    const document = inquiryDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.relationships.verifications.data).toEqual([
      { type: 'verification/government-id', id: first.id },
      { type: 'verification/selfie', id: second.id },
    ]);
    expect(document.included).toBeUndefined();
  });

  it('includes the verifications with their checks and files on ?include=verifications', async () => {
    const id = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, id, {
      status: 'passed',
      files: ['front', 'back'],
      checks: [
        { name: 'id_blur_detection', status: 'passed', metadata: { blur_score: 120.5 } },
        {
          name: 'id_portrait_detection',
          status: 'passed',
          type: 'fraud',
          requirement: 'not_required',
        },
      ],
    });

    const response = await api.app.inject({
      url: `${BASE}/${id}?include=verifications`,
      headers: bearer(api.token),
    });

    const document = inquiryDocumentSchema.parse(expectStatus(response, 200));
    expect(document.included).toEqual([
      expect.objectContaining({
        type: 'verification/government-id',
        id: verification.id,
        attributes: expect.objectContaining({
          status: 'passed',
          checks: [
            {
              name: 'id_blur_detection',
              status: 'passed',
              reasons: [],
              requirement: 'required',
              // C50.8: derived from the registry when the check is served.
              category: 'user_action_required',
              metadata: { blur_score: 120.5 },
              // C29.2: checks stored without them serve the registry stage and null.
              stage: 'ga',
              confidence: null,
              provenance: null,
            },
            {
              name: 'id_portrait_detection',
              status: 'passed',
              reasons: [],
              requirement: 'not_required',
              category: 'fraud',
              metadata: {},
              stage: 'beta',
              confidence: null,
              provenance: null,
            },
          ],
        }) as unknown,
        relationships: {
          inquiry: { data: { type: 'inquiry', id } },
          files: {
            data: verification.fileIds.map((fileId) => ({ type: 'file', id: fileId })),
          },
          // C105.7 (Workflow 7B): the latest transaction it was attached to, else null.
          transaction: { data: null },
        },
      }),
    ]);
  });

  it('answers 404 for an inquiry of another environment', async () => {
    const other = await api.newTenant();
    const foreign = await createInquiry(api, { token: other.token });

    const response = await api.app.inject({
      url: `${BASE}/${foreign}`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ detail: string }>().detail).not.toContain('environment');
  });

  it('rejects an unknown include', async () => {
    const id = await createInquiry(api);

    const response = await api.app.inject({
      url: `${BASE}/${id}?include=files`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/inquiries', () => {
  it('lists inquiries newest first and pages with page[after]', async () => {
    const tenant = await api.newTenant();
    const templateId = await createTemplate(api, tenant.token);
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(await createInquiry(api, { token: tenant.token, templateId }));
    }
    const verification = await seedVerification(api, tenant.environmentId, ids[2] ?? '');

    const first = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: `${BASE}?page[size]=2`, headers: bearer(tenant.token) }),
        200,
      ),
    );
    expect(first.data.map((inquiry) => inquiry.id)).toEqual([ids[2], ids[1]]);
    expect(first.data[0]?.relationships.verifications.data).toEqual([
      { type: 'verification/government-id', id: verification.id },
    ]);
    expect(first.links.next).toBe(`${BASE}?page[after]=${String(ids[1])}&page[size]=2`);

    const second = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: first.links.next ?? '', headers: bearer(tenant.token) }),
        200,
      ),
    );
    expect(second.data.map((inquiry) => inquiry.id)).toEqual([ids[0]]);
    expect(second.links.next).toBeNull();
  });

  it('filters by status and reference id, keeping the filters in the next link', async () => {
    const tenant = await api.newTenant();
    const templateId = await createTemplate(api, tenant.token);
    const a = await createInquiry(api, { token: tenant.token, templateId, referenceId: 'ref a' });
    const b = await createInquiry(api, { token: tenant.token, templateId, referenceId: 'ref a' });
    await createInquiry(api, { token: tenant.token, templateId, referenceId: 'ref-b' });
    await transitionInquiryStatus(api.database.db, tenant.environmentId, a, {
      from: 'created',
      to: 'pending',
    });

    const byReference = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[reference-id]=ref%20a&page[size]=1`,
          headers: bearer(tenant.token),
        }),
        200,
      ),
    );
    expect(byReference.data.map((inquiry) => inquiry.id)).toEqual([b]);
    expect(byReference.links.next).toBe(
      `${BASE}?filter[reference-id]=ref%20a&page[after]=${b}&page[size]=1`,
    );

    const byStatus = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[status]=pending`,
          headers: bearer(tenant.token),
        }),
        200,
      ),
    );
    expect(byStatus.data.map((inquiry) => inquiry.id)).toEqual([a]);
    expect(byStatus.links.next).toBeNull();
  });

  it('only lists the caller environment', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    const mine = await createInquiry(api, { token: tenant.token });
    await createInquiry(api, { token: other.token });

    const list = inquiryListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: BASE, headers: bearer(tenant.token) }), 200),
    );

    expect(list.data.map((inquiry) => inquiry.id)).toEqual([mine]);
  });

  it('rejects an unknown status filter', async () => {
    const response = await api.app.inject({
      url: `${BASE}?filter[status]=done`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/v1/inquiries/:id/resume', () => {
  function resume(id: string, token = api.token) {
    return api.app.inject({ method: 'POST', url: `${BASE}/${id}/resume`, headers: bearer(token) });
  }

  it('returns the inquiry, a session token and the flow URL carrying it in the fragment', async () => {
    const id = await createInquiry(api);

    const response = await resume(id);

    const document = resumeInquiryDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.id).toBe(id);
    const token = document.meta['session-token'];
    expect(token).toMatch(/^ovs_[A-Za-z0-9_-]{43}$/);
    expect(document.meta['flow-url']).toBe(
      `${FLOW_PUBLIC_URL}/#inquiry-id=${id}&session-token=${token}`,
    );
    expect(parseFlowUrlFragment(new URL(document.meta['flow-url']).hash)).toEqual({
      inquiryId: id,
      sessionToken: token,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('stores only the SHA-256 of the token, expiring after 24 hours', async () => {
    const id = await createInquiry(api);

    const token = resumeInquiryDocumentSchema.parse(expectStatus(await resume(id), 200)).meta[
      'session-token'
    ];

    const { rows } = await api.database.client.query<{ token_hash: string; expires_at: Date }>(
      'select token_hash, expires_at from inquiry_sessions where inquiry_id = $1',
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashSessionToken(token));
    expect(new Date(rows[0]?.expires_at ?? 0).getTime()).toBe(
      api.clock.now().getTime() + SESSION_TOKEN_TTL_SECONDS * 1000,
    );
  });

  it('issues a new token on every call', async () => {
    const id = await createInquiry(api);

    const first = expectStatus(await resume(id), 200).meta?.['session-token'];
    const second = expectStatus(await resume(id), 200).meta?.['session-token'];

    expect(second).not.toBe(first);
  });

  it('answers 409 once the inquiry is finished', async () => {
    const id = await createInquiry(api);
    const { db } = api.database;
    await transitionInquiryStatus(db, api.environmentId, id, { from: 'created', to: 'pending' });
    await transitionInquiryStatus(db, api.environmentId, id, { from: 'pending', to: 'completed' });

    const response = await resume(id);

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });

  it('answers 404 for an inquiry of another environment', async () => {
    const other = await api.newTenant();
    const foreign = await createInquiry(api, { token: other.token });

    expect((await resume(foreign)).statusCode).toBe(404);
  });
});

// Phase 2 (C10, C13, C15) ---------------------------------------------------------------------

const DAY_MS = 86_400_000;

async function templateWith(settings: Record<string, unknown>, token = api.token) {
  return createTemplate(api, token, { ...defaultInquiryTemplateAttributes(), settings });
}

describe('POST /api/v1/inquiries (C10, C13)', () => {
  it('resolves the account in the creation transaction and exposes the relationship', async () => {
    const templateId = await createTemplate(api);
    const calls = api.dbAccounts.calls.length;

    const document = inquiryDocumentSchema.parse(
      expectStatus(
        await postInquiry({ 'inquiry-template-id': templateId, 'reference-id': 'acct-ref-1' }),
        201,
      ),
    );

    expect(api.dbAccounts.calls.slice(calls)).toEqual([
      {
        ctx: expect.objectContaining({
          environmentId: api.environmentId,
          organizationId: api.organizationId,
        }) as unknown,
        input: { referenceId: 'acct-ref-1' },
      },
    ]);
    const account = document.data.relationships.account?.data;
    expect(account).toEqual({ type: 'account', id: expect.stringMatching(/^acc_/) as unknown });
    const { rows } = await api.database.client.query<{ account_id: string }>(
      'select account_id from inquiries where id = $1',
      [document.data.id],
    );
    expect(rows[0]?.account_id).toBe(account?.id);

    const again = inquiryDocumentSchema.parse(
      expectStatus(
        await postInquiry({ 'inquiry-template-id': templateId, 'reference-id': 'acct-ref-1' }),
        201,
      ),
    );
    expect(again.data.relationships.account?.data?.id).toBe(account?.id);
  });

  it('puts the inquiry on the given account', async () => {
    const accountId = await resolveInquiryAccount(api.database.db, api.environmentId, {});

    const document = expectStatus(
      await postInquiry({
        'inquiry-template-id': await createTemplate(api),
        'account-id': accountId,
      }),
      201,
    );

    expect(document.data).toMatchObject({
      relationships: { account: { data: { type: 'account', id: accountId } } },
    });
  });

  it('answers 404 for an account of another environment and creates nothing', async () => {
    const other = await api.newTenant();
    const foreignAccount = await resolveInquiryAccount(api.database.db, other.environmentId, {});
    const templateId = await createTemplate(api);
    const before = api.events.named('inquiry.created').length;

    const response = await postInquiry({
      'inquiry-template-id': templateId,
      'account-id': foreignAccount,
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(api.events.named('inquiry.created')).toHaveLength(before);
  });

  it('creates no inquiry when the account cannot be resolved', async () => {
    const templateId = await createTemplate(api);
    api.dbAccounts.failNext(new Error('accounts unavailable'));

    const response = await postInquiry({
      'inquiry-template-id': templateId,
      'reference-id': 'unresolvable-account',
    });

    expect(response.statusCode).toBe(500);
    const { rows } = await api.database.client.query<{ count: number }>(
      'select count(*)::int as count from inquiries where reference_id = $1',
      [`unresolvable-account`],
    );
    expect(rows[0]?.count).toBe(0);
  });

  it('answers 404 when the accounts service names an account that does not exist', async () => {
    const lost = await createInquiryTestApi({
      accounts: { resolveForInquiry: () => Promise.resolve(newId('acc')) },
    });
    try {
      const response = await lost.app.inject({
        method: 'POST',
        url: BASE,
        headers: bearer(lost.token),
        payload: { data: { attributes: { 'inquiry-template-id': await createTemplate(lost) } } },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ detail: string }>().detail).toMatch(
        /^Account acc_\w+ was not found\.$/,
      );
    } finally {
      await lost.close();
    }
  });

  it('sends the Phase 2 attributes, expiring a day after creation by default', async () => {
    const document = expectStatus(
      await postInquiry({ 'inquiry-template-id': await createTemplate(api) }),
      201,
    );

    expect(document.data.attributes).toMatchObject({
      tags: [],
      note: null,
      'expires-at': new Date(api.clock.now().getTime() + DAY_MS).toISOString(),
      'redacted-at': null,
      'decisioned-at': null,
    });
  });

  it("sets expires-at from the pinned version's inquiry-expiration-seconds", async () => {
    const templateId = await templateWith({ 'inquiry-expiration-seconds': 600 });

    const document = expectStatus(await postInquiry({ 'inquiry-template-id': templateId }), 201);

    expect(document.data.attributes['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 600_000).toISOString(),
    );
  });

  it('answers 422 template-archived for an archived template', async () => {
    const templateId = await createTemplate(api);
    await updateInquiryTemplate(api.database.db, api.environmentId, templateId, {
      status: 'archived',
    });

    const response = await postInquiry({ 'inquiry-template-id': templateId });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/template-archived',
    );
  });

  it('records an audit entry with the principal as actor', async () => {
    const userId = newId('usr');
    const token = api.newUserToken(api.environmentId, { userId });
    const templateId = await createTemplate(api);

    const id = expectStatus(await postInquiry({ 'inquiry-template-id': templateId }, token), 201)
      .data.id;

    expect(api.audit.withAction('inquiry.created').filter((e) => e.resourceId === id)).toEqual([
      expect.objectContaining({
        environmentId: api.environmentId,
        organizationId: api.organizationId,
        actor: { type: 'user', id: userId },
        resourceType: 'inquiry',
        resourceId: id,
      }),
    ]);
  });

  it('answers with masked fields for a user without pii:view', async () => {
    const token = api.newUserToken(api.environmentId, { permissions: ['inquiries:write'] });

    const document = expectStatus(
      await postInquiry(
        { 'inquiry-template-id': await createTemplate(api), fields: { name_first: 'Masked' } },
        token,
      ),
      201,
    );

    expect(document.data.attributes.fields).toEqual({ name_first: null });
  });
});

describe('account.created of the account a new inquiry creates (2B K002)', () => {
  it('is dispatched with inquiry.created after the commit, not left to the sweep', async () => {
    const real = await createTestApi((defaults) => ({
      accounts: createAccountsService({ events: defaults.events }),
    }));
    try {
      const templateId = await createTemplate(real);

      const response = await real.app.inject({
        method: 'POST',
        url: '/api/v1/inquiries',
        headers: bearer(real.token),
        payload: { data: { type: 'inquiry', attributes: { 'inquiry-template-id': templateId } } },
      });

      const document = inquiryDocumentSchema.parse(expectStatus(response, 201));
      const dispatched = real.events.named('account.created');
      expect(dispatched.map((event) => event.payload.data.id)).toEqual([
        document.data.relationships.account?.data?.id,
      ]);
    } finally {
      await real.close();
    }
  });
});

describe('GET /api/v1/inquiries/:id?include=verifications (Workflow 2D K001)', () => {
  const FORBIDDEN = 'https://openverify.dev/problems/forbidden';

  async function inquiryWithChecks() {
    const id = await createInquiry(api);
    await seedVerification(api, api.environmentId, id, {
      status: 'failed',
      checks: [{ name: 'id_blur_detection', status: 'failed', reasons: ['blurry'] }],
    });
    return id;
  }

  it('answers 403 forbidden naming verifications:read to an API key without that scope', async () => {
    const id = await inquiryWithChecks();
    const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

    const response = await api.app.inject({
      url: `${BASE}/${id}?include=verifications`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json()).toMatchObject({
      type: FORBIDDEN,
      detail: 'The API key is missing the required scope: verifications:read.',
    });
    expect(response.headers['www-authenticate']).toContain('scope="verifications:read"');
    expect(response.body).not.toContain('blurry');
  });

  it('answers 403 forbidden naming verifications:read to a user without that permission', async () => {
    const id = await inquiryWithChecks();
    const token = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    const response = await api.app.inject({
      url: `${BASE}/${id}?include=verifications`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      type: FORBIDDEN,
      detail: 'The user is missing the required permission: verifications:read.',
    });
    expect(response.body).not.toContain('blurry');
  });

  it('still serves the inquiry without the include, and the include with verifications:read', async () => {
    const id = await inquiryWithChecks();
    const inquiriesOnly = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    const both = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'verifications:read'],
    });

    const plain = inquiryDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(inquiriesOnly) }),
        200,
      ),
    );
    const included = inquiryDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}/${id}?include=verifications`,
          headers: bearer(both),
        }),
        200,
      ),
    );

    expect(plain.data.relationships.verifications.data).toHaveLength(1);
    expect(plain.included).toBeUndefined();
    expect(included.included?.[0]?.attributes.checks).toEqual([
      expect.objectContaining({ name: 'id_blur_detection', reasons: ['blurry'] }),
    ]);
  });
});

describe('GET /api/v1/inquiries/:id (C15 masking)', () => {
  it('shows fields and the note to API keys and to users with pii:view only', async () => {
    const id = await createInquiry(api, { fields: { name_first: 'Visible' } });
    await updateInquiry(api.database.db, api.environmentId, id, { note: 'synthetic note' });
    const masked = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    const unmasked = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'pii:view'],
    });

    const read = async (token: string) =>
      expectStatus(await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(token) }), 200).data
        .attributes;

    expect(await read(api.token)).toMatchObject({
      fields: { name_first: 'Visible' },
      note: 'synthetic note',
    });
    expect(await read(unmasked)).toMatchObject({
      fields: { name_first: 'Visible' },
      note: 'synthetic note',
    });
    expect(await read(masked)).toMatchObject({ fields: { name_first: null }, note: null });
  });

  it('masks every inquiry of a list for a user without pii:view', async () => {
    const tenant = await api.newTenant();
    await createInquiry(api, { token: tenant.token, fields: { name_last: 'Listed' } });
    const masked = api.newUserToken(tenant.environmentId, { permissions: ['inquiries:read'] });

    const list = inquiryListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: BASE, headers: bearer(masked) }), 200),
    );

    expect(list.data.map((inquiry) => inquiry.attributes.fields)).toEqual([{ name_last: null }]);
  });
});

describe('GET /api/v1/inquiries (C10 filters)', () => {
  it('filters by account, template, tag, created-at range and several statuses', async () => {
    const tenant = await api.newTenant();
    const { db } = api.database;
    const templateA = await createTemplate(api, tenant.token);
    const templateB = await createTemplate(api, tenant.token);
    const first = await createInquiry(api, {
      token: tenant.token,
      templateId: templateA,
      referenceId: 'filter-account',
    });
    const second = await createInquiry(api, { token: tenant.token, templateId: templateB });
    const third = await createInquiry(api, {
      token: tenant.token,
      templateId: templateA,
      referenceId: 'filter-account',
    });
    await setInquiryTags(db, tenant.environmentId, second, ['VIP']);
    await transitionInquiryStatus(db, tenant.environmentId, third, {
      from: 'created',
      to: 'pending',
    });
    const accountId = (
      await api.database.client.query<{ account_id: string }>(
        'select account_id from inquiries where id = $1',
        [first],
      )
    ).rows[0]?.account_id;

    const ids = async (query: string) =>
      inquiryListDocumentSchema
        .parse(
          expectStatus(
            await api.app.inject({ url: `${BASE}?${query}`, headers: bearer(tenant.token) }),
            200,
          ),
        )
        .data.map((inquiry) => inquiry.id);

    expect(await ids(`filter[account-id]=${String(accountId)}`)).toEqual([third, first]);
    expect(await ids(`filter[inquiry-template-id]=${templateB}`)).toEqual([second]);
    expect(await ids(`filter[inquiry-template-id]=${templateA},${templateB}`)).toEqual([
      third,
      second,
      first,
    ]);
    expect(await ids('filter[tag]=vip')).toEqual([second]);
    expect(await ids('filter[status]=created,pending')).toEqual([third, second, first]);
    expect(await ids('filter[status]=pending')).toEqual([third]);
    // created_at is the database's clock: pin it, an hour apart, to test the range.
    for (const [id, hoursAgo] of [
      [first, 2],
      [second, 1],
      [third, 0],
    ] as const) {
      await api.database.client.query(`update inquiries set created_at = $2 where id = $1`, [
        id,
        new Date(Date.UTC(2026, 9, 20, 12 - hoursAgo)),
      ]);
    }
    const start = new Date(Date.UTC(2026, 9, 20, 10, 30)).toISOString();
    const end = new Date(Date.UTC(2026, 9, 20, 11, 30)).toISOString();
    expect(await ids(`filter[created-at-start]=${start}&filter[created-at-end]=${end}`)).toEqual([
      second,
    ]);
  });

  it('keeps every filter in the next link', async () => {
    const tenant = await api.newTenant();
    const templateId = await createTemplate(api, tenant.token);
    await createInquiry(api, { token: tenant.token, templateId });
    const newest = await createInquiry(api, { token: tenant.token, templateId });

    const list = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[status]=created&filter[inquiry-template-id]=${templateId}&page[size]=1`,
          headers: bearer(tenant.token),
        }),
        200,
      ),
    );

    expect(list.links.next).toBe(
      `${BASE}?filter[status]=created&filter[inquiry-template-id]=${templateId}` +
        `&page[after]=${newest}&page[size]=1`,
    );
  });
});

describe('POST /api/v1/inquiries/:id/resume (C10, C11)', () => {
  it("gives the session the template's session-expiration-seconds and audits it", async () => {
    const templateId = await templateWith({ 'session-expiration-seconds': 3600 });
    const id = await createInquiry(api, { templateId });

    const response = await api.app.inject({
      method: 'POST',
      url: `${BASE}/${id}/resume`,
      headers: bearer(api.token),
    });

    const token = resumeInquiryDocumentSchema.parse(expectStatus(response, 200)).meta[
      'session-token'
    ];
    const { rows } = await api.database.client.query<{ id: string; expires_at: Date }>(
      'select id, expires_at from inquiry_sessions where token_hash = $1',
      [hashSessionToken(token)],
    );
    expect(new Date(rows[0]?.expires_at ?? 0).getTime()).toBe(
      api.clock.now().getTime() + 3_600_000,
    );
    expect(api.audit.withAction('inquiry.resumed').filter((e) => e.resourceId === id)).toEqual([
      expect.objectContaining({
        resourceType: 'inquiry',
        metadata: { 'inquiry-session-id': rows[0]?.id },
      }),
    ]);
  });
});

describe('the pinned template version (C25.4, Workflow 2E)', () => {
  const pinned = (versionId: string) => ({
    'inquiry-template-version': { data: { type: 'inquiry-template-version', id: versionId } },
  });

  async function currentVersionOf(templateId: string): Promise<string> {
    const response = await api.app.inject({
      url: `/api/v1/inquiry-templates/${templateId}`,
      headers: bearer(api.token),
    });
    return inquiryTemplateDocumentSchema.parse(expectStatus(response, 200)).data.attributes[
      'current-version'
    ].id;
  }

  async function publishNewVersion(templateId: string): Promise<string> {
    const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
    const draft = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-template-versions',
      headers: bearer(api.token),
      payload: {
        data: {
          type: 'inquiry-template-version',
          attributes: {
            'inquiry-template-id': templateId,
            flow,
            'verification-config': verificationConfig,
          },
        },
      },
    });
    const versionId = expectStatus(draft, 201).data.id;
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-template-versions/${versionId}/publish`,
        headers: bearer(api.token),
      }),
      200,
    );
    return versionId;
  }

  it('is named by the create, read, list and action answers and the inquiry.created event', async () => {
    const templateId = await createTemplate(api);
    const versionId = await currentVersionOf(templateId);

    const created = inquiryDocumentSchema.parse(
      expectStatus(await postInquiry({ 'inquiry-template-id': templateId }), 201),
    );
    const { id } = created.data;
    const read = inquiryDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) }), 200),
    );
    const listed = inquiryListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-template-id]=${templateId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    const expired = inquiryDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          method: 'POST',
          url: `${BASE}/${id}/expire`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    const [event] = api.events.named('inquiry.created').filter((e) => e.payload.data.id === id);

    for (const document of [created.data, read.data, listed.data[0], expired.data]) {
      expect(document?.relationships).toMatchObject(pinned(versionId));
    }
    expect(eventPayloadSchema.parse(event?.payload).data).toMatchObject({
      relationships: pinned(versionId),
    });
  });

  it('keeps the version an inquiry pinned after a newer one is published', async () => {
    const templateId = await createTemplate(api);
    const first = await currentVersionOf(templateId);
    const older = await createInquiry(api, { templateId });

    const second = await publishNewVersion(templateId);
    const newer = await createInquiry(api, { templateId });

    const read = async (inquiryId: string) =>
      inquiryDocumentSchema.parse(
        expectStatus(
          await api.app.inject({ url: `${BASE}/${inquiryId}`, headers: bearer(api.token) }),
          200,
        ),
      ).data.relationships;
    expect(second).not.toBe(first);
    expect(await read(older)).toMatchObject(pinned(first));
    expect(await read(newer)).toMatchObject(pinned(second));
  });
});

describe('GET /api/v1/inquiries/:id?include=reports (C70.5, F08)', () => {
  it('needs reports:read, and lists no report before any exists', async () => {
    const id = await createInquiry(api);
    const inquiriesOnly = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    const withReports = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read', 'reports:read'],
    });

    const refused = await api.app.inject({
      url: `${BASE}/${id}?include=reports`,
      headers: bearer(inquiriesOnly),
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      detail: 'The API key is missing the required scope: reports:read.',
    });

    const served = expectStatus(
      await api.app.inject({ url: `${BASE}/${id}?include=reports`, headers: bearer(withReports) }),
      200,
    );
    expect(served).toMatchObject({ data: { id }, included: [] });
  });
});
