/**
 * Inquiry sessions (contract C10): the flow sessions opened by `resume` and one-time links.
 *
 * - `active` until the TTL passes (`expired`, set by the expiry job or an explicit expire),
 *   or until the inquiry leaves `created`/`pending` (`canceled`);
 * - `started-at`, `ip-address` and `user-agent` come from the first flow call, which emits
 *   `inquiry-session.started` once;
 * - `ip-address` and `user-agent` are encrypted at rest and masked without `pii:view` (C15).
 */
import {
  buildDeviceResource,
  buildInquirySessionResource,
  buildNetworkResource,
  filterValues,
  idSchema,
  inquirySessionStatusSchema,
  type DeviceResource,
  type InquirySessionConsentRecord,
  type InquirySessionInclude,
  type InquirySessionIncludeDocument,
  type InquirySessionResource,
  type NetworkRecord,
  type NetworkResource,
  type SessionDeviceRecord,
  type SessionHandoffRecord,
  type SessionNetworkRecord,
} from '@openverify/contracts';
import {
  cancelInquirySessions as cancelSessionRows,
  expireInquirySession as expireSessionRow,
  expireInquirySessions as expireSessionRows,
  getInquiry,
  getInquirySession,
  listInquirySessions as findInquirySessions,
  listSessionDevices,
  listSessionLinks,
  listSessionNetworks,
  markInquirySessionStarted,
  type Db,
  type Device,
  type InquirySession,
  type Network,
  type SessionLinks,
} from '@openverify/db';
import { UNMASKED, type PiiMask } from '../auth/pii.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { InvalidTransitionError, NotFoundError } from '../errors.js';
import { inquirySessionRecordOf } from '../jobs/records.js';
import { evaluateSessionNetworkInTx, type SessionNetworkDeps } from '../network/evaluate.js';
import type { Clock } from '../ports.js';
import { auditEntryOf, type ApiDependencies } from './context.js';
import type { Acting } from './inquiries.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';
import { indexSessionAddressInTx } from './graph/session-start.js';
import { recordSessionDeviceInTx } from './signals/sessions.js';

export const INQUIRY_SESSIONS_PATH = '/api/v1/inquiry-sessions';

/** Longest user agent kept from the first flow call. */
const MAX_USER_AGENT_LENGTH = 512;
/** Longest client address kept (IPv6 with a zone fits). */
const MAX_IP_LENGTH = 64;

/**
 * The consent recorded on a session as the resource shows it (C42.3, C47): what the user
 * accepted, never the client address or user agent it was recorded with.
 */
function consentOf(session: InquirySession): InquirySessionConsentRecord | null {
  const { consent } = session;
  return consent === null
    ? null
    : {
        acceptedAt: consent.acceptedAt,
        textKeys: consent.textKeys,
        optionalTextKeys: consent.optionalTextKeys ?? [],
        locale: consent.locale,
      };
}

/** C91.1 (Workflow 7A): the session's network facts as its row holds them; `null` until evaluated. */
function sessionNetworkRecordOf(session: InquirySession): SessionNetworkRecord {
  const { location } = session;
  return {
    isTor: session.isTor,
    isDatacenter: session.isDatacenter === true ? true : null,
    isVpn: session.isVpn === true ? true : null,
    isProxy: session.isProxy,
    hostingAsn: session.hostingAsn === true ? true : null,
    threatLevel: session.threatLevel,
    countryCode: session.countryCode,
    countryName: session.countryName,
    regionCode: location?.regionCode ?? null,
    regionName: location?.regionName ?? null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    ipConnectionType: session.ipConnectionType,
    // C91.1: `ip-isp` and `network-organization` are both the AS organisation (amendment (N) 1).
    ipIsp: session.networkOrganization,
    networkOrganization: session.networkOrganization,
  };
}

/** C91.1, C94.5, C94.6 (Workflow 7A): the parsed device fields and the tiers that applied. */
function sessionDeviceRecordOf(session: InquirySession): SessionDeviceRecord {
  return {
    osName: session.osName,
    osFullVersion: session.osFullVersion,
    browserName: session.browserName,
    browserFullVersion: session.browserFullVersion,
    deviceType: session.deviceType,
    deviceName: session.deviceName,
    mobileSdkName: session.mobileSdkName,
    mobileSdkFullVersion: session.mobileSdkFullVersion,
    signalsCollected: session.signalsCollected,
  };
}

