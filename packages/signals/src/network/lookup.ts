/**
 * The session's network facts (plan C93.1, C93.3, C93.4): one pure evaluation of an address over
 * the in-memory snapshots, under a millisecond. Honesty (C90.3, ADR 0006):
 * - an unknown is `null` with one reason from the frozen enum, never `false`;
 * - `is-tor` is `false` only for a public IPv4 address against a fresh exit list, and `is-proxy`
 *   only for an adapter's recorded negative; `is-datacenter`, `is-vpn`, `hosting-asn` and
 *   `privacy-relay` are `true` or `null`;
 * - the public datacenter fields come from provider ranges only (H13); a hosting-ASN hit reaches
 *   only `hosting-asn`, with its confidence;
 * - a stale or unavailable source makes the facts it feeds `null` (`list_stale`,
 *   `list_unavailable`); a non-public address gives `address_not_public`; in production, the
 *   documentation ranges are not public and `trust-all` gives `client_address_untrusted`;
 * - the sandbox source is read only for documentation addresses in sandbox environments, so a
 *   production evaluation never names it (H26);
 * - every value names the sources it read (sync id, publication time, SHA-256) and an adapter's
 *   answer its provider and `sandbox`.
 *
 * The threat level (H, `beta`) follows C93.4 as `@openverify/checks`' `sessionThreatLevel` does:
 * `high` for Tor or a proxy flag, `medium` for a VPN ASN, a provider range or a hosting ASN, `low`
 * only when Tor, VPN, hosting and provider ranges were all evaluated, with its confidence capped
 * and its limits stated, and otherwise `null` with the first missing input's reason, a data gap
 * first. `privacy-relay` never raises it.
 */
import { parseAddress, type ParsedAddress } from './address.js';
import { classifyAddress, type AddressClass } from './address-class.js';
import type { AsnSets } from './asn-seeds.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet } from './interval-set.js';
import { MmdbSnapshot, lookupAsn, lookupCity, lookupCountry, type MmdbRole } from './mmdb.js';
import type { RangeAttributes } from './range-files.js';
import { SandboxNetwork } from './sandbox.js';
import type { NetworkSnapshot } from './snapshot.js';
import { TorExitSet } from './tor-exit-list.js';

/** The manifest roles (C92.1), and the sandbox bundle's own. */
export const NETWORK_SOURCE_ROLES = [
  'geo-country',
  'geo-city',
  'asn',
  'tor',
  'cloud-ranges',
  'relay',
  'sandbox',
] as const;
export type NetworkSourceRole = (typeof NETWORK_SOURCE_ROLES)[number];

/** The null reasons a network fact can carry (a subset of the contracts' `SIGNAL_NULL_REASONS`). */
export const NETWORK_NULL_REASONS = [
  'list_unavailable',
  'list_stale',
  'provider_not_configured',
  'not_in_known_ranges',
  'not_in_provider_data',
  'client_address_untrusted',
  'address_not_public',
  'ipv6_not_covered',
] as const;
export type NetworkNullReason = (typeof NETWORK_NULL_REASONS)[number];

/** The evidence reasons a network fact can carry (a subset of `SIGNAL_EVIDENCE_REASONS`). */
export const NETWORK_EVIDENCE_REASONS = [
  'tor_exit_listed',
  'provider_range',
  'hosting_asn',
  'vpn_asn',
  'proxy_flagged',
  'adapter_negative',
  'vpn_list_not_exhaustive',
  'proxy_not_evaluated',
  'approximate',
] as const;
export type NetworkEvidenceReason = (typeof NETWORK_EVIDENCE_REASONS)[number];

/** The facts a reason is about (the contracts' `NETWORK_FACT_FIELDS`). */
export const NETWORK_FACT_FIELDS = [
  'is-tor',
  'is-datacenter',
  'is-vpn',
  'is-proxy',
  'hosting-asn',
  'threat-level',
  'country-code',
  'region-code',
  'location',
  'asn',
  'privacy-relay',
] as const;
export type NetworkFactField = (typeof NETWORK_FACT_FIELDS)[number];

/** One loaded source, as the snapshot loader holds it. */
export interface NetworkSourceSnapshot {
  readonly sourceId: string;
  readonly role: NetworkSourceRole;
  readonly sandboxOnly: boolean;
  /** C92.4: from the last successful check; a sandbox source is never stale. */
  readonly freshness: 'fresh' | 'stale' | 'unavailable';
  /** The applied sync, or `null` before the first. */
  readonly provenance: {
    readonly syncId: string;
    readonly publishedAt: Date;
    readonly sha256: string;
  } | null;
  readonly snapshot: NetworkSnapshot | null;
}

