/**
 * Networks and the session's network facts (plan C91.1, C91.3, C93): one `network` (`net_`) row per
 * evaluation of a session's address, reached only as the session's relationship and through
 * `include` (no `networks` path, as in the public API), and the network attributes the session
 * itself serves.
 *
 * Honesty (C90.3, C93.3, H13): `is-datacenter`, `is-vpn` and `hosting-asn` are `true` or `null`,
 * never `false`, because the lists are not exhaustive; `is-tor` is `false` only for a public IPv4
 * address checked against a fresh exit list, and `is-proxy` only when a bound adapter's file
 * records a negative. The public datacenter fields (`is-datacenter`, `ip-connection-type`, the
 * network's `service-type`) come from provider ranges only; a hosting-ASN hit reaches only our
 * own `hosting-asn`. The network's `threat-level` uses the public `unknown` where the session uses
 * `null`.
 *
 * PII (C91.6): the address, the region and the point; country, ASN and the flags are derived facts
 * without the address and stay after redaction (C91.4).
 */
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { inquirySessionIdentifierSchema } from './identifiers.js';
import {
  resourceWithRelationshipsSchema,
  timestampSchema,
  toTimestamp,
  toOneRelationshipSchema,
} from './json-api.js';
import {
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
  signalSourceSchema,
  type SignalSource,
} from './signals.js';

/** Marks a member PII (C91.6): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

/** A client address as the API recorded it (C10): IPv4, IPv6 or IPv4-mapped IPv6. */
const addressSchema = z.string().min(1).max(64);

/** C93.4: the session's threat levels; the network adds the public `unknown`. */
export const SESSION_THREAT_LEVELS = ['low', 'medium', 'high'] as const;
export const NETWORK_THREAT_LEVELS = ['unknown', 'low', 'medium', 'high'] as const;

/**
 * C93.1 (P05): how the API resolved the address it judged: the socket (trust off), a trusted list
 * of addresses or ranges, a hop count, or `trust-all`, under which the client chose it.
 */
export const CLIENT_ADDRESS_SOURCES = ['socket', 'trusted-list', 'hop-count', 'trust-all'] as const;
export const clientAddressSourceSchema = z.enum(CLIENT_ADDRESS_SOURCES);
export type ClientAddressSource = z.infer<typeof clientAddressSourceSchema>;

/** A field of the network's facts, which a reason is about (C90.3). */
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

/** C90.3: one reason a network fact is `null` or carries a limit (the network's `reasons`). */
export const networkReasonSchema = z.strictObject({
  field: z.enum(NETWORK_FACT_FIELDS),
  reason: z.enum([...SIGNAL_NULL_REASONS, ...SIGNAL_EVIDENCE_REASONS]),
});
export type NetworkReason = z.infer<typeof networkReasonSchema>;

/** An AS number (RFC 6793: 32 bits). */
export const asnSchema = z.int().min(0).max(4_294_967_295);
/** A provider's or an adapter's open vocabulary value, such as `datacenter` or `tor`. */
const vocabulary = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/)
  .max(64);
const organisation = z.string().min(1).max(200);
const placeName = z.string().min(1).max(200);
const regionCode = z.string().min(1).max(16);

/**
 * C91.3: the network resource's attributes: the public ones, then ours (`asn`, `hosting-asn` with
 * its confidence, `privacy-relay`, `client-address-source`, `evaluated-at`, `reasons`, `sources`).
 */
export const networkAttributesSchema = z.strictObject({
  'created-at': timestampSchema,
  'ip-address': pii(addressSchema),
  /** The AS organisation (DB-IP ASN Lite). */
  'service-provider': organisation.nullable(),
  /** `datacenter` from provider ranges only, or an adapter's value; the vocabulary is open. */
  'service-type': vocabulary.nullable(),
  /** `tor`, `vpn`, an adapter's value, or `null`. */
  'proxy-type': vocabulary.nullable(),
  'threat-level': z.enum(NETWORK_THREAT_LEVELS),
  'country-code': countryCodeSchema.nullable(),
  'country-name': placeName.nullable(),
  'region-code': pii(regionCode),
  'region-name': pii(placeName),
  latitude: pii(z.number().min(-90).max(90)),
  longitude: pii(z.number().min(-180).max(180)),
  asn: asnSchema.nullable(),
  /** H, `beta` (H13): the ASN is in the hosting seeds less the overrides. */
  'hosting-asn': z.literal(true).nullable(),
  'hosting-asn-confidence': z.number().min(0).max(1).nullable(),
  /** C92.1: in Apple's Private Relay egress list, when that source is enabled; never raises a level. */
  'privacy-relay': z.literal(true).nullable(),
  'client-address-source': clientAddressSourceSchema,
  'evaluated-at': timestampSchema,
  reasons: z.array(networkReasonSchema).max(64),
  sources: z.array(signalSourceSchema).max(32),
});

export const networkRelationshipsSchema = z.strictObject({
  'inquiry-session': toOneRelationshipSchema(inquirySessionIdentifierSchema),
});

export const networkResourceSchema = resourceWithRelationshipsSchema(
  'network',
  'net',
  networkAttributesSchema,
  networkRelationshipsSchema,
);
export type NetworkResource = z.infer<typeof networkResourceSchema>;

