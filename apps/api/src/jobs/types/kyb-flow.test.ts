/**
 * C52, C61: a business registry and a business website verification run through the flow API and
 * the job: created by the flow (their jobs are runnable now), their values entered (the guidance
 * names what is needed), submitted, judged by the sandbox providers, and read back with their
 * attributes. Every value is synthetic; the sandbox's documented names and endings decide.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passStepsBefore } from '../../flow-engine/testing.js';
import { createEventPublisher } from '../../events/index.js';
import { createBacklinkProvider } from '../../providers/backlink/index.js';
import { createSandboxBusinessRegistryProvider } from '../../providers/business-registry/index.js';
import { createDomainAgeProvider } from '../../providers/domain-age/index.js';
import { createMaliciousWebsiteProvider } from '../../providers/malicious-website/index.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../testing.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
});

afterAll(async () => {
  await api.close();
});

/**
 * A session of a started inquiry of the Phase 5 template, its consent given; the steps before
 * `at`'s passed first, so it is the current step (C151.4, Workflow 9A).
 */
async function session(at: SupportedVerificationType) {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  await passStepsBefore(api, inquiryId, at);
  await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) });
  const consented = await api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/consent',
    headers: bearer(token),
    payload: {
      accepted: true,
      'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      locale: 'en',
    },
  });
  expect(consented.statusCode).toBeLessThan(300);
  return { inquiryId, token };
}

/** The worker's dependencies over the API's database, with the sandbox KYB providers. */
function workerDeps(): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  return {
    db: api.database.db,
    storage: createMemoryStorage(),
    keyring: api.database.keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db: api.database.db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      logger,
    }),
    clock: { now: () => api.clock.now() },
    logger,
    providers: {
      sandbox: {
        businessRegistry: createSandboxBusinessRegistryProvider(),
        domainAge: createDomainAgeProvider('sandbox', { clock: api.clock }),
        maliciousWebsite: createMaliciousWebsiteProvider('sandbox'),
        backlink: createBacklinkProvider('sandbox'),
      },
      production: {},
    },
  };
}

/** Creates a verification of `type`, enters `values`, submits it and runs its job. */
async function runThrough(type: string, values: Record<string, unknown>) {
  const { token } = await session(type.replaceAll('-', '_') as SupportedVerificationType);
  const created = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/verifications',
      headers: bearer(token),
      payload: { type },
    }),
    201,
  ) as { data: { id: string; attributes: Record<string, unknown> } };
  const { id } = created.data;
  const entered = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${id}/inputs`,
      headers: bearer(token),
      payload: values,
    }),
    200,
  ) as { data: { attributes: Record<string, unknown> } };
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${id}/submit`,
      headers: bearer(token),
    }),
    202,
  );
  const result = await processVerification(
    { environmentId: api.environmentId, verificationId: id },
    workerDeps(),
  );
  const served = expectStatus(
    await api.app.inject({ url: `/api/v1/verifications/${id}`, headers: bearer(api.token) }),
    200,
  ) as { data: { attributes: Record<string, unknown> } };
  return {
    created: created.data.attributes,
    entered: entered.data.attributes,
    result,
    served: served.data.attributes,
  };
}

describe('KYB through the flow API and the job (C52, C61)', () => {
  it('runs a business registry verification to passed, with the register’s record', async () => {
    const run = await runThrough('database-business', {
      'business-name': 'Utopia Synthetic Widgets Ltd',
      'country-code': 'GB',
      'registration-number': '01234567',
      'address-street-1': '1 Placeholder Row',
    });

    expect(run.created).toMatchObject({
      status: 'initiated',
      guidance: { 'collect-associated-persons': false, 'required-inputs': ['business-name'] },
      'inputs-received': false,
    });
    expect(run.entered).toMatchObject({ 'inputs-received': true });
    expect(JSON.stringify(run.entered)).not.toContain('Utopia');
    expect(run.result).toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });
    expect(run.served).toMatchObject({
      status: 'passed',
      'business-name': 'Utopia Synthetic Widgets Ltd',
      'registry-source': 'sandbox',
      'registry-record-id': '01234567',
      'registry-status': 'active',
    });
  });

  it('fails a registration number ending 8888 as an inactive business', async () => {
    const run = await runThrough('database-business', {
      'business-name': 'Utopia Synthetic Widgets Ltd',
      'country-code': 'GB',
      'registration-number': '12348888',
    });

    expect(run.result).toMatchObject({ verificationStatus: 'failed' });
    expect(run.served).toMatchObject({ 'registry-status': 'dissolved' });
  });

  it('runs a business website verification of old.example to passed, with its registration date', async () => {
    const run = await runThrough('business-website', { 'website-url': 'https://old.example/' });

    expect(run.created).toMatchObject({ guidance: {}, 'inputs-received': false });
    expect(run.result).toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });
    expect(run.served).toMatchObject({
      status: 'passed',
      'website-url': 'https://old.example/',
      'website-domain': 'old.example',
      'domain-registered-at': expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
      ) as unknown,
    });
  });

  it('fails a website whose host does not resolve', async () => {
    const run = await runThrough('business-website', { 'website-url': 'https://utopia.invalid/' });

    expect(run.result).toMatchObject({ verificationStatus: 'failed' });
  });
});
