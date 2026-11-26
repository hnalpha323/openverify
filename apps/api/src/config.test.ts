import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { syntheticEnv } from './test-support/env.js';

// Synthetic values only. The KEK is base64 of 32 bytes of 0x01; the secrets are not real.
const KEK = Buffer.alloc(32, 1).toString('base64');
const PREVIOUS_KEK = Buffer.alloc(32, 2).toString('base64');
const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';
const VISION_TOKEN = 'synthetic-vision-token-0123456789abcdef';
const S3_SECRET = 'synthetic-s3-secret-key';
/** Base64 of 32 bytes of 0x03: a synthetic blind index key, distinct from the KEK. */
const BLIND_INDEX_KEY = Buffer.alloc(32, 3).toString('base64');

const COMPLETE: NodeJS.ProcessEnv = {
  OPENVERIFY_MODE: 'development',
  OPENVERIFY_API_HOST: '0.0.0.0',
  OPENVERIFY_API_PORT: '4100',
  OPENVERIFY_LOG_LEVEL: 'debug',
  OPENVERIFY_TRUST_PROXY: 'true',
  DATABASE_URL: 'postgres://openverify:synthetic@127.0.0.1:5432/openverify',
  REDIS_URL: 'redis://:synthetic@127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'eu-west-1',
  S3_BUCKET: 'openverify-files',
  S3_ACCESS_KEY_ID: 'synthetic-access-key',
  S3_SECRET_ACCESS_KEY: S3_SECRET,
  S3_FORCE_PATH_STYLE: 'false',
  OPENVERIFY_KEK: KEK,
  OPENVERIFY_KEK_PREVIOUS: PREVIOUS_KEK,
  OPENVERIFY_API_KEY_PEPPER: PEPPER,
  OPENVERIFY_BLIND_INDEX_KEY: BLIND_INDEX_KEY,
  OPENVERIFY_FLOW_PUBLIC_URL: 'https://verify.example.test/flow',
  OPENVERIFY_FLOW_CORS_ORIGINS: 'https://verify.example.test, http://localhost:5173',
  OPENVERIFY_VISION_URL: 'http://vision.internal:8000',
  OPENVERIFY_VISION_SERVICE_TOKEN: VISION_TOKEN,
};

/** The smallest environment that loads: every required variable, nothing optional. */
const MINIMAL: NodeJS.ProcessEnv = {
  DATABASE_URL: COMPLETE.DATABASE_URL,
  REDIS_URL: COMPLETE.REDIS_URL,
  S3_BUCKET: COMPLETE.S3_BUCKET,
  S3_ACCESS_KEY_ID: COMPLETE.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: COMPLETE.S3_SECRET_ACCESS_KEY,
  OPENVERIFY_KEK: KEK,
  OPENVERIFY_API_KEY_PEPPER: PEPPER,
  OPENVERIFY_BLIND_INDEX_KEY: BLIND_INDEX_KEY,
  OPENVERIFY_FLOW_PUBLIC_URL: 'http://localhost:5173',
  OPENVERIFY_VISION_SERVICE_TOKEN: VISION_TOKEN,
  NODE_ENV: 'development',
};