/** C93.5: what the bound `ipReputation` adapter answered for the address. */
export interface IpReputationAnswer {
  readonly provider: string;
  readonly sandbox: boolean;
  /** `true` flagged, `false` a recorded negative, `null` not in the provider's data. */
  readonly value: boolean | null;
  readonly proxyType: string | null;
  readonly connectionType: string | null;
}

/** The constants the evaluation applies (all provisional; C93.3, C93.4). */
export interface NetworkLookupRules {
  readonly vpnAsnConfidence: number;
  readonly hostingAsnConfidence: number;
  readonly threatLowConfidenceCap: number;
  readonly threatLowConfidenceCapWithAdapter: number;
  /** C93.3, decision 11: an exit counts when seen within this many hours of the list's time. */
  readonly torExitWindowHours: number;
}

/** What one evaluation takes. */
export interface NetworkLookupInput {
  /** `request.ip` as Fastify resolved it (C93.1). */
  readonly address: string;
  readonly environment: 'sandbox' | 'production';
  readonly clientAddressSource: 'socket' | 'trusted-list' | 'hop-count' | 'trust-all';
  readonly sources: readonly NetworkSourceSnapshot[];
  /** The pinned ASN seeds less and plus the overrides, or `null` when the seeds were not fetched. */
  readonly asnSets: AsnSets | null;
  /** The bound adapter's answer, or `null` when no adapter is bound. */
  readonly ipReputation: IpReputationAnswer | null;
  readonly rules: NetworkLookupRules;
}

/** One fact with its reasons. */
export interface NetworkFact<Value> {
  readonly value: Value | null;
  readonly nullReason: NetworkNullReason | null;
  readonly reasons: readonly NetworkEvidenceReason[];
  /** H-tier facts only (`is-vpn`, `hosting-asn`, `threat-level`); `null` otherwise. */
  readonly confidence: number | null;
}

/** A source a value read (C90.3 provenance; the contracts' `signalSourceSchema`, camel-cased). */
export type NetworkSourceRef =
  | {
      readonly kind: 'sync';
      readonly sourceId: string;
      readonly syncId: string;
      readonly publishedAt: Date;
      readonly sha256: string;
    }
  | { readonly kind: 'provider'; readonly provider: string; readonly sandbox: boolean };

/** C93.4: which inputs counted as evaluated. */
export interface ThreatInputs {
  readonly tor: boolean;
  readonly vpn: boolean;
  readonly hosting: boolean;
  readonly providerRanges: boolean;
  readonly proxy: boolean;
}

/** The evaluation of one address. */
export interface NetworkEvaluation {
  readonly address: ParsedAddress;
  readonly addressClass: AddressClass;
  readonly facts: {
    readonly 'is-tor': NetworkFact<boolean>;
    readonly 'is-datacenter': NetworkFact<true>;
    readonly 'is-vpn': NetworkFact<true>;
    readonly 'is-proxy': NetworkFact<boolean>;
    readonly 'hosting-asn': NetworkFact<true>;
    readonly 'threat-level': NetworkFact<'low' | 'medium' | 'high'>;
    readonly 'country-code': NetworkFact<string>;
    readonly 'region-code': NetworkFact<string>;
    readonly location: NetworkFact<{ readonly latitude: number; readonly longitude: number }>;
    readonly asn: NetworkFact<number>;
    readonly 'privacy-relay': NetworkFact<true>;
  };
  readonly countryName: string | null;
  readonly regionName: string | null;
  readonly cityName: string | null;
  readonly asnOrganization: string | null;
  /** The provider ranges that hold the address (H13: the only source of the datacenter fields). */
  readonly providerRanges: readonly RangeAttributes[];
  /** `datacenter` from provider ranges, else the adapter's connection type, else `null`. */
  readonly ipConnectionType: string | null;
  /** `tor`, `vpn`, the adapter's proxy type, or `null`. */
  readonly proxyType: string | null;
  readonly evaluated: ThreatInputs;
  /** Every fact's null or evidence reasons, in field order (the network's `reasons`). */
  readonly reasons: readonly {
    readonly field: NetworkFactField;
    readonly reason: NetworkNullReason | NetworkEvidenceReason;
  }[];
  /** Every source read, the adapter last. */
  readonly sources: readonly NetworkSourceRef[];
}

