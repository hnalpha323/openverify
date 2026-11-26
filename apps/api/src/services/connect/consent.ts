/**
 * C236 (Workflow 11A, `api-consent`): consent records on both sides of a share.
 *
 * - The resource (C236.1): its derived status (review H27), `witnessed` only for a `flow` record, the
 *   evidence (`flow`: the session and the time; `attested`: the time), and the members served only
 *   with `pii:view` (`evidence-reference`, `ip-address`, `user-agent`, `text-body`, each `null` without
 *   it, on a declined record and after redaction). An event never carries them (C239.2).
 * - The list and the retrieve (C236.2), within the caller's environment; anything else is the one
 *   generic 404 (C232.8).
 * - The attestation (C236.5, decision 27): the operator's statement, labelled `witnessed: false`, its
 *   text sealed on the record with its digest computed here, its evidence reference sealed, its time
 *   at most 30 days old and never in the future; refused within the decline's validity after a
 *   witnessed decline for the same recipient and purpose on the subject or its account (409
 *   `consent_declined_in_flow`, review H05, verification V08).
 * - The `flow` records the `share_consent` step makes (C236.4, C236.11), with their events
 *   `consent-record.created` and `consent-record.declined` in the record's environment.
 *
 * Honesty (ADR 0010): a `flow` record shows what the server served, that the client reported showing
 * it and that an affirmative act happened in a session the platform witnessed; it does not prove who
 * held the device or that the text was read. An attested record is the operator's statement.
 */
