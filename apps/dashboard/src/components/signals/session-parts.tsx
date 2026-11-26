/**
 * The parts of a session card (C91, C93, C96, C108): the parsed device and the recorded device,
 * the network facts with their tiers, reasons and provenance, and the handoff that created the
 * session. A `null` fact reads "Not evaluated" with its reason, or "Unknown", never "no";
 * fingerprints and the place are masked without `pii:view` exactly as the API masked them, and
 * the device class, which is not PII, always shows.
 */
import {
  SIGNAL_NULL_REASONS,
  type DeviceResource,
  type InquirySessionResource,
  type NetworkResource,
  type SignalNullReason,
  type SignalSource,
} from '@openverify/contracts';
import type { ReactNode } from 'react';
import {
  CLIENT_ADDRESS_SOURCE_WORDS,
  HANDOFF_METHOD_LABELS,
  SESSION_DEVICE_TYPE_LABELS,
  type NetworkFactField,
} from '../../lib/network-words';
import { SIGNAL_EVIDENCE_REASON_WORDS, notEvaluatedText } from '../../lib/signal-words';
import { Detail } from '../detail';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { DeviceTrust } from './device-trust';
import { EvidenceMeta, ReasonList } from './evidence';

type SessionAttributes = InquirySessionResource['attributes'];

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;
const UNKNOWN = 'Unknown';
const NULL_REASONS: ReadonlySet<string> = new Set(SIGNAL_NULL_REASONS);
const SANDBOX_SOURCE = 'openverify-sandbox-network';

/** The id of a session card's heading, which the handoff link targets. */
export const sessionAnchor = (sessionId: string) => `session-${sessionId}`;

/** A titled part of a card: a group named by its heading. */
export function CardPart({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <h4 id={id} className="text-sm font-semibold">
        {title}
      </h4>
      {children}
    </div>
  );
}

const grid = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

const textOrUnknown = (value: string | null | undefined) => value ?? UNKNOWN;

const joined = (...parts: readonly (string | null | undefined)[]) => {
  const present = parts.filter((part): part is string => part !== null && part !== undefined);
  return present.length === 0 ? UNKNOWN : present.join(' ');
};

/** The session's parsed device (C94.5) and, with device recognition, its recorded device. */
export function SessionDevice({
  session,
  device,
  masked,
  trust,
}: {
  readonly session: InquirySessionResource;
  readonly device: DeviceResource | null;
  readonly masked: boolean;
  /** C127.9: the inquiry the card belongs to, and `setDeviceTrust` with `devices:write`. */
  readonly trust?: {
    readonly inquiryId: string;
    readonly action: ((state: ActionState, formData: FormData) => Promise<ActionResult>) | null;
  };
}) {
  const { attributes } = session;
  const deviceType = attributes['device-type'];
  const sdk = attributes['mobile-sdk-name'];
  return (
    <CardPart id={`${session.id}-device`} title="Device">
      <dl className={grid}>
        <Detail term="Operating system">
          {joined(attributes['os-name'], attributes['os-full-version'])}
        </Detail>
        <Detail term="Browser">
          {joined(attributes['browser-name'], attributes['browser-full-version'])}
        </Detail>
        <Detail term="Device type">
          {deviceType === null || deviceType === undefined
            ? UNKNOWN
            : SESSION_DEVICE_TYPE_LABELS[deviceType]}
        </Detail>
        <Detail term="Device name">{textOrUnknown(attributes['device-name'])}</Detail>
        <Detail term="Mobile SDK">
          {sdk === null || sdk === undefined
            ? 'None'
            : joined(sdk, attributes['mobile-sdk-full-version'])}
        </Detail>
      </dl>
      {device === null ? (
        <p className="text-sm text-ink-muted">
          No device was recorded: device recognition did not apply to this session.
        </p>
      ) : (
        <RecordedDevice device={device} masked={masked} trust={trust} />
      )}
    </CardPart>
  );
}

