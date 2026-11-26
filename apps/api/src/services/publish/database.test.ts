/**
 * C50.4 (H28): in a production environment, a `database` step whose `database` provider is
 * unbound is published only with `accept-review-without-provider: true` (every lookup would go to
 * review); otherwise 422 `provider_not_configured`, pointing at the step. A sandbox environment
 * and a bound provider pass. The AAMVA rule is `aamva.test.ts`.
 */
import {
  defaultInquiryTemplateAttributes,
  type CreateInquiryTemplateAttributes,
  type VerificationConfig,
} from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import type { Db } from '@openverify/db';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxDatabaseProvider } from '../../providers/database/sandbox.js';
import type { ProviderBindings } from '../../ports.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import type { ApiDependencies } from '../context.js';
import { databasePublish } from './database.js';

const DATABASE_STEP: FlowStep = {
  id: 'database',
  type: 'database',
  fields: ['name_first', 'name_last', 'birthdate', 'address_street_1', 'address_country_code'],
};

const flowWith = (...steps: FlowStep[]): Flow => ({
  metadata: { specVersion: 1, id: 'database-flow', version: 1, name: 'Database' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    ...steps,
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

const config = (accept?: boolean): VerificationConfig => ({
  database: {
    ...defaultTemplateConfig('database'),
    ...(accept === undefined ? {} : { 'accept-review-without-provider': accept }),
  },
});

const bound = (database?: ReturnType<typeof createSandboxDatabaseProvider>): ProviderBindings => ({
  sandbox: {},
  production: database === undefined ? {} : { database },
});

function problems(options: {
  kind: 'sandbox' | 'production';
  providers?: ProviderBindings;
  flow?: Flow;
  config?: VerificationConfig;
}) {
  return databasePublish.problems({
    deps: { providers: options.providers ?? bound() } as ApiDependencies,
    db: {} as Db,
    environment: { id: 'env_x', kind: options.kind },
    flow: options.flow ?? flowWith(DATABASE_STEP),
    config: options.config ?? config(),
  });
}

describe('the database publish rule (C50.4, H28)', () => {
  it('refuses a production database step whose provider is unbound, pointing at the step', async () => {
    await expect(problems({ kind: 'production' })).resolves.toEqual([
      {
        code: 'provider_not_configured',
        pointer: '/flow/steps/1',
        detail: expect.stringContaining('accept-review-without-provider') as string,
      },
    ]);
  });

  it('accepts it with accept-review-without-provider', async () => {
    await expect(problems({ kind: 'production', config: config(true) })).resolves.toEqual([]);
    await expect(problems({ kind: 'production', config: config(false) })).resolves.toHaveLength(1);
  });

  it('accepts it with a bound provider, and in a sandbox environment', async () => {
    await expect(
      problems({ kind: 'production', providers: bound(createSandboxDatabaseProvider()) }),
    ).resolves.toEqual([]);
    await expect(problems({ kind: 'sandbox' })).resolves.toEqual([]);
  });

  it('has nothing to say about a flow without a database step', async () => {
    await expect(problems({ kind: 'production', flow: flowWith(), config: {} })).resolves.toEqual(
      [],
    );
  });
});

describe('POST /inquiry-templates with a database step (C50.4)', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  function withDatabase(accept?: boolean): CreateInquiryTemplateAttributes {
    const attributes = defaultInquiryTemplateAttributes();
    const completion = attributes.flow.steps.findIndex((step) => step.type === 'completion');
    attributes.flow.steps.splice(completion, 0, DATABASE_STEP);
    attributes['verification-config'] = {
      ...attributes['verification-config'],
      ...config(accept),
    };
    return attributes;
  }

  async function create(token: string, attributes: CreateInquiryTemplateAttributes) {
    return api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(token),
      payload: { data: { type: 'inquiry-template', attributes } },
    });
  }

  it('answers 422 provider_not_configured in production, pointing into the attributes', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const attributes = withDatabase();
    const step = attributes.flow.steps.findIndex((candidate) => candidate.type === 'database');

    const response = await create(production.token, attributes);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'provider_not_configured',
      errors: [{ location: 'body', pointer: `/data/attributes/flow/steps/${String(step)}` }],
    });
  });

  it('creates it in production with accept-review-without-provider, and in a sandbox', async () => {
    const production = await api.newTenant({ kind: 'production' });

    expect((await create(production.token, withDatabase(true))).statusCode).toBe(201);
    expect((await create(api.token, withDatabase())).statusCode).toBe(201);
  });
});
