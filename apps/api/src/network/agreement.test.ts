/**
 * The two halves of C93 meet in the API, which depends on both packages (network-data's
 * followups): the network evaluation's reasons are the contracts' frozen enums, its fields are
 * the contracts' fact fields, and its session threat level (`@openverify/signals/network`) agrees
 * with the one `@openverify/checks` computes from stored facts, on every C93.6 sandbox golden.
 * Pins written after both implementations: they guard the two from drifting apart.
 */
import { NETWORK_SIGNAL_CONSTANTS } from '@openverify/core';
import { sessionThreatLevel } from '@openverify/checks';
import {
  NETWORK_FACT_FIELDS as CONTRACT_FACT_FIELDS,
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
} from '@openverify/contracts';
import {
  NETWORK_EVIDENCE_REASONS,
  NETWORK_FACT_FIELDS,
  NETWORK_NULL_REASONS,
  SandboxNetwork,
  evaluateNetwork,
  networkLookupRules,
  parseAddress,
} from '@openverify/signals/network';
import { sandboxNetworkBundle } from '@openverify/signals/testing';
import { describe, expect, it } from 'vitest';

describe('the network vocabularies are the contracts’', () => {
  it('uses only frozen null and evidence reasons, and the same fact fields', () => {
    expect(SIGNAL_NULL_REASONS).toEqual(expect.arrayContaining([...NETWORK_NULL_REASONS]));
    expect(SIGNAL_EVIDENCE_REASONS).toEqual(expect.arrayContaining([...NETWORK_EVIDENCE_REASONS]));
    expect([...NETWORK_FACT_FIELDS]).toEqual([...CONTRACT_FACT_FIELDS]);
  });
});

describe('the session threat level agrees with signal-logic’s (C93.4)', () => {
  const bundle = SandboxNetwork.parse(sandboxNetworkBundle());
  const sources = [
    {
      sourceId: 'openverify-sandbox-network',
      role: 'sandbox' as const,
      sandboxOnly: true,
      freshness: 'fresh' as const,
      provenance: {
        syncId: '1',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        sha256: 'a'.repeat(64),
      },
      snapshot: bundle,
    },
  ];

  it.each([
    ['192.0.2.10', false],
    ['192.0.2.20', false],
    ['192.0.2.30', false],
    ['192.0.2.40', true],
    ['192.0.2.40', false],
    ['192.0.2.50', false],
    ['198.51.100.7', false],
    ['203.0.113.7', true],
    ['2001:db8::7', false],
    ['10.0.0.1', false],
  ])('on %s (adapter bound: %s)', (address, adapterBound) => {
    const parsed = parseAddress(address);
    const answer = parsed === null ? null : bundle.ipReputation(parsed);
    const evaluation = evaluateNetwork({
      address,
      environment: 'sandbox',
      clientAddressSource: 'trusted-list',
      sources,
      asnSets: null,
      ipReputation:
        adapterBound && answer !== null
          ? { provider: 'sandbox', sandbox: true, ...answer, connectionType: null }
          : null,
      rules: networkLookupRules(NETWORK_SIGNAL_CONSTANTS),
    });
    const { facts } = evaluation;
    const stored = sessionThreatLevel({
      isTor: facts['is-tor'].value,
      isDatacenter: facts['is-datacenter'].value,
      isVpn: facts['is-vpn'].value,
      isProxy: facts['is-proxy'].value,
      hostingAsn: facts['hosting-asn'].value,
      reasons: evaluation.reasons.map(({ field, reason }) => ({ field, reason })),
    });
    const fact = facts['threat-level'];
    expect({ level: stored.level, nullReason: stored.nullReason }).toEqual({
      level: fact.value,
      nullReason: fact.nullReason,
    });
    if (fact.value !== null && fact.value !== 'low') {
      expect(stored.confidence).toBe(fact.confidence);
    }
  });
});
