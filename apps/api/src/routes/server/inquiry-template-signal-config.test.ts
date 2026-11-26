/**
 * C90.6 (Workflow 7A Stage 1b (S)): an inquiry template version's `signal-config`. It is taken on
 * draft creation and draft updates, stored in `signal_config` (`{}` by default, also for a
 * template's version 1), served resolved (`resolveSignalConfig`) on every version, and checked on
 * publish by the rules of `services/publish/signal-config.ts` (`api-signals`), whose refusal is a
 * 422 with its own code and pointers. The rule is replaced here by a spy that refuses on demand.
 * Synthetic values only.
 */
import { defaultInquiryTemplateAttributes, type SignalConfig } from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalConfigPublishContext } from '../../services/publish/signal-config.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

const contexts = vi.hoisted(
  () => [] as { signalConfig: SignalConfig; kind: string; flow: unknown }[],
);
const refuse = vi.hoisted(() => ({ value: false }));
vi.mock('../../services/publish/signal-config.js', () => ({
  signalConfigPublishProblems: (ctx: SignalConfigPublishContext) => {
    contexts.push({ signalConfig: ctx.signalConfig, kind: ctx.environment.kind, flow: ctx.flow });
    return Promise.resolve(
      refuse.value
        ? [
            {
              code: 'unknown_signal',
              pointer: '/data/attributes/signal-config/collect/0',
              detail: 'is not a signal of the catalogue',
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

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload }),
  });

async function storedConfig(versionId: string) {
  const rows = await api.database.db.execute(
    sql`select signal_config from inquiry_template_versions where id = ${versionId}`,
  );
  return (rows as unknown as { rows: { signal_config: unknown }[] }).rows[0]?.signal_config;
}

const RULES: SignalConfig = {
  collect: ['inquiry/tor_detected', 'inquiry/bot_score'],
  'on-signal': 'needs_review',
  'review-rules': [{ signal: 'inquiry/bot_score', gte: 90 }],
};

async function template(): Promise<{ id: string; versionId: string }> {
  const created = expectStatus(
    await call('POST', '/inquiry-templates', {
      data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
    }),
    201,
  ) as unknown as { data: { id: string; attributes: { 'current-version': { id: string } } } };
  return { id: created.data.id, versionId: created.data.attributes['current-version'].id };
}

async function draft(templateId: string, signalConfig?: SignalConfig) {
  const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();
  return expectStatus(
    await call('POST', '/inquiry-template-versions', {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          flow,
          'verification-config': verificationConfig,
          'inquiry-template-id': templateId,
          ...(signalConfig === undefined ? {} : { 'signal-config': signalConfig }),
        },
      },
    }),
    201,
  ) as unknown as { data: { id: string; attributes: Record<string, unknown> } };
}

describe('C90.6: signal-config on inquiry template versions', () => {
  it('serves the defaults, stored as {}, for a version that sets none', async () => {
    const { versionId } = await template();

    const version = expectStatus(
      await call('GET', `/inquiry-template-versions/${versionId}`),
      200,
    ) as unknown as { data: { attributes: Record<string, unknown> } };

    expect(version.data.attributes['signal-config']).toEqual({
      collect: 'default',
      'on-signal': 'none',
      'review-rules': [],
    });
    expect(await storedConfig(versionId)).toEqual({});
  });

  it('takes it on a draft, stores it as sent and serves it resolved', async () => {
    const { id } = await template();

    const created = await draft(id, RULES);

    expect(created.data.attributes['signal-config']).toEqual(RULES);
    expect(await storedConfig(created.data.id)).toEqual(RULES);
  });

  it('replaces it on update and keeps it when an update leaves it out', async () => {
    const { id } = await template();
    const created = await draft(id, RULES);

    const updated = expectStatus(
      await call('PATCH', `/inquiry-template-versions/${created.data.id}`, {
        data: {
          type: 'inquiry-template-version',
          attributes: { 'signal-config': { 'on-signal': 'none' } },
        },
      }),
      200,
    ) as unknown as { data: { attributes: Record<string, unknown> } };
    expect(updated.data.attributes['signal-config']).toEqual({
      collect: 'default',
      'on-signal': 'none',
      'review-rules': [],
    });

    expectStatus(
      await call('PATCH', `/inquiry-template-versions/${created.data.id}`, {
        data: { type: 'inquiry-template-version', attributes: { settings: {} } },
      }),
      200,
    );
    expect(await storedConfig(created.data.id)).toEqual({ 'on-signal': 'none' });
  });

  it('gives the stored member, the flow and the environment to the publish rules', async () => {
    const { id } = await template();
    const created = await draft(id, RULES);

    expectStatus(
      await call('POST', `/inquiry-template-versions/${created.data.id}/publish`, { meta: {} }),
      200,
    );

    expect(contexts.at(-1)).toEqual({
      signalConfig: RULES,
      kind: 'sandbox',
      flow: defaultInquiryTemplateAttributes().flow,
    });
  });

  it('answers a refusal with its code and pointers, leaving the draft a draft', async () => {
    const { id } = await template();
    const created = await draft(id, RULES);
    refuse.value = true;

    const published = await call('POST', `/inquiry-template-versions/${created.data.id}/publish`, {
      meta: {},
    });

    expect(published.statusCode).toBe(422);
    expect(published.json()).toMatchObject({
      code: 'unknown_signal',
      errors: [{ pointer: '/data/attributes/signal-config/collect/0' }],
    });
    const version = expectStatus(
      await call('GET', `/inquiry-template-versions/${created.data.id}`),
      200,
    ) as unknown as { data: { attributes: { status: string } } };
    expect(version.data.attributes.status).toBe('draft');
  });

  it('checks a new template’s version 1 too, with the defaults', async () => {
    await template();

    expect(contexts.at(-1)?.signalConfig).toEqual({});
  });
});
