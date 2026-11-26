/**
 * C62.10: the console view of the CSCA trust store parses its golden answer
 * (`contracts/fixtures/api/dashboard-trust-anchors.json`) and refuses what the trust tables rule
 * out (C53.3): digests that are not SHA-256 hex, countries that are not two capitals, outcomes and
 * freshness states outside their lists, negative counts and unknown members.
 */
import { describe, expect, it } from 'vitest';
import { readFixture } from './test-support.js';
import {
  TRUST_ANCHOR_SYNC_OUTCOMES,
  TRUST_CRL_FRESHNESS,
  dashboardTrustAnchorsSchema,
} from './trust-anchors.js';

const golden = () => readFixture('api/dashboard-trust-anchors.json');

/** A deep copy of `value` with `patch` set at the dotted `path` (array indexes as numbers). */
function patched(value: unknown, path: string, patch: unknown): unknown {
  const copy = structuredClone(value);
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  let node = copy as Record<string, unknown>;
  for (const key of keys) {
    node = node[key] as Record<string, unknown>;
  }
  node[last] = patch;
  return copy;
}

describe('dashboardTrustAnchorsSchema (C62.10)', () => {
  it('parses the golden answer unchanged', () => {
    expect(dashboardTrustAnchorsSchema.parse(golden())).toEqual(golden());
  });

  it('names the sync outcomes the audit table records and the CRL freshness states', () => {
    expect(TRUST_ANCHOR_SYNC_OUTCOMES).toEqual(['accepted', 'refused', 'failed']);
    expect(TRUST_CRL_FRESHNESS).toEqual(['current', 'expired']);
  });

  // Workflow 5C review K13 (owner decision 6 after Workflow 5B): the console says whether the
  // worker refreshes the store and whether ICAO PKD CRLs are fetched.
  it('reports the install’s refresh and ICAO-CRL settings', () => {
    expect(dashboardTrustAnchorsSchema.parse(golden())).toMatchObject({
      settings: { 'refresh-enabled': true, 'icao-crls-allowed': false },
    });
  });

  it('takes a store with no source synced and no anchor', () => {
    const empty = {
      'generated-at': '2026-10-23T12:00:00.000Z',
      'has-production-anchor': false,
      settings: { 'refresh-enabled': false, 'icao-crls-allowed': false },
      sources: [],
      countries: [],
      'withdrawn-anchors': [],
      crls: [],
      'sandbox-anchors': [],
    };
    expect(dashboardTrustAnchorsSchema.parse(empty)).toEqual(empty);
  });

  it.each([
    ['an unknown member', 'verdict', 'trusted'],
    ['a list digest that is not SHA-256 hex', 'sources.0.list-sha256', 'ABC'],
    ['a source id that is not a slug', 'sources.0.id', 'BSI DE'],
    ['a sync outcome outside the list', 'sources.0.last-sync.outcome', 'skipped'],
    ['a sync reason that is not a code', 'sources.0.last-sync.reason', 'The list was older'],
    ['a negative count', 'countries.0.anchors', -1],
    ['a country that is not two capitals', 'countries.0.country', 'DEU'],
    ['an anchor id that is not SHA-256 hex', 'withdrawn-anchors.0.id', 'deadbeef'],
    ['a CRL key id that is not hex', 'crls.0.issuer-key-id', 'not-hex'],
    ['a CRL freshness outside the list', 'crls.1.freshness', 'stale'],
    ['a timestamp that is not ISO 8601', 'sandbox-anchors.0.not-after', '22/10/2036'],
    ['an unknown member of a source', 'sources.1.url', 'https://example.test/list'],
    ['a setting that is not a boolean', 'settings.refresh-enabled', 'yes'],
    ['an unknown setting', 'settings.mirror', true],
    ['no settings', 'settings', undefined],
  ])('refuses %s', (_label, path, value) => {
    expect(dashboardTrustAnchorsSchema.safeParse(patched(golden(), path, value)).success).toBe(
      false,
    );
  });
});
