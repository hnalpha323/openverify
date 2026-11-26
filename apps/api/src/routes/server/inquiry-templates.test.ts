import {
  defaultInquiryTemplateAttributes,
  inquiryTemplateDocumentSchema,
  inquiryTemplateListDocumentSchema,
  newId,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  PROBLEM_JSON,
} from '../../test-support/harness.js';
import {
  phase5TemplateAttributes,
  stepOrderBreakingAttributes,
} from '../../test-support/phase5-templates.js';

let api: InquiryTestApi;

beforeAll(async () => {
  // C55.10: the Phase 5 template's phone step publishes only with an SMS sender bound.
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiry-templates';

function post(payload: Record<string, unknown>, token = api.token) {
  return api.app.inject({ method: 'POST', url: BASE, headers: bearer(token), payload });
}

describe('POST /api/v1/inquiry-templates', () => {
  it('creates a template and its first version', async () => {
    const attributes = defaultInquiryTemplateAttributes();

    const response = await post({ data: { type: 'inquiry-template', attributes } });

    const document = inquiryTemplateDocumentSchema.parse(expectStatus(response, 201));
    expect(document.data.id).toMatch(/^itmpl_/);
    expect(response.headers.location).toBe(`${BASE}/${document.data.id}`);
    expect(document.data.attributes).toMatchObject({
      name: 'Government ID and selfie',
      'current-version': {
        'version-number': 1,
        flow: attributes.flow,
        'verification-config': attributes['verification-config'],
      },
    });
    expect(document.data.attributes['current-version'].id).toMatch(/^itmplv_/);
  });

  it('accepts a body without the optional resource type', async () => {
    const response = await post({ data: { attributes: defaultInquiryTemplateAttributes() } });

    expect(response.statusCode).toBe(201);
  });

  it('rejects a flow that does not match its verification config', async () => {
    const attributes = defaultInquiryTemplateAttributes();
    delete attributes['verification-config'].selfie;

    const response = await post({ data: { attributes } });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ errors: { pointer: string }[] }>().errors).toContainEqual(
      expect.objectContaining({ pointer: '/data/attributes/verification-config' }),
    );
  });

  it('creates a template with every Phase 5 step when it meets the publish rules (C50.4)', async () => {
    const attributes = phase5TemplateAttributes();

    const response = await post({ data: { type: 'inquiry-template', attributes } });

    const document = inquiryTemplateDocumentSchema.parse(expectStatus(response, 201));
    expect(document.data.attributes['current-version'].flow).toEqual(attributes.flow);
  });

  it('answers 422 with a pointer for each publish rule the flow breaks (C50.4, V18)', async () => {
    const response = await post({ data: { attributes: stepOrderBreakingAttributes() } });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ errors: { location: string; pointer: string }[] }>().errors).toEqual([
      expect.objectContaining({
        location: 'body',
        pointer: '/data/attributes/flow/steps/1/source',
      }),
      expect.objectContaining({ location: 'body', pointer: '/data/attributes/flow/steps/2' }),
      expect.objectContaining({ location: 'body', pointer: '/data/attributes/flow/steps/2' }),
    ]);
  });

  it('rejects a body of the wrong resource type', async () => {
    const response = await post({
      data: { type: 'inquiry', attributes: defaultInquiryTemplateAttributes() },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/inquiry-templates/:id', () => {
  it('returns the template with its current version', async () => {
    const id = await createTemplate(api);

    const response = await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) });

    const document = inquiryTemplateDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.id).toBe(id);
    expect(document.data.attributes['current-version'].flow.metadata.id).toBe(
      'default-gov-id-selfie',
    );
  });

  it('answers 404 for a template of another environment', async () => {
    const other = await api.newTenant();
    const id = await createTemplate(api, other.token);

    const response = await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });

  it('answers 400 for a malformed id', async () => {
    const response = await api.app.inject({
      url: `${BASE}/not-an-id`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/v1/inquiry-templates', () => {
  it('lists templates newest first with cursor pagination', async () => {
    const tenant = await api.newTenant();
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(await createTemplate(api, tenant.token));
    }

    const first = inquiryTemplateListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: `${BASE}?page[size]=2`, headers: bearer(tenant.token) }),
        200,
      ),
    );
    expect(first.data.map((template) => template.id)).toEqual([ids[2], ids[1]]);
    expect(first.links.next).toBe(`${BASE}?page[after]=${String(ids[1])}&page[size]=2`);

    const second = inquiryTemplateListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: first.links.next ?? '', headers: bearer(tenant.token) }),
        200,
      ),
    );
    expect(second.data.map((template) => template.id)).toEqual([ids[0]]);
    expect(second.links.next).toBeNull();
  });

  it('answers 400 for a cursor from another environment', async () => {
    const other = await api.newTenant();
    const foreign = await createTemplate(api, other.token);

    const response = await api.app.inject({
      url: `${BASE}?page[after]=${foreign}`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(foreign);
  });

  it.each(['page[size]=0', 'page[size]=101', 'page[size]=x', 'page[after]=inq_x', 'other=1'])(
    'rejects the query %s',
    async (query) => {
      const response = await api.app.inject({
        url: `${BASE}?${query}`,
        headers: bearer(api.token),
      });

      expect(response.statusCode).toBe(400);
    },
  );
});