function configError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('loadConfig', () => {
  it('parses a complete environment into typed settings', () => {
    const config = loadConfig(COMPLETE);

    expect(config).toMatchObject({
      mode: 'development',
      host: '0.0.0.0',
      port: 4100,
      logLevel: 'debug',
      trustProxy: true,
      databaseUrl: COMPLETE.DATABASE_URL,
      redisUrl: COMPLETE.REDIS_URL,
      s3: {
        endpoint: 'http://127.0.0.1:9000',
        region: 'eu-west-1',
        bucket: 'openverify-files',
        accessKeyId: 'synthetic-access-key',
        secretAccessKey: S3_SECRET,
        forcePathStyle: false,
      },
      flowPublicUrl: 'https://verify.example.test/flow',
      flowCorsOrigins: ['https://verify.example.test', 'http://localhost:5173'],
      vision: { url: 'http://vision.internal:8000', serviceToken: VISION_TOKEN },
    });
    expect(Buffer.from(config.apiKeyPepper).toString('utf8')).toBe(PEPPER);
    expect(config.keyring.keyIds).toHaveLength(2);
  });

  it('applies defaults to every optional setting', () => {
    const config = loadConfig(MINIMAL);

    expect(config).toMatchObject({
      mode: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      trustProxy: false,
      s3: { endpoint: undefined, region: 'us-east-1', forcePathStyle: true },
      flowCorsOrigins: ['http://localhost:5173'],
      vision: { url: 'http://127.0.0.1:8000' },
    });
    expect(config.keyring.keyIds).toHaveLength(1);
  });

  it('allows the flow origin by default, without the path of the flow URL', () => {
    const config = loadConfig({
      ...MINIMAL,
      OPENVERIFY_FLOW_PUBLIC_URL: 'https://verify.example.test:8443/hosted/',
    });

    expect(config.flowCorsOrigins).toEqual(['https://verify.example.test:8443']);
  });

  it.each([
    ['development', 'development'],
    ['test', 'test'],
    ['production', 'production'],
    [undefined, 'production'],
    ['staging', 'production'],
  ])('derives the mode from NODE_ENV=%s when OPENVERIFY_MODE is unset', (nodeEnv, mode) => {
    const env = { ...MINIMAL, NODE_ENV: nodeEnv, OPENVERIFY_VISION_URL: 'http://vision:8000' };

    expect(loadConfig(env).mode).toBe(mode);
  });

  it('lets OPENVERIFY_MODE override NODE_ENV', () => {
    expect(loadConfig({ ...MINIMAL, NODE_ENV: 'production', OPENVERIFY_MODE: 'test' }).mode).toBe(
      'test',
    );
  });

  it('reports every missing required variable at once', () => {
    const error = configError({});

    expect(error.message).toMatch(/^Invalid OpenVerify API configuration:/);
    for (const name of [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'OPENVERIFY_KEK',
      'OPENVERIFY_API_KEY_PEPPER',
      'OPENVERIFY_BLIND_INDEX_KEY',
      'OPENVERIFY_FLOW_PUBLIC_URL',
      'OPENVERIFY_VISION_SERVICE_TOKEN',
    ]) {
      expect(error.issues.some((issue) => issue.startsWith(`${name}:`))).toBe(true);
    }
  });

  it.each([
    ['DATABASE_URL', 'mysql://db.example.test/openverify'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_URL', 'http://cache.example.test:6379'],
    ['S3_ENDPOINT', 'ftp://s3.example.test'],
    ['S3_BUCKET', 'Not_A_Bucket'],
    ['S3_FORCE_PATH_STYLE', 'maybe'],
    ['OPENVERIFY_TRUST_PROXY', 'yes please'],
    ['OPENVERIFY_API_PORT', '70000'],
    ['OPENVERIFY_API_PORT', 'eighty'],
    ['OPENVERIFY_LOG_LEVEL', 'verbose'],
    ['OPENVERIFY_MODE', 'staging'],
    ['OPENVERIFY_FLOW_PUBLIC_URL', 'https://verify.example.test/?token=x'],
    ['OPENVERIFY_FLOW_PUBLIC_URL', 'https://verify.example.test/#fragment'],
    ['OPENVERIFY_FLOW_PUBLIC_URL', 'https://user:pass@verify.example.test'],
    ['OPENVERIFY_FLOW_PUBLIC_URL', 'javascript:alert(1)'],
    ['OPENVERIFY_FLOW_CORS_ORIGINS', 'https://verify.example.test/path'],
    ['OPENVERIFY_FLOW_CORS_ORIGINS', '*'],
    ['OPENVERIFY_VISION_URL', 'vision:8000'],
    ['OPENVERIFY_API_KEY_PEPPER', 'too-short'],
    ['OPENVERIFY_VISION_SERVICE_TOKEN', 'too-short'],
  ])('rejects %s=%s and names the variable without echoing its value', (name, value) => {
    const error = configError({ ...MINIMAL, [name]: value });

    expect(error.issues.some((issue) => issue.startsWith(`${name}:`))).toBe(true);
    expect(error.message).not.toContain(value);
  });

  it('reports an invalid KEK without revealing key material', () => {
    const error = configError({ ...MINIMAL, OPENVERIFY_KEK: 'c2hvcnQ=' });

    expect(error.issues).toEqual([expect.stringMatching(/^OPENVERIFY_KEK: /) as unknown]);
    expect(error.message).not.toContain('c2hvcnQ=');
  });

  it('reports an invalid previous KEK under its own name', () => {
    const error = configError({ ...MINIMAL, OPENVERIFY_KEK_PREVIOUS: 'not base64!' });

    expect(error.issues).toEqual([expect.stringMatching(/^OPENVERIFY_KEK_PREVIOUS/) as unknown]);
  });

  it('never echoes secret values in its messages', () => {
    const error = configError({
      ...MINIMAL,
      DATABASE_URL: 'mysql://user:hunter2-db-password@db.example.test/x',
      OPENVERIFY_API_KEY_PEPPER: 'short-secret',
    });

    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('short-secret');
  });

  describe('in production', () => {
    const production: NodeJS.ProcessEnv = {
      ...MINIMAL,
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_VISION_URL: 'http://vision:8000',
    };

    it('loads with real-looking secrets', () => {
      expect(loadConfig(production).mode).toBe('production');
    });

    it('requires OPENVERIFY_VISION_URL instead of defaulting to localhost', () => {
      const error = configError({ ...production, OPENVERIFY_VISION_URL: undefined });

      expect(error.issues.some((issue) => issue.startsWith('OPENVERIFY_VISION_URL:'))).toBe(true);
    });

    it.each([
      'OPENVERIFY_API_KEY_PEPPER',
      'OPENVERIFY_VISION_SERVICE_TOKEN',
      'S3_SECRET_ACCESS_KEY',
    ])('refuses a change-me placeholder in %s', (name) => {
      const error = configError({
        ...production,
        [name]: 'change-me-placeholder-value-0123456789abcdef',
      });

      expect(error.issues).toEqual([
        `${name}: still holds a change-me placeholder; set a real secret`,
      ]);
    });

    it('accepts change-me placeholders outside production', () => {
      const env = {
        ...MINIMAL,
        OPENVERIFY_API_KEY_PEPPER: 'change-me-api-key-pepper-at-least-32-chars',
      };

      expect(loadConfig(env).mode).toBe('development');
    });
  });
});

describe('C12 platform settings', () => {
  it('limits the server API to 300 requests per minute per principal by default', () => {
    expect(loadConfig(MINIMAL).rateLimits).toEqual({ apiPerMinute: 300 });
  });

  it('reads OPENVERIFY_RATE_LIMIT_API_PER_MINUTE', () => {
    const config = loadConfig({ ...MINIMAL, OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: '1200' });

    expect(config.rateLimits).toEqual({ apiPerMinute: 1200 });
  });

  it.each(['0', '-5', '1.5', 'lots', '1000001'])(
    'rejects OPENVERIFY_RATE_LIMIT_API_PER_MINUTE=%s',
    (value) => {
      const error = configError({ ...MINIMAL, OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: value });

      expect(error.issues).toEqual([
        'OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: must be a whole number from 1 to 1000000',
      ]);
    },
  );
});

describe('the blind index key (C31.8)', () => {
  it('reads OPENVERIFY_BLIND_INDEX_KEY as 32 bytes', () => {
    expect(loadConfig(MINIMAL).blindIndexKey).toEqual(new Uint8Array(32).fill(3));
  });

  it.each([
    ['16 bytes', Buffer.alloc(16, 3).toString('base64')],
    ['not base64', 'not-base64-at-all!'],
    ['the change-me placeholder', 'change-me-base64-of-32-random-bytes'],
  ])('refuses a key of %s and names the variable without echoing it', (_label, value) => {
    const error = configError({ ...MINIMAL, OPENVERIFY_BLIND_INDEX_KEY: value });

    expect(error.issues).toEqual([
      expect.stringMatching(/^OPENVERIFY_BLIND_INDEX_KEY: /) as unknown,
    ]);
    expect(error.message).not.toContain(value);
  });

  it('refuses the KEK as the blind index key: they are separate secrets', () => {
    const error = configError({ ...MINIMAL, OPENVERIFY_BLIND_INDEX_KEY: KEK });

    expect(error.issues).toEqual([
      'OPENVERIFY_BLIND_INDEX_KEY: must differ from OPENVERIFY_KEK; generate a separate key',
    ]);
    expect(error.message).not.toContain(KEK);
  });
});

/** No provider bound to any C35, C44 or C63 kind. */
const UNBOUND = {
  aamva: null,
  publicFigure: null,
  ageEstimate: null,
  selfieAgeEstimate: null,
  selfiePublicFigure: null,
  suspiciousEntity: null,
  sms: null,
  database: null,
  evmRpc: null,
  businessRegistry: null,
  domainAge: null,
  maliciousWebsite: null,
  backlink: null,
  // C83 (Phase 6): the report provider kinds, unbound unless named.
  adverseMedia: null,
  emailIntelligence: null,
  phoneIntelligence: null,
  addressVerification: null,
  cryptoExposure: null,
  // C93.5 (Phase 7): read by both processes.
  ipReputation: null,
  // C126.3, C135.5 (Phase 8): the worker's.
  slack: null,
  attachmentScanner: null,
  // C211.4 (Workflow 10B): read by both processes.
  deviceIntegrity: null,
};
/**
 * C63: the API reads sms, database, aamva, (C93.5) ipReputation and (C211.3) deviceIntegrity; the
 * worker every kind.
 */
const API_UNBOUND = {
  sms: null,
  database: null,
  aamva: null,
  ipReputation: null,
  deviceIntegrity: null,
};
/** C61.1 (F11): the worker binds GLEIF and RDAP unless told `none`, and nothing else. */
const WORKER_DEFAULTS = {
  ...UNBOUND,
  businessRegistry: ['gleif'],
  domainAge: 'rdap',
};

function workerConfigError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env, { process: 'worker' });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('C35, C44 and C63 provider bindings (ADR 0002 §3d, §3e)', () => {
  it('binds no provider by default but GLEIF and RDAP, so the A-tier checks are not configured', () => {
    expect(loadConfig(MINIMAL).providers).toEqual({
      sandbox: API_UNBOUND,
      production: API_UNBOUND,
    });
    expect(loadConfig(MINIMAL, { process: 'worker' }).providers).toEqual({
      sandbox: WORKER_DEFAULTS,
      production: WORKER_DEFAULTS,
    });
  });

  it('binds the sandbox provider to sandbox environments, per check', () => {
    const config = loadConfig(
      {
        ...MINIMAL,
        OPENVERIFY_PROVIDER_AAMVA_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX: ' sandbox ',
        OPENVERIFY_PROVIDER_AGE_ESTIMATE_SANDBOX: '',
      },
      { process: 'worker' },
    );

    expect(config.providers.sandbox).toEqual({
      ...WORKER_DEFAULTS,
      aamva: 'sandbox',
      publicFigure: 'sandbox',
    });
  });

  it('binds the C44 selfie sandbox providers to sandbox environments, per check', () => {
    const config = loadConfig(
      {
        ...MINIMAL,
        OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_SANDBOX: '',
        OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_SANDBOX: 'sandbox',
      },
      { process: 'worker' },
    );

    expect(config.providers).toEqual({
      sandbox: { ...WORKER_DEFAULTS, selfieAgeEstimate: 'sandbox', suspiciousEntity: 'sandbox' },
      production: WORKER_DEFAULTS,
    });
  });

  it.each([
    'OPENVERIFY_PROVIDER_AAMVA_PRODUCTION',
    'OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION',
    'OPENVERIFY_PROVIDER_AGE_ESTIMATE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_PRODUCTION',
    'OPENVERIFY_PROVIDER_DATABASE_PRODUCTION',
    'OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION',
  ])('stops the worker with the sandbox provider bound to production (%s)', (variable) => {
    const error = workerConfigError({ ...MINIMAL, [variable]: 'sandbox' });

    expect(error.issues).toEqual([
      `${variable}: a sandbox provider cannot be bound to production environments`,
    ]);
  });

  it.each([
    'OPENVERIFY_PROVIDER_AAMVA_PRODUCTION',
    'OPENVERIFY_PROVIDER_DATABASE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SMS_PRODUCTION',
  ])('stops the API with the sandbox provider bound to production (%s)', (variable) => {
    const error = configError({ ...MINIMAL, [variable]: 'sandbox' });

    expect(error.issues).toEqual([
      `${variable}: a sandbox provider cannot be bound to production environments`,
    ]);
  });

  it('leaves the kinds of the other process to it (C63, V10)', () => {
    expect(() =>
      loadConfig({ ...MINIMAL, OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION: 'sandbox' }),
    ).not.toThrow();
    expect(() =>
      loadConfig({ ...MINIMAL, OPENVERIFY_PROVIDER_SLACK_PRODUCTION: 'sandbox' }),
    ).not.toThrow();
  });

  it('stops the worker over a Twilio binding without its credentials (C126.6)', () => {
    expect(
      workerConfigError({ ...MINIMAL, OPENVERIFY_PROVIDER_SMS_PRODUCTION: 'twilio' }).message,
    ).toContain('OPENVERIFY_TWILIO_ACCOUNT_SID');
  });

  it('refuses a provider this version does not ship, without echoing the value', () => {
    const error = configError({
      ...MINIMAL,
      OPENVERIFY_PROVIDER_AAMVA_SANDBOX: 'secret-vendor-key-123',
    });

    expect(error.issues).toEqual([
      'OPENVERIFY_PROVIDER_AAMVA_SANDBOX: must be sandbox, the only provider this version ships, or unset',
    ]);
    expect(error.message).not.toContain('secret-vendor-key-123');
  });
});