function RecordedDevice({
  device,
  masked,
  trust,
}: {
  readonly device: DeviceResource;
  readonly masked: boolean;
  readonly trust:
    | {
        readonly inquiryId: string;
        readonly action: ((state: ActionState, formData: FormData) => Promise<ActionResult>) | null;
      }
    | undefined;
}) {
  const { attributes } = device;
  const android = attributes.platform === 'android';
  const hex = (value: string | null) =>
    masked && value === null ? (
      <MaskedValue value={null} masked />
    ) : value === null ? (
      <EmptyValue />
    ) : (
      code(value)
    );
  return (
    <dl className={grid}>
      <Detail term="Device">{code(device.id)}</Detail>
      <Detail term="Platform">{android ? 'Android' : 'Web'}</Detail>
      {android ? (
        <Detail term="Device fingerprint">{hex(attributes['device-fingerprint'])}</Detail>
      ) : (
        <Detail term="Browser fingerprint">
          {attributes['fingerprint-randomised'] && attributes['browser-fingerprint'] === null
            ? 'None: the browser randomises its fingerprint'
            : hex(attributes['browser-fingerprint'])}
        </Detail>
      )}
      {!android && (
        <Detail term="Device class">
          {attributes['device-class'] === null ? <EmptyValue /> : code(attributes['device-class'])}
        </Detail>
      )}
      <Detail term="Key id">{code(attributes['key-id'])}</Detail>
      <Detail term="Sessions on this device">{attributes['session-count']}</Detail>
      <Detail term="First seen (UTC)">
        <Timestamp value={attributes['first-seen-at']} />
      </Detail>
      <Detail term="Last seen (UTC)">
        <Timestamp value={attributes['last-seen-at']} />
      </Detail>
      {trust !== undefined && (
        <DeviceTrust inquiryId={trust.inquiryId} device={device} action={trust.action} />
      )}
    </dl>
  );
}

/** The reasons the network row records for `field`. */
function reasonsFor(network: NetworkResource | null, field: NetworkFactField) {
  const all = (network?.attributes.reasons ?? []).filter((reason) => reason.field === field);
  const nullReason = all.find((reason) => NULL_REASONS.has(reason.reason))?.reason ?? null;
  const evidence = all
    .filter((reason) => !NULL_REASONS.has(reason.reason))
    .map(
      (reason) =>
        SIGNAL_EVIDENCE_REASON_WORDS[reason.reason as keyof typeof SIGNAL_EVIDENCE_REASON_WORDS],
    );
  return { nullReason: nullReason as SignalNullReason | null, evidence };
}

/** A fact's value: found, checked and not found (only where the data is exhaustive), or null. */
function flagText(value: boolean | null | undefined, nullReason: SignalNullReason | null) {
  if (value === true) {
    return 'Yes';
  }
  if (value === false) {
    return 'Checked: not found';
  }
  return notEvaluatedText(nullReason);
}

const LEVELS: Readonly<Record<string, string>> = {
  low: 'Low: no listed risk found',
  medium: 'Medium',
  high: 'High',
};

interface FactRow {
  readonly term: string;
  readonly field: NetworkFactField;
  readonly tier: string;
  readonly beta: boolean;
  readonly confidence?: number | null;
  readonly text: (nullReason: SignalNullReason | null) => ReactNode;
}

function Fact({
  row,
  network,
}: {
  readonly row: FactRow;
  readonly network: NetworkResource | null;
}) {
  const { nullReason, evidence } = reasonsFor(network, row.field);
  return (
    <Detail term={row.term}>
      <span className="flex flex-col gap-1">
        <span>{row.text(nullReason)}</span>
        <EvidenceMeta tier={row.tier} beta={row.beta} confidence={row.confidence} />
        <ReasonList reasons={evidence} />
      </span>
    </Detail>
  );
}

const point = (attributes: SessionAttributes) => {
  const { latitude, longitude } = attributes;
  return latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined
    ? null
    : `${String(latitude)}, ${String(longitude)} (approximate)`;
};

function placeText(
  value: string | null,
  masked: boolean,
  nullReason: SignalNullReason | null,
): ReactNode {
  if (value !== null) {
    return value;
  }
  return masked ? <MaskedValue value={null} masked /> : notEvaluatedText(nullReason);
}

