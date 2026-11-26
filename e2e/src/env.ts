/**
 * The environment of one e2e run: random secrets and free ports for the compose services
 * (read by `infra/docker-compose.yml`) and for the API, worker, vision service, flow and
 * dashboard processes. Written to the gitignored `e2e/.env.e2e` on every run.
 */
import { randomBytes } from 'node:crypto';
import { RECEIVER_TLS, SANDBOX_CHIP_FACES_DIR } from './paths.js';

/** The compose project of the e2e stack. Teardown removes only this project's containers and volumes. */
export const E2E_COMPOSE_PROJECT = 'openverify-e2e';

/**
 * The server API's `api` limit for the run (C12): above what the specs send in a minute with
 * one key, and asserted in the `RateLimit-Limit` header.
 */
export const E2E_API_RATE_LIMIT_PER_MINUTE = 1200;

/**
 * The dashboard's build output for the run (`OPENVERIFY_DASHBOARD_DIST_DIR`, see
 * `apps/dashboard/next.config.ts`): a developer's or agent's `next typegen` or `next dev`, which
 * write `.next/types` and `.next/dev`, never collides with it.
 */
export const E2E_DASHBOARD_DIST_DIR = '.next/e2e';

/**
 * The dashboard as the browser opens it: on `localhost`, because WebAuthn needs a domain as its
 * relying party (never an IP address) and the page origin must match the API's WebAuthn origin.
 */
export function dashboardOrigin(ports: Pick<E2ePorts, 'dashboard'>): string {
  return `http://localhost:${String(ports.dashboard)}`;
}

/** The seeded operators: one per built-in role (C15), plus the TOTP-enrolled admin. */
const SEEDED_OPERATORS = ['admin', 'developer', 'reviewer', 'viewer', 'mfa-admin'] as const;

export interface E2ePorts {
  postgres: number;
  redis: number;
  s3: number;
  s3Console: number;
  mailpitSmtp: number;
  mailpitUi: number;
  api: number;
  vision: number;
  flow: number;
  dashboard: number;
}

export type RandomBytes = (length: number) => Uint8Array;

const HOST = '127.0.0.1';

/**
 * Builds the run's variables. Secrets are hex or base64, so no value needs quoting in an env
 * file or escaping in a URL.
 */
