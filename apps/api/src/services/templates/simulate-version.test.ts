/**
 * C156.4 (Workflow 9B, api-templates-carry): `POST /inquiry-template-versions/:id/simulate` walks
 * the stored version (a flow-spec 1 flow migrated, as the engine walks it) over the body's scope, a
 * built-in preset or the caller's own, labelled simulated; it stores nothing, sends nothing and runs
 * no workflow. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import {
  defaultInquiryTemplateAttributes,
  templateSimulationDocumentSchema,
} from '@openverify/contracts';
import { createSimulationPreset, createUser } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { bearer, createTemplate, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;
let versionId: string;

beforeAll(async () => {
  api = await createInquiryTestApi();
  const templateId = await createTemplate(api);
  const template = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-templates/${templateId}`,
      headers: bearer(api.token),
    }),
    200,
  );
  versionId = (template.data.attributes as { 'current-version': { id: string } })['current-version']
    .id;
});

afterAll(async () => {
  await api.close();
});

const simulate = (id: string, meta: Record<string, unknown>, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${id}/simulate`,
    headers: bearer(token),
    payload: { meta },
  });

type Simulation = ReturnType<typeof templateSimulationDocumentSchema.parse>;

const PASSING = {
  verifications: { government_id: { status: 'passed' }, selfie: { status: 'passed' } },
};

describe('POST /inquiry-template-versions/:id/simulate (C156.4)', () => {
  it('walks the stored version over a scope, labelled simulated, with its path and outcome', async () => {
    const response = await simulate(versionId, { scope: PASSING });
    expect(response.statusCode, response.body).toBe(200);
    const document = templateSimulationDocumentSchema.parse(response.json());
    expect(document.data).toMatchObject({ type: 'inquiry-template-simulation', id: versionId });
    expect(document.data.attributes.simulated).toBe(true);
    // A flow-spec 1 flow is walked migrated, as the engine walks it: its transitions are branches.
    expect(document.data.attributes.steps.map((step) => step['step-id'])).toEqual([
      'consent',
      'government_id',
      'government_id-routes',
      'selfie',
      'selfie-routes',
      'completion',
    ]);
    expect(document.data.attributes.outcome).toEqual({
      status: 'completed',
      'flow-outcome': {
        'verification-types-on-path': ['government-id', 'selfie'],
        'fallbacks-taken': [],
        flags: [],
      },
    });
  });

  it('simulates a flow-spec 2 draft as its own engine would walk it', async () => {
    const templateId = await createTemplate(api);
    const flow = JSON.parse(
      readFileSync(
        new URL(
          '../../../../../contracts/fixtures/flows/v2/projection-branch.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown;
    const draft = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-template-versions',
        headers: bearer(api.token),
        payload: {
          data: {
            attributes: {
              'inquiry-template-id': templateId,
              flow,
              'field-schemas': [{ key: 'nickname', type: 'string', label: 'Nickname', pii: true }],
              'verification-config': {
                'government-id':
                  defaultInquiryTemplateAttributes()['verification-config']['government-id'],
              },
            },
          },
        },
      }),
      201,
    );
    const response = await simulate(draft.data.id, {
      scope: { verifications: { id_card: { status: 'passed', extractions: { 'age-years': 16 } } } },
    });
    expect(response.statusCode, response.body).toBe(200);
    const golden = JSON.parse(
      readFileSync(
        new URL('../../../../../contracts/fixtures/api/template-simulation.json', import.meta.url),
        'utf8',
      ),
    ) as { data: { attributes: unknown } };
    expect(response.json<{ data: { attributes: unknown } }>().data.attributes).toEqual(
      golden.data.attributes,
    );
  });

  it('takes a built-in preset resolved against the version, and the caller’s own preset', async () => {
    const failed = await simulate(versionId, { 'preset-id': 'builtin:government-id-failed' });
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json<Simulation>().data.attributes.outcome.status).toBe('failed');

    const user = await createUser(api.database.db, {
      id: testId('usr'),
      organizationId: api.organizationId,
      email: `${testId('usr').toLowerCase()}@example.com`,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    });
    const preset = await createSimulationPreset(api.database.db, api.environmentId, {
      id: testId('ssp'),
      userId: user.id,
      name: 'Synthetic review',
      scope: { verifications: { government_id: { status: 'needs_review' } } },
    });
    const token = api.newUserToken(api.environmentId, { userId: user.id });
    const own = await simulate(versionId, { 'preset-id': preset.id }, token);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json<Simulation>().data.attributes.steps.at(-1)?.['step-id']).toBe('selfie');
    // An API key holds no presets, and another user's is not found.
    expect((await simulate(versionId, { 'preset-id': preset.id })).statusCode).toBe(404);
    const other = api.newUserToken(api.environmentId, { userId: testId('usr') });
    expect((await simulate(versionId, { 'preset-id': preset.id }, other)).statusCode).toBe(404);
  });

  it('answers 404 for an unknown preset and for a version of another environment', async () => {
    expect((await simulate(versionId, { 'preset-id': 'builtin:nothing-passed' })).statusCode).toBe(
      404,
    );
    const elsewhere = await api.newTenant();
    const response = await simulate(versionId, { scope: PASSING }, elsewhere.token);
    expect(response.statusCode).toBe(404);
  });

  it('refuses a scope the version does not hold with 422 at its pointer, echoing no value', async () => {
    const response = await simulate(versionId, {
      scope: { verifications: { nowhere: { status: 'passed', extractions: {} } } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ location: 'body', pointer: '/meta/scope/verifications/nowhere' }],
    });
    const contradicted = await simulate(versionId, {
      scope: {
        verifications: {
          government_id: { status: 'passed', checks: { id_expired_detection: 'failed' } },
        },
      },
    });
    expect(contradicted.statusCode).toBe(422);
    expect(contradicted.json()).toMatchObject({
      errors: [{ pointer: '/meta/scope/verifications/government_id/status' }],
    });
  });

  it('stores nothing, sends nothing and runs no workflow', async () => {
    const count = async (table: string) =>
      Number(
        (
          await api.database.client.query<{ count: string }>(
            `select count(*)::text as count from ${table} where environment_id = $1`,
            [api.environmentId],
          )
        ).rows[0]?.count,
      );
    const tables = ['inquiries', 'inquiry_flow_steps', 'workflow_runs', 'audit_logs'];
    const before = await Promise.all(tables.map(count));
    const events = api.events.events.length;
    const jobs = api.queue.jobs.length;
    expect((await simulate(versionId, { scope: PASSING })).statusCode).toBe(200);
    expect(await Promise.all(tables.map(count))).toEqual(before);
    expect(api.events.events.length).toBe(events);
    expect(api.queue.jobs.length).toBe(jobs);
  });
});
