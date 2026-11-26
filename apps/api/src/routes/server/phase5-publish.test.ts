/**
 * C50.4, C54.1: creating a template and publishing a version run the async publish hook of each
 * type whose step the flow holds, with the environment and the template, and answer a broken
 * rule as a 422 with its code and a pointer under `/data/attributes`. The phone hook is replaced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PublishContext } from '../../services/publish/index.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';

const hook = vi.hoisted(() => ({
  calls: [] as { kind: string; steps: number; phoneConfig: unknown }[],
  broken: true,
}));

vi.mock('../../services/publish/phone-number.js', () => ({
  phoneNumberPublish: {
    problems: (ctx: PublishContext) => {
      hook.calls.push({
        kind: ctx.environment.kind,
        steps: ctx.flow.steps.length,
        phoneConfig: ctx.config['phone-number'],
      });
      const index = ctx.flow.steps.findIndex((step) => step.type === 'phone_otp');
      return Promise.resolve(
        hook.broken
          ? [
              {
                code: 'otp_channel_not_configured' as const,
                pointer: `/flow/steps/${String(index)}`,
                detail: 'No synthetic sender.',
              },
            ]
          : [],
      );
    },
  },
}));

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const attributes = phase5TemplateAttributes();
const phoneIndex = attributes.flow.steps.findIndex((step) => step.type === 'phone_otp');

function createTemplate() {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-templates',
    headers: bearer(api.token),
    payload: { data: { type: 'inquiry-template', attributes } },
  });
}

describe('async publish hooks (C50.4, C54.1)', () => {
  it('runs the hook of each type the flow holds and answers its problem with its code and pointer', async () => {
    hook.broken = true;
    hook.calls.length = 0;

    const response = await createTemplate();

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'otp_channel_not_configured',
      errors: [
        {
          location: 'body',
          pointer: `/data/attributes/flow/steps/${String(phoneIndex)}`,
          detail: 'No synthetic sender.',
        },
      ],
    });
    expect(hook.calls).toEqual([
      {
        kind: api.environmentKind,
        steps: attributes.flow.steps.length,
        phoneConfig: attributes['verification-config']['phone-number'],
      },
    ]);
  });

  it('publishes a draft only once its hooks find nothing', async () => {
    hook.broken = false;
    const created = expectStatus(await createTemplate(), 201);
    const templateId = created.data.id;
    const draft = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-template-versions',
        headers: bearer(api.token),
        payload: {
          data: {
            type: 'inquiry-template-version',
            attributes: {
              'inquiry-template-id': templateId,
              flow: attributes.flow,
              'verification-config': attributes['verification-config'],
            },
          },
        },
      }),
      201,
    );
    hook.broken = true;

    const refused = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${draft.data.id}/publish`,
      headers: bearer(api.token),
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ code: 'otp_channel_not_configured' });
  });
});
