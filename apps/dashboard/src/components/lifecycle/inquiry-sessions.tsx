import type {
  DeviceResource,
  InquirySessionResource,
  NetworkResource,
} from '@openverify/contracts';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { Detail } from '../detail';
import { EmptyValue, MaskedValue } from '../masked-value';
import { DbIpAttribution } from '../signals/db-ip-attribution';
import {
  SessionDevice,
  SessionHandoff,
  SessionNetwork,
  isHandoffSession,
  sessionAnchor,
  showsIpLocation,
} from '../signals/session-parts';
import { Timestamp } from '../timestamp';
import { COLLECTOR_TIER_LABELS } from '../../lib/network-words';
import { SessionStatusBadge } from './badges';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface InquirySessionsProps {
  readonly inquiryId: string;
  readonly sessions: readonly InquirySessionResource[];
  /**
   * The sessions' devices and networks, as `GET /inquiry-sessions/:id?include=device,network`
   * answered them (C91.2, C91.3).
   */
  readonly included?: readonly (DeviceResource | NetworkResource)[];
  /** The API masked the client addresses (no `pii:view`, C15). */
  readonly masked: boolean;
  /** `inquiry-sessions:write`. */
  readonly canExpire: boolean;
  readonly expire: Action;
  readonly expireAll: (
    state: ActionState<{ expiredCount: number }>,
    formData: FormData,
  ) => Promise<ActionResult<{ expiredCount: number }>>;
  /** C127.9: `setDeviceTrust`, given only with `devices:write`. */
  readonly trustDevice?: Action;
}

const time = (value: string | null) =>
  value === null ? <EmptyValue /> : <Timestamp value={value} />;

const keys = (values: readonly string[], none: string) =>
  values.length === 0 ? (
    <span className="text-ink-muted">{none}</span>
  ) : (
    values.map((key, index) => (
      <span key={key}>
        {index > 0 && ', '}
        <code className="font-mono text-xs break-all">{key}</code>
      </span>
    ))
  );

/** A consent term and its value, small enough for a table cell. */
function ConsentTerm({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-xs font-medium text-ink-muted">{term}</dt>
      <dd className="text-xs break-words">{children}</dd>
    </div>
  );
}

/**
 * What the user accepted on a session (C42.3, C47): when, in which locale, the required consent
 * texts and the optional ones ticked (the matching consent, `consent.biometric-matching`).
 */
function Consent({ session }: { readonly session: InquirySessionResource }) {
  const { consent } = session.attributes;
  if (consent === undefined) {
    return <span className="text-ink-muted">Not reported</span>;
  }
  if (consent === null) {
    return <span className="text-ink-muted">Not given yet</span>;
  }
  return (
    <dl className="grid min-w-56 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      <ConsentTerm term="Accepted (UTC)">
        <Timestamp value={consent['accepted-at']} />
      </ConsentTerm>
      <ConsentTerm term="Locale">
        <code className="font-mono text-xs">{consent.locale}</code>
      </ConsentTerm>
      <ConsentTerm term="Required texts">{keys(consent['text-keys'], 'None')}</ConsentTerm>
      <ConsentTerm term="Optional texts">
        {keys(consent['optional-text-keys'], 'None ticked')}
      </ConsentTerm>
    </dl>
  );
}

const COLLECTED_LABELS = COLLECTOR_TIER_LABELS;

/** C94.6: the tiers the session collected, read at session level; an empty list is no pass. */
function SignalsCollected({ session }: { readonly session: InquirySessionResource }) {
  const tiers = session.attributes['signals-collected'];
  if (tiers === undefined) {
    return <span className="text-ink-muted">Not reported by this server</span>;
  }
  if (tiers.length === 0) {
    return <>Nothing collected</>;
  }
  return <>{tiers.map((tier) => COLLECTED_LABELS[tier]).join(', ')}</>;
}