/** C91.1, C96.4, C96.7 (Workflow 7A): the handoff fields of a session; `null` without a handoff. */
function sessionHandoffRecordOf(session: InquirySession): SessionHandoffRecord {
  return {
    method: session.deviceHandoffMethod,
    fromSessionId: session.handoffFromSessionId,
    redeemedAt: session.handoffRedeemedAt,
    rejectedAt: session.handoffRejectedAt,
    distanceMeters: session.handoffDistanceMeters,
    countryChanged: session.handoffCountryChanged,
    asnChanged: session.handoffAsnChanged,
  };
}

/**
 * The inquiry-session resource as `mask` may see it, with its status at `now`: its network facts,
 * parsed device and tiers on every read (C91.1), and its `device` and `network` relationships when
 * `links` is given. Without `pii:view` the C91.6 attributes (address, user agent, region, point)
 * are `null`.
 */
export function inquirySessionResource(
  session: InquirySession,
  now: Date,
  mask: PiiMask = UNMASKED,
  links?: SessionLinks,
): InquirySessionResource {
  const record = inquirySessionRecordOf(session, now);
  const resource = buildInquirySessionResource({
    ...record,
    ipAddress: mask.ipAddress(record.ipAddress),
    userAgent: mask.userAgent(record.userAgent),
    consent: consentOf(session),
    network: sessionNetworkRecordOf(session),
    device: sessionDeviceRecordOf(session),
    handoff: sessionHandoffRecordOf(session),
    ...(links === undefined ? {} : { networkId: links.networkId, deviceId: links.deviceId }),
  });
  return { ...resource, attributes: mask.attributes(resource.attributes) };
}

/** C91.3: the network resource of a session's evaluation, masked as the session is (C91.6). */
export function networkResource(network: Network, mask: PiiMask = UNMASKED): NetworkResource {
  const { location } = network;
  const resource = buildNetworkResource({
    id: network.id,
    inquirySessionId: network.inquirySessionId,
    createdAt: network.createdAt,
    evaluatedAt: network.evaluatedAt,
    ipAddress: network.ip,
    serviceProvider: network.serviceProvider,
    serviceType: network.serviceType,
    proxyType: network.proxyType,
    threatLevel: network.threatLevel,
    countryCode: network.countryCode,
    countryName: network.countryName,
    regionCode: location?.regionCode ?? null,
    regionName: location?.regionName ?? null,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    asn: network.asn,
    hostingAsn: network.hostingAsn,
    hostingAsnConfidence: network.hostingAsnConfidence,
    privacyRelay: network.privacyRelay,
    clientAddressSource: network.clientAddressSource,
    reasons: network.reasons as NetworkRecord['reasons'],
    sources: network.sources as unknown as NetworkRecord['sources'],
  });
  return { ...resource, attributes: mask.attributes(resource.attributes) };
}

/** C91.2: the device resource, its fingerprints masked without `pii:view` (C91.6). */
export function deviceResource(device: Device, mask: PiiMask = UNMASKED): DeviceResource {
  const resource = buildDeviceResource({
    id: device.id,
    createdAt: device.createdAt,
    deviceFingerprint: device.deviceFingerprint,
    browserFingerprint: device.browserFingerprint,
    deviceClass: device.deviceClass,
    platform: device.platform,
    collectorVersion: device.collectorVersion,
    fingerprintRandomised: device.fingerprintRandomised,
    keyId: device.keyId,
    sessionCount: device.sessionCount,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    trustedAt: device.trustedAt,
    trustedBy:
      device.trustedByType === null || device.trustedById === null
        ? null
        : { type: device.trustedByType, id: device.trustedById },
    trustReason: device.trustReason,
  });
  return { ...resource, attributes: mask.attributes(resource.attributes) };
}

/** The `included` of the sessions' `include` members, in session order, devices first. */
async function includedOf(
  db: Db,
  environmentId: string,
  sessionIds: readonly string[],
  include: readonly InquirySessionInclude[],
  mask: PiiMask,
): Promise<(DeviceResource | NetworkResource)[]> {
  const included: (DeviceResource | NetworkResource)[] = [];
  if (include.includes('device')) {
    const seen = new Set<string>();
    for (const { device } of await listSessionDevices(db, environmentId, sessionIds)) {
      if (!seen.has(device.id)) {
        seen.add(device.id);
        included.push(deviceResource(device, mask));
      }
    }
  }
  if (include.includes('network')) {
    for (const network of await listSessionNetworks(db, environmentId, sessionIds)) {
      included.push(networkResource(network, mask));
    }
  }
  return included;
}