// Synthetic Twilio credentials: well-formed, not real.
const TWILIO_ENV = {
  OPENVERIFY_PROVIDER_SMS_PRODUCTION: 'twilio',
  OPENVERIFY_TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  OPENVERIFY_TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
  // Synthetic and low-entropy on purpose: never a real secret.
  OPENVERIFY_TWILIO_API_KEY_SECRET: 's'.repeat(40),
  OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: `MG${'c'.repeat(32)}`,
};

describe('Twilio credentials (C55.10, C63, C126.6)', () => {
  it('reads them when sms is bound to twilio', () => {
    expect(loadConfig({ ...MINIMAL, ...TWILIO_ENV }).twilio).toEqual({
      accountSid: TWILIO_ENV.OPENVERIFY_TWILIO_ACCOUNT_SID,
      apiKeySid: TWILIO_ENV.OPENVERIFY_TWILIO_API_KEY_SID,
      apiKeySecret: TWILIO_ENV.OPENVERIFY_TWILIO_API_KEY_SECRET,
      messagingServiceSid: TWILIO_ENV.OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID,
      from: null,
    });
    const fromNumber = { ...TWILIO_ENV, OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: undefined };
    expect(
      loadConfig({ ...MINIMAL, ...fromNumber, OPENVERIFY_TWILIO_FROM: '+15555550100' }).twilio,
    ).toMatchObject({ messagingServiceSid: null, from: '+15555550100' });
  });

  it('reads none of them otherwise', () => {
    const unbound = { ...TWILIO_ENV, OPENVERIFY_PROVIDER_SMS_PRODUCTION: undefined };
    expect(loadConfig({ ...MINIMAL, ...unbound }).twilio).toBeNull();
    expect(loadConfig({ ...MINIMAL, ...unbound }, { process: 'worker' }).twilio).toBeNull();
  });

  it('reads them in the worker too, for workflow messages (C126.6, decision 76)', () => {
    expect(loadConfig({ ...MINIMAL, ...TWILIO_ENV }, { process: 'worker' }).twilio).toEqual(
      loadConfig({ ...MINIMAL, ...TWILIO_ENV }).twilio,
    );
  });

  it('stops the API naming each missing credential', () => {
    const error = configError({ ...MINIMAL, OPENVERIFY_PROVIDER_SMS_SANDBOX: 'twilio' });

    expect(error.issues).toEqual([
      'OPENVERIFY_TWILIO_ACCOUNT_SID: is required while sms is bound to twilio',
      'OPENVERIFY_TWILIO_API_KEY_SID: is required while sms is bound to twilio',
      'OPENVERIFY_TWILIO_API_KEY_SECRET: is required while sms is bound to twilio',
      'OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: set it or OPENVERIFY_TWILIO_FROM while sms is bound to twilio',
    ]);
  });

  it('refuses malformed credentials and both senders, without echoing any value', () => {
    const env = {
      ...MINIMAL,
      ...TWILIO_ENV,
      OPENVERIFY_TWILIO_ACCOUNT_SID: 'AC-secret-looking-value',
      OPENVERIFY_TWILIO_API_KEY_SID: 'SK-another-secret-value',
      OPENVERIFY_TWILIO_API_KEY_SECRET: 'short-secret-value',
      OPENVERIFY_TWILIO_FROM: '0044-secret-number',
    };
    const error = configError(env);

    expect(error.issues).toEqual([
      'OPENVERIFY_TWILIO_ACCOUNT_SID: must be a Twilio account SID (AC and 32 hex characters)',
      'OPENVERIFY_TWILIO_API_KEY_SID: must be a Twilio API key SID (SK and 32 hex characters)',
      'OPENVERIFY_TWILIO_API_KEY_SECRET: must be at least 32 characters',
      'OPENVERIFY_TWILIO_FROM: must be an E.164 number such as +15555550100',
      'OPENVERIFY_TWILIO_FROM: set either it or OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID, not both',
    ]);
    for (const value of ['secret-looking', 'another-secret', 'short-secret', 'secret-number']) {
      expect(error.message).not.toContain(value);
    }
  });

  it('refuses a change-me API key secret in production', () => {
    const error = configError({
      ...MINIMAL,
      ...TWILIO_ENV,
      NODE_ENV: 'production',
      OPENVERIFY_VISION_URL: 'http://vision:8000',
      OPENVERIFY_TWILIO_API_KEY_SECRET: 'change-me-twilio-api-key-secret-0123456789',
    });

    expect(error.issues).toEqual([
      'OPENVERIFY_TWILIO_API_KEY_SECRET: still holds a change-me placeholder; set a real secret',
    ]);
  });
});