/**
 * C91.1: the network facts an inquiry session serves (amending C10), all nullable. The flags follow
 * C93.3; `gps-*` are always `null` in Phase 7 (decision 9).
 */
export const SESSION_NETWORK_ATTRIBUTE_SHAPE = {
  'is-tor': z.boolean().nullable(),
  'is-datacenter': z.literal(true).nullable(),
  'is-vpn': z.literal(true).nullable(),
  'is-proxy': z.boolean().nullable(),
  'hosting-asn': z.literal(true).nullable(),
  'threat-level': z.enum(SESSION_THREAT_LEVELS).nullable(),
  'country-code': countryCodeSchema.nullable(),
  'country-name': placeName.nullable(),
  'region-code': pii(regionCode),
  'region-name': pii(placeName),
  latitude: pii(z.number().min(-90).max(90)),
  longitude: pii(z.number().min(-180).max(180)),
  'gps-latitude': z.null().meta({ pii: true }),
  'gps-longitude': z.null().meta({ pii: true }),
  'gps-precision': z.null(),
  'gps-country-code': z.null(),
  /** `datacenter` from provider ranges only, an adapter's value, or `null` (H13). */
  'ip-connection-type': vocabulary.nullable(),
  'ip-isp': organisation.nullable(),
  'network-organization': organisation.nullable(),
} as const;

/** The session's network facts as the API records them (C93.2). */
export interface SessionNetworkRecord {
  isTor: boolean | null;
  isDatacenter: true | null;
  isVpn: true | null;
  isProxy: boolean | null;
  hostingAsn: true | null;
  threatLevel: (typeof SESSION_THREAT_LEVELS)[number] | null;
  countryCode: string | null;
  countryName: string | null;
  /** `null` when unknown, masked or redacted. */
  regionCode: string | null;
  regionName: string | null;
  latitude: number | null;
  longitude: number | null;
  ipConnectionType: string | null;
  ipIsp: string | null;
  networkOrganization: string | null;
}

/** The session attributes of {@link SESSION_NETWORK_ATTRIBUTE_SHAPE}. */
export function sessionNetworkAttributes(record: SessionNetworkRecord): Record<string, unknown> {
  return {
    'is-tor': record.isTor,
    'is-datacenter': record.isDatacenter,
    'is-vpn': record.isVpn,
    'is-proxy': record.isProxy,
    'hosting-asn': record.hostingAsn,
    'threat-level': record.threatLevel,
    'country-code': record.countryCode,
    'country-name': record.countryName,
    'region-code': record.regionCode,
    'region-name': record.regionName,
    latitude: record.latitude,
    longitude: record.longitude,
    'gps-latitude': null,
    'gps-longitude': null,
    'gps-precision': null,
    'gps-country-code': null,
    'ip-connection-type': record.ipConnectionType,
    'ip-isp': record.ipIsp,
    'network-organization': record.networkOrganization,
  };
}

/** A network row as the builder takes it; PII members already masked or redacted. */
export interface NetworkRecord {
  id: string;
  inquirySessionId: string;
  createdAt: Date;
  evaluatedAt: Date;
  ipAddress: string | null;
  serviceProvider: string | null;
  serviceType: string | null;
  proxyType: string | null;
  threatLevel: (typeof NETWORK_THREAT_LEVELS)[number];
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  latitude: number | null;
  longitude: number | null;
  asn: number | null;
  hostingAsn: true | null;
  hostingAsnConfidence: number | null;
  privacyRelay: true | null;
  clientAddressSource: ClientAddressSource;
  reasons: readonly NetworkReason[];
  sources: readonly SignalSource[];
}

/**
 * Builds the network resource (C91.3).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildNetworkResource(record: NetworkRecord): NetworkResource {
  return networkResourceSchema.parse({
    type: 'network',
    id: record.id,
    attributes: {
      'created-at': toTimestamp(record.createdAt),
      'ip-address': record.ipAddress,
      'service-provider': record.serviceProvider,
      'service-type': record.serviceType,
      'proxy-type': record.proxyType,
      'threat-level': record.threatLevel,
      'country-code': record.countryCode,
      'country-name': record.countryName,
      'region-code': record.regionCode,
      'region-name': record.regionName,
      latitude: record.latitude,
      longitude: record.longitude,
      asn: record.asn,
      'hosting-asn': record.hostingAsn,
      'hosting-asn-confidence': record.hostingAsnConfidence,
      'privacy-relay': record.privacyRelay,
      'client-address-source': record.clientAddressSource,
      'evaluated-at': toTimestamp(record.evaluatedAt),
      reasons: record.reasons.map((reason) => ({ ...reason })),
      sources: record.sources.map((source) => ({ ...source })),
    },
    relationships: {
      'inquiry-session': {
        data: { type: 'inquiry-session', id: record.inquirySessionId },
      },
    },
  });
}

function piiMembers(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
    .map(([member]) => member);
}

/** C91.6, C107.5: every network and session-network attribute marked PII. */
export const PII_NETWORK_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    ...piiMembers(networkAttributesSchema.shape),
    ...piiMembers(SESSION_NETWORK_ATTRIBUTE_SHAPE),
  ]),
]);