/** Every session include, for the session events (C91.1). */
const ALL_INCLUDES: readonly InquirySessionInclude[] = ['device', 'network'];

/** Stages `name` for each session in `tx`, with the session as its payload. */
export async function stageSessionEvents(
  tx: Db,
  events: TransactionalEventPublisher,
  name: 'inquiry-session.started' | 'inquiry-session.expired' | 'inquiry-session.canceled',
  sessions: readonly InquirySession[],
  now: Date,
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const session of sessions) {
    const { environmentId, id } = session;
    // C91.1: the session webhooks carry its device and network, unmasked as every payload is.
    const links = (await listSessionLinks(tx, environmentId, [id])).get(id);
    const included = await includedOf(tx, environmentId, [id], ALL_INCLUDES, UNMASKED);
    staged.push(
      await events.stage(tx, {
        environmentId,
        name,
        payload: {
          data: inquirySessionResource(session, now, UNMASKED, links),
          ...(included.length === 0 ? {} : { included }),
        },
      }),
    );
  }
  return staged;
}

/**
 * C10: the inquiry left `created`/`pending`, so its active sessions become `canceled`, each
 * with `inquiry-session.canceled` staged in `tx`.
 */
export async function cancelActiveSessions(
  tx: Db,
  events: TransactionalEventPublisher,
  environmentId: string,
  inquiryId: string,
  at: Date,
): Promise<StagedEvent[]> {
  const canceled = await cancelSessionRows(tx, environmentId, inquiryId, at);
  return stageSessionEvents(tx, events, 'inquiry-session.canceled', canceled, at);
}

/**
 * C10 session TTL: marks `sessions` (active, past their TTL) `expired` with
 * `inquiry-session.expired` staged in `tx`. Returns the staged events.
 */
export async function expireSessions(
  tx: Db,
  events: TransactionalEventPublisher,
  sessions: readonly Pick<InquirySession, 'id' | 'environmentId'>[],
  at: Date,
): Promise<StagedEvent[]> {
  const expired: InquirySession[] = [];
  for (const session of sessions) {
    const row = await expireSessionRow(tx, session.environmentId, session.id, at);
    if (row !== null) {
      expired.push(row);
    }
  }
  return stageSessionEvents(tx, events, 'inquiry-session.expired', expired, at);
}

export interface ClientDetails {
  ip: string;
  userAgent: string | undefined;
}

/** A start without network deps evaluates nothing, so its indexer has nothing to report. */
const NO_LOGGER = { warn: () => undefined };

/**
 * Records the first successful flow call of a session (C10): its time, client address and
 * user agent (sealed for the row), with `inquiry-session.started` in the same transaction.
 * Later calls change nothing, so the event is emitted once.
 */
export async function recordSessionStart(
  deps: {
    db: Db;
    events: TransactionalEventPublisher;
    clock: Clock;
    /** C93.2 (Workflow 7A): without it the start evaluates no address (tests that do not need it). */
    network?: SessionNetworkDeps | undefined;
  },
  session: Pick<InquirySession, 'id' | 'environmentId'>,
  client: ClientDetails,
): Promise<void> {
  const at = deps.clock.now();
  const ip = client.ip.slice(0, MAX_IP_LENGTH);
  const staged = await deps.db.transaction(async (tx) => {
    const started = await markInquirySessionStarted(tx, session.environmentId, session.id, {
      at,
      ip,
      userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    });
    if (started === null) {
      return [];
    }
    // C93.2 (F15): the call that won the start evaluates the address, in this transaction, so the
    // session's network facts and its start commit together. A failure rolls the start back.
    const network =
      deps.network === undefined
        ? null
        : await evaluateSessionNetworkInTx(tx, deps.network, started, { ip }, at);
    // C93.2, C94.5 (Workflow 7A): the parsed device fields from the user agent (`api-signals`).
    await recordSessionDeviceInTx(tx, started, { userAgent: started.userAgent }, at);
    // C101.3 (Workflow 7B; P05): the graph's IP row, in a savepoint, so it never rolls the start
    // back; a network that wrote nothing reads as no address (`api-graph`).
    await indexSessionAddressInTx(tx, started, network, { ip }, deps.network?.logger ?? NO_LOGGER);
    return stageSessionEvents(tx, deps.events, 'inquiry-session.started', [started], at);
  });
  await deps.events.dispatch(staged);
}

/** @throws {NotFoundError} when the session is not in this environment. */
async function findSession(db: Db, environmentId: string, id: string): Promise<InquirySession> {
  const session = await getInquirySession(db, environmentId, id);
  if (session === null) {
    throw new NotFoundError(`Inquiry session ${id} was not found.`);
  }
  return session;
}

