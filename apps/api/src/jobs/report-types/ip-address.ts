/**
 * C106.1 (Workflow 7A Stage 3, owner `api-network`): the `ip-address` report job, behind the frozen
 * `ReportTypeJob` of `jobs/report-types/index.ts`, over the same lookups as the session evaluation
 * (C93.3, C93.4; `evaluateNetwork` of `@openverify/signals/network`) and the worker's own network
 * snapshots (`ReportJobDeps.networkSnapshots`).
 *
 * - Review model `none`: `has-match` is always `false`; our `flagged` is true exactly when Tor, the
 *   VPN flag, the proxy flag or a provider-range datacenter is (decision 42).
 * - The public datacenter fields (`service-type` `DATACENTER`, `datacenter-ip`) come from provider
 *   ranges only; a hosting-ASN hit reaches only our `hosting-asn` (H13).
 * - `tor-exit-node` is `MATCHED` for a listed exit and `CLEARED` only for a public IPv4 address
 *   checked against a fresh exit list; otherwise `null`, listed in `unavailable-fields` with its
 *   C93 reason (H01). A stale or unavailable exit list ends the run `errored` (`list_stale` or
 *   `list_unavailable`, naming the source), keeping what it found: the run is never `ready` with
 *   Tor unchecked. Other stale sources leave their fields `null` and listed.
 * - A completion report of the session address (`inquiry_session`) is judged as the session was:
 *   its network row's `client-address-source`, so a production `trust-all` address reads
 *   `client_address_untrusted`. An address the API caller gave is not a client address
 *   (`client-address-source` `null`).
 * - Every field's tier, confidence (H only) and reasons are in `field-details`; the sources read
 *   carry their sync id, publication time, SHA-256, origin and attribution; the adapter that
 *   answered is the run's `provider`; the network constants applied are its `thresholds`.
 *
 * Nothing it logs carries the address (C93.7).
 */
import { NETWORK_SIGNAL_CONSTANTS } from '@openverify/core';
import {
  IP_ADDRESS_REPORT_NULL_CAUSES,
  ipAddressQuerySchema,
  REPORT_UNAVAILABLE_REASONS,
  type ClientAddressSource,
} from '@openverify/contracts';
import { firstInquiryNetwork, listNetworkSourceStates } from '@openverify/db';
import {
  evaluateNetwork,
  networkLookupRules,
  type IpReputationAnswer,
  type NetworkEvaluation,
  type NetworkFact,
} from '@openverify/signals/network';
import { loadAsnData } from '../../network/asn-data.js';
import { networkManifest, networkManifestSource } from '../../network/manifest.js';
import { networkSourceSnapshots } from '../../network/snapshots.js';
import type { ReportRunContext, ReportRunResult, ReportTypeJob, RunOutcome } from './job.js';
import { erroredResult } from './provider-reports.js';

type UnavailableReason = (typeof REPORT_UNAVAILABLE_REASONS)[number];
type ReportField = keyof typeof IP_ADDRESS_REPORT_NULL_CAUSES;

const REPORT_REASONS: ReadonlySet<string> = new Set(REPORT_UNAVAILABLE_REASONS);
const TOR_SOURCE = 'tor-exit-addresses';

/** ADR 0002 §3f: the network constants the evaluation applied (provisional, core's). */
function networkThresholds(): Record<string, number> {
  const thresholds: Record<string, number> = {};
  for (const [name, constant] of Object.entries(NETWORK_SIGNAL_CONSTANTS)) {
    if (typeof constant.value === 'number') {
      thresholds[name] = constant.value;
    }
  }
  return thresholds;
}

/**
 * C106.1 (V12): the report reason of a fact's null reason. The frozen table's reason when the
 * field lists it; otherwise the reason itself where the report vocabulary has it (a City Lite or
 * ASN Lite file without a record for the address: `not_in_known_ranges`).
 */
function reasonFor(field: ReportField, fact: NetworkFact<unknown>): UnavailableReason | null {
  const reason = fact.nullReason;
  if (reason === null) {
    return null;
  }
  const listed: readonly string[] = IP_ADDRESS_REPORT_NULL_CAUSES[field];
  return listed.includes(reason) || REPORT_REASONS.has(reason) ? reason : null;
}

/** C106.1: a field's tier, its confidence (H only) and its reasons. */
function detail(tier: 'R' | 'A' | 'H', fact: NetworkFact<unknown>): Record<string, unknown> {
  return tier === 'H'
    ? { tier, confidence: fact.value === null ? null : fact.confidence, reasons: [...fact.reasons] }
    : { tier, reasons: [...fact.reasons] };
}