/** C93.3: the session's network facts, each with its tier, its reasons and its provenance. */
export function SessionNetwork({
  session,
  network,
  masked,
}: {
  readonly session: InquirySessionResource;
  readonly network: NetworkResource | null;
  readonly masked: boolean;
}) {
  const evaluated =
    session.relationships.network?.data !== null &&
    session.relationships.network?.data !== undefined;
  const { attributes } = session;
  const rows: readonly FactRow[] = [
    {
      term: 'Tor exit',
      field: 'is-tor',
      tier: 'R',
      beta: false,
      text: (reason) => flagText(attributes['is-tor'], reason),
    },
    {
      term: 'Cloud provider address',
      field: 'is-datacenter',
      tier: 'R',
      beta: false,
      text: (reason) => flagText(attributes['is-datacenter'], reason),
    },
    {
      term: 'VPN network',
      field: 'is-vpn',
      tier: 'H',
      beta: true,
      text: (reason) => flagText(attributes['is-vpn'], reason),
    },
    {
      term: 'Hosting network',
      field: 'hosting-asn',
      tier: 'H',
      beta: true,
      confidence: network?.attributes['hosting-asn-confidence'] ?? null,
      text: (reason) => flagText(attributes['hosting-asn'], reason),
    },
    {
      term: 'Proxy',
      field: 'is-proxy',
      tier: 'A',
      beta: true,
      text: (reason) => flagText(attributes['is-proxy'], reason),
    },
    {
      term: 'Threat level',
      field: 'threat-level',
      tier: 'H',
      beta: true,
      text: (reason) => {
        const level = attributes['threat-level'];
        return level === null || level === undefined
          ? notEvaluatedText(reason)
          : (LEVELS[level] ?? level);
      },
    },
    {
      term: 'Country',
      field: 'country-code',
      tier: 'R',
      beta: false,
      text: (reason) => {
        const countryCode = attributes['country-code'] ?? null;
        return countryCode === null
          ? notEvaluatedText(reason)
          : `${attributes['country-name'] ?? countryCode} (${countryCode}), approximate`;
      },
    },
    {
      term: 'Region',
      field: 'region-code',
      tier: 'R',
      beta: false,
      text: (reason) => placeText(attributes['region-name'] ?? null, masked, reason),
    },
    {
      term: 'Location',
      field: 'location',
      tier: 'R',
      beta: false,
      text: (reason) => placeText(point(attributes), masked, reason),
    },
    {
      term: 'Network (ASN)',
      field: 'asn',
      tier: 'R',
      beta: false,
      text: (reason) => {
        const asn = network?.attributes.asn ?? null;
        const organisation = attributes['network-organization'] ?? null;
        return asn === null && organisation === null
          ? notEvaluatedText(reason)
          : joined(asn === null ? null : `AS${String(asn)}`, organisation);
      },
    },
    {
      term: 'Private relay',
      field: 'privacy-relay',
      tier: 'R',
      beta: false,
      text: (reason) => flagText(network?.attributes['privacy-relay'] ?? null, reason),
    },
  ];
  return (
    <CardPart id={`${session.id}-network`} title="Network">
      {!evaluated ? (
        <p className="text-sm text-ink-muted">
          This session&apos;s address was not evaluated yet: it is evaluated on the session&apos;s
          first flow call.
        </p>
      ) : (
        <>
          <dl className={grid}>
            {rows.map((row) => (
              <Fact key={row.term} row={row} network={network} />
            ))}
            <Detail term="Connection type">{attributes['ip-connection-type'] ?? UNKNOWN}</Detail>
            <Detail term="Address resolved by">
              {network === null
                ? UNKNOWN
                : CLIENT_ADDRESS_SOURCE_WORDS[network.attributes['client-address-source']]}
            </Detail>
            <Detail term="Evaluated (UTC)">
              {network === null ? (
                UNKNOWN
              ) : (
                <Timestamp value={network.attributes['evaluated-at']} />
              )}
            </Detail>
          </dl>
          <SourceList sources={network?.attributes.sources ?? []} />
        </>
      )}
    </CardPart>
  );
}

