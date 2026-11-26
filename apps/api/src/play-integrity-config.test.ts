/**
 * Workflow 10B (`api-integrity`; C211.4, foundation-10b amendment 8): `play-integrity`'s settings.
 *
 * The worker, which decodes, reads `OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME`,
 * `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS` and the secret
 * `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` while either environment kind binds
 * `deviceIntegrity` to `play-integrity`, and stops at start without them; the API never reads them.
 * No issue echoes a value, and production refuses a change-me placeholder for the key.
 *
 * The key is generated for the run; every value is synthetic.
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { createProviderBindings } from './providers/index.js';
import { syntheticEnv } from './test-support/env.js';
import { workerProviderBindings } from './worker.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  client_email: 'synthetic-decoder@example.com',
  private_key: PEM,
});
/** A SHA-256 digest in Play Integrity's encoding (base64url, 43 characters), of synthetic bytes. */
const DIGEST = createHash('sha256').update('synthetic-certificate').digest('base64url');

const bound = (overrides: NodeJS.ProcessEnv = {}) =>
  syntheticEnv({
    OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: 'play-integrity',
    OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: 'com.example.synthetic.app',
    OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS: `${DIGEST}, ${'d'.repeat(43)}`,
    OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: KEY_FILE,
    ...overrides,
  });

const issuesOf = (env: NodeJS.ProcessEnv, process: 'api' | 'worker' = 'worker'): string[] => {
  try {
    loadConfig(env, { process });
    return [];
  } catch (error) {
    if (error instanceof ConfigError) {
      return [...error.issues];
    }
    throw error;
  }
};

describe('play-integrity settings (C211.4)', () => {
  it('are read by the worker while play-integrity is bound', () => {
    expect(loadConfig(bound(), { process: 'worker' }).playIntegrity).toEqual({
      packageName: 'com.example.synthetic.app',
      certificateDigests: [DIGEST, 'd'.repeat(43)],
      serviceAccount: { clientEmail: 'synthetic-decoder@example.com', privateKey: PEM },
    });
  });

  it('are never read by the API, nor while nothing binds play-integrity', () => {
    expect(loadConfig(bound(), { process: 'api' }).playIntegrity).toBeNull();
    expect(
      loadConfig(
        syntheticEnv({
          OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: 'sandbox',
          OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: 'not json at all',
        }),
        { process: 'worker' },
      ).playIntegrity,
    ).toBeNull();
  });

  it('stop the worker when one is missing while play-integrity is bound', () => {
    expect(issuesOf(bound({ OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: '' }))).toEqual([
      'OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: is required while deviceIntegrity is bound to play-integrity',
    ]);
    expect(
      issuesOf(
        bound({
          OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: '',
          OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION: 'play-integrity',
          OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '',
        }),
      ),
    ).toEqual([
      'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: is required while deviceIntegrity is bound to play-integrity',
    ]);
  });

  it('refuse a malformed value without echoing it', () => {
    const issues = issuesOf(
      bound({
        OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: 'not a package',
        OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS: 'synthetic-short-digest',
        OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON:
          '{"client_email":"synthetic-leak@example.com"}',
      }),
    );

    expect(issues).toEqual([
      'OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: must be an Android package name',
      'OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS: must be base64url SHA-256 digests',
      'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: must be a service account key file with client_email and private_key',
    ]);
    expect(JSON.stringify(issues)).not.toMatch(
      /synthetic-leak|synthetic-short-digest|not a package/,
    );
    expect(
      issuesOf(bound({ OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '{not json' })),
    ).toEqual([
      'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: must be a service account key file (JSON)',
    ]);
  });

  it('reach the worker’s play-integrity binding', async () => {
    const config = loadConfig(bound(), { process: 'worker' });
    const providers = workerProviderBindings(config, {});

    expect(providers.sandbox.deviceIntegrity).toMatchObject({ name: 'play-integrity' });
    // Without an outbound client the binding refuses rather than decode (the worker passes one).
    await expect(
      providers.sandbox.deviceIntegrity?.decode({
        token: 'synthetic-device-integrity-token',
        requestHash: 'A'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    expect(
      createProviderBindings(config.providers, { playIntegrity: null }).sandbox.deviceIntegrity,
    ).toMatchObject({ name: 'play-integrity' });
  });
});