function SessionCard({
  inquiryId,
  session,
  device,
  network,
  masked,
  canExpire,
  expire,
  trustDevice,
}: {
  readonly inquiryId: string;
  readonly session: InquirySessionResource;
  readonly device: DeviceResource | null;
  readonly network: NetworkResource | null;
  readonly masked: boolean;
  readonly canExpire: boolean;
  readonly expire: Action;
  readonly trustDevice: Action | null;
}) {
  const { attributes } = session;
  const headingId = sessionAnchor(session.id);
  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h3 id={headingId} className="text-base font-semibold">
            Session <code className="font-mono text-xs">{session.id}</code>
          </h3>
          <SessionStatusBadge status={attributes.status} />
          {canExpire && attributes.status === 'active' && (
            <ConfirmActionButton
              label="Expire"
              variant="secondary"
              title="Expire this session?"
              description="The end user's open flow stops working. A new link or session token is needed to continue."
              confirmLabel="Expire session"
              pendingLabel="Expiring…"
              action={expire}
              fields={{ 'inquiry-id': inquiryId, 'inquiry-session-id': session.id }}
              successMessage="The session was expired."
            />
          )}
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail term="Created (UTC)">{time(attributes['created-at'])}</Detail>
          <Detail term="Started (UTC)">{time(attributes['started-at'])}</Detail>
          <Detail term="Expires (UTC)">{time(attributes['expires-at'])}</Detail>
          <Detail term="IP address">
            <MaskedValue value={attributes['ip-address']} masked={masked} />
          </Detail>
          <Detail term="User agent">
            <span className="break-all">
              <MaskedValue value={attributes['user-agent']} masked={masked} />
            </span>
          </Detail>
          <Detail term="Signals collected">
            <SignalsCollected session={session} />
          </Detail>
          <Detail term="Consent">
            <Consent session={session} />
          </Detail>
        </dl>
        {isHandoffSession(session) && <SessionHandoff session={session} />}
        <SessionDevice
          session={session}
          device={device}
          masked={masked}
          trust={{ inquiryId, action: trustDevice }}
        />
        <SessionNetwork session={session} network={network} masked={masked} />
      </article>
    </li>
  );
}

const isDevice = (resource: DeviceResource | NetworkResource): resource is DeviceResource =>
  resource.type === 'device';
const isNetwork = (resource: DeviceResource | NetworkResource): resource is NetworkResource =>
  resource.type === 'network';

/**
 * The inquiry's flow sessions (C10, C108): one card per session, with the consent it recorded
 * (C42.3, C47), the collection tiers that applied, its device, its network facts and the handoff
 * that created it, each expirable while active. The DB-IP line closes the section whenever a
 * session shows an IP location or a distance from one (C92.8).
 */
export function InquirySessions({
  inquiryId,
  sessions,
  included = [],
  masked,
  canExpire,
  expire,
  expireAll,
  trustDevice,
}: InquirySessionsProps) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No sessions yet. A session opens when the end user starts the hosted flow.
      </p>
    );
  }
  const devices = new Map(included.filter(isDevice).map((device) => [device.id, device]));
  const networks = new Map(included.filter(isNetwork).map((network) => [network.id, network]));
  const anyActive = sessions.some((session) => session.attributes.status === 'active');
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Inquiry sessions" className="flex flex-col gap-4">
        {sessions.map((session) => {
          const deviceId = session.relationships.device?.data?.id;
          const networkId = session.relationships.network?.data?.id;
          return (
            <SessionCard
              key={session.id}
              inquiryId={inquiryId}
              session={session}
              device={deviceId === undefined ? null : (devices.get(deviceId) ?? null)}
              network={networkId === undefined ? null : (networks.get(networkId) ?? null)}
              masked={masked}
              canExpire={canExpire}
              expire={expire}
              trustDevice={trustDevice ?? null}
            />
          );
        })}
      </ul>
      {sessions.some(showsIpLocation) && <DbIpAttribution />}
      {canExpire && anyActive && (
        <div>
          <ConfirmActionButton
            label="Expire all active sessions"
            variant="secondary"
            title="Expire every active session?"
            description="Every open flow of this inquiry stops working."
            confirmLabel="Expire sessions"
            pendingLabel="Expiring…"
            action={expireAll}
            fields={{ 'inquiry-id': inquiryId }}
            successMessage="The active sessions were expired."
          />
        </div>
      )}
    </div>
  );
}