const RULE_KEYS = {
  vpnAsnConfidence: 'vpn-asn-confidence',
  hostingAsnConfidence: 'hosting-asn-confidence',
  threatLowConfidenceCap: 'threat-low-confidence-cap',
  threatLowConfidenceCapWithAdapter: 'threat-low-confidence-cap-with-adapter',
} as const;

/**
 * The rules from the core registry's `NETWORK_SIGNAL_CONSTANTS` (or any table of the same keys),
 * which the caller passes: this package has no runtime dependency on core.
 * @throws {RangeError} for a missing or non-numeric constant.
 */
export function networkLookupRules(
  constants: Readonly<Record<string, { readonly value: unknown }>>,
): NetworkLookupRules {
  const read = (key: string): number => {
    const value = constants[key]?.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`the network constant ${key} is not a confidence from 0 to 1`);
    }
    return value;
  };
  const torExitWindowHours = constants['tor-exit-window-hours']?.value;
  if (
    typeof torExitWindowHours !== 'number' ||
    !Number.isFinite(torExitWindowHours) ||
    torExitWindowHours <= 0
  ) {
    throw new RangeError('the Tor window is a positive number of hours');
  }
  return {
    vpnAsnConfidence: read(RULE_KEYS.vpnAsnConfidence),
    hostingAsnConfidence: read(RULE_KEYS.hostingAsnConfidence),
    threatLowConfidenceCap: read(RULE_KEYS.threatLowConfidenceCap),
    threatLowConfidenceCapWithAdapter: read(RULE_KEYS.threatLowConfidenceCapWithAdapter),
    torExitWindowHours,
  };
}

// ---------------------------------------------------------------------------------------------
// Sources by role

type DataRole = Exclude<NetworkSourceRole, 'sandbox'>;
const DATA_ROLES: readonly DataRole[] = [
  'tor',
  'cloud-ranges',
  'asn',
  'geo-country',
  'geo-city',
  'relay',
];
const MMDB_ROLE: Readonly<Partial<Record<DataRole, MmdbRole>>> = {
  asn: 'asn',
  'geo-country': 'country',
  'geo-city': 'city',
};

interface Readable {
  readonly ref: NetworkSourceRef;
  readonly snapshot: NetworkSnapshot;
}

interface RoleView {
  readonly fresh: readonly Readable[];
  /** Why the role's facts are `null` when no fresh source answers. */
  readonly missing: 'list_stale' | 'list_unavailable';
  /**
   * Whether every source of the role is readable. When one is not, its gap holds beside a fresh
   * sibling too: only a hit can be read, never "not listed" (R002, ADR 0006).
   */
  readonly complete: boolean;
}

interface Context {
  readonly views: Readonly<Record<DataRole, RoleView>>;
  readonly asnSets: AsnSets | null;
}

function syncRef(source: NetworkSourceSnapshot): NetworkSourceRef | null {
  return source.provenance === null
    ? null
    : {
        kind: 'sync',
        sourceId: source.sourceId,
        syncId: source.provenance.syncId,
        publishedAt: source.provenance.publishedAt,
        sha256: source.provenance.sha256,
      };
}

function fits(role: DataRole, snapshot: NetworkSnapshot): boolean {
  const mmdbRole = MMDB_ROLE[role];
  if (mmdbRole !== undefined) {
    return snapshot instanceof MmdbSnapshot && snapshot.role === mmdbRole;
  }
  return role === 'tor' ? snapshot instanceof TorExitSet : snapshot instanceof IntervalSet;
}

/** The public sources: every source but the sandbox's, grouped by role. */
function publicContext(input: NetworkLookupInput): Context {
  const views = {} as Record<DataRole, RoleView>;
  for (const role of DATA_ROLES) {
    const own = input.sources.filter((source) => !source.sandboxOnly && source.role === role);
    const fresh: Readable[] = [];
    for (const source of own) {
      const ref = syncRef(source);
      if (
        source.freshness === 'fresh' &&
        source.snapshot !== null &&
        ref !== null &&
        fits(role, source.snapshot)
      ) {
        fresh.push({ ref, snapshot: source.snapshot });
      }
    }
    views[role] = {
      fresh,
      missing: own.some((source) => source.freshness === 'stale')
        ? 'list_stale'
        : 'list_unavailable',
      complete: fresh.length === own.length,
    };
  }
  return { views, asnSets: input.asnSets };
}