describe('the attachment scanner (C135.5, C143.8), reserved for Workflow 8B', () => {
  const CLAMD = { OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: 'clamd' };

  it('reads the socket in the worker while a binding names clamd', () => {
    const socket = { ...CLAMD, OPENVERIFY_CLAMD_SOCKET: '/run/clamav/clamd.sock' };

    expect(loadConfig({ ...MINIMAL, ...socket }, { process: 'worker' }).clamdSocket).toBe(
      '/run/clamav/clamd.sock',
    );
  });

  it('stops the worker without it, naming the variable', () => {
    expect(workerConfigError({ ...MINIMAL, ...CLAMD }).message).toContain(
      'OPENVERIFY_CLAMD_SOCKET',
    );
  });

  it('reads none of it otherwise', () => {
    const socket = { OPENVERIFY_CLAMD_SOCKET: '/run/clamav/clamd.sock' };

    expect(loadConfig({ ...MINIMAL, ...socket }, { process: 'worker' }).clamdSocket).toBeNull();
    expect(loadConfig({ ...MINIMAL, ...socket, ...CLAMD }).clamdSocket).toBeNull();
  });
});

describe('EVM RPC settings (C57.5, C63, decision 22), in the worker only', () => {
  const RPC = {
    OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION: 'json-rpc',
    OPENVERIFY_EVM_RPC_URLS:
      'eip155:1=https://rpc.example.test/v3/synthetic-key, eip155:137=https://polygon.example.test/',
  };

  it('reads the node URL per chain when evmRpc is bound to json-rpc', () => {
    const config = loadConfig({ ...MINIMAL, ...RPC }, { process: 'worker' });

    expect(config.evmRpc).toEqual({
      urls: new Map([
        ['eip155:1', 'https://rpc.example.test/v3/synthetic-key'],
        ['eip155:137', 'https://polygon.example.test/'],
      ]),
      allowPrivateNetworks: false,
    });
    expect(loadConfig({ ...MINIMAL, ...RPC }).evmRpc).toBeNull();
  });

  it('lets the URLs be plain http on a private network only with its own flag, in any mode', () => {
    const env = {
      ...MINIMAL,
      ...RPC,
      NODE_ENV: 'production',
      OPENVERIFY_VISION_URL: 'http://vision:8000',
      OPENVERIFY_EVM_RPC_URLS: 'eip155:31337=http://10.0.0.5:8545',
      OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: 'true',
    };

    expect(loadConfig(env, { process: 'worker' }).evmRpc).toEqual({
      urls: new Map([['eip155:31337', 'http://10.0.0.5:8545']]),
      allowPrivateNetworks: true,
    });
    expect(
      workerConfigError({ ...env, OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: 'false' }).issues,
    ).toEqual([
      'OPENVERIFY_EVM_RPC_URLS: entry 1 must be eip155:<chain>=https://… (http only with OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS)',
    ]);
  });

  it('stops the worker without URLs, and with malformed or repeated entries, echoing none', () => {
    expect(
      workerConfigError({ ...MINIMAL, OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX: 'json-rpc' }).issues,
    ).toEqual(['OPENVERIFY_EVM_RPC_URLS: is required while evmRpc is bound to json-rpc']);
    const error = workerConfigError({
      ...MINIMAL,
      ...RPC,
      OPENVERIFY_EVM_RPC_URLS:
        'eip155:1=https://a.example.test/secret-a,bip122:x=https://b.example.test/secret-b,' +
        'eip155:1=https://c.example.test/secret-c,eip155:5=https://user:pw@d.example.test/secret-d',
    });
    expect(error.issues).toEqual([
      'OPENVERIFY_EVM_RPC_URLS: entry 2 must be eip155:<chain>=https://… (http only with OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS)',
      'OPENVERIFY_EVM_RPC_URLS: entry 3 repeats a chain',
      'OPENVERIFY_EVM_RPC_URLS: entry 4 must be eip155:<chain>=https://… (http only with OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS)',
    ]);
    expect(error.message).not.toContain('secret-');
    expect(
      workerConfigError({ ...MINIMAL, ...RPC, OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: 'maybe' })
        .issues,
    ).toEqual(['OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: must be true or false']);
  });
});

