/**
 * C52.3: `POST /api/v1/flow/verifications/:id/inputs`. The values are cleaned (controls and
 * bidirectional characters removed, trimmed), checked against the type's body and the step (a
 * member the step does not collect is refused, a required one must be present: 422 with a JSON
 * Pointer per member), sealed and never echoed; a new body replaces the earlier one while the
 * verification is `initiated`. The answer is the flow view with `inputs-received`. The C52.1
 * preconditions are `verification-mutations.contract.test.ts`. Every value is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  flowVerificationDocumentSchema,
  type DefaultInquiryTemplateAttributes,
  type SupportedVerificationType,
} from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import { getVerificationInputs } from '@openverify/db';
import type { FlowStep } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { passStepsBefore } from '../../flow-engine/testing.js';

const FORM_STEPS: readonly FlowStep[] = [
  {
    id: 'database',
    type: 'database',
    fields: [
      'name_first',
      'name_last',
      'birthdate',
      'address_street_1',
      'address_city',
      'address_country_code',
    ],
  },
  { id: 'aamva', type: 'aamva', source: 'form' },
  { id: 'business', type: 'database_business' },
  { id: 'website', type: 'business_website' },
];

/** The default template with the four form steps before completion. */
function formTemplate(
  business: DefaultInquiryTemplateAttributes['verification-config']['database-business'] = defaultTemplateConfig(
    'database_business',
  ),
): DefaultInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Form steps';
  const completion = attributes.flow.steps.findIndex((step) => step.type === 'completion');
  attributes.flow.steps = [
    ...attributes.flow.steps.slice(0, completion),
    ...FORM_STEPS,
    ...attributes.flow.steps.slice(completion),
  ];
  attributes['verification-config'] = {
    ...attributes['verification-config'],
    database: defaultTemplateConfig('database'),
    aamva: defaultTemplateConfig('aamva'),
    'database-business': business,
    'business-website': defaultTemplateConfig('business_website'),
  };
  return attributes;
}

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

let api: TestApi;
let formTemplateId: string;

beforeAll(async () => {
  api = await createTestApi();
  formTemplateId = await createTemplate(api, api.token, formTemplate());
});

afterAll(async () => {
  await api.close();
});

/** A started inquiry with consent, its session, and a verification of `type`. */
async function target(
  type: SupportedVerificationType,
  options: { templateId?: string; status?: 'submitted' } = {},
) {
  const inquiryId = await createInquiry(api, { templateId: options.templateId ?? formTemplateId });
  const token = await resumeInquiry(api, inquiryId);
  // C151.4 (Workflow 9A): the steps before the target's passed, so its step is the current one.
  await passStepsBefore(api, inquiryId, type);
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(token),
      payload: CONSENT_BODY,
    }),
    201,
  );
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type,
    ...(options.status === undefined ? {} : { status: options.status }),
  });
  return { inquiryId, token, id };
}

