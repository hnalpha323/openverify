/**
 * C108, C92.4, C92.8 (Workflow 7A, `api-network`): the network sources page: each manifest source
 * with its state, staleness, last refusal, attribution and terms; the newest syncs; the pinned ASN
 * seeds with their commits and counts. Public data only: no session, address or subject. The
 * route is built here; registering it under `/api/v1/dashboard` (and its schema in contracts and
 * the OpenAPI snapshot) is `integration-7a`'s.
 */
import type { NetworkSourceState, NetworkSync } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadNetworkManifest } from '../../network/manifest.js';
import { reconcileNetworkSources } from '../../network/reconcile.js';
import type { AdminRouteContext } from './admin-context.js';
import {
  dashboardNetworkSourcesSchema,
  networkSourceRoutes,
  networkSourcesDocument,
  type NetworkSourcesInput,
} from './network-sources.js';

const manifest = loadNetworkManifest();
const NOW = new Date('2026-10-30T08:00:00.000Z');

function state(id: string, overrides: Partial<NetworkSourceState> = {}): NetworkSourceState {
  return {
    id,
    enabled: true,
    sandboxOnly: id === 'openverify-sandbox-network',
    lastSyncId: null,
    lastPublishedAt: null,
    lastSha256: null,
    lastAppliedAt: null,
    lastCheckedAt: null,
    lastOrigin: null,
    lastErrorCode: null,
    checkFailures: 0,
    lastFailedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<NetworkSourcesInput> = {}): NetworkSourcesInput {
  return {
    manifest,
    states: [
      state('tor-exit-addresses', {
        lastSyncId: 9,
        lastPublishedAt: new Date('2026-10-30T07:00:00Z'),
        lastSha256: 'a'.repeat(64),
        lastAppliedAt: new Date('2026-10-30T07:05:00Z'),
        lastCheckedAt: new Date('2026-10-30T01:00:00Z'),
        lastOrigin: 'publisher',
        lastErrorCode: 'refused_mass_removal',
        checkFailures: 1,
        lastFailedAt: new Date('2026-10-30T07:30:00Z'),
      }),
      state('openverify-sandbox-network', {
        lastSyncId: 3,
        lastSha256: 'b'.repeat(64),
        lastOrigin: 'import',
        lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
      }),
      state('dbip-city-lite', { enabled: false }),
    ],
    syncs: [
      {
        id: 9,
        sourceId: 'tor-exit-addresses',
        startedAt: new Date('2026-10-30T07:30:00Z'),
        finishedAt: new Date('2026-10-30T07:30:02Z'),
        outcome: 'refused_mass_removal',
        errorCode: null,
        publishedAt: new Date('2026-10-30T07:20:00Z'),
        sha256: 'c'.repeat(64),
        snapshotBytes: 4096,
        entryCount: 12,
        coveredIpv4: null,
        coveredIpv6: null,
        actor: 'job',
        origin: 'publisher',
        overrides: [],
        supersededAt: null,
        snapshotDeletedAt: null,
      } satisfies NetworkSync,
    ],
    asn: {
      status: 'loaded',
      sets: { hosting: new Set([64503]), vpn: new Set() },
      counts: { hosting: 1, vpn: 0 },
    },
    seeds: [
      {
        name: 'x4bnet_vpn_asns',
        commit: '30c56a5dfe5465afd41b5c628939fbe3e02f89aa',
        sha256: 'd'.repeat(64),
      },
    ],
    now: NOW,
    ...overrides,
  };
}

describe('networkSourcesDocument', () => {
  it('lists every manifest source with its state, staleness, refusal, attribution and terms', () => {
    const document = dashboardNetworkSourcesSchema.parse(networkSourcesDocument(input()));
    expect(document.sources.map((source) => source.id)).toEqual(
      manifest.sources.map((source) => source.id),
    );
    const tor = document.sources.find((source) => source.id === 'tor-exit-addresses');
    expect(tor).toMatchObject({
      publisher: 'The Tor Project (TorDNSEL)',
      role: 'tor',
      enabled: true,
      'enabled-by-default': true,
      'sandbox-only': false,
      'import-only': false,
      'last-sync-id': '9',
      'last-checked-at': '2026-10-30T01:00:00.000Z',
      'last-applied-at': '2026-10-30T07:05:00.000Z',
      'published-at': '2026-10-30T07:00:00.000Z',
      sha256: 'a'.repeat(64),
      origin: 'publisher',
      // Six hours after its last check, plus one: the exit list is stale.
      stale: true,
      'stale-after-hours': 6,
      'last-error-code': 'refused_mass_removal',
      'check-failures': 1,
      attribution: 'Tor exit list: The Tor Project (TorDNSEL, CC0)',
      'link-back': null,
    });
    expect(tor?.terms.url).toBe('https://metrics.torproject.org/collector.html');
    const sandbox = document.sources.find((source) => source.id === 'openverify-sandbox-network');
    expect(sandbox).toMatchObject({ 'sandbox-only': true, 'import-only': true, stale: false });
    const city = document.sources.find((source) => source.id === 'dbip-city-lite');
    expect(city).toMatchObject({
      enabled: false,
      stale: null,
      'link-back': 'https://db-ip.com',
      attribution: 'IP geolocation by DB-IP',
    });
    const never = document.sources.find((source) => source.id === 'aws-ip-ranges');
    expect(never).toMatchObject({ 'last-checked-at': null, stale: null, 'last-sync-id': null });
  });

  it('lists the newest syncs and the pinned ASN seeds', () => {
    const document = dashboardNetworkSourcesSchema.parse(networkSourcesDocument(input()));
    expect(document['recent-syncs']).toEqual([
      {
        id: '9',
        'source-id': 'tor-exit-addresses',
        'started-at': '2026-10-30T07:30:00.000Z',
        'finished-at': '2026-10-30T07:30:02.000Z',
        outcome: 'refused_mass_removal',
        'error-code': null,
        'published-at': '2026-10-30T07:20:00.000Z',
        sha256: 'c'.repeat(64),
        'snapshot-bytes': 4096,
        'entry-count': 12,
        actor: 'job',
        origin: 'publisher',
        overrides: [],
      },
    ]);
    expect(document['asn-seeds']).toEqual({
      status: 'loaded',
      files: [],
      'hosting-asns': 1,
      'vpn-asns': 0,
      seeds: [
        {
          name: 'x4bnet_vpn_asns',
          commit: '30c56a5dfe5465afd41b5c628939fbe3e02f89aa',
          sha256: 'd'.repeat(64),
        },
      ],
    });
    const missing = networkSourcesDocument(
      input({ asn: { status: 'missing', files: ['bad-asn-list.csv'] } }),
    );
    expect(dashboardNetworkSourcesSchema.parse(missing)['asn-seeds']).toMatchObject({
      status: 'missing',
      files: ['bad-asn-list.csv'],
      'hosting-asns': null,
      'vpn-asns': null,
    });
  });

  it('holds no address: only publication digests, ids and codes', () => {
    expect(JSON.stringify(networkSourcesDocument(input()))).not.toMatch(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    );
  });
});

describe('networkSourceRoutes', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.client.query('truncate network_syncs, network_sources');
    await reconcileNetworkSources(database.db, {
      sourcesDisabled: [],
      sourcesEnabled: [],
      clock: { now: () => NOW },
      manifest,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it('serves GET /network-sources under settings:read, from the rows', async () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorateRequest('operator', null);
    app.addHook('onRequest', (request, _reply, done) => {
      (request as unknown as { operator: unknown }).operator = { user: { id: 'usr_synthetic' } };
      done();
    });
    let scopes: unknown;
    app.addHook('onRoute', (route) => {
      scopes = (route.config as { scopes?: unknown } | undefined)?.scopes;
    });
    await app.register(networkSourceRoutes, {
      db: database.db,
      clock: { now: () => NOW },
    } as unknown as AdminRouteContext);
    const response = await app.inject({ method: 'GET', url: '/network-sources' });
    expect(response.statusCode).toBe(200);
    const body = dashboardNetworkSourcesSchema.parse(response.json());
    expect(body.sources).toHaveLength(manifest.sources.length);
    expect(scopes).toEqual(['settings:read']);
    await app.close();
  });
});