/** C93.6: the sandbox source alone, for documentation addresses in sandbox environments. */
function sandboxContext(input: NetworkLookupInput): Context {
  const found = input.sources.find(
    (source) =>
      source.sandboxOnly &&
      // C92.4: a sandbox source is never stale.
      source.freshness !== 'unavailable' &&
      source.snapshot instanceof SandboxNetwork &&
      source.provenance !== null,
  );
  const ref = found === undefined ? null : syncRef(found);
  const sandbox = found?.snapshot;
  const views = {} as Record<DataRole, RoleView>;
  for (const role of DATA_ROLES) {
    if (ref === null || !(sandbox instanceof SandboxNetwork)) {
      views[role] = { fresh: [], missing: 'list_unavailable', complete: false };
      continue;
    }
    const snapshot: NetworkSnapshot = {
      tor: sandbox.tor,
      'cloud-ranges': sandbox.providerRanges,
      asn: sandbox.asn,
      'geo-country': sandbox.country,
      'geo-city': sandbox.city,
      relay: sandbox.relayRanges,
    }[role];
    views[role] = { fresh: [{ ref, snapshot }], missing: 'list_unavailable', complete: true };
  }
  return { views, asnSets: sandbox instanceof SandboxNetwork ? sandbox.asnSets : null };
}

/** The sources an evaluation read, each once, in the order it read them. */
class Readings {
  readonly refs: NetworkSourceRef[] = [];
  readonly #seen = new Set<string>();

  add(ref: NetworkSourceRef): void {
    const name =
      ref.kind === 'sync' ? `sync:${ref.sourceId}:${ref.syncId}` : `provider:${ref.provider}`;
    if (!this.#seen.has(name)) {
      this.#seen.add(name);
      this.refs.push(ref);
    }
  }

  /**
   * Asks every fresh source of a view. A source whose data breaks its format (`mmdb`) is skipped,
   * as unavailable, so a corrupt file never answers "not in the data". `reason` says no source
   * answered; `gap` says some did, but not all: an answer they gave can be read, and their silence
   * can not (R002).
   */
  consult<Answer>(
    view: RoleView,
    ask: (snapshot: NetworkSnapshot) => Answer,
  ): {
    readonly answers: Answer[];
    readonly reason: NetworkNullReason | null;
    readonly gap: NetworkNullReason | null;
  } {
    const answers: Answer[] = [];
    for (const { ref, snapshot } of view.fresh) {
      try {
        answers.push(ask(snapshot));
      } catch (error) {
        if (error instanceof NetworkParseError) {
          continue;
        }
        throw error;
      }
      this.add(ref);
    }
    if (answers.length === 0) {
      const reason = view.fresh.length === 0 ? view.missing : 'list_unavailable';
      return { answers, reason, gap: reason };
    }
    const gap = !view.complete
      ? view.missing
      : answers.length < view.fresh.length
        ? 'list_unavailable'
        : null;
    return { answers, reason: null, gap };
  }
}

// ---------------------------------------------------------------------------------------------
// Facts

type Facts = NetworkEvaluation['facts'];

function fact<Value>(
  value: Value | null,
  nullReason: NetworkNullReason | null,
  reasons: readonly NetworkEvidenceReason[] = [],
  confidence: number | null = null,
): NetworkFact<Value> {
  return {
    value,
    nullReason: value === null ? nullReason : null,
    reasons: value === null ? [] : reasons,
    confidence,
  };
}

function nullFact<Value>(reason: NetworkNullReason): NetworkFact<Value> {
  return { value: null, nullReason: reason, reasons: [], confidence: null };
}

const GAP_REASONS: ReadonlySet<NetworkNullReason> = new Set([
  'list_stale',
  'list_unavailable',
  'provider_not_configured',
  'client_address_untrusted',
]);