/** C90.3: the sources a network value read, a sandbox source labelled so. */
export function SourceList({ sources }: { readonly sources: readonly SignalSource[] }) {
  if (sources.length === 0) {
    return <p className="text-xs text-ink-muted">No data source was read.</p>;
  }
  return (
    <ul aria-label="Network data sources" className="flex flex-col gap-1 text-xs">
      {sources.map((source) =>
        source.kind === 'sync' ? (
          <li key={`${source['source-id']}-${source['sync-id']}`} className="break-all">
            {code(source['source-id'])}
            {source['source-id'] === SANDBOX_SOURCE && <SandboxLabel />}, sync {source['sync-id']},
            published <Timestamp value={source['published-at']} /> UTC, SHA-256{' '}
            {code(source.sha256)}
          </li>
        ) : (
          <li key={`provider-${source.provider}`}>
            Provider {code(source.provider)}
            {source.sandbox && <SandboxLabel />}
          </li>
        ),
      )}
    </ul>
  );
}

export function SandboxLabel() {
  return (
    <span className="ms-1.5 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-600/30 ring-inset">
      Sandbox
    </span>
  );
}

const changed = (value: boolean | null | undefined) =>
  value === true ? 'Yes' : value === false ? 'No' : UNKNOWN;

/** Whether a session was created by a handoff redemption (C96.4). */
export const isHandoffSession = (session: InquirySessionResource) =>
  (session.attributes['device-handoff-method'] ?? null) !== null ||
  (session.attributes['handoff-from-session-id'] ?? null) !== null;

/** C96.3: when the desktop rejected the phone's session; a server that sent nothing is unknown. */
function rejectedText(rejected: string | null | undefined) {
  if (rejected === undefined) {
    return UNKNOWN;
  }
  if (rejected === null) {
    return 'Not rejected';
  }
  return (
    <span className="flex flex-col gap-1">
      <Timestamp value={rejected} />
      <span>The desktop said “this was not me”, and its captures were cancelled.</span>
    </span>
  );
}

/** C96.3, C96.4, C96.7: how the phone's session was reached, and how far it moved. */
export function SessionHandoff({ session }: { readonly session: InquirySessionResource }) {
  const { attributes } = session;
  const method = attributes['device-handoff-method'] ?? null;
  const from = attributes['handoff-from-session-id'] ?? null;
  const redeemed = attributes['handoff-redeemed-at'] ?? null;
  const distance = attributes['handoff-distance-meters'] ?? null;
  return (
    <CardPart id={`${session.id}-handoff`} title="Handoff">
      <dl className={grid}>
        <Detail term="Method">{method === null ? UNKNOWN : HANDOFF_METHOD_LABELS[method]}</Detail>
        <Detail term="From session">
          {from === null ? (
            UNKNOWN
          ) : (
            <a href={`#${sessionAnchor(from)}`} className={LINK_CLASS}>
              {code(from)}
            </a>
          )}
        </Detail>
        <Detail term="Redeemed (UTC)">
          {redeemed === null ? UNKNOWN : <Timestamp value={redeemed} />}
        </Detail>
        <Detail term="Rejected (UTC)">{rejectedText(attributes['handoff-rejected-at'])}</Detail>
        <Detail term="Distance">
          {distance === null ? UNKNOWN : `${distance.toLocaleString('en-US')} m (approximate)`}
        </Detail>
        <Detail term="Country changed">{changed(attributes['handoff-country-changed'])}</Detail>
        <Detail term="Network changed">{changed(attributes['handoff-asn-changed'])}</Detail>
      </dl>
    </CardPart>
  );
}

/** Whether the session shows an IP location or a distance from one (C92.8). */
export const showsIpLocation = (session: InquirySessionResource) => {
  const { attributes } = session;
  return [
    attributes['country-code'],
    attributes['region-name'],
    attributes.latitude,
    attributes['handoff-distance-meters'],
  ].some((value) => value !== null && value !== undefined);
};
