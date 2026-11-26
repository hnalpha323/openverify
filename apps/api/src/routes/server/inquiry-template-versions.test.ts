/** C11 template versions: drafts, publishing with superseding, and reads. */
import {
  defaultInquiryTemplateAttributes,
  inquiryDocumentSchema,
  inquiryTemplateDocumentSchema,
  inquiryTemplateVersionDocumentSchema,
  inquiryTemplateVersionListDocumentSchema,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
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
import { stepOrderBreakingAttributes } from '../../test-support/phase5-templates.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiry-template-versions';
const INVALID_TRANSITION = 'https://openverify.dev/problems/invalid-transition';
const DEFAULT_SETTINGS = {
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
};

/** The default template's flow and config with one selfie attempt: a recognisable change. */
function content() {
  const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
  const selfie = flow.steps.find((step) => step.type === 'selfie');
  if (selfie?.type === 'selfie') {
    selfie.maxAttempts = 1;
  }
  return { flow, 'verification-config': verificationConfig };
}

function createDraft(templateId: string, extra: Record<string, unknown> = {}, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url: BASE,
    headers: bearer(token),
    payload: {
      data: {
        type: 'inquiry-template-version',
        attributes: { 'inquiry-template-id': templateId, ...content(), ...extra },
      },
    },
  });
}

async function draftOf(templateId: string, extra: Record<string, unknown> = {}) {
  return expectStatus(await createDraft(templateId, extra), 201).data.id;
}

function patch(id: string, attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'PATCH',
    url: `${BASE}/${id}`,
    headers: bearer(token),
    payload: { data: { type: 'inquiry-template-version', attributes } },
  });
}

const publish = (id: string, token = api.token) =>
  api.app.inject({ method: 'POST', url: `${BASE}/${id}/publish`, headers: bearer(token) });

const get = (id: string, token = api.token) =>
  api.app.inject({ url: `${BASE}/${id}`, headers: bearer(token) });

const userWith = (...permissions: Permission[]) =>
  api.newUserToken(api.environmentId, { permissions });