type ThreatFact = 'is-tor' | 'is-proxy' | 'is-vpn' | 'is-datacenter' | 'hosting-asn';
/** C93.4: the facts in the order the table reads them, with each one's evidence reason. */
const THREAT_FACTS: readonly ThreatFact[] = [
  'is-tor',
  'is-proxy',
  'is-vpn',
  'is-datacenter',
  'hosting-asn',
];
const THREAT_REASON: Readonly<Record<ThreatFact, NetworkEvidenceReason>> = {
  'is-tor': 'tor_exit_listed',
  'is-proxy': 'proxy_flagged',
  'is-vpn': 'vpn_asn',
  'is-datacenter': 'provider_range',
  'hosting-asn': 'hosting_asn',
};
/** The null reason that still counts as evaluated (C93.4); Tor counts only with a value. */
const EVALUATED_WHEN_NULL: Readonly<Record<ThreatFact, NetworkNullReason | null>> = {
  'is-tor': null,
  'is-proxy': 'not_in_provider_data',
  'is-vpn': 'not_in_known_ranges',
  'is-datacenter': 'not_in_known_ranges',
  'hosting-asn': 'not_in_known_ranges',
};
const LOW_INPUTS: readonly ThreatFact[] = ['is-tor', 'is-vpn', 'hosting-asn', 'is-datacenter'];

function evaluatedFact(facts: Omit<Facts, 'threat-level'>, name: ThreatFact): boolean {
  const own = facts[name];
  return (
    own.value !== null || (own.nullReason !== null && own.nullReason === EVALUATED_WHEN_NULL[name])
  );
}

function threatLevel(
  facts: Omit<Facts, 'threat-level'>,
  rules: NetworkLookupRules,
): NetworkFact<'low' | 'medium' | 'high'> {
  const confidenceOf: Readonly<Record<ThreatFact, number>> = {
    'is-tor': 1,
    'is-proxy': 1,
    'is-vpn': rules.vpnAsnConfidence,
    'is-datacenter': 1,
    'hosting-asn': rules.hostingAsnConfidence,
  };
  const listed = THREAT_FACTS.filter((name) => facts[name].value === true);
  const reasons = listed.map((name) => THREAT_REASON[name]);
  for (const [level, inputs] of [
    ['high', ['is-tor', 'is-proxy']],
    ['medium', ['is-vpn', 'is-datacenter', 'hosting-asn']],
  ] as const) {
    const set = listed.filter((name) => (inputs as readonly ThreatFact[]).includes(name));
    if (set.length > 0) {
      return fact(level, null, reasons, Math.max(...set.map((name) => confidenceOf[name])));
    }
  }
  const missing = LOW_INPUTS.filter((name) => !evaluatedFact(facts, name)).map(
    (name) => facts[name].nullReason ?? 'list_unavailable',
  );
  if (missing.length > 0) {
    return nullFact(
      missing.find((reason) => GAP_REASONS.has(reason)) ?? missing[0] ?? 'list_unavailable',
    );
  }
  const proxyEvaluated = evaluatedFact(facts, 'is-proxy');
  return fact<'low' | 'medium' | 'high'>(
    'low',
    null,
    proxyEvaluated
      ? ['vpn_list_not_exhaustive']
      : ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
    proxyEvaluated ? rules.threatLowConfidenceCapWithAdapter : rules.threatLowConfidenceCap,
  );
}

function reasonsOf(facts: Facts): NetworkEvaluation['reasons'] {
  return NETWORK_FACT_FIELDS.flatMap((field) => {
    const own = facts[field];
    const reasons: readonly (NetworkNullReason | NetworkEvidenceReason)[] =
      own.nullReason !== null ? [own.nullReason] : own.reasons;
    return reasons.map((reason) => ({ field, reason }));
  });
}

function evaluatedOf(facts: Facts): ThreatInputs {
  return {
    tor: evaluatedFact(facts, 'is-tor'),
    vpn: evaluatedFact(facts, 'is-vpn'),
    hosting: evaluatedFact(facts, 'hosting-asn'),
    providerRanges: evaluatedFact(facts, 'is-datacenter'),
    proxy: evaluatedFact(facts, 'is-proxy'),
  };
}

/** Every fact `null` with one reason: a gate the address did not pass. */
function unevaluated(
  address: ParsedAddress,
  addressClass: AddressClass,
  reason: NetworkNullReason,
): NetworkEvaluation {
  const facts = Object.fromEntries(
    NETWORK_FACT_FIELDS.map((field) => [field, nullFact(reason)]),
  ) as unknown as Facts;
  return {
    address,
    addressClass,
    facts,
    countryName: null,
    regionName: null,
    cityName: null,
    asnOrganization: null,
    providerRanges: [],
    ipConnectionType: null,
    proxyType: null,
    evaluated: evaluatedOf(facts),
    reasons: reasonsOf(facts),
    sources: [],
  };
}

