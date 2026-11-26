/**
 * A session's network evaluation (plan C91.1, C91.3, C93.2; Workflow 7A): the `networks` row and
 * the session's own network facts, written together, once, in the session start's transaction.
 *
 * Owner: `api-network` (Stage 3), who builds the bodies of these stubs behind the signatures
 * `foundation-7a` declared in Stage 1b checkpoint (N). The address seals as `SEALED.networkIp`
 * and the location as `SEALED.networkLocation` (the network row) and
 * `SEALED.inquirySessionLocation` (the session), each for its own row id.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import type {
  CLIENT_ADDRESS_SOURCE_VALUES,
  NETWORK_THREAT_LEVEL_VALUES,
  NetworkLocation,
  SESSION_THREAT_LEVEL_VALUES,
} from '../schema.js';
import { openJson, openValue, sealJson, sealValue, type Sealed } from '../sealed.js';
import { dateOf, numberOf, rowsOf, stringOf, textArray, type Row } from './watchlist-rows.js';

export type NetworkThreatLevel = (typeof NETWORK_THREAT_LEVEL_VALUES)[number];
export type SessionThreatLevel = (typeof SESSION_THREAT_LEVEL_VALUES)[number];
export type ClientAddressSourceValue = (typeof CLIENT_ADDRESS_SOURCE_VALUES)[number];

/** C90.3: one reason a fact is `null` or carries a limit (`networkReasonSchema` in contracts). */
export interface NetworkFactReason {
  field: string;
  reason: string;
}

/**
 * The facts of one evaluation (C93.3). `true`-or-`null` flags never take `false` (the table's
 * checks refuse it); `isTor` and `isProxy` are `false` only where C93.3 says the data is
 * exhaustive.
 */
export interface NetworkFacts {
  isTor: boolean | null;
  isDatacenter: true | null;
  isVpn: true | null;
  isProxy: boolean | null;
  hostingAsn: true | null;
  hostingAsnConfidence: number | null;
  privacyRelay: true | null;
  /** The session's level; the network row stores `unknown` for `null`. */
  threatLevel: SessionThreatLevel | null;
  countryCode: string | null;
  countryName: string | null;
  location: NetworkLocation | null;
  asn: number | null;
  /** The AS organisation: the network's `service-provider`, the session's `ip-isp`. */
  organization: string | null;
  /** `datacenter` from provider ranges only, or an adapter's value. */
  serviceType: string | null;
  /** `tor`, `vpn`, an adapter's value, or `null`. */
  proxyType: string | null;
  /** The session's `ip-connection-type`. */
  ipConnectionType: string | null;
}

/** What `evaluateSessionNetworkInTx` writes for one session (C93.2). */
export interface NetworkEvaluationWrite {
  /** A new `net_` id. */
  id: string;
  inquirySessionId: string;
  /** The evaluated address, sealed for the network row. */
  ip: string;
  clientAddressSource: ClientAddressSourceValue;
  evaluatedAt: Date;
  facts: NetworkFacts;
  reasons: readonly NetworkFactReason[];
  /** C90.3 provenance (`signalSourceSchema` in contracts). */
  sources: readonly Record<string, unknown>[];
}

/** A `networks` row as the repositories return it: the address and location opened. */
export interface Network {
  id: string;
  environmentId: string;
  inquirySessionId: string;
  ip: string | null;
  location: NetworkLocation | null;
  serviceProvider: string | null;
  serviceType: string | null;
  proxyType: string | null;
  threatLevel: NetworkThreatLevel;
  countryCode: string | null;
  countryName: string | null;
  asn: number | null;
  hostingAsn: true | null;
  hostingAsnConfidence: number | null;
  privacyRelay: true | null;
  clientAddressSource: ClientAddressSourceValue;
  evaluatedAt: Date;
  reasons: NetworkFactReason[];
  sources: Record<string, unknown>[];
  createdAt: Date;
  updatedAt: Date;
}

const NETWORK_COLUMNS = sql`id, environment_id as "environmentId",
  inquiry_session_id as "inquirySessionId", ip, location, service_provider as "serviceProvider",
  service_type as "serviceType", proxy_type as "proxyType", threat_level as "threatLevel",
  country_code as "countryCode", country_name as "countryName", asn, hosting_asn as "hostingAsn",
  hosting_asn_confidence as "hostingAsnConfidence", privacy_relay as "privacyRelay",
  client_address_source as "clientAddressSource", evaluated_at as "evaluatedAt", reasons, sources,
  created_at as "createdAt", updated_at as "updatedAt"`;

const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