describe('POST /api/v1/inquiry-template-versions', () => {
  it('creates a draft numbered max + 1 without changing the current version', async () => {
    const templateId = await createTemplate(api);

    const response = await createDraft(templateId, { settings: { 'retention-days': 7 } });

    const document = inquiryTemplateVersionDocumentSchema.parse(expectStatus(response, 201));
    expect(response.headers.location).toBe(`${BASE}/${document.data.id}`);
    expect(document.data).toMatchObject({
      type: 'inquiry-template-version',
      attributes: {
        'version-number': 2,
        status: 'draft',
        'published-at': null,
        settings: { ...DEFAULT_SETTINGS, 'retention-days': 7 },
        flow: content().flow,
      },
      relationships: { 'inquiry-template': { data: { type: 'inquiry-template', id: templateId } } },
    });
    const template = inquiryTemplateDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/inquiry-templates/${templateId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    expect(template.data.attributes['current-version']['version-number']).toBe(1);
    expect(
      api.audit.withAction('inquiry-template-version.created').map((e) => e.resourceId),
    ).toContain(document.data.id);
  });

  it('rejects content that fails the template validation', async () => {
    const templateId = await createTemplate(api);
    const { flow } = content();

    const response = await api.app.inject({
      method: 'POST',
      url: BASE,
      headers: bearer(api.token),
      payload: {
        data: {
          attributes: {
            'inquiry-template-id': templateId,
            flow,
            'verification-config': { selfie: content()['verification-config'].selfie },
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for a template of another environment', async () => {
    const other = await api.newTenant();

    const response = await createDraft(await createTemplate(api, other.token));

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });

  it('requires inquiry-templates:write', async () => {
    const templateId = await createTemplate(api);

    expect((await createDraft(templateId, {}, userWith('inquiry-templates:read'))).statusCode).toBe(
      403,
    );
  });
});

describe('PATCH /api/v1/inquiry-template-versions/:id', () => {
  it('changes a draft and audits it', async () => {
    const id = await draftOf(await createTemplate(api));

    const document = inquiryTemplateVersionDocumentSchema.parse(
      expectStatus(await patch(id, { settings: { 'inquiry-expiration-seconds': 900 } }), 200),
    );

    expect(document.data.attributes.settings['inquiry-expiration-seconds']).toBe(900);
    expect(document.data.attributes.status).toBe('draft');
    expect(
      api.audit.withAction('inquiry-template-version.updated').filter((e) => e.resourceId === id),
    ).toEqual([expect.objectContaining({ metadata: { attributes: ['settings'] } })]);
  });

  it('answers 422 when the merged flow and config no longer match', async () => {
    const id = await draftOf(await createTemplate(api));
    const { 'verification-config': config } = content();

    const response = await patch(id, { 'verification-config': { selfie: config.selfie } });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ errors: unknown[] }>().errors.length).toBeGreaterThan(0);
  });

  it('answers 409 invalid-transition for a published version', async () => {
    const id = await draftOf(await createTemplate(api));
    expectStatus(await publish(id), 200);

    const response = await patch(id, { settings: {} });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
  });

  it('answers 404 across environments and 403 without inquiry-templates:write', async () => {
    const other = await api.newTenant();
    const foreignTemplate = await createTemplate(api, other.token);
    const foreign = expectStatus(await createDraft(foreignTemplate, {}, other.token), 201).data.id;
    const id = await draftOf(await createTemplate(api));

    expect((await patch(foreign, { settings: {} })).statusCode).toBe(404);
    expect((await patch(id, { settings: {} }, userWith('inquiry-templates:read'))).statusCode).toBe(
      403,
    );
  });
});

describe('POST /api/v1/inquiry-template-versions/:id/publish', () => {
  it('keeps a draft that breaks a C50.4 publish rule, and answers 422 with pointers when it is published', async () => {
    const templateId = await createTemplate(api);
    const { flow, 'verification-config': config } = stepOrderBreakingAttributes();
    const id = await draftOf(templateId, { flow, 'verification-config': config });

    const response = await publish(id);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(
      [
        '/data/attributes/flow/steps/1/source',
        '/data/attributes/flow/steps/2',
        '/data/attributes/flow/steps/2',
      ],
    );
    expect(
      inquiryTemplateVersionDocumentSchema.parse(expectStatus(await get(id), 200)).data.attributes
        .status,
    ).toBe('draft');
  });

  it('publishes the draft, supersedes the previous version and pins new inquiries to it', async () => {
    const templateId = await createTemplate(api);
    const before = await createInquiry(api, { templateId });
    const id = await draftOf(templateId);

    const document = inquiryTemplateVersionDocumentSchema.parse(
      expectStatus(await publish(id), 200),
    );

    expect(document.data.attributes).toMatchObject({
      status: 'published',
      'published-at': expect.any(String) as unknown,
    });
    const template = inquiryTemplateDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/inquiry-templates/${templateId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    expect(template.data.attributes['current-version']).toMatchObject({
      id,
      'version-number': 2,
    });
    const versions = inquiryTemplateVersionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-template-id]=${templateId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );
    expect(
      versions.data.map((version) => [
        version.attributes['version-number'],
        version.attributes.status,
      ]),
    ).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);

    const after = await createInquiry(api, { templateId });
    const pinned = async (inquiryId: string) =>
      (
        await api.database.client.query<{ version: string }>(
          'select inquiry_template_version_id as version from inquiries where id = $1',
          [inquiryId],
        )
      ).rows[0]?.version;
    expect(await pinned(after)).toBe(id);
    expect(await pinned(before)).not.toBe(id);
    expect(
      inquiryDocumentSchema.parse(
        expectStatus(
          await api.app.inject({ url: `/api/v1/inquiries/${before}`, headers: bearer(api.token) }),
          200,
        ),
      ).data.attributes.status,
    ).toBe('created');
    expect(
      api.audit.withAction('inquiry-template-version.published').filter((e) => e.resourceId === id),
    ).toEqual([expect.objectContaining({ resourceType: 'inquiry-template-version' })]);
  });

  it('answers 409 invalid-transition for a version that is not a draft', async () => {
    const id = await draftOf(await createTemplate(api));
    expectStatus(await publish(id), 200);

    const response = await publish(id);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
  });

  it('requires inquiry-templates:publish, which inquiry-templates:write does not grant', async () => {
    const id = await draftOf(await createTemplate(api));

    const response = await publish(
      id,
      userWith('inquiry-templates:write', 'inquiry-templates:read'),
    );

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain('scope="inquiry-templates:publish"');
    expectStatus(await publish(id, userWith('inquiry-templates:publish')), 200);
  });

  it('answers 404 for a version of another environment', async () => {
    const other = await api.newTenant();
    const foreignTemplate = await createTemplate(api, other.token);
    const foreign = expectStatus(await createDraft(foreignTemplate, {}, other.token), 201).data.id;

    expect((await publish(foreign)).statusCode).toBe(404);
    expect(expectStatus(await get(foreign, other.token), 200).data.attributes.status).toBe('draft');
  });
});

describe('GET /api/v1/inquiry-template-versions', () => {
  it('fetches a version, with the default settings applied', async () => {
    const templateId = await createTemplate(api);
    const id = await draftOf(templateId);

    const document = inquiryTemplateVersionDocumentSchema.parse(expectStatus(await get(id), 200));

    expect(document.data.attributes.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('filters by status and pages newest first', async () => {
    const templateId = await createTemplate(api);
    const second = await draftOf(templateId);
    const third = await draftOf(templateId);

    const drafts = inquiryTemplateVersionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-template-id]=${templateId}&filter[status]=draft&page[size]=1`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );

    expect(drafts.data.map((version) => version.id)).toEqual([third]);
    expect(drafts.links.next).toBe(
      `${BASE}?filter[inquiry-template-id]=${templateId}&filter[status]=draft&page[after]=${third}&page[size]=1`,
    );
    const next = inquiryTemplateVersionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: drafts.links.next ?? '', headers: bearer(api.token) }),
        200,
      ),
    );
    expect(next.data.map((version) => version.id)).toEqual([second]);
  });

  it('only lists versions of the caller environment', async () => {
    const other = await api.newTenant();
    const foreignTemplate = await createTemplate(api, other.token);
    expectStatus(await createDraft(foreignTemplate, {}, other.token), 201);

    const list = inquiryTemplateVersionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-template-id]=${foreignTemplate}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );

    expect(list.data).toEqual([]);
  });

  it('answers 404 across environments and requires inquiry-templates:read', async () => {
    const other = await api.newTenant();
    const foreign = expectStatus(
      await createDraft(await createTemplate(api, other.token), {}, other.token),
      201,
    ).data.id;
    const own = await draftOf(await createTemplate(api));

    expect((await get(foreign)).statusCode).toBe(404);
    expect((await get(own, userWith('inquiries:read'))).statusCode).toBe(403);
    expect(
      (await api.app.inject({ url: BASE, headers: bearer(userWith('inquiries:read')) })).statusCode,
    ).toBe(403);
  });
});
