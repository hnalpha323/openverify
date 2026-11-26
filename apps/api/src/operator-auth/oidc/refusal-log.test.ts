/**
 * C248.7 and C250.7 (Workflow 11B, `sso-oidc`): an SSO refusal is told to the log by its own code
 * and counted by the registered metric `sso_sign_in_refused`, never with a value from the identity
 * provider and never with a label (an organisation is not a metric label; rule 11).
 */
import { describe, expect, it, vi } from 'vitest';
import { metrics } from '../../metrics-registry.js';
import { createSsoRefusalLog } from './refusal-log.js';

function recorder() {
  return {
    info: vi.fn<(object: Record<string, unknown>, message: string) => void>(),
    warn: vi.fn<(object: Record<string, unknown>, message: string) => void>(),
  };
}

describe('the SSO refusal log (C248.7, C250.7)', () => {
  it('registers sso_sign_in_refused as a counter without labels, owned by sso-oidc', () => {
    expect(metrics.get('sso_sign_in_refused')).toMatchObject({
      kind: 'counter',
      unit: 'count',
      labels: [],
      owner: 'sso-oidc',
      contract: 'C248.7',
    });
  });

  it('logs the refusal code and the provider id, then counts one refusal', () => {
    const logger = recorder();
    const log = createSsoRefusalLog(logger);

    log('email_unverified', { providerId: 'ssop_01JC0000000000000000000000' });
    log('binding_missing', {});

    expect(logger.warn.mock.calls).toEqual([
      [
        { sso: { failure: 'email_unverified', providerId: 'ssop_01JC0000000000000000000000' } },
        'sso sign-in refused',
      ],
      [{ sso: { failure: 'binding_missing' } }, 'sso sign-in refused'],
    ]);
    expect(logger.info.mock.calls).toEqual([
      [{ metric: 'sso_sign_in_refused', value: 1 }, 'metric'],
      [{ metric: 'sso_sign_in_refused', value: 1 }, 'metric'],
    ]);
  });
});
