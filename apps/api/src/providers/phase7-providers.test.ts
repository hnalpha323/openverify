/**
 * C93.5 (Workflow 7A Stage 1b, checkpoint (N); F26, H25): `ipReputation` is a provider kind of its
 * own, bound by `OPENVERIFY_PROVIDER_IP_REPUTATION_{SANDBOX,PRODUCTION}` under C63's rules, and,
 * unlike Phase 6's kinds, read by both the API (session evaluation) and the worker (the report).
 * Its names are `mmdb-file` (an operator-licensed file) and `sandbox`. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  PHASE7_PROVIDER_KINDS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES_BY_KIND,
  createProviderBindings,
  readProviderSettings,
} from './index.js';
import { createIpReputationProvider } from './ip-reputation/index.js';

const MMDB_PATH = '/var/lib/openverify/ip-reputation/synthetic.mmdb';

/** `record[kind]`, for the kind lists before `ipReputation` joined their key types. */
function ofKind(record: object, kind = 'ipReputation'): unknown {
  return (record as Record<string, unknown>)[kind];
}

describe('the ipReputation kind (C93.5)', () => {
  it('is a kind of its own, with its variable and names, read by both processes', () => {
    expect(PHASE7_PROVIDER_KINDS).toEqual(['ipReputation']);
    // Workflow 10B: deviceIntegrity follows Phase 8's kinds.
    expect(PROVIDER_KINDS.at(-4)).toBe('ipReputation');
    expect(ofKind(PROVIDER_ENV_PREFIXES)).toBe('OPENVERIFY_PROVIDER_IP_REPUTATION');
    expect(ofKind(PROVIDER_NAMES_BY_KIND)).toEqual(['mmdb-file', 'sandbox']);
    expect(PROCESS_PROVIDER_KINDS.api).toContain('ipReputation');
    expect(PROCESS_PROVIDER_KINDS.worker).toContain('ipReputation');
  });

  it('is read the same way by the API and the worker', () => {
    const env = {
      OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'Sandbox',
      OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: ' mmdb-file ',
    };

    for (const process of ['api', 'worker'] as const) {
      const read = readProviderSettings(env, process);
      expect(read.issues).toEqual([]);
      expect(ofKind(read.settings.sandbox)).toBe('sandbox');
      expect(ofKind(read.settings.production)).toBe('mmdb-file');
    }
  });

  it('is unbound when unset, and refuses the sandbox in production and an unknown name', () => {
    expect(ofKind(readProviderSettings({}, 'api').settings.production)).toBeNull();
    expect(
      readProviderSettings(
        {
          OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: 'sandbox',
          OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'vendor-api',
        },
        'api',
      ).issues,
    ).toEqual([
      'OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: must be mmdb-file or sandbox, or unset',
      'OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: a sandbox provider cannot be bound to production environments',
    ]);
  });

  it('binds the sandbox and the file adapter through the factory, with the file path', () => {
    const settings = readProviderSettings(
      {
        OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: 'mmdb-file',
      },
      'api',
    ).settings;

    const bindings = createProviderBindings(settings, { ipReputation: { mmdbPath: MMDB_PATH } });

    expect(bindings.sandbox.ipReputation).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.production.ipReputation).toMatchObject({ id: 'mmdb-file', sandbox: false });
  });

  it('leaves the kind out of an environment kind that does not bind it', () => {
    const bindings = createProviderBindings(
      readProviderSettings({ OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'sandbox' }, 'worker')
        .settings,
    );

    expect(bindings.production.ipReputation).toBeUndefined();
  });

  it('refuses the file adapter without its file', () => {
    expect(() =>
      createProviderBindings(
        readProviderSettings({ OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: 'mmdb-file' }, 'api')
          .settings,
      ),
    ).toThrow(/OPENVERIFY_IP_REPUTATION_MMDB_PATH/);
    expect(() => createIpReputationProvider('mmdb-file', { mmdbPath: null })).toThrow(
      /mmdb-file needs its file/,
    );
  });
});
