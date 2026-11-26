/**
 * C249.1 (G-TLS; decision 13; Phase 11, Workflow 11B, platform-ops): each store's transport read
 * from its URL, one `insecure_transport` warning per store in production mode whose transport an
 * interceptor could read or replace (its name and the reason, never the URL), the settings that
 * would turn verification off refused, the CA files checked and added to the default trust store.
 * `store-tls.integration.test.ts` proves the trust store against a real TLS server. The CA here is
 * one of Node's bundled public roots: real, and no secret.
 */
import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import {
  applyStoreTls,
  certificatesOf,
  NO_STORE_TLS,
  readStoreTls,
  type DefaultCaStore,
  type StoreTlsInput,
  type TlsStore,
} from './store-tls.js';

const CA = rootCertificates[0] ?? '';
const CHAIN = `${rootCertificates[1] ?? ''}\n${rootCertificates[2] ?? ''}\n`;
const NO_CA = { postgres: null, redis: null, s3: null, vision: null };

const SECURE = {
  postgres:
    'postgresql://app:change-me-synthetic@db.example.org:5432/openverify?sslmode=verify-full',
  redis: 'rediss://openverify-api:change-me-synthetic@cache.example.org:6380',
  s3: 'https://s3.example.org',
  vision: 'https://vision.example.org:8000',
} as const;

function input(overrides: Partial<StoreTlsInput> = {}): StoreTlsInput {
  return {
    production: true,
    stores: ['postgres', 'redis', 's3', 'vision'],
    urls: { ...SECURE },
    caFiles: NO_CA,
    ...overrides,
  };
}

const warningsOf = (urls: Partial<Record<TlsStore, string | undefined>>, production = true) =>
  readStoreTls(input({ production, urls: { ...SECURE, ...urls } }), () => CA).warnings;

