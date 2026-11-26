/**
 * C93.1-C93.3, C93.5, C93.6 (H26, P05): a session's network evaluation, written with its networks
 * row in the session start's transaction, over PGlite. The snapshots hold the synthetic sandbox
 * bundle (documentation ranges, fictional ASNs) and the adapters are the sandbox's; no request is
 * made and no real list is read.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getInquirySession, listSessionNetworks } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { SandboxNetwork } from '@openverify/signals/network';
import { sandboxNetworkBundle } from '@openverify/signals/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrustProxySetting } from '../operator-auth/settings.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { ulidIdGenerator, type NetworkSnapshot } from '../ports.js';
import { createIpReputationProvider } from '../providers/ip-reputation/index.js';
import { createInMemoryNetworkSnapshots } from '../test-support/fakes.js';
import type { AsnData } from './asn-data.js';
import {
  clientAddressSourceOf,
  evaluateSessionNetworkInTx,
  type SessionNetworkDeps,
} from './evaluate.js';
import type { PrivatePeerSample } from './private-peers.js';

let database: TestDatabase;
const NOW = new Date('2026-10-30T08:00:00.000Z');
const bundle = sandboxNetworkBundle();
const SHA = createHash('sha256').update(bundle).digest('hex');

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const SANDBOX_SNAPSHOT: NetworkSnapshot = {
  sourceId: 'openverify-sandbox-network',
  sandboxOnly: true,
  syncId: 7,
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  appliedAt: new Date('2026-01-01T00:00:00Z'),
  sha256: SHA,
  checkedAt: NOW,
  bytes: bundle.byteLength,
  data: SandboxNetwork.parse(bundle),
};

const ADDRESS = '192.0.2.10';
const NO_ASN_DATA = (): AsnData => ({ status: 'missing', files: ['x4bnet-vpn-ASN.txt'] });

function deps(
  options: { trustProxy?: TrustProxySetting; adapter?: 'sandbox' | 'throws' | null } = {},
) {
  const samples: PrivatePeerSample[] = [];
  const sandboxAdapter = createIpReputationProvider('sandbox', { mmdbPath: null });
  const adapter =
    options.adapter === null
      ? undefined
      : options.adapter === 'throws'
        ? {
            id: 'mmdb-file',
            sandbox: false,
            lookup: () => {
              throw new Error('the ipReputation file cannot be read');
            },
          }
        : sandboxAdapter;
  const logger = createCapturingLogger();
  const value: SessionNetworkDeps = {
    logger,
    snapshots: createInMemoryNetworkSnapshots([SANDBOX_SNAPSHOT]),
    providers: {
      sandbox: { ipReputation: adapter },
      production: { ipReputation: options.adapter === 'throws' ? adapter : undefined },
    },
    trustProxy: options.trustProxy ?? ['127.0.0.1'],
    privatePeers: { observe: (sample) => samples.push(sample) },
    ids: ulidIdGenerator,
    asnData: NO_ASN_DATA,
  };
  return { deps: value, samples, logger };
}

async function session(kind: 'sandbox' | 'production' = 'sandbox') {
  const { environment } = await createTestTenant(database.db, { kind });
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const id = testId('iqse');
  await database.client.query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [id, environment.id, inquiry.id, randomBytes(32).toString('hex')],
  );
  return { id, environmentId: environment.id, inquiryId: inquiry.id };
}

async function evaluate(
  ip: string,
  options: Parameters<typeof deps>[0] & { kind?: 'sandbox' | 'production' } = {},
) {
  const started = await session(options.kind);
  const { deps: value, samples, logger } = deps(options);
  const written = await database.db.transaction((tx) =>
    evaluateSessionNetworkInTx(tx, value, started, { ip }, NOW),
  );
  const [network] = await listSessionNetworks(database.db, started.environmentId, [started.id]);
  const stored = await getInquirySession(database.db, started.environmentId, started.id);
  return { started, written, network, stored, samples, deps: value, logger };
}

const reasonOf = (
  network: { reasons: { field: string; reason: string }[] } | undefined,
  field: string,
) => network?.reasons.filter((reason) => reason.field === field).map(({ reason }) => reason);

describe('evaluateSessionNetworkInTx (sandbox values, C93.6)', () => {
  it('evaluates a Tor exit: the network row and the session facts, with their provenance', async () => {
    const { written, network, stored } = await evaluate('192.0.2.10');
    expect(written).toEqual({ networkId: network?.id });
    expect(network).toMatchObject({
      ip: '192.0.2.10',
      clientAddressSource: 'trusted-list',
      proxyType: 'tor',
      threatLevel: 'high',
      countryCode: 'ZZ',
      countryName: 'Example Land',
      evaluatedAt: NOW,
    });
    expect(network?.sources).toContainEqual({
      kind: 'sync',
      'source-id': 'openverify-sandbox-network',
      'sync-id': '7',
      'published-at': '2026-01-01T00:00:00.000Z',
      sha256: SHA,
    });
    expect(stored).toMatchObject({
      networkEvaluatedAt: NOW,
      isTor: true,
      threatLevel: 'high',
      countryCode: 'ZZ',
    });
  });

  it('marks a provider range as a datacenter, publicly, and a hosting ASN only as ours', async () => {
    const range = await evaluate('192.0.2.20');
    expect(range.stored).toMatchObject({ isDatacenter: true, ipConnectionType: 'datacenter' });
    expect(range.network?.serviceType).toBe('datacenter');
    const hosting = await evaluate('192.0.2.50');
    expect(hosting.stored).toMatchObject({ isDatacenter: null, hostingAsn: true });
    expect(hosting.network).toMatchObject({ serviceType: null, hostingAsn: true, asn: 64503 });
    expect(hosting.network?.hostingAsnConfidence).toBe(0.5);
  });

  it('asks the bound adapter, naming it as a sandbox in the sources', async () => {
    const { stored, network } = await evaluate('192.0.2.40');
    expect(stored?.isProxy).toBe(true);
    expect(network?.sources).toContainEqual({
      kind: 'provider',
      provider: 'sandbox',
      sandbox: true,
    });
  });

  it('answers is-proxy null with provider_not_configured without an adapter, or when it fails', async () => {
    for (const adapter of [null, 'throws'] as const) {
      const { stored, network } = await evaluate('192.0.2.40', { adapter });
      expect(stored?.isProxy).toBeNull();
      expect(reasonOf(network, 'is-proxy')).toEqual(['provider_not_configured']);
    }
  });

  it('says IPv6 is not covered by the exit list', async () => {
    const { stored, network } = await evaluate('2001:db8::7');
    expect(stored?.isTor).toBeNull();
    expect(reasonOf(network, 'is-tor')).toEqual(['ipv6_not_covered']);
  });

  it('folds an IPv4-mapped IPv6 address to IPv4 before it judges and seals it', async () => {
    const { network, stored } = await evaluate('::ffff:192.0.2.10');
    expect(network?.ip).toBe('192.0.2.10');
    expect(stored?.isTor).toBe(true);
  });

  it('writes nothing for a session already evaluated', async () => {
    const { started, deps: value } = await evaluate('192.0.2.10');
    const again = await evaluateSessionNetworkInTx(
      database.db,
      value,
      started,
      { ip: '192.0.2.20' },
      NOW,
    );
    expect(again).toBeNull();
  });
});

describe('evaluateSessionNetworkInTx (production, H26 and P05)', () => {
  it('never reads the sandbox source: a documentation address is not public there', async () => {
    const { network, stored } = await evaluate('192.0.2.10', { kind: 'production' });
    expect(stored).toMatchObject({ isTor: null, threatLevel: null, countryCode: null });
    expect(reasonOf(network, 'is-tor')).toEqual(['address_not_public']);
    expect(JSON.stringify(network?.sources)).not.toContain('openverify-sandbox-network');
  });

  it('nulls every fact with client_address_untrusted under trust-all', async () => {
    const { network } = await evaluate('192.0.2.10', { kind: 'production', trustProxy: true });
    expect(network?.clientAddressSource).toBe('trust-all');
    expect(new Set(network?.reasons.map(({ reason }) => reason))).toEqual(
      new Set(['client_address_untrusted']),
    );
  });

  it('tells the private-peer watch about each session, without its address', async () => {
    const privateOne = await evaluate('10.1.2.3', { kind: 'production' });
    expect(privateOne.samples).toEqual([{ environmentKind: 'production', addressIsPrivate: true }]);
    expect(reasonOf(privateOne.network, 'country-code')).toEqual(['address_not_public']);
    const sandbox = await evaluate('192.0.2.10');
    expect(sandbox.samples).toEqual([{ environmentKind: 'sandbox', addressIsPrivate: false }]);
  });

  it('reads a sandbox address from the sandbox bundle alone, whatever the pinned seeds', async () => {
    // The seeds are missing here (NO_ASN_DATA); the bundle's own fictional ASN lists answer.
    const { network } = await evaluate('198.51.100.7');
    expect(network).toMatchObject({ asn: 64501, serviceProvider: 'Example Residential' });
    expect(reasonOf(network, 'is-vpn')).toEqual(['not_in_known_ranges']);
    expect(reasonOf(network, 'hosting-asn')).toEqual(['not_in_known_ranges']);
  });
});

describe('evaluateSessionNetworkInTx never fails the session start for an address', () => {
  it('writes nothing, and does not throw, when the evaluation itself fails', async () => {
    const started = await session();
    const { deps: value } = deps();
    const broken = {
      ...value,
      snapshots: {
        current: () => {
          throw new Error('the snapshots are unreadable');
        },
      },
    };
    const written = await database.db.transaction((tx) =>
      evaluateSessionNetworkInTx(tx, broken, started, { ip: '192.0.2.10' }, NOW),
    );
    expect(written).toBeNull();
    const stored = await getInquirySession(database.db, started.environmentId, started.id);
    expect(stored?.networkEvaluatedAt).toBeNull();
  });

  it('writes nothing for an address it cannot read, so the session reads not evaluated', async () => {
    const { written, network, stored } = await evaluate('not-an-address');
    expect(written).toBeNull();
    expect(network).toBeUndefined();
    expect(stored?.networkEvaluatedAt).toBeNull();
  });
});

describe('an evaluation that writes nothing leaves a trace (K7A-10, C93.7)', () => {
  const warnings = (logger: ReturnType<typeof createCapturingLogger>) =>
    logger.entries.filter((entry) => entry.level === 'warn');

  it('logs a failed adapter once, with the error’s name only', async () => {
    const { logger } = await evaluate(ADDRESS, { adapter: 'throws' });

    expect(warnings(logger)).toMatchObject([
      { message: 'ip reputation lookup failed', object: { error: 'Error' } },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(ADDRESS);
  });

  it('logs an unparsable address once, never the address', async () => {
    const { logger } = await evaluate('not-an-address-203.0.113.9');

    expect(warnings(logger)).toMatchObject([{ message: 'session address does not parse' }]);
    expect(JSON.stringify(logger.entries)).not.toContain('203.0.113.9');
  });

  it('logs a failed evaluation once, with the error’s name only', async () => {
    const started = await session();
    const { deps: value, logger } = deps();
    value.asnData = () => {
      throw new RangeError('the seeds cannot be read');
    };

    await database.db.transaction((tx) =>
      evaluateSessionNetworkInTx(tx, value, started, { ip: ADDRESS }, NOW),
    );

    expect(warnings(logger)).toMatchObject([
      { message: 'session network evaluation failed', object: { error: 'RangeError' } },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(ADDRESS);
    expect(JSON.stringify(logger.entries)).not.toContain('the seeds cannot be read');
  });
});

describe('clientAddressSourceOf (C93.1)', () => {
  it('names how the address was resolved', () => {
    expect(clientAddressSourceOf(false)).toBe('socket');
    expect(clientAddressSourceOf(['10.0.0.0/8'])).toBe('trusted-list');
    expect(clientAddressSourceOf(2)).toBe('hop-count');
    expect(clientAddressSourceOf(true)).toBe('trust-all');
  });
});
