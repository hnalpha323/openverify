/**
 * Sessions, devices and network data in words (C91, C92, C93, C96, C108). A `null` fact reads
 * "not evaluated" or "unknown" with its reason, never "no". Each vocabulary's test iterates the
 * contracts' list first.
 */
import type {
  ClientAddressSource,
  HandoffMethod,
  NETWORK_FACT_FIELDS,
  SESSION_DEVICE_TYPES,
} from '@openverify/contracts';
import type { CollectorTier } from '@openverify/core';

export type NetworkFactField = (typeof NETWORK_FACT_FIELDS)[number];
export type SessionDeviceType = (typeof SESSION_DEVICE_TYPES)[number];

/** C93.3: the network facts, as their `reasons` name them. */
export const NETWORK_FACT_LABELS: Readonly<Record<NetworkFactField, string>> = Object.freeze({
  'is-tor': 'Tor exit',
  'is-datacenter': 'Cloud provider address',
  'is-vpn': 'VPN network',
  'is-proxy': 'Proxy',
  'hosting-asn': 'Hosting network',
  'threat-level': 'Threat level',
  'country-code': 'Country',
  'region-code': 'Region',
  location: 'Location',
  asn: 'Network (ASN)',
  'privacy-relay': 'Private relay',
});

/** C93.1 (P05): how the API resolved the address it judged. */
export const CLIENT_ADDRESS_SOURCE_WORDS: Readonly<Record<ClientAddressSource, string>> =
  Object.freeze({
    socket: 'The connection itself (no proxy trusted)',
    'trusted-list': 'Forwarded by a trusted proxy',
    'hop-count': 'Forwarded, counted by proxy hops',
    'trust-all': 'Any forwarded address: the client could choose it',
  });

/** C94.6: the collection tiers. */
export const COLLECTOR_TIER_LABELS: Readonly<Record<CollectorTier, string>> = Object.freeze({
  'session-integrity': 'Session integrity',
  'device-recognition': 'Device recognition',
});

export const SESSION_DEVICE_TYPE_LABELS: Readonly<Record<SessionDeviceType, string>> =
  Object.freeze({
    desktop: 'Desktop',
    smartphone: 'Smartphone',
    tablet: 'Tablet',
    tv: 'TV',
  });

/** C96.4: how a phone's session was reached; `qr` covers the QR and its copied link. */
export const HANDOFF_METHOD_LABELS: Readonly<Record<HandoffMethod, string>> = Object.freeze({
  qr: 'QR code or its link',
  email: 'Email',
  sms: 'SMS',
});

const SYNC_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  applied: 'Applied',
  unchanged: 'Unchanged (same publication)',
  busy: 'Skipped: another sync held the source',
  refused_rollback: 'Refused: older than the applied publication',
  refused_future: 'Refused: published in the future',
  refused_mass_removal: 'Refused: too much removed at once',
  refused_mass_addition: 'Refused: too much added at once',
  refused_schema: 'Refused: the file did not match its format',
  refused_size: 'Refused: the file is too large',
  refused_digest: "Refused: the publisher's digest did not match",
  error: 'Failed: the check could not finish',
});

const ERROR_CODES: Readonly<Record<string, string>> = Object.freeze({
  storage_not_configured: 'Not configured: this process has no object storage',
  source_disabled: 'Not configured: the source is turned off',
  ...Object.fromEntries(
    Object.entries(SYNC_OUTCOMES).filter(([code]) => code.startsWith('refused_')),
  ),
});

const known = (words: Readonly<Record<string, string>>, code: string) =>
  Object.hasOwn(words, code) ? (words[code] ?? code) : code;

/** A network sync's outcome in words; an outcome the console does not know reads as its code. */
export function networkSyncOutcomeText(outcome: string): string {
  return known(SYNC_OUTCOMES, outcome);
}

/** A network source's last error code in words; an unknown code reads as itself. */
export function networkErrorCodeText(code: string): string {
  return known(ERROR_CODES, code);
}
