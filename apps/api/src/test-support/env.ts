/**
 * A complete, synthetic API environment for tests that go through `loadConfig`. No value is a
 * real credential; services at these addresses are never contacted unless a test starts them.
 */
import { randomBytes } from 'node:crypto';

/** At least 32 characters, as the API requires; plainly not a real pepper. */
const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';

export function syntheticEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENVERIFY_MODE: 'test',
    OPENVERIFY_API_HOST: '127.0.0.1',
    OPENVERIFY_API_PORT: '0',
    OPENVERIFY_LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://openverify:synthetic@127.0.0.1:1/openverify',
    REDIS_URL: 'redis://:synthetic@127.0.0.1:1',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_BUCKET: 'openverify-test-files',
    S3_ACCESS_KEY_ID: 'synthetic-access-key',
    S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
    OPENVERIFY_KEK: randomBytes(32).toString('base64'),
    OPENVERIFY_API_KEY_PEPPER: PEPPER,
    OPENVERIFY_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    OPENVERIFY_FLOW_PUBLIC_URL: 'https://flow.example.test',
    OPENVERIFY_VISION_URL: 'http://127.0.0.1:1',
    OPENVERIFY_VISION_SERVICE_TOKEN: 'synthetic-vision-token-0123456789abcdef',
    // C63: the two kinds that are on by default (GLEIF, RDAP) are unbound, so no test reaches a
    // network provider; a test that needs one names it.
    OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX: 'none',
    OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'none',
    OPENVERIFY_PROVIDER_DOMAIN_AGE_SANDBOX: 'none',
    OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION: 'none',
    ...overrides,
  };
}