function enter(token: string, id: string, payload: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${id}/inputs`,
    headers: bearer(token),
    payload,
  });
}

/** `values` without the named members. */
function without(values: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => !names.includes(name)));
}

const stored = async (id: string) =>
  (await getVerificationInputs(api.database.db, api.environmentId, id))?.values ?? null;

/** The `errors` pointers of a problem answer. */
function pointers(response: {
  statusCode: number;
  headers: Record<string, unknown>;
  json(): unknown;
}) {
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  const problem = response.json() as { errors?: { location: string; pointer: string }[] };
  return (problem.errors ?? []).map((error) => {
    expect(error.location).toBe('body');
    return error.pointer;
  });
}

const DATABASE_VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-city': 'Springfield',
  'address-country-code': 'US',
};

const AAMVA_VALUES = {
  'name-first': 'Synthia',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'identification-number': 'D1234567',
  'issuing-authority': 'CA',
  'address-postal-code': '90001',
};

describe('POST /flow/verifications/:id/inputs: database (C52.3)', () => {
  it('seals the cleaned values, never echoes them, and answers the flow view with inputs-received', async () => {
    const { token, id } = await target('database');

    const response = await enter(token, id, {
      ...DATABASE_VALUES,
      'name-first': ' Syn\u0000thia\u202e ',
    });

    const document = flowVerificationDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data).toMatchObject({
      id,
      type: 'verification/database',
      attributes: {
        status: 'initiated',
        'inputs-received': true,
        guidance: {
          fields: Object.keys(DATABASE_VALUES),
          'required-fields': ['name-first', 'name-last', 'address-country-code'],
        },
      },
    });
    for (const value of Object.values(DATABASE_VALUES)) {
      expect(response.body).not.toContain(value);
    }
    expect(await stored(id)).toEqual(DATABASE_VALUES);
  });

  it('replaces the earlier values while the verification is initiated', async () => {
    const { token, id } = await target('database');
    expectStatus(await enter(token, id, DATABASE_VALUES), 200);

    expectStatus(
      await enter(token, id, {
        'name-first': 'Synthea',
        'name-last': 'Testerton',
        'address-country-code': 'GB',
      }),
      200,
    );

    expect(await stored(id)).toEqual({
      'name-first': 'Synthea',
      'name-last': 'Testerton',
      'address-country-code': 'GB',
    });
  });

  it('refuses a member the step does not collect, with a pointer to it, and keeps nothing', async () => {
    const { token, id } = await target('database');

    const response = await enter(token, id, {
      ...DATABASE_VALUES,
      'phone-number': '+15555550100',
      'address-postal-code': '62704',
    });

    expect(response.statusCode).toBe(422);
    expect(pointers(response).sort()).toEqual(['/address-postal-code', '/phone-number']);
    expect(response.body).not.toContain('+15555550100');
    expect(await stored(id)).toBeNull();
  });

  it('refuses a body without a required member, with a pointer to each', async () => {
    const { token, id } = await target('database');
    const response = await enter(
      token,
      id,
      without(DATABASE_VALUES, 'name-last', 'address-country-code'),
    );

    expect(response.statusCode).toBe(422);
    expect(pointers(response).sort()).toEqual(['/address-country-code', '/name-last']);
  });

  it('refuses a name over 200 characters with a pointer to it, not a route-level 400', async () => {
    const { token, id } = await target('database');

    const response = await enter(token, id, {
      ...DATABASE_VALUES,
      'name-first': 'A'.repeat(201),
    });

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/name-first']);
    expect(await stored(id)).toBeNull();
  });

  it('refuses a value that cleaning empties', async () => {
    const { token, id } = await target('database');

    const response = await enter(token, id, {
      ...DATABASE_VALUES,
      'address-city': ' \u200e\u0007 ',
    });

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/address-city']);
  });

  it('answers 409 once the verification was submitted, and keeps nothing', async () => {
    const { token, id } = await target('database', { status: 'submitted' });

    expect((await enter(token, id, DATABASE_VALUES)).statusCode).toBe(409);
    expect(await stored(id)).toBeNull();
  });

  it('answers 422 for a database verification of a flow without a database step', async () => {
    const { token, id } = await target('database', { templateId: await createTemplate(api) });

    const response = await enter(token, id, DATABASE_VALUES);

    expect(response.statusCode).toBe(422);
    expect(await stored(id)).toBeNull();
  });

  it('answers 422 for a verification of another type', async () => {
    const { token, id } = await target('government_id');

    expect((await enter(token, id, DATABASE_VALUES)).statusCode).toBe(422);
  });
});

describe('POST /flow/verifications/:id/inputs: AAMVA (C52.3, C59.6)', () => {
  it('takes the AAMVA form, sealed', async () => {
    const { token, id } = await target('aamva');

    const response = await enter(token, id, AAMVA_VALUES);

    expect(expectStatus(response, 200).data.attributes).toMatchObject({
      'inputs-received': true,
      guidance: { source: 'form' },
    });
    expect(response.body).not.toContain('D1234567');
    expect(await stored(id)).toEqual(AAMVA_VALUES);
  });

  it('refuses a body without the members the form requires, pointing at each', async () => {
    const { token, id } = await target('aamva');
    const response = await enter(token, id, without(AAMVA_VALUES, 'issuing-authority'));

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/issuing-authority']);
  });

  it('refuses an issuing authority outside the US jurisdictions with a pointer to it, not a route-level 400', async () => {
    const { token, id } = await target('aamva');

    const response = await enter(token, id, { ...AAMVA_VALUES, 'issuing-authority': 'ZZ' });

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/issuing-authority']);
    expect(response.body).not.toContain('D1234567');
    expect(await stored(id)).toBeNull();
  });

  it('answers the route-level 400 for a body that is no object at all', async () => {
    const { token, id } = await target('aamva');

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${id}/inputs`,
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: JSON.stringify(['name-first']),
    });

    expect(response.statusCode).toBe(400);
    expect(await stored(id)).toBeNull();
  });

  it('answers 409 verification_created_by_server for the silent step', async () => {
    const silent = defaultInquiryTemplateAttributes();
    const completion = silent.flow.steps.findIndex((step) => step.type === 'completion');
    silent.flow.steps.splice(completion, 0, {
      id: 'aamva',
      type: 'aamva',
      source: 'government_id',
    });
    silent['verification-config'] = {
      ...silent['verification-config'],
      aamva: defaultTemplateConfig('aamva'),
    };
    const templateId = await createTemplate(api, api.token, silent);
    const { token, id } = await target('aamva', { templateId });

    const response = await enter(token, id, AAMVA_VALUES);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'verification_created_by_server' });
    expect(await stored(id)).toBeNull();
  });
});