/** The result attributes and their unavailable reasons, from one evaluation. */
function resultOf(
  evaluation: NetworkEvaluation,
  clientAddressSource: ClientAddressSource | null,
): { result: Record<string, unknown>; unavailable: ReportRunResult['unavailableFields'] } {
  const { facts } = evaluation;
  const tor = facts['is-tor'].value;
  const datacenter = facts['is-datacenter'].value;
  const vpn = facts['is-vpn'].value;
  const proxy = facts['is-proxy'].value;
  const point = facts.location.value;
  const values: Record<ReportField | 'mobile-ip', unknown> = {
    'tor-exit-node': tor === true ? 'MATCHED' : tor === false ? 'CLEARED' : null,
    'datacenter-ip': datacenter,
    'service-type': datacenter === true ? 'DATACENTER' : null,
    'vpn-detected': vpn,
    'proxy-detected': proxy,
    isp: evaluation.asnOrganization,
    'mobile-ip': null,
    'country-code': facts['country-code'].value,
    'country-name': evaluation.countryName,
    city: evaluation.cityName,
    region: evaluation.regionName,
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
  };
  const factOf: Record<ReportField, NetworkFact<unknown>> = {
    'tor-exit-node': facts['is-tor'],
    'datacenter-ip': facts['is-datacenter'],
    'service-type': facts['is-datacenter'],
    'vpn-detected': facts['is-vpn'],
    'proxy-detected': facts['is-proxy'],
    isp: facts.asn,
    'country-code': facts['country-code'],
    'country-name': facts['country-code'],
    city: facts.location,
    region: facts['region-code'],
    latitude: facts.location,
    longitude: facts.location,
  };
  const unavailable: { field: string; reason: UnavailableReason }[] = [];
  for (const field of Object.keys(factOf) as ReportField[]) {
    if (values[field] !== null) {
      continue;
    }
    const reason = reasonFor(field, factOf[field]) ?? reasonFor(field, facts['country-code']);
    unavailable.push({ field, reason: reason ?? 'undetermined' });
  }
  unavailable.push({ field: 'mobile-ip', reason: 'no_documented_method' });
  return {
    result: {
      ...values,
      flagged: tor === true || vpn === true || proxy === true || datacenter === true,
      'hosting-asn': facts['hosting-asn'].value,
      'client-address-source': clientAddressSource,
      'field-details': {
        'tor-exit-node': detail('R', facts['is-tor']),
        'datacenter-ip': detail('R', facts['is-datacenter']),
        'vpn-detected': detail('H', facts['is-vpn']),
        'proxy-detected': detail('A', facts['is-proxy']),
        'hosting-asn': detail('H', facts['hosting-asn']),
      },
    },
    unavailable,
  };
}

async function run(ctx: ReportRunContext): Promise<RunOutcome> {
  const query = ipAddressQuerySchema.safeParse(ctx.report.query);
  if (!query.success) {
    return { kind: 'completed', result: erroredResult('insufficient_input') };
  }
  const address = query.data['ip-address'];
  const { report, deps } = ctx;
  const kind = report.environmentKind;
  const now = deps.clock.now();

  // A session's address is judged as the session was (C93.1).
  let clientAddressSource: ClientAddressSource | null = null;
  if (report.querySources['ip-address'] === 'inquiry_session' && report.inquiryId !== null) {
    clientAddressSource =
      (await firstInquiryNetwork(deps.db, report.environmentId, report.inquiryId))
        ?.clientAddressSource ?? null;
  }

  const snapshots = deps.networkSnapshots?.current(kind) ?? [];
  const adapter = ctx.providers.ipReputation;
  let ipReputation: IpReputationAnswer | null = null;
  if (adapter !== undefined) {
    try {
      ipReputation = { provider: adapter.id, sandbox: adapter.sandbox, ...adapter.lookup(address) };
    } catch {
      ipReputation = null;
    }
  }
  const asn = loadAsnData();
  const evaluation = evaluateNetwork({
    address,
    environment: kind,
    clientAddressSource: clientAddressSource ?? 'socket',
    sources: networkSourceSnapshots(
      snapshots,
      kind,
      now,
      undefined,
      deps.networkSnapshots?.unloaded?.(kind),
    ),
    asnSets: asn.status === 'loaded' ? asn.sets : null,
    ipReputation,
    rules: networkLookupRules(NETWORK_SIGNAL_CONSTANTS),
  });
  const { result, unavailable } = resultOf(evaluation, clientAddressSource);

  const torReason = evaluation.facts['is-tor'].nullReason;
  const errors: ReportRunResult['errors'] =
    torReason === 'list_stale' || torReason === 'list_unavailable'
      ? [{ code: torReason, source: TOR_SOURCE }]
      : [];
  result.error = errors[0]?.code ?? null;

  const manifest = networkManifest();
  const origins = new Map(
    (await listNetworkSourceStates(deps.db)).map((state) => [state.id, state.lastOrigin]),
  );
  const checked = new Map(snapshots.map((snapshot) => [snapshot.sourceId, snapshot.checkedAt]));
  const sources = evaluation.sources.flatMap((ref) =>
    ref.kind === 'sync'
      ? [
          {
            sourceId: ref.sourceId,
            syncId: ref.syncId,
            publishedAt: ref.publishedAt,
            checkedAt: checked.get(ref.sourceId) ?? ref.publishedAt,
            sha256: ref.sha256,
            origin: origins.get(ref.sourceId) ?? 'publisher',
            attribution: networkManifestSource(ref.sourceId, manifest)?.attribution ?? ref.sourceId,
          },
        ]
      : [],
  );
  const answered = evaluation.sources.find((ref) => ref.kind === 'provider');
  return {
    kind: 'completed',
    result: {
      errors,
      sources,
      coverage: null,
      result,
      unavailableFields: unavailable,
      provider:
        answered?.kind === 'provider' ? { id: answered.provider, sandbox: answered.sandbox } : null,
      thresholds: networkThresholds(),
      notices: [],
      matcherVersion: null,
      matches: [],
    },
  };
}

export const ipAddressReportJob: ReportTypeJob = { type: 'ip-address', run };
