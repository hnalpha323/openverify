/**
 * C93.2 (Workflow 7A, F15): the network evaluation of a session's address, called by
 * `recordSessionStart` (`services/inquiry-sessions.ts`) in the transaction that records the first
 * flow call, once per session (the call that wins `markInquirySessionStarted`).
 *
 * Owner: `api-network` (Stage 3). It folds IPv4-mapped IPv6 to IPv4, records how the address was
 * resolved (C93.1: socket, trusted list, hop count, `trust-all`), evaluates it against the
 * snapshots the environment kind may read (a pure call under 1 ms; production never reads the
 * sandbox source) and the bound `ipReputation`, and writes the `networks` row and the session's
 * network facts with their reasons and provenance (`recordSessionNetworkEvaluation`). It tells the
 * private-peer watch about each production session. Nothing it logs carries the address (C93.7).
 *
 * Honesty (C90.3, ADR 0006): the evaluation is `@openverify/signals/network`'s pure
 * `evaluateNetwork`, which gives every `null` fact one reason from the frozen enum and never a
 * `false` for an unknown. The ASN seeds missing make the ASN flags `list_unavailable`; an adapter
 * that cannot answer is read as no adapter (`provider_not_configured`). An address that does not
 * parse (none should: it is Fastify's `request.ip`) writes nothing, so the session reads not
 * evaluated, and the start still commits: nothing here throws for an address.
 */
import { NETWORK_SIGNAL_CONSTANTS } from '@openverify/core';
import {
  getEnvironment,
  recordSessionNetworkEvaluation,
  type Db,
  type NetworkFacts,
} from '@openverify/db';
import {
  evaluateNetwork,
  networkLookupRules,
  parseAddress,
  type IpReputationAnswer,
  type NetworkEvaluation,
  type NetworkSourceRef,
} from '@openverify/signals/network';
import type { TrustProxySetting } from '../operator-auth/settings.js';
import type { EnvironmentKind, IdGenerator, NetworkSnapshots, ProviderBindings } from '../ports.js';
import { loadAsnData, type AsnData } from './asn-data.js';
import type { PrivatePeerWatch } from './private-peers.js';
import type { WorkerLogger } from '../jobs/logger.js';
import { networkSourceSnapshots } from './snapshots.js';

/** What the evaluation reads; the API process builds it once (`container.ts`). */
export interface SessionNetworkDeps {
  snapshots: NetworkSnapshots;
  /** The API's providers per environment kind: `ipReputation` among them (C93.5). */
  providers: ProviderBindings;
  /** `OPENVERIFY_TRUST_PROXY`, from which the network's `client-address-source` follows. */
  trustProxy: TrustProxySetting;
  privatePeers: PrivatePeerWatch;
  ids: IdGenerator;
  /** K7A-10: what wrote nothing leaves a trace, by the error's name only (C93.7). */
  logger: Pick<WorkerLogger, 'warn'>;
  /** The pinned ASN seeds with the overrides; `loadAsnData()` by default (tests pass their own). */
  asnData?: (() => AsnData) | undefined;
}

/** C93.1 (P05): how the API resolved the address, from `OPENVERIFY_TRUST_PROXY`. */
export function clientAddressSourceOf(
  trustProxy: TrustProxySetting,
): 'socket' | 'trusted-list' | 'hop-count' | 'trust-all' {
  if (trustProxy === true) {
    return 'trust-all';
  }
  if (typeof trustProxy === 'number') {
    return 'hop-count';
  }
  return Array.isArray(trustProxy) ? 'trusted-list' : 'socket';
}

/** The session being started. */
export interface SessionToEvaluate {
  id: string;
  environmentId: string;
  inquiryId: string;
}

const RULES = networkLookupRules(NETWORK_SIGNAL_CONSTANTS);

/** C90.3 provenance, in the contracts' `signalSourceSchema` form. */
function sourceRecord(ref: NetworkSourceRef): Record<string, unknown> {
  return ref.kind === 'sync'
    ? {
        kind: 'sync',
        'source-id': ref.sourceId,
        'sync-id': ref.syncId,
        'published-at': ref.publishedAt.toISOString(),
        sha256: ref.sha256,
      }
    : { kind: 'provider', provider: ref.provider, sandbox: ref.sandbox };
}