describe('readStoreTls (C249.1)', () => {
  it('warns about nothing when every store verifies TLS', () => {
    expect(readStoreTls(input())).toEqual({
      settings: { caFiles: NO_CA },
      issues: [],
      warnings: [],
    });
  });

  it('warns once per plain-text store in production, naming the store and never the URL', () => {
    const warnings = warningsOf({
      postgres: 'postgresql://app:change-me-synthetic@db.example.org:5432/openverify',
      redis: 'redis://openverify-api:change-me-synthetic@cache.example.org:6379',
      s3: 'http://s3.example.org:9000',
      vision: 'http://vision.example.org:8000',
    });

    expect(warnings.map((warning) => [warning.code, warning.store])).toEqual([
      ['insecure_transport', 'postgres'],
      ['insecure_transport', 'redis'],
      ['insecure_transport', 's3'],
      ['insecure_transport', 'vision'],
    ]);
    expect(warnings[0]?.reason).toBe(
      'Postgres connects in plain text; set sslmode=verify-full in DATABASE_URL, with OPENVERIFY_POSTGRES_CA_FILE for a private CA',
    );
    expect(warnings[1]?.reason).toBe(
      'Valkey connects in plain text; use rediss:// in REDIS_URL, with OPENVERIFY_REDIS_CA_FILE for a private CA',
    );
    expect(warnings[2]?.reason).toBe(
      'The S3 store connects in plain text; use https:// in S3_ENDPOINT, with OPENVERIFY_S3_CA_FILE for a private CA',
    );
    expect(warnings[3]?.reason).toBe(
      'The vision service connects in plain text; use https:// in OPENVERIFY_VISION_URL, with OPENVERIFY_VISION_CA_FILE for a private CA',
    );
    const text = JSON.stringify(warnings);
    expect(text).not.toContain('example.org');
    expect(text).not.toContain('change-me');
  });

  it.each(['disable', 'allow', 'prefer', 'require', 'verify-ca'])(
    'warns about a Postgres sslmode=%s, below verify-full',
    (sslmode) => {
      const [warning] = warningsOf({
        postgres: `postgresql://app@db.example.org/openverify?sslmode=${sslmode}`,
      });
      expect(warning?.store).toBe('postgres');
      expect(warning?.code).toBe('insecure_transport');
    },
  );

  it('takes ssl=true as verified TLS, as node-postgres does', () => {
    expect(warningsOf({ postgres: 'postgresql://app@db.example.org/openverify?ssl=true' })).toEqual(
      [],
    );
  });

  it('warns about nothing outside production mode', () => {
    expect(
      warningsOf(
        { postgres: 'postgresql://app@db.example.org/openverify', s3: 'http://s3' },
        false,
      ),
    ).toEqual([]);
  });

  it('never warns about a loopback host, which no network carries', () => {
    expect(
      warningsOf({
        postgres: 'postgresql://app@127.0.0.1:5432/openverify',
        redis: 'redis://localhost:6379',
        s3: 'http://[::1]:9000',
        vision: 'http://127.0.0.2:8000',
      }),
    ).toEqual([]);
  });

  it('reads only the stores the process connects to', () => {
    const result = readStoreTls(
      input({
        stores: ['postgres', 'redis'],
        urls: {
          postgres: 'postgresql://app@db.example.org/x',
          redis: undefined,
          s3: 'http://s3',
          vision: undefined,
        },
      }),
    );

    expect(result.warnings.map((warning) => warning.store)).toEqual(['postgres']);
  });

  it.each([
    'postgresql://app@db.example.org/x?sslmode=no-verify',
    'postgresql://app@db.example.org/x?sslmode=require&uselibpqcompat=true',
    'postgresql://app@127.0.0.1/x?sslmode=no-verify',
  ])('refuses a URL that turns verification off, in every mode: %s', (postgres) => {
    for (const production of [true, false]) {
      expect(readStoreTls(input({ production, urls: { ...SECURE, postgres } })).issues).toEqual([
        'DATABASE_URL: turns certificate verification off (sslmode=no-verify, or uselibpqcompat with a mode below verify-full); use sslmode=verify-full with OPENVERIFY_POSTGRES_CA_FILE',
      ]);
    }
  });

  it('accepts uselibpqcompat with verify-full', () => {
    expect(
      readStoreTls(
        input({
          urls: {
            ...SECURE,
            postgres: 'postgresql://app@db.example.org/x?sslmode=verify-full&uselibpqcompat=true',
          },
        }),
      ).issues,
    ).toEqual([]);
  });

  it('checks each CA file: readable, and only PEM certificates', () => {
    const files: Record<string, string> = {
      '/etc/ca/postgres.pem': CA,
      '/etc/ca/redis.pem': CHAIN,
      '/etc/ca/s3.pem': 'not a certificate',
      '/etc/ca/vision.pem': '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
    };
    const caFiles = {
      postgres: '/etc/ca/postgres.pem',
      redis: '/etc/ca/redis.pem',
      s3: '/etc/ca/s3.pem',
      vision: '/etc/ca/vision.pem',
    };

    const result = readStoreTls(input({ caFiles }), (path) => {
      const text = files[path];
      if (text === undefined) {
        throw new Error('ENOENT');
      }
      return text;
    });

    expect(result.issues).toEqual([
      'OPENVERIFY_S3_CA_FILE: holds no PEM certificate',
      'OPENVERIFY_VISION_CA_FILE: holds no PEM certificate',
    ]);
    expect(result.settings).toEqual({ caFiles });
    expect(
      readStoreTls(input({ caFiles: { ...NO_CA, redis: '/missing' } }), () => {
        throw new Error('ENOENT');
      }).issues,
    ).toEqual(['OPENVERIFY_REDIS_CA_FILE: cannot be read']);
  });
});

describe('certificatesOf', () => {
  it('splits a chain into its certificates', () => {
    expect(certificatesOf(CHAIN)).toHaveLength(2);
    expect(certificatesOf('nothing')).toEqual([]);
  });
});

describe('applyStoreTls (C249.1)', () => {
  function fakeStore(): DefaultCaStore & { set: string[][] } {
    const set: string[][] = [];
    return {
      set,
      getCACertificates: () => ['BUNDLED-ROOT'],
      setDefaultCACertificates: (certificates) => {
        set.push(certificates);
      },
    };
  }

  it('adds every named CA to the default trust store once, beside the bundled roots', () => {
    const store = fakeStore();

    applyStoreTls(
      { caFiles: { postgres: '/a.pem', redis: '/b.pem', s3: null, vision: '/a.pem' } },
      (path) => (path === '/a.pem' ? CA : CHAIN),
      store,
    );

    expect(store.set).toHaveLength(1);
    expect(store.set[0]).toEqual(['BUNDLED-ROOT', CA, ...certificatesOf(CHAIN)]);
  });

  it('changes nothing without a CA file', () => {
    const store = fakeStore();

    applyStoreTls(NO_STORE_TLS, () => CA, store);

    expect(store.set).toEqual([]);
  });

  it('says which Node.js it needs when the runtime cannot set the trust store', () => {
    const store = { getCACertificates: () => [] } as unknown as DefaultCaStore;

    expect(() => {
      applyStoreTls({ caFiles: { ...NO_STORE_TLS.caFiles, postgres: '/a.pem' } }, () => CA, store);
    }).toThrow('needs Node.js 22.19 or later');
  });
});