describe('POST /flow/verifications/:id/inputs: business registry and website (C52.3)', () => {
  const BUSINESS = { 'business-name': 'Example Holdings Ltd', 'country-code': 'GB' };

  it('takes a business, sealed', async () => {
    const { token, id } = await target('database_business');

    expectStatus(await enter(token, id, { ...BUSINESS, 'registration-number': '01234567' }), 200);

    expect(await stored(id)).toEqual({ ...BUSINESS, 'registration-number': '01234567' });
  });

  it('refuses associated persons unless the step collects them', async () => {
    const { token, id } = await target('database_business');

    const response = await enter(token, id, {
      ...BUSINESS,
      'associated-persons': [{ 'name-first': 'Ada', 'name-last': 'Example' }],
    });

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/associated-persons']);
  });

  it('requires an input every configured match group names', async () => {
    const config = defaultTemplateConfig('database_business');
    const templateId = await createTemplate(
      api,
      api.token,
      formTemplate({
        ...config,
        checks: {
          ...config.checks,
          database_business_identity_comparison: {
            enabled: true,
            required: true,
            config: { 'match-groups': [{ name: 'partial', 'registration-number': 'full' }] },
          },
        },
      }),
    );
    const { token, id } = await target('database_business', { templateId });

    const response = await enter(token, id, BUSINESS);

    expect(response.statusCode).toBe(422);
    expect(pointers(response)).toEqual(['/registration-number']);
  });

  it('takes a website, and refuses members of another type with a pointer to each', async () => {
    const { token, id } = await target('business_website');
    expectStatus(await enter(token, id, { 'website-url': 'https://shop.example' }), 200);
    expect(await stored(id)).toEqual({ 'website-url': 'https://shop.example' });

    const { id: other, token: otherToken } = await target('business_website');
    const response = await enter(otherToken, other, { 'name-first': 'Synthia' });

    expect(response.statusCode).toBe(422);
    expect(pointers(response).sort()).toEqual(['/name-first', '/website-url']);
  });
});

describe('entering values, then submitting (C52.3, C52.6)', () => {
  function submit(token: string, id: string) {
    return api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${id}/submit`,
      headers: bearer(token),
    });
  }

  it.each([
    ['database', DATABASE_VALUES],
    ['aamva', AAMVA_VALUES],
  ] as const)(
    'a %s form is submitted only once its values were entered, then refuses new ones',
    async (type, values) => {
      const { token, id } = await target(type);

      const early = await submit(token, id);
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({ code: 'inputs_required' });

      expectStatus(await enter(token, id, values), 200);
      expect(expectStatus(await submit(token, id), 202).data.attributes).toMatchObject({
        status: 'submitted',
        'inputs-received': true,
      });
      expect(api.queue.jobs).toContainEqual({
        environmentId: api.environmentId,
        verificationId: id,
      });

      expect((await enter(token, id, values)).statusCode).toBe(409);
    },
  );
});