/** The facts the repository writes, from one evaluation (C93.3). */
export function networkFactsOf(evaluation: NetworkEvaluation): NetworkFacts {
  const { facts } = evaluation;
  const point = facts.location.value;
  const regionCode = facts['region-code'].value;
  const location =
    point === null && regionCode === null && evaluation.regionName === null
      ? null
      : {
          regionCode,
          regionName: evaluation.regionName,
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
        };
  const hostingAsn = facts['hosting-asn'].value;
  return {
    isTor: facts['is-tor'].value,
    isDatacenter: facts['is-datacenter'].value,
    isVpn: facts['is-vpn'].value,
    isProxy: facts['is-proxy'].value,
    hostingAsn,
    hostingAsnConfidence: hostingAsn === true ? facts['hosting-asn'].confidence : null,
    privacyRelay: facts['privacy-relay'].value,
    threatLevel: facts['threat-level'].value,
    countryCode: facts['country-code'].value,
    countryName: evaluation.countryName,
    location: location,
    asn: facts.asn.value,
    organization: evaluation.asnOrganization,
    // H13: the public datacenter fields come from provider ranges only.
    serviceType: facts['is-datacenter'].value === true ? 'datacenter' : null,
    proxyType: evaluation.proxyType,
    ipConnectionType: evaluation.ipConnectionType,
  };
}

/** The pure part of the evaluation: the snapshots, the adapter, the seeds and the lookups. */
function evaluateOnce(
  deps: SessionNetworkDeps,
  kind: EnvironmentKind,
  address: string,
  clientAddressSource: ReturnType<typeof clientAddressSourceOf>,
  at: Date,
): NetworkEvaluation {
  const adapter = deps.providers[kind].ipReputation;
  let ipReputation: IpReputationAnswer | null = null;
  if (adapter !== undefined) {
    try {
      ipReputation = { provider: adapter.id, sandbox: adapter.sandbox, ...adapter.lookup(address) };
    } catch (error) {
      deps.logger.warn({ error: (error as Error).name }, 'ip reputation lookup failed');
      ipReputation = null;
    }
  }
  const asn = (deps.asnData ?? (() => loadAsnData()))();
  return evaluateNetwork({
    address,
    environment: kind,
    clientAddressSource,
    sources: networkSourceSnapshots(
      deps.snapshots.current(kind),
      kind,
      at,
      undefined,
      deps.snapshots.unloaded?.(kind),
    ),
    asnSets: asn.status === 'loaded' ? asn.sets : null,
    ipReputation,
    rules: RULES,
  });
}

/**
 * C93.2: evaluates the session's address in `tx` and writes its network; returns the network's
 * id, or `null` when nothing was written (an address that does not parse, or a session already
 * evaluated, whose facts are frozen).
 */
export async function evaluateSessionNetworkInTx(
  tx: Db,
  deps: SessionNetworkDeps,
  session: SessionToEvaluate,
  client: { ip: string },
  at: Date,
): Promise<{ networkId: string } | null> {
  const parsed = parseAddress(client.ip);
  if (parsed === null) {
    deps.logger.warn({ error: 'AddressParseError' }, 'session address does not parse');
    return null;
  }
  const environment = await getEnvironment(tx, session.environmentId);
  if (environment === null) {
    return null;
  }
  const kind = environment.kind;
  const clientAddressSource = clientAddressSourceOf(deps.trustProxy);
  let evaluation: NetworkEvaluation;
  try {
    evaluation = evaluateOnce(deps, kind, parsed.text, clientAddressSource, at);
  } catch (error) {
    // A failure of the evaluation itself (unreadable snapshots, a missing manifest) leaves the
    // session not evaluated; it never fails the start (foundation-7a amendment (N) 7).
    deps.logger.warn({ error: (error as Error).name }, 'session network evaluation failed');
    return null;
  }
  deps.privatePeers.observe({
    environmentKind: kind,
    addressIsPrivate: evaluation.addressClass === 'not_public',
  });
  const network = await recordSessionNetworkEvaluation(tx, session.environmentId, {
    id: deps.ids.newId('net'),
    inquirySessionId: session.id,
    ip: evaluation.address.text,
    clientAddressSource,
    evaluatedAt: at,
    facts: networkFactsOf(evaluation),
    reasons: evaluation.reasons,
    sources: evaluation.sources.map(sourceRecord),
  });
  return network === null ? null : { networkId: network.id };
}