/**
 * Evaluates an address (C93.2: at the session's first successful flow call).
 * @throws {TypeError} when the address does not parse.
 */
export function evaluateNetwork(input: NetworkLookupInput): NetworkEvaluation {
  const address = parseAddress(input.address);
  if (address === null) {
    throw new TypeError('the client address does not parse');
  }
  return evaluateClassified(input, address, classifyAddress(address));
}

/** The evaluation for an address of a given class: the seam the tests drive with a public class. */
export function evaluateClassified(
  input: NetworkLookupInput,
  address: ParsedAddress,
  addressClass: AddressClass,
): NetworkEvaluation {
  if (input.environment === 'production' && input.clientAddressSource === 'trust-all') {
    return unevaluated(address, addressClass, 'client_address_untrusted');
  }
  if (
    addressClass === 'not_public' ||
    (addressClass === 'documentation' && input.environment === 'production')
  ) {
    return unevaluated(address, addressClass, 'address_not_public');
  }
  const { views, asnSets } =
    addressClass === 'documentation' ? sandboxContext(input) : publicContext(input);
  const { rules } = input;
  const readings = new Readings();

  // Tor (R): IPv4 only, as published.
  let isTor: NetworkFact<boolean>;
  if (address.family === 6) {
    isTor = nullFact('ipv6_not_covered');
  } else {
    const tor = readings.consult(views.tor, (snapshot) =>
      (snapshot as TorExitSet).listed(address.key, rules.torExitWindowHours),
    );
    const listed = tor.answers.some(Boolean);
    isTor = listed
      ? fact(true, null, ['tor_exit_listed'])
      : tor.gap !== null
        ? nullFact(tor.gap)
        : fact(false, null);
  }

  // Provider ranges (R): the only source of the public datacenter fields (H13).
  const cloud = readings.consult(views['cloud-ranges'], (snapshot) =>
    (snapshot as IntervalSet<RangeAttributes>).lookup(address.key),
  );
  const providerRanges = cloud.answers.flat();
  const isDatacenter: NetworkFact<true> =
    providerRanges.length > 0
      ? fact<true>(true, null, ['provider_range'])
      : nullFact(cloud.gap ?? 'not_in_known_ranges');

  // ASN (R lookup), then the H-tier seeds over it.
  const asnRead = readings.consult(views.asn, (snapshot) =>
    lookupAsn(snapshot as MmdbSnapshot, address),
  );
  const asnRecord = asnRead.answers.find((answer) => answer !== null) ?? null;
  const asn: NetworkFact<number> =
    asnRecord === null ? nullFact(asnRead.gap ?? 'not_in_known_ranges') : fact(asnRecord.asn, null);
  const seeded = (
    set: 'hosting' | 'vpn',
    reason: NetworkEvidenceReason,
    confidence: number,
  ): NetworkFact<true> => {
    if (asnSets === null) {
      return nullFact('list_unavailable');
    }
    if (asn.value === null) {
      return nullFact(asn.nullReason ?? 'list_unavailable');
    }
    return asnSets[set].has(asn.value)
      ? fact<true>(true, null, [reason], confidence)
      : nullFact('not_in_known_ranges');
  };
  const hostingAsn = seeded('hosting', 'hosting_asn', rules.hostingAsnConfidence);
  const isVpn = seeded('vpn', 'vpn_asn', rules.vpnAsnConfidence);

  // Proxy (A): the bound adapter's answer only.
  const reputation = input.ipReputation;
  let isProxy: NetworkFact<boolean>;
  if (reputation === null) {
    isProxy = nullFact('provider_not_configured');
  } else {
    readings.add({ kind: 'provider', provider: reputation.provider, sandbox: reputation.sandbox });
    isProxy =
      reputation.value === null
        ? nullFact('not_in_provider_data')
        : fact(reputation.value, null, [reputation.value ? 'proxy_flagged' : 'adapter_negative']);
  }

  // Country (R lookup, approximate): Country Lite, else City Lite's country.
  let countryRead = readings.consult(views['geo-country'], (snapshot) =>
    lookupCountry(snapshot as MmdbSnapshot, address),
  );
  if (countryRead.reason !== null) {
    const fromCity = readings.consult(views['geo-city'], (snapshot) =>
      lookupCountry(snapshot as MmdbSnapshot, address),
    );
    countryRead = fromCity.reason === null ? fromCity : countryRead;
  }
  const countryRecord = countryRead.answers.find((answer) => answer !== null) ?? null;
  const countryCode: NetworkFact<string> =
    countryRecord === null
      ? nullFact(countryRead.gap ?? 'not_in_known_ranges')
      : fact(countryRecord.code, null, ['approximate']);

  // Region and point (R lookup, approximate): City Lite only.
  const cityRead = readings.consult(views['geo-city'], (snapshot) =>
    lookupCity(snapshot as MmdbSnapshot, address),
  );
  const city = cityRead.answers.find((answer) => answer !== null) ?? null;
  const cityGap = cityRead.gap ?? 'not_in_known_ranges';
  const location: NetworkFact<{ latitude: number; longitude: number }> =
    city?.latitude != null && city.longitude !== null
      ? fact({ latitude: city.latitude, longitude: city.longitude }, null, ['approximate'])
      : nullFact(cityGap);
  const regionCode: NetworkFact<string> =
    city?.regionCode != null ? fact(city.regionCode, null, ['approximate']) : nullFact(cityGap);

  // Privacy relay (R): never raises the threat level.
  const relay = readings.consult(views.relay, (snapshot) =>
    (snapshot as IntervalSet<RangeAttributes>).has(address.key),
  );
  const privacyRelay: NetworkFact<true> = relay.answers.some(Boolean)
    ? fact<true>(true, null)
    : nullFact(relay.gap ?? 'not_in_known_ranges');

  const partial = {
    'is-tor': isTor,
    'is-datacenter': isDatacenter,
    'is-vpn': isVpn,
    'is-proxy': isProxy,
    'hosting-asn': hostingAsn,
    'country-code': countryCode,
    'region-code': regionCode,
    location,
    asn,
    'privacy-relay': privacyRelay,
  };
  const facts: Facts = { ...partial, 'threat-level': threatLevel(partial, rules) };
  // The adapter's source goes last, after every list read.
  const refs = [
    ...readings.refs.filter((ref) => ref.kind === 'sync'),
    ...readings.refs.filter((ref) => ref.kind === 'provider'),
  ];
  return {
    address,
    addressClass,
    facts,
    countryName: countryRecord?.name ?? null,
    regionName: city?.regionName ?? null,
    cityName: city?.cityName ?? null,
    asnOrganization: asnRecord?.organization ?? null,
    providerRanges,
    ipConnectionType:
      isDatacenter.value === true ? 'datacenter' : (reputation?.connectionType ?? null),
    proxyType:
      isTor.value === true
        ? 'tor'
        : isVpn.value === true
          ? 'vpn'
          : isProxy.value === true
            ? (reputation?.proxyType ?? 'proxy')
            : null,
    evaluated: evaluatedOf(facts),
    reasons: reasonsOf(facts),
    sources: refs,
  };
}

