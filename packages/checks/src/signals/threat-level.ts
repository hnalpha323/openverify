/**
 * C93.4 (H, `beta`, ours; H04): a session's network threat level from its C93.3 facts, by
 * {@link THREAT_LEVEL_RULES}. The confidences and caps are `NETWORK_SIGNAL_CONSTANTS` in the core
 * signal registry (provisional).
 *
 * An input counts as **evaluated** when:
 * - `is-tor`: it is `true`, or `false` (only ever against a fresh IPv4 snapshot);
 * - VPN and hosting ASN: the lookup ran against fresh seeds, answering `true`, or `null` with
 *   `not_in_known_ranges`;
 * - provider ranges: the lookup ran against at least one fresh source, answering `true`, or
 *   `null` with `not_in_known_ranges`;
 * - proxy: a bound adapter answered, `true`, `false`, or `null` with `not_in_provider_data`.
 *
 * Levels, in order: `high` when `is-tor` or the adapter's proxy flag is `true`; `medium` when
 * `is-vpn`, `is-datacenter` or `hosting-asn` is `true`; `low` when Tor, VPN, hosting and provider
 * ranges were all evaluated and none is `true`, always with `vpn_list_not_exhaustive` and, without
 * an adapter's answer, `proxy_not_evaluated`, its confidence the cap (0.5 without an adapter, 0.8
 * with one); otherwise `null` on the session and `unknown` on the network, naming the reason of
 * the first input not evaluated, a data gap first. `privacy-relay` never raises the level.
 *
 * Confidence of `high` and `medium`: the highest confidence among the facts that set the level:
 * 1 for an exact listing (a Tor exit, a provider range, the adapter's flag), and the registry's
 * `vpn-asn-confidence` (0.6) or `hosting-asn-confidence` (0.5) for an ASN-level list.
 */
import { NETWORK_SIGNAL_CONSTANTS } from '@openverify/core';
import type { SessionNetworkInput } from './inputs.js';
import { constantValue, factNullReason, firstReason } from './network-facts.js';
import type { SignalEvidenceReason, SignalNullReason } from './vocabulary.js';

type ThreatFact = 'is-tor' | 'is-proxy' | 'is-vpn' | 'is-datacenter' | 'hosting-asn';

/** One row of the threat-level table. */
export interface ThreatLevelRule {
  readonly level: 'high' | 'medium' | 'low';
  /** `high` and `medium`: any of these facts `true`. `low`: every one of these evaluated, none true. */
  readonly facts: readonly ThreatFact[];
  readonly when: 'any-true' | 'all-evaluated-none-true';
}

const HIGH: ThreatLevelRule = Object.freeze({
  level: 'high',
  facts: Object.freeze(['is-tor', 'is-proxy'] as const),
  when: 'any-true',
});
const MEDIUM: ThreatLevelRule = Object.freeze({
  level: 'medium',
  facts: Object.freeze(['is-vpn', 'is-datacenter', 'hosting-asn'] as const),
  when: 'any-true',
});
const LOW: ThreatLevelRule = Object.freeze({
  level: 'low',
  facts: Object.freeze(['is-tor', 'is-vpn', 'hosting-asn', 'is-datacenter'] as const),
  when: 'all-evaluated-none-true',
});

/** C93.4: the threat-level table, in the order it applies. */
export const THREAT_LEVEL_RULES: readonly ThreatLevelRule[] = Object.freeze([HIGH, MEDIUM, LOW]);

/** The facts the threat level reads. */
export type ThreatLevelFacts = Pick<
  SessionNetworkInput,
  'isTor' | 'isDatacenter' | 'isVpn' | 'isProxy' | 'hostingAsn' | 'reasons'
>;

