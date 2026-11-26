import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECEIVER_TLS, REPO_ROOT, SANDBOX_CHIP_FACES_DIR, selfieStill } from './paths.js';
import {
  E2E_API_RATE_LIMIT_PER_MINUTE,
  E2E_COMPOSE_PROJECT,
  E2E_DASHBOARD_DIST_DIR,
  dashboardOrigin,
  formatEnvFile,
  generateE2eEnv,
  parseEnvFile,
  type E2ePorts,
} from './env.js';
import { childEnvironment } from './processes.js';

const PORTS: E2ePorts = {
  postgres: 41001,
  redis: 41002,
  s3: 41003,
  s3Console: 41004,
  mailpitSmtp: 41005,
  mailpitUi: 41006,
  api: 41007,
  vision: 41008,
  flow: 41009,
  dashboard: 41010,
};

/** Deterministic, low-entropy bytes: never a real secret. */
const counting = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => i % 256);

describe('generateE2eEnv', () => {
  it('serves the dashboard through its custom server from its own build output (C21)', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(E2E_DASHBOARD_DIST_DIR).toBe('.next/e2e');
    expect(env).toMatchObject({
      OPENVERIFY_DASHBOARD_DIST_DIR: '.next/e2e',
      // The browser reaches the dashboard directly: its socket peer is the operator.
      OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: '0',
    });
    expect(env.OPENVERIFY_DASHBOARD_BFF_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  });

  it('opens the dashboard on localhost, the WebAuthn origin, never on an IP address', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(dashboardOrigin(PORTS)).toBe('http://localhost:41010');
    expect(env.OPENVERIFY_WEBAUTHN_ORIGIN).toBe(dashboardOrigin(PORTS));
    expect(env.OPENVERIFY_DASHBOARD_PUBLIC_URL).toBe(dashboardOrigin(PORTS));
  });

  it('lets a sandbox workflow reach a local receiver it trusts, and records Slack (C146.3)', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env).toMatchObject({
      OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: 'true',
      OPENVERIFY_PROVIDER_SLACK_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_SLACK_PRODUCTION: '',
      NODE_EXTRA_CA_CERTS: RECEIVER_TLS.certificate,
    });
  });

  it('binds the sandbox attachment scanner, read the same by the API and the worker (C146.3)', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env).toMatchObject({
      OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: '',
    });
  });

  it('uses its own compose project, so the developer stack and its volumes are never touched', () => {
    expect(E2E_COMPOSE_PROJECT).toBe('openverify-e2e');
  });

  it('binds every compose service to loopback on the chosen ports', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env).toMatchObject({
      OPENVERIFY_BIND_ADDRESS: '127.0.0.1',
      POSTGRES_PORT: '41001',
      REDIS_PORT: '41002',
      S3_PORT: '41003',
      S3_CONSOLE_PORT: '41004',
      MAILPIT_SMTP_PORT: '41005',
      MAILPIT_UI_PORT: '41006',
      POSTGRES_USER: 'openverify',
      POSTGRES_DB: 'openverify',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'openverify-files',
    });
  });

  it('points the API, worker, vision service, flow and dashboard at each other', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env.DATABASE_URL).toBe(
      `postgres://openverify:${env.POSTGRES_PASSWORD ?? ''}@127.0.0.1:41001/openverify`,
    );
    expect(env.REDIS_URL).toBe(`redis://:${env.REDIS_PASSWORD ?? ''}@127.0.0.1:41002`);
    expect(env).toMatchObject({
      OPENVERIFY_MODE: 'development',
      OPENVERIFY_API_HOST: '127.0.0.1',
      OPENVERIFY_API_PORT: '41007',
      S3_ENDPOINT: 'http://127.0.0.1:41003',
      S3_FORCE_PATH_STYLE: 'true',
      OPENVERIFY_VISION_URL: 'http://127.0.0.1:41008',
      OPENVERIFY_FLOW_PUBLIC_URL: 'http://127.0.0.1:41009',
      VITE_OPENVERIFY_API_URL: 'http://127.0.0.1:41007',
      OPENVERIFY_API_URL: 'http://127.0.0.1:41007',
      OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
    });
  });

  it('serves the flow through the flow server, which reaches the API with a token both share (C157)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // The API and the flow server read the same variable: at least 32 bytes (C174.7).
    expect(env.OPENVERIFY_FLOW_SERVER_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(env).toMatchObject({
      OPENVERIFY_FLOW_SERVER_API_URL: 'http://127.0.0.1:41007',
      OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: '0',
      // The preview's only frame is the console (C157.1).
      OPENVERIFY_DASHBOARD_PUBLIC_URL: 'http://localhost:41010',
    });
    expect(env).not.toHaveProperty('OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS');
  });

  it("sends invitation email to the run's Mailpit and links to its dashboard (C15)", () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env).toMatchObject({
      OPENVERIFY_SMTP_URL: 'smtp://127.0.0.1:41005',
      OPENVERIFY_MAIL_FROM: 'e2e-no-reply@example.test',
      OPENVERIFY_DASHBOARD_PUBLIC_URL: 'http://localhost:41010',
      OPENVERIFY_WEBAUTHN_RP_ID: 'localhost',
      OPENVERIFY_WEBAUTHN_ORIGIN: 'http://localhost:41010',
    });
  });

  it('sets the server API rate limit the specs expect in the RateLimit headers (C12)', () => {
    expect(generateE2eEnv(PORTS, counting).OPENVERIFY_RATE_LIMIT_API_PER_MINUTE).toBe(
      String(E2E_API_RATE_LIMIT_PER_MINUTE),
    );
    expect(E2E_API_RATE_LIMIT_PER_MINUTE).toBe(1200);
  });

  it('names one seeded operator per built-in role, plus the TOTP-enrolled admin', () => {
    const env = generateE2eEnv(PORTS);

    for (const role of ['admin', 'developer', 'reviewer', 'viewer', 'mfa-admin']) {
      const prefix = `OPENVERIFY_SEED_${role.replace('-', '_').toUpperCase()}`;
      expect(env[`${prefix}_EMAIL`], role).toMatch(
        new RegExp(`^${role}-[0-9a-f]+@example\\.test$`),
      );
      expect(env[`${prefix}_PASSWORD`]?.length, role).toBeGreaterThanOrEqual(12);
    }
  });

  it('generates every secret at random, long enough for the services that check', () => {
    const env = generateE2eEnv(PORTS);
    const again = generateE2eEnv(PORTS);
    const secrets = [
      'POSTGRES_PASSWORD',
      'REDIS_PASSWORD',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'OPENVERIFY_KEK',
      'OPENVERIFY_API_KEY_PEPPER',
      'OPENVERIFY_BLIND_INDEX_KEY',
      'OPENVERIFY_VISION_SERVICE_TOKEN',
      'OPENVERIFY_SEED_ADMIN_PASSWORD',
      'OPENVERIFY_SEED_DEVELOPER_PASSWORD',
      'OPENVERIFY_SEED_REVIEWER_PASSWORD',
      'OPENVERIFY_SEED_VIEWER_PASSWORD',
      'OPENVERIFY_SEED_MFA_ADMIN_PASSWORD',
      'OPENVERIFY_DASHBOARD_BFF_TOKEN',
      'OPENVERIFY_FLOW_SERVER_TOKEN',
    ];

    for (const name of secrets) {
      expect(env[name], name).toBeDefined();
      expect(env[name], name).not.toBe(again[name]);
      expect(env[name], name).not.toMatch(/^change-me/);
    }
    expect(Buffer.from(env.OPENVERIFY_KEK ?? '', 'base64')).toHaveLength(32);
    // C31.8: a separate secret, base64 of 32 bytes.
    expect(Buffer.from(env.OPENVERIFY_BLIND_INDEX_KEY ?? '', 'base64')).toHaveLength(32);
    expect(env.OPENVERIFY_BLIND_INDEX_KEY).not.toBe(env.OPENVERIFY_KEK);
    expect(env.OPENVERIFY_API_KEY_PEPPER?.length).toBeGreaterThanOrEqual(32);
    expect(env.OPENVERIFY_VISION_SERVICE_TOKEN?.length).toBeGreaterThanOrEqual(32);
    expect(env.OPENVERIFY_SEED_ADMIN_PASSWORD?.length).toBeGreaterThanOrEqual(12);
    expect(env.OPENVERIFY_DASHBOARD_BFF_TOKEN?.length).toBeGreaterThanOrEqual(32);
    expect(env.OPENVERIFY_SEED_ADMIN_EMAIL).toMatch(/^admin-[0-9a-f]+@example\.test$/);
  });

  it('only produces values that need no quoting in an env file or a URL', () => {
    const env = generateE2eEnv(PORTS);

    for (const [name, value] of Object.entries(env)) {
      expect(value, name).toMatch(/^[A-Za-z0-9@:/._+=-]*$/);
    }
  });

  it('leaves the C44 providers unbound, even when the shell binds one (C36, C44)', () => {
    const env = generateE2eEnv(PORTS, counting);
    const variables = [
      'PUBLIC_FIGURE',
      'AGE_ESTIMATE',
      'SELFIE_AGE_ESTIMATE',
      'SELFIE_PUBLIC_FIGURE',
      'SUSPICIOUS_ENTITY',
    ].flatMap((kind) =>
      ['SANDBOX', 'PRODUCTION'].map((environment) => `OPENVERIFY_PROVIDER_${kind}_${environment}`),
    );

    // The A-tier review specs rely on it: an unbound provider answers provider_not_configured.
    for (const name of variables) {
      expect(env[name], name).toBe('');
    }
    const inherited = Object.fromEntries(variables.map((name) => [name, 'sandbox']));
    const child = childEnvironment(env, inherited);
    for (const name of variables) {
      expect(child[name], name).toBe('');
    }
  });

  it('binds the 5B providers to their sandbox for sandbox environments, and none to production (C63, V23)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // businessRegistry (C61.1), domainAge (C61.4), maliciousWebsite (C61.5) and backlink: the
    // KYB specs read their sandbox magic; production binds none, and the two kinds that are on
    // by default (GLEIF, RDAP) are set to none explicitly.
    for (const kind of ['BUSINESS_REGISTRY', 'DOMAIN_AGE', 'MALICIOUS_WEBSITE', 'BACKLINK']) {
      expect(env[`OPENVERIFY_PROVIDER_${kind}_SANDBOX`], kind).toBe('sandbox');
    }
    expect(env.OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION).toBe('none');
    expect(env.OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION).toBe('none');
    expect(env.OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION).toBe('');
    expect(env.OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION).toBe('');
    // C62.7: the trust store is never synced or refreshed from an e2e run.
    expect(env.OPENVERIFY_TRUST_ANCHOR_REFRESH).toBe('false');
    expect(env.OPENVERIFY_NFC_ALLOW_ICAO_CRLS).toBe('false');
  });

  it('binds the 5A providers to their sandbox for sandbox environments only (C63, V23)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // sms (C55.10), database (C59.1), aamva (C35, C59.4) and evmRpc (C57.5): the phone, database
    // and crypto wallet specs read their sandbox answers; production binds none of them.
    for (const kind of ['SMS', 'DATABASE', 'AAMVA', 'EVM_RPC']) {
      expect(env[`OPENVERIFY_PROVIDER_${kind}_SANDBOX`], kind).toBe('sandbox');
      expect(env[`OPENVERIFY_PROVIDER_${kind}_PRODUCTION`], kind).toBe('');
    }
  });

  it('binds the Phase 6 report providers to their sandbox for sandbox environments only, with no credential, no list sync setting and the GDELT acknowledgement off, whatever the shell says (C83, C89.2, V01)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // adverseMedia (C81), emailIntelligence, phoneIntelligence and addressVerification (C82.4)
    // and cryptoExposure: report-risk.spec reads their sandbox magic; production binds none.
    for (const kind of [
      'ADVERSE_MEDIA',
      'EMAIL_INTELLIGENCE',
      'PHONE_INTELLIGENCE',
      'ADDRESS_VERIFICATION',
      'CRYPTO_EXPOSURE',
    ]) {
      expect(env[`OPENVERIFY_PROVIDER_${kind}_SANDBOX`], kind).toBe('sandbox');
      expect(env[`OPENVERIFY_PROVIDER_${kind}_PRODUCTION`], kind).toBe('');
    }
    // No vendor credential, no EU token and no Wikidata contact: lists reach the stack only
    // through seed:dev and watchlists:sync --import, which make no request (C76.2, V01).
    const unset = [
      'OPENVERIFY_HIBP_API_KEY',
      'OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID',
      'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID',
      'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET',
      'OPENVERIFY_SMARTY_AUTH_ID',
      'OPENVERIFY_SMARTY_AUTH_TOKEN',
      'OPENVERIFY_EU_FSF_TOKEN',
      'OPENVERIFY_WIKIDATA_USER_AGENT',
      'OPENVERIFY_WATCHLIST_SOURCES_DISABLED',
    ];
    for (const name of unset) {
      expect(env[name], name).toBe('');
    }
    expect(env.OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE).toBe('false');
    expect(env.OPENVERIFY_WATCHLIST_REFRESH).toBe('false');

    const child = childEnvironment(env, {
      OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc',
      OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'true',
      OPENVERIFY_HIBP_API_KEY: 'change-me-from-the-shell',
      OPENVERIFY_WIKIDATA_USER_AGENT: 'ShellContact/1.0 (ops@example.test)',
      OPENVERIFY_WATCHLIST_REFRESH: 'true',
    });
    expect(child).toMatchObject({
      OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: '',
      OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'false',
      OPENVERIFY_HIBP_API_KEY: '',
      OPENVERIFY_WIKIDATA_USER_AGENT: '',
      OPENVERIFY_WATCHLIST_REFRESH: 'false',
    });
  });

  it('names the generated fixture faces for the sandbox test chip, whatever the shell says (C208.1)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // Workflow 10C: the API reads person B's centre still from this directory for a face-mismatch
    // chip. The faces are generated on the host from the pinned fixtures and never enter an image.
    expect(env.OPENVERIFY_SANDBOX_CHIP_FACES).toBe(SANDBOX_CHIP_FACES_DIR);
    expect(path.relative(REPO_ROOT, SANDBOX_CHIP_FACES_DIR)).toBe(
      path.join('fixtures', 'generated', 'selfie'),
    );
    expect(path.dirname(selfieStill('b', 'center'))).toBe(SANDBOX_CHIP_FACES_DIR);
    expect(
      childEnvironment(env, { OPENVERIFY_SANDBOX_CHIP_FACES: '/tmp/from-the-shell' })
        .OPENVERIFY_SANDBOX_CHIP_FACES,
    ).toBe(SANDBOX_CHIP_FACES_DIR);
  });

  it('binds deviceIntegrity to its sandbox for sandbox environments only, with no Play Integrity setting, whatever the shell says (C211.1, C211.4)', () => {
    const env = generateE2eEnv(PORTS, counting);

    // Workflow 10B: the 10B spec's sandbox magic tokens reach the two Play Integrity signals; no
    // Google endpoint is ever called (rule 9), so play-integrity is never bound and no setting passes.
    expect(env.OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX).toBe('sandbox');
    expect(env.OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION).toBe('');
    for (const name of [
      'OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME',
      'OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS',
      'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
    ]) {
      expect(env[name], name).toBe('');
    }
    const child = childEnvironment(env, {
      OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: 'play-integrity',
      OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION: 'play-integrity',
      OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: 'change-me-from-the-shell',
    });
    expect(child).toMatchObject({
      OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION: '',
      OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '',
    });
  });

  it('binds no network provider and carries no provider credential, whatever the shell says (C63)', () => {
    const env = generateE2eEnv(PORTS, counting);
    const credentials = [
      'OPENVERIFY_TWILIO_ACCOUNT_SID',
      'OPENVERIFY_TWILIO_API_KEY_SID',
      'OPENVERIFY_TWILIO_API_KEY_SECRET',
      'OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID',
      'OPENVERIFY_TWILIO_FROM',
      'OPENVERIFY_EVM_RPC_URLS',
      'OPENVERIFY_COMPANIES_HOUSE_API_KEY',
      'OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY',
      'OPENVERIFY_SEC_EDGAR_USER_AGENT',
    ];

    const providers = Object.entries(env).filter(([name]) =>
      name.startsWith('OPENVERIFY_PROVIDER_'),
    );
    for (const [name, value] of providers) {
      expect(['', 'sandbox', 'none'], name).toContain(value);
    }
    for (const name of credentials) {
      expect(env[name], name).toBe('');
    }
    expect(env.OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS).toBe('false');
    const child = childEnvironment(env, {
      OPENVERIFY_PROVIDER_SMS_SANDBOX: 'twilio',
      OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX: 'json-rpc',
      OPENVERIFY_TWILIO_API_KEY_SECRET: 'change-me-from-the-shell',
      OPENVERIFY_EVM_RPC_URLS: 'eip155:1=https://rpc.example.test/key',
      OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'gleif',
      OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION: 'rdap',
      OPENVERIFY_COMPANIES_HOUSE_API_KEY: 'change-me-from-the-shell',
      OPENVERIFY_TRUST_ANCHOR_REFRESH: 'true',
    });
    expect(child).toMatchObject({
      OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX: 'sandbox',
      OPENVERIFY_TWILIO_API_KEY_SECRET: '',
      OPENVERIFY_EVM_RPC_URLS: '',
      OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'none',
      OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION: 'none',
      OPENVERIFY_COMPANIES_HOUSE_API_KEY: '',
      OPENVERIFY_TRUST_ANCHOR_REFRESH: 'false',
    });
  });
});