describe('the OTP SMS ceiling (C55.7, decision 14)', () => {
  it('defaults to 1,000 and reads a whole number from 1 to 1,000,000', () => {
    expect(loadConfig(MINIMAL).otpSmsMaxPerHourCeiling).toBe(1000);
    expect(
      loadConfig({ ...MINIMAL, OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING: '250' })
        .otpSmsMaxPerHourCeiling,
    ).toBe(250);
  });

  it.each(['0', '1000001', '12.5', 'many'])('refuses %s', (value) => {
    expect(
      configError({ ...MINIMAL, OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING: value }).issues,
    ).toEqual([
      'OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING: must be a whole number from 1 to 1000000',
    ]);
  });
});

describe('Companies House and SEC EDGAR (C61.1, C63), in the worker only', () => {
  const LIVE_KEY = 'synthetic0live0companies0house0key';
  const SANDBOX_KEY = 'synthetic0sandbox0companies0house0key';
  const CONTACT = 'Utopia Widgets compliance@example.test';

  it('reads the keys and the contact while a binding names their register', () => {
    const config = loadConfig(
      {
        ...MINIMAL,
        OPENVERIFY_COMPANIES_HOUSE_API_KEY: LIVE_KEY,
        OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY: SANDBOX_KEY,
        OPENVERIFY_SEC_EDGAR_USER_AGENT: CONTACT,
      },
      { process: 'worker' },
    );

    expect(config.providers.production.businessRegistry).toEqual([
      'gleif',
      'companies-house',
      'sec-edgar',
    ]);
    expect(config.companiesHouse).toEqual({ apiKey: LIVE_KEY, sandboxApiKey: SANDBOX_KEY });
    expect(config.secEdgar).toEqual({ userAgent: CONTACT });
  });

  it('reads none of them without a binding naming them, nor in the API', () => {
    const env = { ...MINIMAL, OPENVERIFY_COMPANIES_HOUSE_API_KEY: LIVE_KEY };
    const unbound = loadConfig(
      {
        ...env,
        OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX: 'none',
        OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'gleif',
      },
      { process: 'worker' },
    );
    expect(unbound.companiesHouse).toBeNull();
    expect(unbound.secEdgar).toBeNull();
    expect(loadConfig(env).companiesHouse).toBeNull();
    expect(loadConfig(env).providers.production).not.toHaveProperty('businessRegistry');
  });

  it('stops the worker naming the missing credential of a register named explicitly', () => {
    const error = workerConfigError({
      ...MINIMAL,
      OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'gleif,companies-house,sec-edgar',
      OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX: 'companies-house',
    });

    expect(error.issues).toEqual([
      'OPENVERIFY_COMPANIES_HOUSE_API_KEY: is required while businessRegistry names companies-house for production environments',
      'OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY: is required while businessRegistry names companies-house for sandbox environments',
      'OPENVERIFY_SEC_EDGAR_USER_AGENT: is required while businessRegistry names sec-edgar',
    ]);
  });

  it('refuses a malformed key or contact without echoing it, and a placeholder key in production', () => {
    const error = workerConfigError({
      ...MINIMAL,
      OPENVERIFY_COMPANIES_HOUSE_API_KEY: 'short secret!',
      OPENVERIFY_SEC_EDGAR_USER_AGENT: 'no-contact-secret',
    });
    expect(error.issues).toEqual([
      'OPENVERIFY_COMPANIES_HOUSE_API_KEY: must be a Companies House API key (20 to 64 letters, digits and hyphens)',
      'OPENVERIFY_SEC_EDGAR_USER_AGENT: must name the organization and a contact email address, such as "Example Ltd admin@example.com"',
    ]);
    expect(error.message).not.toContain('secret');
    const production = workerConfigError({
      ...MINIMAL,
      NODE_ENV: 'production',
      OPENVERIFY_VISION_URL: 'http://vision:8000',
      OPENVERIFY_COMPANIES_HOUSE_API_KEY: 'change-me-companies-house-api-key',
    });
    expect(production.issues).toEqual([
      'OPENVERIFY_COMPANIES_HOUSE_API_KEY: still holds a change-me placeholder; set a real secret',
    ]);
  });
});