/** C93.4: a session's threat level with its confidence, reasons and the caps applied. */
export interface SessionThreatLevel {
  readonly level: 'low' | 'medium' | 'high' | null;
  /** The network resource's vocabulary: `unknown` where the session has `null`. */
  readonly networkLevel: 'unknown' | 'low' | 'medium' | 'high';
  readonly confidence: number | null;
  readonly reasons: readonly SignalEvidenceReason[];
  readonly nullReason: SignalNullReason | null;
  /** Whether a bound adapter answered for the proxy flag (it picks the low cap). */
  readonly proxyEvaluated: boolean;
}

/** Each fact's value, its evidence reason and its confidence when `true`. */
const FACTS: Readonly<
  Record<
    ThreatFact,
    {
      readonly value: (facts: ThreatLevelFacts) => boolean | null;
      readonly reason: SignalEvidenceReason;
      readonly confidence: () => number;
    }
  >
> = Object.freeze({
  'is-tor': { value: (facts) => facts.isTor, reason: 'tor_exit_listed', confidence: () => 1 },
  'is-proxy': { value: (facts) => facts.isProxy, reason: 'proxy_flagged', confidence: () => 1 },
  'is-vpn': {
    value: (facts) => facts.isVpn,
    reason: 'vpn_asn',
    confidence: () => constantValue(NETWORK_SIGNAL_CONSTANTS, 'vpn-asn-confidence'),
  },
  'is-datacenter': {
    value: (facts) => facts.isDatacenter,
    reason: 'provider_range',
    confidence: () => 1,
  },
  'hosting-asn': {
    value: (facts) => facts.hostingAsn,
    reason: 'hosting_asn',
    confidence: () => constantValue(NETWORK_SIGNAL_CONSTANTS, 'hosting-asn-confidence'),
  },
});

/** The null reason that still counts as evaluated, per fact (C93.4). */
const EVALUATED_WHEN_NULL: Readonly<Record<ThreatFact, SignalNullReason | null>> = Object.freeze({
  'is-tor': null,
  'is-proxy': 'not_in_provider_data',
  'is-vpn': 'not_in_known_ranges',
  'is-datacenter': 'not_in_known_ranges',
  'hosting-asn': 'not_in_known_ranges',
});

function evaluated(facts: ThreatLevelFacts, fact: ThreatFact): boolean {
  if (FACTS[fact].value(facts) !== null) {
    return true;
  }
  const counts = EVALUATED_WHEN_NULL[fact];
  return counts !== null && factNullReason(facts.reasons, fact) === counts;
}

/** C93.4: the threat level of one session's facts. */
export function sessionThreatLevel(facts: ThreatLevelFacts): SessionThreatLevel {
  const proxyEvaluated = evaluated(facts, 'is-proxy');
  const listed = (Object.keys(FACTS) as ThreatFact[]).filter(
    (fact) => FACTS[fact].value(facts) === true,
  );
  for (const rule of [HIGH, MEDIUM]) {
    const set = rule.facts.filter((fact) => listed.includes(fact));
    if (set.length > 0) {
      return {
        level: rule.level,
        networkLevel: rule.level,
        confidence: Math.max(...set.map((fact) => FACTS[fact].confidence())),
        reasons: listed.map((fact) => FACTS[fact].reason),
        nullReason: null,
        proxyEvaluated,
      };
    }
  }
  const missing = LOW.facts.filter((fact) => !evaluated(facts, fact));
  if (missing.length > 0) {
    return {
      level: null,
      networkLevel: 'unknown',
      confidence: null,
      reasons: [],
      nullReason: firstReason(missing.map((fact) => factNullReason(facts.reasons, fact))),
      proxyEvaluated,
    };
  }
  return {
    level: 'low',
    networkLevel: 'low',
    confidence: constantValue(
      NETWORK_SIGNAL_CONSTANTS,
      proxyEvaluated ? 'threat-low-confidence-cap-with-adapter' : 'threat-low-confidence-cap',
    ),
    reasons: proxyEvaluated
      ? ['vpn_list_not_exhaustive']
      : ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
    nullReason: null,
    proxyEvaluated,
  };
}