/** The session's network attributes (the contracts' `SessionNetworkRecord`, C91.1). */
export function sessionNetworkFacts(evaluation: NetworkEvaluation): {
  readonly isTor: boolean | null;
  readonly isDatacenter: true | null;
  readonly isVpn: true | null;
  readonly isProxy: boolean | null;
  readonly hostingAsn: true | null;
  readonly threatLevel: 'low' | 'medium' | 'high' | null;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly regionCode: string | null;
  readonly regionName: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly ipConnectionType: string | null;
  readonly ipIsp: string | null;
  readonly networkOrganization: string | null;
} {
  const { facts } = evaluation;
  return {
    isTor: facts['is-tor'].value,
    isDatacenter: facts['is-datacenter'].value,
    isVpn: facts['is-vpn'].value,
    isProxy: facts['is-proxy'].value,
    hostingAsn: facts['hosting-asn'].value,
    threatLevel: facts['threat-level'].value,
    countryCode: facts['country-code'].value,
    countryName: evaluation.countryName,
    regionCode: facts['region-code'].value,
    regionName: evaluation.regionName,
    latitude: facts.location.value?.latitude ?? null,
    longitude: facts.location.value?.longitude ?? null,
    ipConnectionType: evaluation.ipConnectionType,
    ipIsp: evaluation.asnOrganization,
    networkOrganization: evaluation.asnOrganization,
  };
}