describe('the trust-store settings (C62.7)', () => {
  it('keep ICAO CRLs and the refresh off by default, in both processes', () => {
    expect(loadConfig(MINIMAL).nfc).toEqual({ allowIcaoCrls: false, trustAnchorRefresh: false });
    expect(loadConfig(MINIMAL, { process: 'worker' }).nfc).toEqual({
      allowIcaoCrls: false,
      trustAnchorRefresh: false,
    });
  });

  it('turn on with their variables, and refuse anything but a boolean', () => {
    expect(
      loadConfig(
        {
          ...MINIMAL,
          OPENVERIFY_NFC_ALLOW_ICAO_CRLS: 'true',
          OPENVERIFY_TRUST_ANCHOR_REFRESH: '1',
        },
        { process: 'worker' },
      ).nfc,
    ).toEqual({ allowIcaoCrls: true, trustAnchorRefresh: true });
    expect(
      workerConfigError({ ...MINIMAL, OPENVERIFY_TRUST_ANCHOR_REFRESH: 'daily' }).issues,
    ).toEqual(['OPENVERIFY_TRUST_ANCHOR_REFRESH: must be true or false']);
    expect(configError({ ...MINIMAL, OPENVERIFY_NFC_ALLOW_ICAO_CRLS: 'yes' }).issues).toEqual([
      'OPENVERIFY_NFC_ALLOW_ICAO_CRLS: must be true or false',
    ]);
  });
});

