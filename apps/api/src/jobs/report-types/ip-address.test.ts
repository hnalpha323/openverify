/**
 * C106.1 (H01, H07, H13, V12): the `ip-address` report job over the worker's network snapshots,
 * one golden per case, each served through the frozen resource schema. The snapshots hold the
 * synthetic sandbox bundle (documentation ranges, fictional ASNs); no publisher is called. A
 * stale exit list cannot be reached with a documentation address (it reads the sandbox source in
 * a sandbox and is not public in production), so that case wraps the evaluation and marks the
 * exit list stale, as a public address against a stale list would read.
 */
import { createHash, randomBytes } from 'node:crypto';
import { recordSessionNetworkEvaluation } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { SandboxNetwork, type NetworkEvaluation } from '@openverify/signals/network';
import { sandboxNetworkBundle } from '@openverify/signals/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NetworkSnapshot } from '../../ports.js';
import { createIpReputationProvider } from '../../providers/ip-reputation/index.js';
import { createInMemoryNetworkSnapshots } from '../../test-support/fakes.js';
import { ipAddressReportJob } from './ip-address.js';
import type { ReportRunResult } from './job.js';
import { REPORT_NOW, reportContext, servedReport } from './provider-testing.js';

const override = vi.hoisted(() => ({
  current: null as ((evaluation: NetworkEvaluation) => NetworkEvaluation) | null,
}));
vi.mock('@openverify/signals/network', async (importOriginal) => {
  const original = await importOriginal<typeof import('@openverify/signals/network')>();
  return {
    ...original,
    evaluateNetwork: (input: Parameters<typeof original.evaluateNetwork>[0]) => {
      const evaluation = original.evaluateNetwork(input);
      return override.current === null ? evaluation : override.current(evaluation);
    },
  };
});

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.client.query(
    `insert into network_sources (id, enabled, sandbox_only, last_origin)
       values ('openverify-sandbox-network', true, true, 'import')`,
  );
}, 120_000);

afterAll(async () => {
  await database.close();
});

const bundle = sandboxNetworkBundle();
const SHA = createHash('sha256').update(bundle).digest('hex');
const SANDBOX: NetworkSnapshot = {
  sourceId: 'openverify-sandbox-network',
  sandboxOnly: true,
  syncId: 7,
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  sha256: SHA,
  checkedAt: REPORT_NOW,
  bytes: bundle.byteLength,
  data: SandboxNetwork.parse(bundle),
};

async function run(
  address: string,
  options: { kind?: 'sandbox' | 'production'; proxy?: boolean; inquirySession?: boolean } = {},
) {
  const ctx = reportContext({
    type: 'ip-address',
    query: { 'ip-address': address },
    environmentKind: options.kind ?? 'sandbox',
    db: database.db,
    providers:
      options.proxy === true
        ? { ipReputation: createIpReputationProvider('sandbox', { mmdbPath: null }) }
        : {},
    deps: { networkSnapshots: createInMemoryNetworkSnapshots([SANDBOX]) },
  });
  const outcome = await ipAddressReportJob.run(ctx);
  if (outcome.kind !== 'completed') {
    throw new Error('the run waited');
  }
  return { result: outcome.result, served: servedReport(ctx, outcome.result), ctx };
}

const attributesOf = (served: { attributes: unknown }) =>
  served.attributes as Record<string, unknown>;

const unavailable = (result: ReportRunResult) =>
  Object.fromEntries(result.unavailableFields.map(({ field, reason }) => [field, reason]));

describe('the ip-address report (sandbox values)', () => {
  it('matches a sandbox Tor exit, flagged, with the sandbox source as provenance', async () => {
    const { result, served } = await run('192.0.2.10');
    expect(result.errors).toEqual([]);
    expect(served.attributes).toMatchObject({
      status: 'ready',
      'has-match': false,
      'tor-exit-node': 'MATCHED',
      flagged: true,
      'country-code': 'ZZ',
      'country-name': 'Example Land',
      'mobile-ip': null,
      error: null,
    });
    expect(attributesOf(served)['field-details']).toMatchObject({
      'tor-exit-node': { tier: 'R', reasons: ['tor_exit_listed'] },
    });
    expect(result.sources).toEqual([
      {
        sourceId: 'openverify-sandbox-network',
        syncId: '7',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        checkedAt: REPORT_NOW,
        sha256: SHA,
        origin: 'import',
        attribution: 'OpenVerify synthetic sandbox network data',
      },
    ]);
    expect(unavailable(result)['mobile-ip']).toBe('no_documented_method');
  });

  it('serves a provider range as the public datacenter fields', async () => {
    const { served } = await run('192.0.2.20');
    expect(served.attributes).toMatchObject({
      'service-type': 'DATACENTER',
      'datacenter-ip': true,
      flagged: true,
    });
  });

  it('keeps a hosting ASN out of the public datacenter fields (H13)', async () => {
    const { served, result } = await run('192.0.2.50');
    expect(served.attributes).toMatchObject({
      'service-type': null,
      'datacenter-ip': null,
      'hosting-asn': true,
      flagged: false,
    });
    expect(attributesOf(served)['field-details']).toMatchObject({
      'hosting-asn': { tier: 'H', confidence: 0.5, reasons: ['hosting_asn'] },
    });
    expect(unavailable(result)).toMatchObject({
      'datacenter-ip': 'not_in_known_ranges',
      'service-type': 'not_in_known_ranges',
    });
  });

  it('asks the bound adapter for the proxy flag, naming it as a sandbox', async () => {
    const { served, result } = await run('192.0.2.40', { proxy: true });
    expect(served.attributes).toMatchObject({ 'proxy-detected': true, flagged: true });
    expect(result.provider).toEqual({ id: 'sandbox', sandbox: true });
    const unbound = await run('192.0.2.40');
    expect(unavailable(unbound.result)['proxy-detected']).toBe('provider_not_configured');
  });

  it('serves a fictional city point for the city range, with the VPN flag as H', async () => {
    const city = await run('203.0.113.7');
    expect(city.served.attributes).toMatchObject({
      latitude: -30,
      longitude: -140,
      city: 'Example City',
    });
    const vpn = await run('192.0.2.30');
    expect(vpn.served.attributes).toMatchObject({ 'vpn-detected': true, flagged: true });
    expect(attributesOf(vpn.served)['field-details']).toMatchObject({
      'vpn-detected': { tier: 'H', confidence: 0.6, reasons: ['vpn_asn'] },
    });
  });
});

