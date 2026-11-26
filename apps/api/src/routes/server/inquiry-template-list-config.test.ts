/**
 * C99.5 (Workflow 7B Stage 1b (L)): `list-config` on inquiry template versions: stored as sent,
 * served resolved, pinned per version, and given to the publish rules
 * (`listConfigPublishProblems`, `api-lists`, a stub until then), whose first problem's code answers
 * with every pointer. Synthetic values.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { ListConfig } from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListConfigPublishContext } from '../../services/publish/list-config.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

const contexts = vi.hoisted(() => [] as { listConfig: ListConfig; kind: string }[]);
const refuse = vi.hoisted(() => ({ value: false }));
vi.mock('../../services/publish/list-config.js', () => ({
  listConfigPublishProblems: (ctx: ListConfigPublishContext) => {
    contexts.push({ listConfig: ctx.listConfig, kind: ctx.environment.kind });
    return Promise.resolve(
      refuse.value
        ? [
            {
              code: 'kind_not_collected',
              pointer: '/data/attributes/list-config/screen/0',
              detail: 'names a list of a kind this environment does not collect',
            },
          ]
        : [],
    );
  },
}));

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  contexts.length = 0;
  refuse.value = false;
});

const call = (method: 'POST' | 'PATCH' | 'GET', path: string, payload?: Record<string, unknown>) =>
  api.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload }),
  });

async function stored(versionId: string): Promise<unknown> {
  const rows = await api.database.db.execute(
    sql`select list_config from inquiry_template_versions where id = ${versionId}`,
  );
  return (rows as unknown as { rows: { list_config: unknown }[] }).rows[0]?.list_config;
}

async function template(): Promise<{ id: string; versionId: string }> {
  const created = expectStatus(
    await call('POST', '/inquiry-templates', {
      data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
    }),
    201,
  ) as unknown as { data: { id: string; attributes: { 'current-version': { id: string } } } };
  return { id: created.data.id, versionId: created.data.attributes['current-version'].id };
}

async function draft(templateId: string, listConfig?: ListConfig) {
  const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
  return expectStatus(
    await call('POST', '/inquiry-template-versions', {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          flow,
          'verification-config': verificationConfig,
          'inquiry-template-id': templateId,
          ...(listConfig === undefined ? {} : { 'list-config': listConfig }),
        },
      },
    }),
    201,
  ) as unknown as { data: { id: string; attributes: Record<string, unknown> } };
}

const CONFIG: ListConfig = { screen: 'none', 'on-list-match': 'needs_review' };

describe('C99.5: list-config on inquiry template versions', () => {
  it('serves the defaults, stored as {}, for a version that sets none', async () => {
    const { id } = await template();

    const version = await draft(id);

    expect(version.data.attributes['list-config']).toEqual({
      screen: 'all',
      'on-list-match': 'none',
    });
    expect(await stored(version.data.id)).toEqual({});
  });

  it('takes it on a draft, stores it as sent and serves it resolved', async () => {
    const { id } = await template();

    const version = await draft(id, { 'on-list-match': 'needs_review' });

    expect(await stored(version.data.id)).toEqual({ 'on-list-match': 'needs_review' });
    expect(version.data.attributes['list-config']).toEqual({
      screen: 'all',
      'on-list-match': 'needs_review',
    });
  });

  it('replaces it on update and keeps it when an update leaves it out', async () => {
    const { id } = await template();
    const version = await draft(id, CONFIG);

    expectStatus(
      await call('PATCH', `/inquiry-template-versions/${version.data.id}`, {
        data: { attributes: { 'list-config': { screen: 'all' } } },
      }),
      200,
    );
    expect(await stored(version.data.id)).toEqual({ screen: 'all' });

    expectStatus(
      await call('PATCH', `/inquiry-template-versions/${version.data.id}`, {
        data: { attributes: { settings: {} } },
      }),
      200,
    );
    expect(await stored(version.data.id)).toEqual({ screen: 'all' });
  });

  it('gives the stored member to the publish rules', async () => {
    const { id } = await template();
    const version = await draft(id, CONFIG);
    contexts.length = 0;

    expectStatus(await call('POST', `/inquiry-template-versions/${version.data.id}/publish`), 200);

    expect(contexts).toEqual([{ listConfig: CONFIG, kind: 'sandbox' }]);
  });

  it('answers a refusal with its code and pointers, leaving the draft a draft', async () => {
    const { id } = await template();
    const version = await draft(id, CONFIG);
    refuse.value = true;

    const response = await call('POST', `/inquiry-template-versions/${version.data.id}/publish`);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'kind_not_collected',
      errors: [expect.objectContaining({ pointer: '/data/attributes/list-config/screen/0' })],
    });
    const reread = expectStatus(
      await call('GET', `/inquiry-template-versions/${version.data.id}`),
      200,
    ) as unknown as { data: { attributes: { status: string } } };
    expect(reread.data.attributes.status).toBe('draft');
  });

  it('checks a new template’s version 1 too, with the defaults', async () => {
    await template();

    expect(contexts).toEqual([{ listConfig: {}, kind: 'sandbox' }]);
  });
});