/** Opens the address and the location for the row, and drops the ciphertexts. */
function networkRow(row: Row): Network {
  const id = String(row.id);
  const ip = stringOf(row.ip);
  const location = stringOf(row.location);
  return {
    id,
    environmentId: String(row.environmentId),
    inquirySessionId: String(row.inquirySessionId),
    ip: ip === null ? null : openValue(SEALED.networkIp, id, ip as Sealed),
    location:
      location === null
        ? null
        : (openJson(SEALED.networkLocation, id, location as Sealed) as NetworkLocation),
    serviceProvider: stringOf(row.serviceProvider),
    serviceType: stringOf(row.serviceType),
    proxyType: stringOf(row.proxyType),
    threatLevel: String(row.threatLevel) as NetworkThreatLevel,
    countryCode: stringOf(row.countryCode),
    countryName: stringOf(row.countryName),
    asn: numberOf(row.asn),
    hostingAsn: row.hostingAsn === true ? true : null,
    hostingAsnConfidence: numberOf(row.hostingAsnConfidence),
    privacyRelay: row.privacyRelay === true ? true : null,
    clientAddressSource: String(row.clientAddressSource) as ClientAddressSourceValue,
    evaluatedAt: dateOf(row.evaluatedAt) ?? new Date(0),
    reasons: json(row.reasons) as NetworkFactReason[],
    sources: json(row.sources) as Record<string, unknown>[],
    createdAt: dateOf(row.createdAt) ?? new Date(0),
    updatedAt: dateOf(row.updatedAt) ?? new Date(0),
  };
}

/**
 * C93.2: writes the session's `networks` row and its network facts in `tx`, once: a session that
 * already has an evaluation keeps it (the frozen facts). Returns the row, or `null` when the
 * session already had one. The address seals as `SEALED.networkIp` and the location as
 * `SEALED.networkLocation` for the network row and `SEALED.inquirySessionLocation` for the session.
 */
export async function recordSessionNetworkEvaluation(
  tx: Db,
  environmentId: string,
  write: NetworkEvaluationWrite,
): Promise<Network | null> {
  const { facts } = write;
  const location = facts.location;
  const evaluatedAt = write.evaluatedAt.toISOString();
  const [row] = await rowsOf(
    tx,
    sql`insert into networks (id, environment_id, inquiry_session_id, ip, location,
          service_provider, service_type, proxy_type, threat_level, country_code, country_name, asn,
          hosting_asn, hosting_asn_confidence, privacy_relay, client_address_source, evaluated_at,
          reasons, sources)
        values (${write.id}, ${environmentId}, ${write.inquirySessionId},
          ${sealValue(SEALED.networkIp, write.id, write.ip)},
          ${location === null ? null : sealJson(SEALED.networkLocation, write.id, location)},
          ${facts.organization}, ${facts.serviceType}, ${facts.proxyType},
          ${facts.threatLevel ?? 'unknown'}, ${facts.countryCode}, ${facts.countryName},
          ${facts.asn}, ${facts.hostingAsn}, ${facts.hostingAsnConfidence}, ${facts.privacyRelay},
          ${write.clientAddressSource}, ${evaluatedAt}::timestamptz,
          ${JSON.stringify(write.reasons)}::jsonb, ${JSON.stringify(write.sources)}::jsonb)
        on conflict (environment_id, inquiry_session_id) do nothing
        returning ${NETWORK_COLUMNS}`,
  );
  if (row === undefined) {
    return null;
  }
  await tx.execute(sql`
    update inquiry_sessions
       set network_evaluated_at = ${evaluatedAt}::timestamptz, is_tor = ${facts.isTor},
           is_datacenter = ${facts.isDatacenter}, is_vpn = ${facts.isVpn},
           is_proxy = ${facts.isProxy}, hosting_asn = ${facts.hostingAsn},
           threat_level = ${facts.threatLevel}, country_code = ${facts.countryCode},
           country_name = ${facts.countryName},
           location = ${
             location === null
               ? null
               : sealJson(SEALED.inquirySessionLocation, write.inquirySessionId, location)
           },
           ip_connection_type = ${facts.ipConnectionType},
           network_organization = ${facts.organization}, updated_at = now()
     where environment_id = ${environmentId} and id = ${write.inquirySessionId}
       and network_evaluated_at is null`);
  return networkRow(row);
}

/**
 * C91.1: the network evaluations of `sessionIds` (for `?include=network` and the session's
 * `network` relationship), at most one per session, in session-id order.
 */
export async function listSessionNetworks(
  db: Db,
  environmentId: string,
  sessionIds: readonly string[],
): Promise<Network[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  return (
    await rowsOf(
      db,
      sql`select ${NETWORK_COLUMNS} from networks
           where environment_id = ${environmentId}
             and inquiry_session_id = any(${textArray(sessionIds)})
           order by inquiry_session_id`,
    )
  ).map(networkRow);
}

/**
 * C106.1: the first evaluated network of an inquiry's sessions (by `evaluated_at`, then id), the
 * address an `ip-address` completion report screens (`inquiry_session`); `null` without one.
 */
export async function firstInquiryNetwork(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<Network | null> {
  const [row] = await rowsOf(
    db,
    sql`select ${NETWORK_COLUMNS} from networks n
         where n.environment_id = ${environmentId}
           and n.inquiry_session_id in (
             select s.id from inquiry_sessions s
              where s.environment_id = ${environmentId} and s.inquiry_id = ${inquiryId})
         order by n.evaluated_at, n.id
         limit 1`,
  );
  return row === undefined ? null : networkRow(row);
}