describe('the synthetic test environment (C63)', () => {
  it.each(['api', 'worker'] as const)('binds no network provider in the %s process', (process) => {
    const { providers } = loadConfig(syntheticEnv(), { process });

    for (const environment of ['sandbox', 'production'] as const) {
      for (const [kind, binding] of Object.entries(providers[environment])) {
        expect([null, 'sandbox'], `${environment} ${kind}`).toContainEqual(binding);
      }
    }
  });

  it('sets none for businessRegistry and domainAge, which are on by default', () => {
    const env = syntheticEnv();

    for (const kind of ['BUSINESS_REGISTRY', 'DOMAIN_AGE']) {
      for (const environment of ['SANDBOX', 'PRODUCTION']) {
        expect(env[`OPENVERIFY_PROVIDER_${kind}_${environment}`], kind).toBe('none');
      }
    }
  });
});

describe('OPENVERIFY_WATCHLIST_SOURCES_DISABLED (C76.4)', () => {
  it('is read the same way by every process: comma-separated source ids, trimmed, once each', () => {
    for (const process of ['api', 'worker'] as const) {
      const config = loadConfig(
        syntheticEnv({ OPENVERIFY_WATCHLIST_SOURCES_DISABLED: ' un-sc,ofac-sdn, un-sc ,' }),
        { process },
      );
      expect(config.watchlists.sourcesDisabled).toEqual(['un-sc', 'ofac-sdn']);
    }
    expect(loadConfig(syntheticEnv()).watchlists.sourcesDisabled).toEqual([]);
  });

  it('refuses a value that is not a source id, naming the variable only', () => {
    expect(() =>
      loadConfig(syntheticEnv({ OPENVERIFY_WATCHLIST_SOURCES_DISABLED: 'ofac-sdn,Bad Id!' })),
    ).toThrow(/OPENVERIFY_WATCHLIST_SOURCES_DISABLED: /);
  });
});
