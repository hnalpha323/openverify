/**
 * Workflow 10B (`api-integrity`; C211.5): a review rule on either Play Integrity signal
 * (`inquiry/device_integrity_level`, `inquiry/app_recognized`) where the environment's kind binds no
 * `deviceIntegrity` provider is `provider_not_bound` (Phase 7's code): unbound, every inquiry would
 * read the signal as `provider_not_configured`, a gap that sends it to review. The heuristics read the
 * device's own body and need no provider.
 */
import { defaultInquiryTemplateAttributes, type SignalConfig } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeviceIntegrityProvider } from '../device-integrity/index.js';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import { signalConfigPublishProblems } from './signal-config.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/data/attributes/signal-config';

async function codes(signalConfig: SignalConfig, bound: boolean, kind: 'sandbox' | 'production') {
  const tenant = await api.newTenant({ kind });
  const providers = bound
    ? {
        sandbox: { deviceIntegrity: createDeviceIntegrityProvider('sandbox') },
        production: { deviceIntegrity: createDeviceIntegrityProvider('play-integrity') },
      }
    : api.deps.providers;
  const found = await signalConfigPublishProblems({
    deps: { ...api.deps, providers },
    db: api.database.db,
    environment: { id: tenant.environmentId, kind: tenant.environmentKind },
    flow: defaultInquiryTemplateAttributes().flow,
    signalConfig,
  });
  return found.map(({ code, pointer }) => [code, pointer]);
}

describe('a review rule on a Play Integrity signal (C211.5)', () => {
  const rules: SignalConfig = {
    'review-rules': [
      { signal: 'inquiry/device_integrity_level', in: ['basic', 'none'] },
      { signal: 'inquiry/app_recognized', eq: false },
      { signal: 'inquiry/device_rooted', eq: true },
    ],
  };

  it('is provider_not_bound where the kind binds no deviceIntegrity provider', async () => {
    for (const kind of ['sandbox', 'production'] as const) {
      expect(await codes(rules, false, kind), kind).toEqual([
        ['provider_not_bound', `${BASE}/review-rules/0/signal`],
        ['provider_not_bound', `${BASE}/review-rules/1/signal`],
      ]);
    }
  });

  it('passes where one is bound', async () => {
    expect(await codes(rules, true, 'sandbox')).toEqual([]);
    expect(await codes(rules, true, 'production')).toEqual([]);
  });
});