export interface ListInquirySessionsQuery extends PageQuery {
  'filter[inquiry-id]'?: string | undefined;
  'filter[status]'?: string | undefined;
}

/** `GET /inquiry-sessions`: newest first, by inquiry and stored status. */
export async function listInquirySessions(
  { db, clock }: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  query: ListInquirySessionsQuery,
): Promise<{ data: InquirySessionResource[]; links: { next: string | null } }> {
  const inquiryId = query['filter[inquiry-id]'];
  const status = query['filter[status]'];
  const page = await withCursor(() =>
    findInquirySessions(db, acting.ctx.environmentId, {
      ...pageRequest(query),
      inquiryId: filterValues(inquiryId, idSchema('inq')),
      status: filterValues(status, inquirySessionStatusSchema),
    }),
  );
  const now = clock.now();
  const links = await listSessionLinks(
    db,
    acting.ctx.environmentId,
    page.items.map((session) => session.id),
  );
  return {
    data: page.items.map((session) =>
      inquirySessionResource(session, now, acting.mask, links.get(session.id)),
    ),
    links: {
      next: nextLink(
        INQUIRY_SESSIONS_PATH,
        { 'filter[inquiry-id]': inquiryId, 'filter[status]': status },
        query,
        page.next,
      ),
    },
  };
}

/**
 * `GET /inquiry-sessions/:id`, with `include` (C91.1: `device`, `network`) in `included`, masked as
 * the session is. @throws {NotFoundError} outside this environment.
 */
export async function getInquirySessionDocument(
  { db, clock }: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  id: string,
  include: readonly InquirySessionInclude[] = [],
): Promise<InquirySessionIncludeDocument> {
  const { environmentId } = acting.ctx;
  const session = await findSession(db, environmentId, id);
  const links = (await listSessionLinks(db, environmentId, [id])).get(id);
  const data = inquirySessionResource(session, clock.now(), acting.mask, links);
  if (include.length === 0) {
    return { data };
  }
  return { data, included: await includedOf(db, environmentId, [id], include, acting.mask) };
}

/**
 * `POST /inquiry-sessions/:id/expire`: an active session becomes `expired`, with
 * `inquiry-session.expired` and an audit entry.
 * @throws {NotFoundError} outside this environment.
 * @throws {InvalidTransitionError} when the session is no longer active.
 */
export async function expireInquirySession(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
): Promise<InquirySessionResource> {
  const { db, events, clock, audit } = deps;
  const { environmentId } = acting.ctx;
  const at = clock.now();
  const { session, staged } = await db.transaction(async (tx) => {
    const current = await findSession(tx, environmentId, id);
    const expired = await expireSessionRow(tx, environmentId, id, at);
    if (expired === null) {
      throw new InvalidTransitionError(
        `The inquiry session is ${current.status}; only an active session can be expired.`,
      );
    }
    await audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'inquiry-session.expired',
        resourceType: 'inquiry-session',
        resourceId: id,
      }),
    );
    return {
      session: expired,
      staged: await stageSessionEvents(tx, events, 'inquiry-session.expired', [expired], at),
    };
  });
  await events.dispatch(staged);
  const links = (await listSessionLinks(db, environmentId, [id])).get(id);
  return inquirySessionResource(session, at, acting.mask, links);
}

/**
 * `POST /inquiry-sessions/expire-all`: every active session of the inquiry becomes `expired`,
 * each with its event and audit entry.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 */
export async function expireAllInquirySessions(
  deps: ApiDependencies,
  acting: Acting,
  inquiryId: string,
): Promise<{ meta: { 'expired-count': number } }> {
  const { db, events, clock, audit } = deps;
  const { environmentId } = acting.ctx;
  const at = clock.now();
  const staged = await db.transaction(async (tx) => {
    if ((await getInquiry(tx, environmentId, inquiryId)) === null) {
      throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
    }
    const expired = await expireSessionRows(tx, environmentId, inquiryId, at);
    for (const session of expired) {
      await audit.record(
        tx,
        auditEntryOf(acting.ctx, acting.actor, {
          action: 'inquiry-session.expired',
          resourceType: 'inquiry-session',
          resourceId: session.id,
        }),
      );
    }
    return stageSessionEvents(tx, events, 'inquiry-session.expired', expired, at);
  });
  await events.dispatch(staged);
  return { meta: { 'expired-count': staged.length } };
}
