import { describe, expect, it } from 'vitest';
import type { NetworkReasonInput } from './inputs.js';
import { cleanNetwork } from './testing.js';
import { THREAT_LEVEL_RULES, sessionThreatLevel, type ThreatLevelFacts } from './threat-level.js';

const facts = (overrides: Partial<ThreatLevelFacts> = {}): ThreatLevelFacts => {
  const { isTor, isDatacenter, isVpn, isProxy, hostingAsn, reasons } = cleanNetwork();
  return { isTor, isDatacenter, isVpn, isProxy, hostingAsn, reasons, ...overrides };
};

/** Every fact null for the same reason, as api-network writes for a non-public address. */
const allNull = (reason: NetworkReasonInput['reason']): ThreatLevelFacts =>
  facts({
    isTor: null,
    reasons: (['is-tor', 'is-datacenter', 'is-vpn', 'is-proxy', 'hosting-asn'] as const).map(
      (field) => ({ field, reason }),
    ),
  });

describe('THREAT_LEVEL_RULES (C93.4)', () => {
  it('holds the table in the order it applies', () => {
    expect(THREAT_LEVEL_RULES).toEqual([
      { level: 'high', facts: ['is-tor', 'is-proxy'], when: 'any-true' },
      { level: 'medium', facts: ['is-vpn', 'is-datacenter', 'hosting-asn'], when: 'any-true' },
      {
        level: 'low',
        facts: ['is-tor', 'is-vpn', 'hosting-asn', 'is-datacenter'],
        when: 'all-evaluated-none-true',
      },
    ]);
  });
});

describe('sessionThreatLevel (C93.4, H04)', () => {
  it('golden: a default install, fresh lists, no adapter, nothing listed: low, capped at 0.5', () => {
    expect(sessionThreatLevel(facts())).toEqual({
      level: 'low',
      networkLevel: 'low',
      confidence: 0.5,
      reasons: ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
      nullReason: null,
      proxyEvaluated: false,
    });
  });

  it('golden: an adapter that answered raises the low cap to 0.8 and drops proxy_not_evaluated', () => {
    const answered = facts({
      reasons: facts().reasons.map((reason) =>
        reason.field === 'is-proxy'
          ? { field: 'is-proxy', reason: 'not_in_provider_data' }
          : reason,
      ),
    });
    expect(sessionThreatLevel(answered)).toMatchObject({
      level: 'low',
      confidence: 0.8,
      reasons: ['vpn_list_not_exhaustive'],
      proxyEvaluated: true,
    });
    expect(sessionThreatLevel(facts({ isProxy: false }))).toMatchObject({
      level: 'low',
      confidence: 0.8,
      proxyEvaluated: true,
    });
  });

  it('golden: a Tor exit is high', () => {
    expect(sessionThreatLevel(facts({ isTor: true }))).toEqual({
      level: 'high',
      networkLevel: 'high',
      confidence: 1,
      reasons: ['tor_exit_listed'],
      nullReason: null,
      proxyEvaluated: false,
    });
  });

  it("golden: the adapter's proxy flag is high", () => {
    expect(sessionThreatLevel(facts({ isProxy: true }))).toMatchObject({
      level: 'high',
      confidence: 1,
      reasons: ['proxy_flagged'],
      proxyEvaluated: true,
    });
  });

  it('golden: a provider range, a VPN ASN or a hosting ASN is medium, at its own confidence', () => {
    expect(sessionThreatLevel(facts({ isDatacenter: true }))).toMatchObject({
      level: 'medium',
      confidence: 1,
      reasons: ['provider_range'],
    });
    expect(sessionThreatLevel(facts({ isVpn: true }))).toMatchObject({
      level: 'medium',
      confidence: 0.6,
      reasons: ['vpn_asn'],
    });
    expect(sessionThreatLevel(facts({ hostingAsn: true }))).toMatchObject({
      level: 'medium',
      confidence: 0.5,
      reasons: ['hosting_asn'],
    });
    expect(sessionThreatLevel(facts({ isVpn: true, hostingAsn: true }))).toMatchObject({
      level: 'medium',
      confidence: 0.6,
      reasons: ['vpn_asn', 'hosting_asn'],
    });
  });

  it('golden: Tor beside a VPN ASN is high and names both', () => {
    expect(sessionThreatLevel(facts({ isTor: true, isVpn: true }))).toMatchObject({
      level: 'high',
      confidence: 1,
      reasons: ['tor_exit_listed', 'vpn_asn'],
    });
  });

  it.each([
    ['an IPv6 address (no IPv6 exits listed)', 'ipv6_not_covered'],
    ['a stale exit list', 'list_stale'],
    ['an exit list never synced', 'list_unavailable'],
  ] as const)('golden: is null (network unknown) for %s', (_label, reason) => {
    const unevaluated = facts({
      isTor: null,
      reasons: [...facts().reasons, { field: 'is-tor', reason }],
    });
    expect(sessionThreatLevel(unevaluated)).toEqual({
      level: null,
      networkLevel: 'unknown',
      confidence: null,
      reasons: [],
      nullReason: reason,
      proxyEvaluated: false,
    });
  });

  it('golden: is null when the ASN seeds are stale, naming the gap first', () => {
    const stale = facts({
      isTor: null,
      reasons: [
        { field: 'is-tor', reason: 'ipv6_not_covered' },
        { field: 'is-datacenter', reason: 'not_in_known_ranges' },
        { field: 'is-vpn', reason: 'list_stale' },
        { field: 'hosting-asn', reason: 'list_stale' },
      ],
    });
    expect(sessionThreatLevel(stale)).toMatchObject({ level: null, nullReason: 'list_stale' });
  });

  it('reads a null fact without its reason as a gap (list_unavailable)', () => {
    expect(sessionThreatLevel(facts({ reasons: [] }))).toMatchObject({
      level: null,
      nullReason: 'list_unavailable',
    });
  });

  it.each(['address_not_public', 'client_address_untrusted'] as const)(
    'golden: every fact null for %s gives null with that reason',
    (reason) => {
      expect(sessionThreatLevel(allNull(reason))).toMatchObject({
        level: null,
        networkLevel: 'unknown',
        nullReason: reason,
      });
    },
  );

  it('is medium for a listed VPN even when Tor could not be checked (the rule order)', () => {
    expect(
      sessionThreatLevel(
        facts({
          isTor: null,
          isVpn: true,
          reasons: [{ field: 'is-tor', reason: 'ipv6_not_covered' }],
        }),
      ),
    ).toMatchObject({ level: 'medium', reasons: ['vpn_asn'] });
  });
});
