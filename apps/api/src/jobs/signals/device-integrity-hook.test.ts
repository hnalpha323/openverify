/**
 * Workflow 10B Stage 3 (`integration-10b`; api-integrity's missing hook, C211.5): the `inquiry-signals`
 * job and the flow's provisional snapshots read the Play Integrity facts of the environment kind's bound
 * `deviceIntegrity` provider (`deviceIntegritySignalsInput`), so a stored sandbox verdict reaches the
 * two Play Integrity signals of a running inquiry. Without a bound provider in the deps, the two read
 * `collector_missing` as before. Every verdict is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  type SignalDetails,
  type SignalValue,
} from '@openverify/contracts';
import { getInquiry, storeInquiryIntegrityVerdict } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderBindings } from '../../ports.js';
import {
  createDeviceIntegrityProvider,
  sandboxVerdict,
} from '../../services/device-integrity/index.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
} from '../../test-support/harness.js';
import { createCapturingLogger } from '../testing.js';
import { inquirySignalsInputInTx } from './input.js';
import { processInquirySignals, type InquirySignalsDeps } from './process.js';

let api: InquiryTestApi;
let deps: InquirySignalsDeps;

beforeAll(async () => {
  api = await createInquiryTestApi();
  deps = {
    db: api.database.db,
    clock: api.clock,
    logger: createCapturingLogger(),
    events: api.events,
    keyring: api.database.keyring,
  };
});

afterAll(async () => {
  await api.close();
});

const sandbox = () => createDeviceIntegrityProvider('sandbox', { clock: api.clock });
const bound = (): ProviderBindings => ({ sandbox: { deviceIntegrity: sandbox() }, production: {} });

const NOTICE = 'notice.session-integrity';

/** A completed inquiry whose one session consented under the session-integrity tier, with a stored verdict. */
async function expiredWithVerdict(token: string) {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent' ? { ...step, textKeys: ['consent.processing', NOTICE] } : step,
  );
  const templateId = await createTemplate(api, api.token, attributes);
  const inquiryId = await createInquiry(api, { templateId });
  const headers = bearer(await resumeInquiry(api, inquiryId));
  expectStatus(await api.app.inject({ method: 'GET', url: '/api/v1/flow/session', headers }), 200);
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers,
      payload: { accepted: true, 'text-keys': ['consent.processing', NOTICE], locale: 'en' },
    }),
    201,
  );
  await storeInquiryIntegrityVerdict(api.database.db, api.environmentId, {
    inquiryId,
    provider: 'sandbox',
    verdict: { ...sandboxVerdict(token, api.clock.now()) },
    decodedAt: api.clock.now(),
  });
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
      headers: bearer(api.token),
      payload: { meta: { actions: [{ type: 'complete_inquiry' }] } },
    }),
    200,
  );
  return inquiryId;
}

async function frozen(inquiryId: string) {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  const signals = inquiry?.signals as SignalValue[] | null;
  const details = inquiry?.signalDetails as SignalDetails | null;
  const value = (name: string) => signals?.find((signal) => signal.name === name)?.value;
  return { value, details };
}

describe('the signal jobs read the bound deviceIntegrity provider (C211.5)', () => {
  it('carries a stored sandbox verdict to the two Play Integrity signals of the inquiry', async () => {
    const inquiryId = await expiredWithVerdict('sandbox-strong');

    await processInquirySignals(
      { environmentId: api.environmentId, inquiryId },
      { ...deps, providers: bound() },
    );

    const { value, details } = await frozen(inquiryId);
    expect(value('inquiry/device_integrity_level')).toBe('strong');
    expect(value('inquiry/app_recognized')).toBe(true);
    expect(details?.['inquiry/app_recognized']).toMatchObject({
      sources: [{ kind: 'provider', provider: 'sandbox', sandbox: true }],
    });
  });

  it('reads collector_missing for both without a bound provider in the deps, as before', async () => {
    const inquiryId = await expiredWithVerdict('sandbox-strong');

    await processInquirySignals({ environmentId: api.environmentId, inquiryId }, deps);

    const { value, details } = await frozen(inquiryId);
    expect(value('inquiry/device_integrity_level')).toBeNull();
    expect(details?.['inquiry/device_integrity_level']).toMatchObject({
      'null-reason': 'collector_missing',
    });
  });

  it('assembles the facts in the shared input when the context names the provider, the snapshots included', async () => {
    const inquiryId = await expiredWithVerdict('sandbox-device');
    const row = await getInquiry(api.database.db, api.environmentId, inquiryId);
    if (row === null) {
      throw new Error('the inquiry was not created');
    }
    const read = (context: Parameters<typeof inquirySignalsInputInTx>[3]) =>
      inquirySignalsInputInTx(api.database.db, row, 'default', context);

    const withProvider = await read({
      environment: 'sandbox',
      computedAt: api.clock.now(),
      deviceIntegrity: sandbox(),
    });
    const without = await read({ environment: 'sandbox', computedAt: api.clock.now() });

    expect(withProvider.deviceIntegrity).toMatchObject({
      provider: { name: 'sandbox', sandbox: true },
      verdict: { provider: 'sandbox' },
    });
    expect(without.deviceIntegrity).toBeUndefined();
  });
});