import { createHash } from 'node:crypto';
import {
  ATTESTED_AT_MAX_AGE_DAYS,
  anyIdSchema,
  filterValues,
  consentRecordStatusSchema,
  idSchema,
  connectSideSchema,
  type AttestConsentRecordBody,
  type ConsentRecordResource,
  type ListConsentRecordsQuery,
} from '@openverify/contracts';
import {
  consentRecordStatusOf,
  createConsentRecord,
  getAccount,
  getConsentRecord,
  getConsentText,
  getConsentConnection,
  getInquiry,
  getOrganization,
  getTransaction,
  getVerification,
  hasStandingDecline,
  insertConsentTextIfAbsent,
  listConsentRecords,
  listTransactionObjects,
  shareTokensCitingConsentRecords,
  type Db,
  type NewOpenedConsentRecord,
  type OpenedConsentRecord,
} from '@openverify/db';
import { UnprocessableContentError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { appendSystemAuditEntry } from '../audit-log.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { crossTenant } from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import { ConnectProblemError } from './problems.js';

export const CONSENT_RECORDS_PATH = '/api/v1/connect/consent-records';

const DAY_MS = 86_400_000;

/** What the consent services read and write through. */
export type ConsentDeps = Pick<ApiDependencies, 'db' | 'clock' | 'ids' | 'events' | 'audit'>;

/** The SHA-256 of a text's logical form (NFC, UTF-8), as `consentTextDigest` computes it. */
export const consentBodyDigest = (body: string): string =>
  createHash('sha256').update(body.normalize('NFC'), 'utf8').digest('hex');

/** An organisation's name as a consent text and a record show it (NFC). */
export async function organizationNameOf(db: Db, organizationId: string): Promise<string> {
  const organization = await getOrganization(db, organizationId);
  if (organization === null) {
    throw connectNotFound();
  }
  return organization.name.normalize('NFC');
}

/** What the resource needs beyond the row. */
export interface ServedConsentRecord {
  record: OpenedConsentRecord;
  /** The token citing a source record (from the token rows), or `null`. */
  citingTokenId: string | null;
  /** The stored `flow` text (with `pii:view` only), or `null`. */
  textBody: string | null;
  /** The resource type of a verification subject, when the subject is one. */
  subjectResourceType?: string | null | undefined;
}

type SubjectIdentifier = ConsentRecordResource['relationships']['subject']['data'];

function subjectOf(served: ServedConsentRecord): SubjectIdentifier {
  const { record } = served;
  if (record.subjectType === null || record.subjectId === null) {
    return null;
  }
  switch (record.subjectType) {
    case 'share-token':
      return {
        type: 'connect/share-token',
        id: record.subjectId,
      };
    case 'verification':
      return {
        type: served.subjectResourceType ?? 'verification/government-id',
        id: record.subjectId,
      } as SubjectIdentifier;
    default:
      return {
        type: record.subjectType,
        id: record.subjectId,
      };
  }
}

/** C236.1: the record as its environment sees it; the PII members only with `pii:view`. */
export function consentRecordResource(
  served: ServedConsentRecord,
  options: { pii: boolean; now: Date },
): ConsentRecordResource {
  const { record } = served;
  const accepted = record.outcome === 'accepted';
  const pii = options.pii && record.redactedAt === null;
  const evidence: ConsentRecordResource['attributes']['evidence'] =
    record.redactedAt !== null
      ? null
      : record.method === 'attested'
        ? record.attestedAt === null
          ? null
          : { 'attested-at': record.attestedAt.toISOString() }
        : record.sessionId === null
          ? null
          : {
              'session-id': record.sessionId,
              'accepted-at': accepted
                ? (record.acceptedAt ?? record.createdAt).toISOString()
                : null,
              'declined-at': accepted ? null : record.createdAt.toISOString(),
            };
  const shareTokenId = !accepted
    ? null
    : record.side === 'destination'
      ? record.shareTokenId
      : served.citingTokenId;
  return {
    type: 'consent-record',
    id: record.id,
    attributes: {
      side: record.side,
      outcome: record.outcome,
      status: consentRecordStatusOf(record, options.now),
      purpose: record.purpose,
      'recipient-organization-id': record.recipientOrganizationId,
      'recipient-name': record.recipientName,
      'data-categories': [
        ...record.dataCategories,
      ] as ConsentRecordResource['attributes']['data-categories'],
      'explicit-biometric': record.explicitBiometric,
      text: {
        locale: record.textLocale ?? 'en',
        keys: [...(record.textKeys ?? [])],
        sha256: record.textSha256,
      },
      'biometric-text-sha256': record.biometricTextSha256,
      method: record.method,
      witnessed: record.method === 'flow',
      evidence,
      'evidence-reference': pii ? record.evidenceReference : null,
      'ip-address': pii && accepted ? record.evidenceIp : null,
      'user-agent': pii && accepted ? record.evidenceUserAgent : null,
      'text-body':
        pii && accepted
          ? record.method === 'attested'
            ? record.attestedTextBody
            : served.textBody
          : null,
      'expires-at': record.expiresAt.toISOString(),
      'withdrawn-at': record.withdrawnAt?.toISOString() ?? null,
      'withdrawn-via': record.withdrawnVia,
      'withdrawal-reason': record.withdrawalReason,
      'redacted-at': record.redactedAt?.toISOString() ?? null,
      'created-at': record.createdAt.toISOString(),
    },
    relationships: {
      subject: { data: subjectOf(served) },
      connection: {
        data: { type: 'connect/connection', id: record.connectionId },
      },
      'share-token': {
        data: shareTokenId === null ? null : { type: 'connect/share-token', id: shareTokenId },
      },
    },
  };
}

/** Reads what the resource needs beyond the row, in the record's own environment. */
export async function servedConsentRecord(
  db: Db,
  record: OpenedConsentRecord,
  pii: boolean,
): Promise<ServedConsentRecord> {
  const citingTokenId =
    record.side === 'source' && record.outcome === 'accepted'
      ? ((await shareTokensCitingConsentRecords(db, record.environmentId, [record.id])).get(
          record.id,
        ) ?? null)
      : null;
  const textBody =
    pii && record.method === 'flow' && record.outcome === 'accepted' && record.redactedAt === null
      ? ((await getConsentText(db, record.environmentId, record.textSha256))?.body ?? null)
      : null;
  let subjectResourceType: string | null = null;
  if (record.subjectType === 'verification' && record.subjectId !== null) {
    const verification = await getVerification(db, record.environmentId, record.subjectId);
    subjectResourceType =
      verification === null ? null : `verification/${verification.type.replaceAll('_', '-')}`;
  }
  return { record, citingTokenId, textBody, subjectResourceType };
}

/** The event payload of a record: the resource without a PII member (C239.2). */
export async function consentRecordEventPayload(
  db: Db,
  record: OpenedConsentRecord,
  now: Date,
): Promise<{ data: ConsentRecordResource }> {
  return {
    data: consentRecordResource(await servedConsentRecord(db, record, false), {
      pii: false,
      now,
    }),
  };
}

/** Stages `consent-record.<name>` for a record, in its own environment, in `tx`. */
export async function stageConsentRecordEvent(
  tx: Db,
  deps: Pick<ConsentDeps, 'events' | 'clock'>,
  record: OpenedConsentRecord,
  name: 'consent-record.created' | 'consent-record.declined' | 'consent-record.withdrawn',
): Promise<StagedEvent> {
  return deps.events.stage(tx, {
    environmentId: record.environmentId,
    name,
    payload: await consentRecordEventPayload(tx, record, deps.clock.now()),
  });
}

/** C236.2: `GET /connect/consent-records/:id`, or the one 404. */
export async function getConsentRecordDocument(
  deps: Pick<ConsentDeps, 'db' | 'clock'>,
  acting: Acting,
  id: string,
): Promise<{ data: ConsentRecordResource }> {
  const record = await getConsentRecord(deps.db, acting.ctx.environmentId, id);
  if (record === null) {
    throw connectNotFound();
  }
  const pii = acting.mask.visible;
  return {
    data: consentRecordResource(await servedConsentRecord(deps.db, record, pii), {
      pii,
      now: deps.clock.now(),
    }),
  };
}

/** C236.2: `GET /connect/consent-records`, newest first (C1), with its filters. */
export async function listConsentRecordsDocument(
  deps: Pick<ConsentDeps, 'db' | 'clock'>,
  acting: Acting,
  query: ListConsentRecordsQuery,
): Promise<{ data: ConsentRecordResource[]; links: { next: string | null } }> {
  const now = deps.clock.now();
  const page = await withCursor(() =>
    listConsentRecords(deps.db, acting.ctx.environmentId, {
      now,
      page: pageRequest(query),
      subjectIds: filterValues(query['filter[subject-id]'], anyIdSchema),
      side: query['filter[side]'],
      statuses: filterValues(query['filter[status]'], consentRecordStatusSchema),
      connectionIds: filterValues(query['filter[connection-id]'], idSchema('cxn')),
    }),
  );
  const pii = acting.mask.visible;
  const data: ConsentRecordResource[] = [];
  for (const record of page.items) {
    data.push(
      consentRecordResource(await servedConsentRecord(deps.db, record, pii), {
        pii,
        now,
      }),
    );
  }
  return {
    data,
    links: {
      next: nextLink(
        CONSENT_RECORDS_PATH,
        {
          'filter[subject-id]': query['filter[subject-id]'],
          'filter[side]': query['filter[side]'],
          'filter[status]': query['filter[status]'],
          'filter[connection-id]': query['filter[connection-id]'],
        },
        query,
        page.next,
      ),
    },
  };
}

const ATTRIBUTE = (name: string) => `/data/attributes/${name}`;

/**
 * C236.5 (V08): the inquiries a witnessed decline is looked for on: the subject inquiry and every
 * inquiry of its account; for an account, its inquiries; for a transaction, the inquiries and the
 * accounts attached to it. The account path is resolved in SQL in the caller's environment.
 */
async function declineScope(
  db: Db,
  environmentId: string,
  subject: { type: 'inquiry' | 'account' | 'transaction'; id: string },
): Promise<{ inquiryIds: string[]; accountIds: string[] }> {
  switch (subject.type) {
    case 'inquiry': {
      const inquiry = await getInquiry(db, environmentId, subject.id);
      return {
        inquiryIds: [subject.id],
        accountIds: inquiry === null ? [] : [inquiry.accountId],
      };
    }
    case 'account':
      return { inquiryIds: [], accountIds: [subject.id] };
    case 'transaction': {
      // A transaction's people are the inquiries and accounts attached to it (C105.2).
      const objects = (await listTransactionObjects(db, environmentId, [subject.id])).get(
        subject.id,
      );
      return {
        inquiryIds: (objects ?? []).flatMap((row) =>
          row.inquiryId === null ? [] : [row.inquiryId],
        ),
        accountIds: (objects ?? []).flatMap((row) =>
          row.accountId === null ? [] : [row.accountId],
        ),
      };
    }
  }
}

/** The subject of a source-side attestation, which must exist (and not be redacted) here. */
async function attestedSubject(
  db: Db,
  environmentId: string,
  id: string,
): Promise<{ type: 'inquiry' | 'account' | 'transaction'; id: string }> {
  const prefix = id.slice(0, id.indexOf('_'));
  const found =
    prefix === 'inq'
      ? await getInquiry(db, environmentId, id)
      : prefix === 'acc'
        ? await getAccount(db, environmentId, id)
        : await getTransaction(db, environmentId, id);
  if (found === null) {
    throw connectNotFound();
  }
  if ((found as { redactedAt?: Date | null }).redactedAt != null) {
    throw new ConnectProblemError('source_redacted', 'The subject has been redacted.');
  }
  return {
    type: prefix === 'inq' ? 'inquiry' : prefix === 'acc' ? 'account' : 'transaction',
    id,
  };
}

/**
 * C236.5: `POST /connect/consent-records` (scope `connect-consent-records:attest`): an attested record,
 * `witnessed: false`. The source side names `subject-id` and the connection must be the caller's
 * outbound one; the destination side names a token inbound to the caller on that connection.
 */
export async function attestConsentRecord(
  deps: ConsentDeps,
  acting: Acting,
  body: AttestConsentRecordBody,
): Promise<{ data: ConsentRecordResource }> {
  const attributes = body.data.attributes;
  const { db, clock } = deps;
  const now = clock.now();
  const environmentId = acting.ctx.environmentId;
  const organizationId = acting.ctx.organizationId;
  const side = connectSideSchema.parse(attributes.side);

  const attestedAt = new Date(attributes['attested-at']);
  if (attestedAt.getTime() > now.getTime()) {
    throw new UnprocessableContentError('The attestation is in the future.', [
      {
        location: 'body',
        pointer: ATTRIBUTE('attested-at'),
        detail: 'Must not be in the future.',
      },
    ]);
  }
  if (now.getTime() - attestedAt.getTime() > ATTESTED_AT_MAX_AGE_DAYS * DAY_MS) {
    throw new UnprocessableContentError('The attestation is too old.', [
      {
        location: 'body',
        pointer: ATTRIBUTE('attested-at'),
        detail: `Must be within the last ${String(ATTESTED_AT_MAX_AGE_DAYS)} days.`,
      },
    ]);
  }
  const categories = attributes['data-categories'];
  if (categories.includes('biometric') && !attributes['explicit-biometric']) {
    throw new ConnectProblemError(
      'explicit_consent_required',
      'A consent covering biometric data needs explicit-biometric.',
    );
  }

  const connection = await getConsentConnection(db, organizationId, attributes['connection-id']);
  if (connection === null) {
    throw connectNotFound();
  }
  let subject: {
    type: 'inquiry' | 'account' | 'transaction' | 'share-token';
    id: string;
  };
  let recipientOrganizationId: string;
  let shareTokenId: string | null = null;
  let declineInquiries: string[];
  let declineAccounts: string[] = [];
  if (side === 'source') {
    // C236.6: a source record's recipient is the connection's destination, never another.
    if (connection.sourceOrganizationId !== organizationId) {
      throw connectNotFound();
    }
    const found = await attestedSubject(db, environmentId, attributes['subject-id'] ?? '');
    subject = found;
    recipientOrganizationId = connection.destinationOrganizationId;
    ({ inquiryIds: declineInquiries, accountIds: declineAccounts } = await declineScope(
      db,
      environmentId,
      found,
    ));
  } else {
    if (connection.destinationOrganizationId !== organizationId) {
      throw connectNotFound();
    }
    const token = await crossTenant.getInboundShareToken(
      db,
      {
        organizationId,
        environmentId,
        environmentKind: acting.environmentKind,
      },
      attributes['share-token-id'] ?? '',
    );
    if (token.connectionId !== connection.id) {
      throw connectNotFound();
    }
    shareTokenId = token.id;
    subject = { type: 'share-token', id: token.id };
    recipientOrganizationId = organizationId;
    declineInquiries = token.reservedInquiryId === null ? [] : [token.reservedInquiryId];
  }

  if (
    await hasStandingDecline(db, environmentId, {
      recipientOrganizationId,
      purpose: 'share.reuse-kyc',
      inquiryIds: declineInquiries,
      accountIds: declineAccounts,
      now,
    })
  ) {
    throw new ConnectProblemError(
      'consent_declined_in_flow',
      'The person declined this share in the flow, and the decline still stands.',
    );
  }

  const recipientName = await organizationNameOf(db, recipientOrganizationId);
  const textBody = attributes['text-body'].normalize('NFC');
  const id = deps.ids.newId('cnsr');
  const input: NewOpenedConsentRecord = {
    id,
    side,
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: subject.type,
    subjectId: subject.id,
    connectionId: connection.id,
    shareTokenId,
    recipientOrganizationId,
    recipientName,
    dataCategories: [...categories],
    explicitBiometric: attributes['explicit-biometric'],
    textLocale: attributes['text-locale'],
    textKeys: [],
    textSha256: consentBodyDigest(textBody),
    attestedTextBody: textBody,
    method: 'attested',
    evidenceReference: attributes['evidence-reference'],
    attestedAt,
    attestedByType: acting.actor.type === 'user' ? 'user' : 'api-key',
    attestedById: acting.actor.id,
    expiresAt: new Date(now.getTime() + attributes['expires-in-seconds'] * 1000),
    createdAt: now,
  };
  const { record, staged } = await db.transaction(async (tx) => {
    const created = await createConsentRecord(tx, environmentId, input);
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'consent-record.created',
        resourceType: 'consent-record',
        resourceId: created.id,
        metadata: { method: 'attested', side },
      }),
    );
    return {
      record: created,
      staged: await stageConsentRecordEvent(tx, deps, created, 'consent-record.created'),
    };
  });
  await deps.events.dispatch([staged]);
  const pii = acting.mask.visible;
  return {
    data: consentRecordResource(await servedConsentRecord(db, record, pii), {
      pii,
      now,
    }),
  };
}