describe('generateE2eEnv for Workflow 7A (C93.1, C93.5, C93.6, F34)', () => {
  it('trusts the loopback proxy, so a spec presents a sandbox address with X-Forwarded-For', () => {
    expect(generateE2eEnv(PORTS, counting).OPENVERIFY_TRUST_PROXY).toBe('127.0.0.1');
  });

  it('binds the sandbox IP reputation for sandbox environments only, with no MMDB path', () => {
    const env = generateE2eEnv(PORTS, counting);

    expect(env.OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX).toBe('sandbox');
    expect(env.OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION).toBe('');
    expect(env.OPENVERIFY_IP_REPUTATION_MMDB_PATH).toBe('');
  });

  it('turns Connect on, whatever the shell says (C231.10)', () => {
    const child = childEnvironment(generateE2eEnv(PORTS, counting), {
      OPENVERIFY_CONNECT_ENABLED: 'false',
    });

    // Workflow 11A: the reusable stack serves Connect, so the 11A spec and stackTest reach it.
    expect(child.OPENVERIFY_CONNECT_ENABLED).toBe('true');
  });

  it('never refreshes network data and turns no source on or off, whatever the shell says', () => {
    const child = childEnvironment(generateE2eEnv(PORTS, counting), {
      OPENVERIFY_NETWORK_REFRESH: 'true',
      OPENVERIFY_NETWORK_SOURCES_ENABLED: 'dbip-city-lite',
      OPENVERIFY_NETWORK_SOURCES_DISABLED: 'openverify-sandbox-network',
    });

    expect(child).toMatchObject({
      OPENVERIFY_NETWORK_REFRESH: 'false',
      OPENVERIFY_NETWORK_SOURCES_ENABLED: '',
      OPENVERIFY_NETWORK_SOURCES_DISABLED: '',
    });
  });
});

describe('formatEnvFile and parseEnvFile', () => {
  it('round-trip, with a header saying the file is generated', () => {
    const env = generateE2eEnv(PORTS, counting);
    const text = formatEnvFile(env);

    expect(text.startsWith('# Generated by e2e/setup/global-setup.ts')).toBe(true);
    expect(parseEnvFile(text)).toEqual(env);
  });

  it('ignores comments and blank lines, and keeps = inside values', () => {
    expect(parseEnvFile('# comment\n\nA=1\nB=x=y\n')).toEqual({ A: '1', B: 'x=y' });
  });

  it('refuses a value that would break the file', () => {
    expect(() => formatEnvFile({ A: 'two\nlines' })).toThrow('A: value cannot be written');
    expect(() => formatEnvFile({ 'not a name': 'x' })).toThrow('not a name: invalid name');
  });
});