describe('the ip-address report never clears what the exit list cannot answer (H01)', () => {
  it('leaves IPv6 null with ipv6_not_covered, ready', async () => {
    const { served, result } = await run('2001:db8::7');
    expect(served.attributes).toMatchObject({ status: 'ready', 'tor-exit-node': null });
    expect(unavailable(result)['tor-exit-node']).toBe('ipv6_not_covered');
  });

  it('leaves a private address null with address_not_public', async () => {
    const { served, result } = await run('10.20.30.40');
    expect(served.attributes).toMatchObject({ 'tor-exit-node': null, 'country-code': null });
    expect(unavailable(result)).toMatchObject({
      'tor-exit-node': 'address_not_public',
      'country-code': 'address_not_public',
    });
  });

  it('reads a documentation address in production as not public, never the sandbox source', async () => {
    const { served, result } = await run('192.0.2.10', { kind: 'production' });
    expect(attributesOf(served)['tor-exit-node']).toBeNull();
    expect(unavailable(result)['tor-exit-node']).toBe('address_not_public');
    expect(result.sources).toEqual([]);
  });

  it('ends errored with list_stale, naming the exit list, and keeps what it found', async () => {
    override.current = (evaluation) => ({
      ...evaluation,
      facts: {
        ...evaluation.facts,
        'is-tor': { value: null, nullReason: 'list_stale', reasons: [], confidence: null },
      },
    });
    try {
      const { served, result } = await run('192.0.2.10');
      expect(result.errors).toEqual([{ code: 'list_stale', source: 'tor-exit-addresses' }]);
      expect(served.attributes).toMatchObject({
        status: 'errored',
        'tor-exit-node': null,
        error: 'list_stale',
        'country-code': 'ZZ',
      });
      expect(unavailable(result)['tor-exit-node']).toBe('list_stale');
    } finally {
      override.current = null;
    }
  });

  it('ends errored with insufficient_input for a query it cannot read', async () => {
    const ctx = reportContext({ type: 'ip-address', query: {}, db: database.db });
    const outcome = await ipAddressReportJob.run(ctx);
    expect(outcome).toMatchObject({
      kind: 'completed',
      result: { errors: [{ code: 'insufficient_input' }] },
    });
  });
});

describe('a completion report of the session address (inquiry_session)', () => {
  it('judges the address as the session was judged, naming how it was resolved', async () => {
    const { environment } = await createTestTenant(database.db, { kind: 'production' });
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const sessionId = testId('iqse');
    await database.client.query(
      `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
         values ($1, $2, $3, $4, now() + interval '1 hour')`,
      [sessionId, environment.id, inquiry.id, randomBytes(32).toString('hex')],
    );
    await recordSessionNetworkEvaluation(database.db, environment.id, {
      id: testId('net'),
      inquirySessionId: sessionId,
      ip: '192.0.2.10',
      clientAddressSource: 'trust-all',
      evaluatedAt: REPORT_NOW,
      facts: {
        isTor: null,
        isDatacenter: null,
        isVpn: null,
        isProxy: null,
        hostingAsn: null,
        hostingAsnConfidence: null,
        privacyRelay: null,
        threatLevel: null,
        countryCode: null,
        countryName: null,
        location: null,
        asn: null,
        organization: null,
        serviceType: null,
        proxyType: null,
        ipConnectionType: null,
      },
      reasons: [],
      sources: [],
    });
    const ctx = reportContext({
      type: 'ip-address',
      query: { 'ip-address': '192.0.2.10' },
      environmentId: environment.id,
      environmentKind: 'production',
      origin: 'inquiry_completion',
      inquiryId: inquiry.id,
      db: database.db,
      deps: { networkSnapshots: createInMemoryNetworkSnapshots([SANDBOX]) },
    });
    const completion = {
      ...ctx,
      report: { ...ctx.report, querySources: { 'ip-address': 'inquiry_session' } },
    };
    const outcome = await ipAddressReportJob.run(completion);
    if (outcome.kind !== 'completed') {
      throw new Error('the run waited');
    }
    expect(outcome.result.result['client-address-source']).toBe('trust-all');
    expect(unavailable(outcome.result)['tor-exit-node']).toBe('client_address_untrusted');
  });
});