export function generateE2eEnv(
  ports: E2ePorts,
  random: RandomBytes = randomBytes,
): Record<string, string> {
  const hex = (bytes: number) => Buffer.from(random(bytes)).toString('hex');
  const url = (port: number) => `http://${HOST}:${String(port)}`;

  const postgresPassword = hex(24);
  const redisPassword = hex(24);
  const dashboardUrl = dashboardOrigin(ports);
  const operators = Object.fromEntries(
    SEEDED_OPERATORS.flatMap((role) => {
      const prefix = `OPENVERIFY_SEED_${role.replace('-', '_').toUpperCase()}`;
      return [
        [`${prefix}_EMAIL`, `${role}-${hex(4)}@example.test`],
        [`${prefix}_PASSWORD`, hex(16)],
      ];
    }),
  );
  return {
    // Compose services (infra/docker-compose.yml), loopback only.
    OPENVERIFY_BIND_ADDRESS: HOST,
    POSTGRES_PORT: String(ports.postgres),
    POSTGRES_USER: 'openverify',
    POSTGRES_DB: 'openverify',
    POSTGRES_PASSWORD: postgresPassword,
    REDIS_PORT: String(ports.redis),
    REDIS_PASSWORD: redisPassword,
    S3_PORT: String(ports.s3),
    S3_CONSOLE_PORT: String(ports.s3Console),
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'openverify-files',
    S3_ACCESS_KEY_ID: `e2e${hex(8)}`,
    S3_SECRET_ACCESS_KEY: hex(24),
    MAILPIT_SMTP_PORT: String(ports.mailpitSmtp),
    MAILPIT_UI_PORT: String(ports.mailpitUi),

    // API and worker (apps/api).
    OPENVERIFY_MODE: 'development',
    OPENVERIFY_LOG_LEVEL: 'info',
    OPENVERIFY_API_HOST: HOST,
    OPENVERIFY_API_PORT: String(ports.api),
    DATABASE_URL: `postgres://openverify:${postgresPassword}@${HOST}:${String(ports.postgres)}/openverify`,
    REDIS_URL: `redis://:${redisPassword}@${HOST}:${String(ports.redis)}`,
    S3_ENDPOINT: url(ports.s3),
    S3_FORCE_PATH_STYLE: 'true',
    OPENVERIFY_KEK: Buffer.from(random(32)).toString('base64'),
    OPENVERIFY_API_KEY_PEPPER: hex(32),
    // C31.8: the identification-number blind index, a separate secret from the KEK.
    OPENVERIFY_BLIND_INDEX_KEY: Buffer.from(random(32)).toString('base64'),
    OPENVERIFY_FLOW_PUBLIC_URL: url(ports.flow),
    OPENVERIFY_VISION_URL: url(ports.vision),
    OPENVERIFY_VISION_SERVICE_TOKEN: hex(32),
    // The webhook receiver runs on this machine; the flag is refused in production mode.
    OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true',
    OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: String(E2E_API_RATE_LIMIT_PER_MINUTE),
    // C15: invitation email to this run's Mailpit, links to its dashboard, WebAuthn on localhost
    // (an RP ID is a domain, never an IP address), and the BFF token.
    OPENVERIFY_SMTP_URL: `smtp://${HOST}:${String(ports.mailpitSmtp)}`,
    OPENVERIFY_MAIL_FROM: 'e2e-no-reply@example.test',
    OPENVERIFY_DASHBOARD_PUBLIC_URL: dashboardUrl,
    OPENVERIFY_WEBAUTHN_RP_ID: 'localhost',
    OPENVERIFY_WEBAUTHN_ORIGIN: dashboardUrl,
    OPENVERIFY_DASHBOARD_BFF_TOKEN: hex(32),
    // C44: no public figure, age or suspicious entity provider is bound in either environment
    // kind, whatever the shell exports, so those A-tier checks answer provider_not_configured
    // (the A-tier review specs rely on it).
    ...Object.fromEntries(
      [
        'PUBLIC_FIGURE',
        'AGE_ESTIMATE',
        'SELFIE_AGE_ESTIMATE',
        'SELFIE_PUBLIC_FIGURE',
        'SUSPICIOUS_ENTITY',
      ].flatMap((kind) =>
        ['SANDBOX', 'PRODUCTION'].map((environment) => [
          `OPENVERIFY_PROVIDER_${kind}_${environment}`,
          '',
        ]),
      ),
    ),
    // C63, V23: the 5A kinds are bound to their deterministic sandbox for sandbox environments,
    // and to nothing for production: the sandbox SMS sink (C55.11), the database magic tokens
    // (C59.2), the AAMVA endings (C59.4) and the sandbox contract wallet (C57.5). No network
    // provider (Twilio, a JSON-RPC node) is bound, and no credential or node URL is passed on.
    ...Object.fromEntries(
      ['SMS', 'DATABASE', 'AAMVA', 'EVM_RPC'].flatMap((kind) => [
        [`OPENVERIFY_PROVIDER_${kind}_SANDBOX`, 'sandbox'],
        [`OPENVERIFY_PROVIDER_${kind}_PRODUCTION`, ''],
      ]),
    ),
    OPENVERIFY_TWILIO_ACCOUNT_SID: '',
    OPENVERIFY_TWILIO_API_KEY_SID: '',
    OPENVERIFY_TWILIO_API_KEY_SECRET: '',
    OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: '',
    OPENVERIFY_TWILIO_FROM: '',
    OPENVERIFY_EVM_RPC_URLS: '',
    OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: 'false',
    // C61, C63, V23: the 5B kinds are bound to their deterministic sandbox for sandbox
    // environments (the registry endings, the website names of C61.6) and to nothing for
    // production, where the two kinds on by default (GLEIF, RDAP) are set to none. No register
    // credential or EDGAR contact is passed on, and the trust store is never refreshed (C62.7).
    ...Object.fromEntries(
      ['BUSINESS_REGISTRY', 'DOMAIN_AGE', 'MALICIOUS_WEBSITE', 'BACKLINK'].map((kind) => [
        `OPENVERIFY_PROVIDER_${kind}_SANDBOX`,
        'sandbox',
      ]),
    ),
    OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION: 'none',
    OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION: 'none',
    OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION: '',
    OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION: '',
    OPENVERIFY_COMPANIES_HOUSE_API_KEY: '',
    OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY: '',
    OPENVERIFY_SEC_EDGAR_USER_AGENT: '',
    OPENVERIFY_NFC_ALLOW_ICAO_CRLS: 'false',
    OPENVERIFY_TRUST_ANCHOR_REFRESH: 'false',
    // C83, C89.2: the Phase 6 report kinds are bound to their deterministic sandbox for sandbox
    // environments (the media, breach, line-type, postal and exposure magic of C82.4) and to
    // nothing for production. No vendor credential, EU token or Wikidata contact is passed on,
    // GDELT is never acknowledged, and the lists are never refreshed: they reach the stack only
    // through seed:dev and `watchlists:sync --import`, which make no request (C76.2, V01).
    ...Object.fromEntries(
      [
        'ADVERSE_MEDIA',
        'EMAIL_INTELLIGENCE',
        'PHONE_INTELLIGENCE',
        'ADDRESS_VERIFICATION',
        'CRYPTO_EXPOSURE',
      ].flatMap((kind) => [
        [`OPENVERIFY_PROVIDER_${kind}_SANDBOX`, 'sandbox'],
        [`OPENVERIFY_PROVIDER_${kind}_PRODUCTION`, ''],
      ]),
    ),
    OPENVERIFY_HIBP_API_KEY: '',
    OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: '',
    OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID: '',
    OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: '',
    OPENVERIFY_SMARTY_AUTH_ID: '',
    OPENVERIFY_SMARTY_AUTH_TOKEN: '',
    OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: 'false',
    OPENVERIFY_EU_FSF_TOKEN: '',
    OPENVERIFY_WIKIDATA_USER_AGENT: '',
    OPENVERIFY_WATCHLIST_SOURCES_DISABLED: '',
    OPENVERIFY_WATCHLIST_REFRESH: 'false',
    // Workflow 7A (C93.1, C93.6, F34): the API trusts one proxy on loopback, as an operator's
    // reverse proxy on the same host; the 7A specs present a sandbox address with X-Forwarded-For
    // (e2e/src/forwarded-for.ts), and every other request keeps the socket peer, 127.0.0.1. The
    // sandbox IP reputation answers in sandbox environments (C93.5), no operator MMDB is mounted,
    // the network data reaches the stack only through seed:dev's import (no refresh, no request,
    // C92.2), and no source is turned on or off.
    OPENVERIFY_TRUST_PROXY: '127.0.0.1',
    OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'sandbox',
    OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: '',
    OPENVERIFY_IP_REPUTATION_MMDB_PATH: '',
    OPENVERIFY_NETWORK_REFRESH: 'false',
    OPENVERIFY_NETWORK_SOURCES_DISABLED: '',
    OPENVERIFY_NETWORK_SOURCES_ENABLED: '',
    // Workflow 8A (C146.3): a sandbox's workflow may call a receiver on loopback, which the worker
    // trusts through this run's throwaway certificate; Slack steps go to the sandbox list.
    OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: 'true',
    NODE_EXTRA_CA_CERTS: RECEIVER_TLS.certificate,
    OPENVERIFY_PROVIDER_SLACK_SANDBOX: 'sandbox',
    OPENVERIFY_PROVIDER_SLACK_PRODUCTION: '',
    // Workflow 8B (C146.3): attachments are scanned by the sandbox scanner (EICAR infected, all
    // else clean), and the API, which reads the same name, serves only what it found clean.
    OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'sandbox',
    OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: '',
    // C211.1, C211.4 (Workflow 10B): device integrity is bound to its deterministic sandbox (the magic
    // tokens of C211.4) for sandbox environments and to nothing for production; play-integrity is
    // never bound and no Play Integrity setting is passed on, so no run reaches a Google endpoint.
    OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX: 'sandbox',
    OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION: '',
    OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: '',
    OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS: '',
    OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '',
    // C208.1 (Workflow 10C): the sandbox test chip's face-mismatch scenario reads person B's centre
    // still from the generated fixture set on this host; no image holds a face.
    OPENVERIFY_SANDBOX_CHIP_FACES: SANDBOX_CHIP_FACES_DIR,
    // C231.10 (Workflow 11A): the reusable stack serves Connect, so the 11A spec and stackTest reach it.
    OPENVERIFY_CONNECT_ENABLED: 'true',

    // C157 (Workflow 9A): the flow server computes each entry's headers and reads an embed's
    // frame-ancestors from the API's internal route with this shared token (at least 32 bytes).
    OPENVERIFY_FLOW_SERVER_TOKEN: hex(32),
    OPENVERIFY_FLOW_SERVER_API_URL: url(ports.api),
    OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: '0',

    // Hosted flow build (apps/flow) and dashboard BFF (apps/dashboard): the dashboard is built
    // into its own output and served by server.ts, which records the browser as the socket peer
    // (C21); no proxy is in front of it.
    VITE_OPENVERIFY_API_URL: url(ports.api),
    OPENVERIFY_API_URL: url(ports.api),
    OPENVERIFY_DASHBOARD_DIST_DIR: E2E_DASHBOARD_DIST_DIR,
    OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: '0',

    // Dev seed (apps/api/scripts/seed-dev.ts --mfa-admin): the dashboard operators.
    ...operators,
  };
}

const NAME = /^[A-Z_][A-Z0-9_]*$/;
const WRITABLE_VALUE = /^[A-Za-z0-9@:/._+=,-]*$/;

/** Serialises variables as `NAME=value` lines under a header. */
export function formatEnvFile(env: Readonly<Record<string, string>>): string {
  const lines = Object.entries(env).map(([name, value]) => {
    if (!NAME.test(name)) {
      throw new Error(`${name}: invalid name`);
    }
    if (!WRITABLE_VALUE.test(value)) {
      throw new Error(`${name}: value cannot be written to an env file unquoted`);
    }
    return `${name}=${value}`;
  });
  return [
    '# Generated by e2e/setup/global-setup.ts for one e2e run: random secrets and free ports.',
    '# Gitignored and replaced on every run. Never commit it.',
    ...lines,
    '',
  ].join('\n');
}

/** Reads `NAME=value` lines, skipping blank lines and comments. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    if (trimmed === '' || trimmed.startsWith('#') || separator < 1) {
      continue;
    }
    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return env;
}
