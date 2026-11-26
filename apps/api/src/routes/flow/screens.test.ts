/**
 * C148.5 (Workflow 9A, api-flow-engine, checkpoint "screens"): `POST /flow/screens/:stepId/submit`
 * takes the current screen's values and the button pressed. Only the current step accepts it (409
 * `flow_step_not_current`); every value is validated again on the server (Arabic-Indic digits
 * normalised first, C161.4), a hidden component's value is discarded, `fields` is written, the exit
 * is recorded through the button's port, the flow advances, and the answer is the session. A
 * resubmission of a step already left answers the current session. No value is ever echoed in a
 * problem. Every value is synthetic.
 */
import { getInquiry, listInquiryFlowSteps } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, resumeInquiry } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** consent -> about (a screen with a skip button) -> id_card -> done; skip -> done. */
const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'screens', version: 1, name: 'Screens' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
    {
      id: 'about',
      type: 'screen',
      components: [
        {
          id: 'nick',
          kind: 'text_input',
          field: 'nickname',
          labelKey: 'about.nickname',
          required: true,
          minLength: 2,
          maxLength: 20,
          pattern: '[A-Za-z]+',
        },
        { id: 'age', kind: 'number', field: 'age', labelKey: 'about.age', min: 18, max: 120 },
        {
          id: 'plan',
          kind: 'select',
          field: 'plan',
          labelKey: 'about.plan',
          required: true,
          options: [
            { key: 'basic', value: 'basic', labelKey: 'about.plan.basic' },
            { key: 'other', value: 'other', labelKey: 'about.plan.other' },
          ],
        },
        {
          id: 'plan_other',
          kind: 'text_input',
          field: 'plan_detail',
          labelKey: 'about.plan.detail',
          required: true,
          visibleWhen: { '===': [{ var: 'screen.plan' }, 'other'] },
        },
        {
          id: 'home',
          kind: 'country_select',
          field: 'home_country',
          labelKey: 'about.country',
          allowedCountries: ['US', 'CA'],
        },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        { id: 'later', kind: 'button', labelKey: 'about.later', action: 'submit', port: 'skip' },
      ],
    },
    {
      id: 'id_card',
      type: 'government_id',
      sides: 'front',
      maxAttempts: 2,
      captureMethods: ['camera'],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    edge('e1', 'consent', 'next', 'about'),
    edge('e2', 'about', 'next', 'id_card'),
    edge('e3', 'about', 'button:skip', 'done'),
    edge('e4', 'id_card', 'next', 'done'),
  ],
});

/** A session of a new inquiry of {@link FLOW}, with its consent recorded when `consent`. */
async function session(consent = true): Promise<{ inquiryId: string; token: string }> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow: FLOW });
  const token = await resumeInquiry(api, inquiry.id);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  if (consent) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: { accepted: true, 'text-keys': ['consent.biometric'], locale: 'en' },
      }),
      201,
    );
  }
  return { inquiryId: inquiry.id, token };
}

const submit = (token: string, stepId: string, payload: Record<string, unknown>) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/screens/${stepId}/submit`,
    headers: bearer(token),
    payload,
  });

async function inquiryOf(inquiryId: string) {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (inquiry === null) throw new Error('no inquiry');
  return inquiry;
}

const VALID = { nickname: 'Ada', age: 42, plan: 'basic', home_country: 'CA' };

describe('POST /api/v1/flow/screens/:stepId/submit (C148.5)', () => {
  it('refuses a screen that is not the current step with 409 flow_step_not_current', async () => {
    const { token } = await session(false);
    const response = await submit(token, 'about', { values: VALID });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'flow_step_not_current' });
  });

  it('validates every visible value again, at its pointer, without echoing a value', async () => {
    const { inquiryId, token } = await session();
    const response = await submit(token, 'about', {
      values: { nickname: 'A1', age: 12, plan: 'gold', home_country: 'FR' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ errors: { pointer: string }[] }>();
    expect(body.errors.map((error) => error.pointer).sort()).toEqual([
      '/values/age',
      '/values/home_country',
      '/values/nickname',
      '/values/plan',
    ]);
    for (const value of ['A1', 'gold', 'FR']) {
      expect(response.body).not.toContain(`"${value}"`);
    }
    expect(await inquiryOf(inquiryId)).toMatchObject({ flowStepId: 'about', fields: {} });

    const missing = await submit(token, 'about', { values: { age: 30 } });
    expect(missing.statusCode).toBe(422);
    expect(
      missing.json<{ errors: { pointer: string }[] }>().errors.map((error) => error.pointer),
    ).toEqual(['/values/nickname', '/values/plan']);
  });

  it('writes the values, normalising Arabic-Indic digits, discards a hidden one, and moves on through next', async () => {
    const { inquiryId, token } = await session();
    const response = await submit(token, 'about', {
      values: { ...VALID, age: '٤٢', plan_detail: 'not shown', stray: 'not on this screen' },
    });
    const answered = expectStatus(response, 200) as unknown as {
      inquiry: { status: string };
    };
    expect(answered.inquiry.status).toBe('pending');
    const inquiry = await inquiryOf(inquiryId);
    expect(inquiry.fields).toEqual({ nickname: 'Ada', age: 42, plan: 'basic', home_country: 'CA' });
    expect(inquiry).toMatchObject({ flowStepId: 'id_card', flowPreviousStepId: 'about' });
    const about = (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).find(
      (entry) => entry.stepId === 'about',
    );
    expect(about).toMatchObject({ exitPort: 'next', sensitive: false });
  });

  it('requires a shown component: the detail of the other plan', async () => {
    const { token } = await session();
    const response = await submit(token, 'about', { values: { ...VALID, plan: 'other' } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ pointer: '/values/plan_detail' }] });
  });

  it('takes a button’s own port, recorded as sensitive, and refuses a button the screen lacks', async () => {
    const { inquiryId, token } = await session();
    const unknown = await submit(token, 'about', { values: VALID, button: 'nope' });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json()).toMatchObject({ errors: [{ pointer: '/button' }] });

    expectStatus(await submit(token, 'about', { values: VALID, button: 'skip' }), 200);
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'done',
      status: 'completed',
    });
    const about = (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).find(
      (entry) => entry.stepId === 'about',
    );
    expect(about).toMatchObject({ exitPort: 'button:skip', sensitive: true });
  });

  it('answers a resubmission of a step already left with the current session and changes nothing', async () => {
    const { inquiryId, token } = await session();
    expectStatus(await submit(token, 'about', { values: VALID }), 200);
    const again = await submit(token, 'about', { values: { ...VALID, nickname: 'Bea' } });
    expectStatus(again, 200);
    expect((await inquiryOf(inquiryId)).fields).toMatchObject({ nickname: 'Ada' });
  });
});