// Phase 2 (C11) -------------------------------------------------------------------------------

function patch(id: string, attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'PATCH',
    url: `${BASE}/${id}`,
    headers: bearer(token),
    payload: { data: { type: 'inquiry-template', attributes } },
  });
}

describe('inquiry template status and settings (C11)', () => {
  it('creates an active template whose version 1 carries the resolved settings', async () => {
    const response = await post({
      data: {
        attributes: {
          ...defaultInquiryTemplateAttributes(),
          settings: { 'inquiry-expiration-seconds': 3600, 'retention-days': 30 },
        },
      },
    });

    const document = inquiryTemplateDocumentSchema.parse(expectStatus(response, 201));
    expect(document.data.attributes.status).toBe('active');
    expect(document.data.attributes['current-version'].settings).toEqual({
      'inquiry-expiration-seconds': 3600,
      'session-expiration-seconds': 86_400,
      'one-time-link-expiration-seconds': 86_400,
      'retention-days': 30,
      // C91.5 (Phase 7): the session cap.
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
      // C151.10 (Workflow 9A): no change at start, a day at resume.
      'inquiry-expiration-after-start-seconds': null,
      'inquiry-expiration-after-resume-seconds': 86_400,
      // C235.3 (Workflow 11A): served off by default.
      'accept-cloned-results': null,
    });
    const read = inquiryTemplateDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: `${BASE}/${document.data.id}`, headers: bearer(api.token) }),
        200,
      ),
    );
    expect(read.data.attributes['current-version'].settings?.['inquiry-expiration-seconds']).toBe(
      3600,
    );
  });

  it('applies the default settings on read when none were set', async () => {
    const id = await createTemplate(api);

    const document = inquiryTemplateDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) }), 200),
    );

    expect(document.data.attributes['current-version'].settings).toEqual({
      'inquiry-expiration-seconds': 86_400,
      'session-expiration-seconds': 86_400,
      'one-time-link-expiration-seconds': 86_400,
      'retention-days': null,
      // C91.5 (Phase 7): the session cap.
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
      // C151.10 (Workflow 9A): no change at start, a day at resume.
      'inquiry-expiration-after-start-seconds': null,
      'inquiry-expiration-after-resume-seconds': 86_400,
      // C235.3 (Workflow 11A): served off by default.
      'accept-cloned-results': null,
    });
  });

  it('accepts verification-config v2: per-check config and allowed countries', async () => {
    const attributes = defaultInquiryTemplateAttributes();
    const governmentId = attributes['verification-config']['government-id'];
    const selfie = attributes['verification-config'].selfie;
    if (governmentId === undefined || selfie === undefined) {
      throw new Error('the default template has both verifications');
    }
    governmentId.checks.id_blur_detection = {
      enabled: true,
      required: true,
      config: { 'min-blur-score': 150 },
    };
    governmentId['allowed-countries'] = ['US', 'CA'];
    selfie.checks.selfie_id_comparison = {
      enabled: true,
      required: true,
      config: { threshold: 0.4 },
    };

    const document = inquiryTemplateDocumentSchema.parse(
      expectStatus(await post({ data: { attributes } }), 201),
    );

    expect(
      document.data.attributes['current-version']['verification-config']['government-id'],
    ).toMatchObject({
      checks: { id_blur_detection: { config: { 'min-blur-score': 150 } } },
      'allowed-countries': ['US', 'CA'],
    });
  });

  it.each([
    ['an out-of-range threshold', { threshold: 0.9 }, 'selfie_id_comparison'],
    ['config on a check that takes none', { anything: 1 }, 'selfie_multiple_faces_detection'],
  ])('rejects %s', async (_label, config, check) => {
    const attributes = defaultInquiryTemplateAttributes();
    const selfie = attributes['verification-config'].selfie;
    if (selfie === undefined) {
      throw new Error('the default template has a selfie');
    }
    selfie.checks[check] = { enabled: true, required: true, config };

    expect((await post({ data: { attributes } })).statusCode).toBe(400);
  });

  it.each([
    ['inquiry-expiration-seconds', 299],
    ['session-expiration-seconds', 2_592_001],
    ['retention-days', 0],
  ])('rejects the setting %s = %s', async (name, value) => {
    const response = await post({
      data: { attributes: { ...defaultInquiryTemplateAttributes(), settings: { [name]: value } } },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /api/v1/inquiry-templates/:id', () => {
  it('renames the template and audits the change', async () => {
    const id = await createTemplate(api);
    const userId = newId('usr');

    const document = inquiryTemplateDocumentSchema.parse(
      expectStatus(
        await patch(id, { name: 'Renamed' }, api.newUserToken(api.environmentId, { userId })),
        200,
      ),
    );

    expect(document.data.attributes.name).toBe('Renamed');
    expect(
      api.audit.withAction('inquiry-template.updated').filter((e) => e.resourceId === id),
    ).toEqual([
      expect.objectContaining({
        actor: { type: 'user', id: userId },
        resourceType: 'inquiry-template',
        metadata: { attributes: ['name'] },
      }),
    ]);
  });

  it('archives a template, which then refuses new inquiries, and restores it', async () => {
    const id = await createTemplate(api);

    const archived = inquiryTemplateDocumentSchema.parse(
      expectStatus(await patch(id, { status: 'archived' }), 200),
    );
    expect(archived.data.attributes.status).toBe('archived');
    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: bearer(api.token),
      payload: { data: { attributes: { 'inquiry-template-id': id } } },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/template-archived',
    );

    expectStatus(await patch(id, { status: 'active' }), 200);
    expect(await createInquiry(api, { templateId: id })).toMatch(/^inq_/);
  });

  it.each([
    ['nothing', {}],
    ['an unknown status', { status: 'deleted' }],
    ['an empty name', { name: '' }],
    ['a flow', { flow: {} }],
  ])('rejects %s', async (_label, attributes) => {
    const id = await createTemplate(api);

    expect((await patch(id, attributes)).statusCode).toBe(400);
  });

  it('answers 404 across environments and 403 without inquiry-templates:write', async () => {
    const other = await api.newTenant();
    const foreign = await createTemplate(api, other.token);
    const id = await createTemplate(api);
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiry-templates:read'] });

    const response = await patch(foreign, { name: 'x' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect((await patch(id, { name: 'x' }, reader)).statusCode).toBe(403);
  });

  it('records inquiry-template.created on creation', async () => {
    const id = await createTemplate(api);

    expect(api.audit.withAction('inquiry-template.created').map((e) => e.resourceId)).toContain(id);
  });
});