/** What a `flow` record holds (C236.4, C236.11): the server's composition and the person's act. */
export interface FlowConsentInput {
  environmentId: string;
  side: 'source' | 'destination';
  outcome: 'accepted' | 'declined';
  /** The inquiry whose session recorded it (both sides: the destination's is the filled inquiry). */
  inquiryId: string;
  sessionId: string;
  connectionId: string;
  shareTokenId: string | null;
  recipientOrganizationId: string;
  recipientName: string;
  categories: readonly string[];
  explicitBiometric: boolean;
  text: {
    locale: string;
    keys: readonly string[];
    sha256: string;
    body: string;
  };
  biometric: { sha256: string; body: string } | null;
  /** The session's address and user agent; never kept on a decline (C236.11). */
  ip: string | null;
  userAgent: string | null;
  /** The step's `consentValidSeconds`. */
  validSeconds: number;
  now: Date;
}

/**
 * C236.4, C236.11: a `flow` record in `tx` (the exit's transaction), with its texts stored once per
 * digest and its event staged; an accepted record keeps the sealed address and user agent, a decline
 * keeps neither nor a text copy beyond the digest. A system audit entry names it (no principal).
 */
export async function recordFlowConsentInTx(
  tx: Db,
  deps: Pick<ConsentDeps, 'ids' | 'events' | 'clock'>,
  input: FlowConsentInput,
): Promise<{ record: OpenedConsentRecord; staged: StagedEvent }> {
  const accepted = input.outcome === 'accepted';
  if (accepted) {
    await insertConsentTextIfAbsent(tx, input.environmentId, {
      sha256: input.text.sha256,
      locale: input.text.locale,
      body: input.text.body,
    });
    if (input.biometric !== null) {
      await insertConsentTextIfAbsent(tx, input.environmentId, {
        sha256: input.biometric.sha256,
        locale: input.text.locale,
        body: input.biometric.body,
      });
    }
  }
  const record = await createConsentRecord(tx, input.environmentId, {
    id: deps.ids.newId('cnsr'),
    side: input.side,
    outcome: input.outcome,
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: input.inquiryId,
    connectionId: input.connectionId,
    shareTokenId: input.shareTokenId,
    recipientOrganizationId: input.recipientOrganizationId,
    recipientName: input.recipientName,
    dataCategories: [...input.categories],
    explicitBiometric: accepted && input.explicitBiometric,
    textLocale: input.text.locale,
    textKeys: [...input.text.keys],
    textSha256: input.text.sha256,
    biometricTextSha256: accepted ? (input.biometric?.sha256 ?? null) : null,
    method: 'flow',
    sessionId: input.sessionId,
    evidenceIp: accepted ? input.ip : null,
    evidenceUserAgent: accepted ? input.userAgent : null,
    acceptedAt: accepted ? input.now : null,
    expiresAt: new Date(input.now.getTime() + input.validSeconds * 1000),
    createdAt: input.now,
  });
  await appendSystemAuditEntry(tx, input.environmentId, {
    action: accepted ? 'consent-record.created' : 'consent-record.declined',
    resourceType: 'consent-record',
    resourceId: record.id,
    metadata: { method: 'flow', side: input.side },
  });
  const staged = await stageConsentRecordEvent(
    tx,
    deps,
    record,
    accepted ? 'consent-record.created' : 'consent-record.declined',
  );
  return { record, staged };
}
