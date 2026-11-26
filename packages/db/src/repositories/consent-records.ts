/**
 * C236, C237, C241.3 (Workflow 11A): consent records, own-environment side. Every function takes the
 * caller's environment id; the other side's records (the redeem job's read of the source record, the
 * access export's counterparty read) are `consent-records.cross-env.ts`.
 *
 * The four sealed columns (`attested_text_body`, `evidence_ip`, `evidence_user_agent`,
 * `evidence_reference`) are sealed for the record's id on write and opened on read, so callers see
 * plaintext ({@link OpenedConsentRecord}) and never a ciphertext. The status is derived, never stored
 * (review H27): {@link consentRecordStatusOf} in code, the same rule in SQL for the list filter.
 *
 * Declared as stubs by `foundation-11a` (Stage 1b (K)); built by `api-consent` (its file).
 */
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealOptional } from '../sealed.js';
import {
  connectConnections,
  connectShareTokens,
  consentRecords,
  type ConnectConsentRecord,
} from '../tables/connect.js';
import { inquiries } from '../tables/inquiries.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** C241.4: `expired` and `failed` tokens are kept this many days after they ended (as one-time links). */
const ENDED_TOKEN_RETENTION_DAYS = 30;

/** The derived statuses of a record (C236.1, review H27). */
export const CONSENT_RECORD_STATUS_VALUES = [
  'active',
  'expired',
  'withdrawn',
  'redacted',
  'declined',
] as const;
export type ConsentRecordStatusValue = (typeof CONSENT_RECORD_STATUS_VALUES)[number];

type SealedMember = 'attestedTextBody' | 'evidenceIp' | 'evidenceUserAgent' | 'evidenceReference';

/** A record with its sealed members opened (plaintext, or `null` when absent or redacted). */
export type OpenedConsentRecord = Omit<ConnectConsentRecord, SealedMember> &
  Record<SealedMember, string | null>;

/** What a caller writes: the sealed members in plaintext, sealed here for the record's id. */
export type NewOpenedConsentRecord = Omit<
  typeof consentRecords.$inferInsert,
  SealedMember | 'environmentId'
> & {
  id: string;
  attestedTextBody?: string | null;
  evidenceIp?: string | null;
  evidenceUserAgent?: string | null;
  evidenceReference?: string | null;
};

const SEALED_COLUMNS: Readonly<Record<SealedMember, string>> = Object.freeze({
  attestedTextBody: SEALED.consentAttestedTextBody,
  evidenceIp: SEALED.consentEvidenceIp,
  evidenceUserAgent: SEALED.consentEvidenceUserAgent,
  evidenceReference: SEALED.consentEvidenceReference,
});

function opened(row: ConnectConsentRecord): OpenedConsentRecord {
  return {
    ...row,
    attestedTextBody: openOptional(SEALED_COLUMNS.attestedTextBody, row.id, row.attestedTextBody),
    evidenceIp: openOptional(SEALED_COLUMNS.evidenceIp, row.id, row.evidenceIp),
    evidenceUserAgent: openOptional(
      SEALED_COLUMNS.evidenceUserAgent,
      row.id,
      row.evidenceUserAgent,
    ),
    evidenceReference: openOptional(
      SEALED_COLUMNS.evidenceReference,
      row.id,
      row.evidenceReference,
    ),
  };
}

/**
 * C236.1 (review H27): the derived status. A decline stays `declined` whatever happened to it; a
 * redacted record is `redacted`, then `withdrawn`, then `expired` once `now` reaches `expires-at`.
 */
export function consentRecordStatusOf(
  record: Pick<OpenedConsentRecord, 'outcome' | 'redactedAt' | 'withdrawnAt' | 'expiresAt'>,
  now: Date,
): ConsentRecordStatusValue {
  if (record.outcome === 'declined') return 'declined';
  if (record.redactedAt !== null) return 'redacted';
  if (record.withdrawnAt !== null) return 'withdrawn';
  return record.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}

/** The same rule as {@link consentRecordStatusOf}, in SQL, for the list filter. */
const statusSql = (now: Date): SQL => sql`case
  when ${consentRecords.outcome} = 'declined' then 'declined'
  when ${consentRecords.redactedAt} is not null then 'redacted'
  when ${consentRecords.withdrawnAt} is not null then 'withdrawn'
  when ${consentRecords.expiresAt} <= ${now} then 'expired'
  else 'active' end`;

const ofRecord = (environmentId: string, id: string) =>
  and(eq(consentRecords.environmentId, environmentId), eq(consentRecords.id, id));

/** C236.4, C236.5, C236.11: a `flow` (accepted or declined) or `attested` record. */
export async function createConsentRecord(
  tx: Db,
  environmentId: string,
  input: NewOpenedConsentRecord,
): Promise<OpenedConsentRecord> {
  const { id } = input;
  const row = inserted(
    await tx
      .insert(consentRecords)
      .values({
        ...input,
        environmentId,
        attestedTextBody: sealOptional(SEALED_COLUMNS.attestedTextBody, id, input.attestedTextBody),
        evidenceIp: sealOptional(SEALED_COLUMNS.evidenceIp, id, input.evidenceIp),
        evidenceUserAgent: sealOptional(
          SEALED_COLUMNS.evidenceUserAgent,
          id,
          input.evidenceUserAgent,
        ),
        evidenceReference: sealOptional(
          SEALED_COLUMNS.evidenceReference,
          id,
          input.evidenceReference,
        ),
      })
      .returning(),
    'consent record',
  );
  return opened(row);
}

/** C236.2: a record of the environment, or null (the caller answers the one 404). */
export async function getConsentRecord(
  db: Db,
  environmentId: string,
  id: string,
): Promise<OpenedConsentRecord | null> {
  const row = firstOrNull(
    await db.select().from(consentRecords).where(ofRecord(environmentId, id)),
  );
  return row === null ? null : opened(row);
}

/** The filters of C236.2's list, each optional. */
export interface ConsentRecordListFilters {
  /** The subject's id (the record's subject, or the token of a destination record). */
  subjectIds?: readonly string[] | undefined;
  side?: 'source' | 'destination' | undefined;
  statuses?: readonly ConsentRecordStatusValue[] | undefined;
  connectionIds?: readonly string[] | undefined;
  /** The time the derived status is read at. */
  now: Date;
  page?: PageRequest | undefined;
}

const consentCursor = environmentCursor(consentRecords);

/** C236.2: newest first (C1), filtered by subject, side, status and connection. */
export async function listConsentRecords(
  db: Db,
  environmentId: string,
  filters: ConsentRecordListFilters,
): Promise<Page<OpenedConsentRecord>> {
  const conditions: (SQL | undefined)[] = [
    eq(consentRecords.environmentId, environmentId),
    filters.subjectIds === undefined
      ? undefined
      : or(
          inArray(consentRecords.subjectId, [...filters.subjectIds]),
          and(
            eq(consentRecords.subjectType, 'share-token'),
            inArray(consentRecords.shareTokenId, [...filters.subjectIds]),
          ),
        ),
    filters.side === undefined ? undefined : eq(consentRecords.side, filters.side),
    filters.statuses === undefined
      ? undefined
      : sql`${statusSql(filters.now)} in (${sql.join(
          filters.statuses.map((status) => sql`${status}`),
          sql`, `,
        )})`,
    filters.connectionIds === undefined
      ? undefined
      : inArray(consentRecords.connectionId, [...filters.connectionIds]),
  ];
  if (
    filters.subjectIds?.length === 0 ||
    filters.statuses?.length === 0 ||
    filters.connectionIds?.length === 0
  ) {
    return { items: [], next: null };
  }
  const page = await paginate(
    db,
    consentCursor,
    environmentId,
    filters.page ?? {},
    (after, limit) =>
      db
        .select()
        .from(consentRecords)
        .where(and(...conditions, after))
        .orderBy(...newestFirst(consentCursor))
        .limit(limit),
  );
  return { items: page.items.map(opened), next: page.next };
}

/**
 * C237.2, C287.2: the record under a row lock, `FOR UPDATE` (a withdrawal) or `FOR SHARE` (a
 * redemption while it commits), taken after the connection and before the token (C231.4).
 */
export async function lockConsentRecord(
  tx: Db,
  environmentId: string,
  id: string,
  mode: 'update' | 'share',
): Promise<OpenedConsentRecord | null> {
  const query = tx.select().from(consentRecords).where(ofRecord(environmentId, id));
  const row = firstOrNull(await (mode === 'update' ? query.for('update') : query.for('share')));
  return row === null ? null : opened(row);
}

/**
 * C237.2: withdraws a record not yet withdrawn, with its channel and reason; `null` when it already
 * was (the caller answers 409 `consent_already_withdrawn`) or does not exist.
 */
export async function withdrawConsentRecord(
  tx: Db,
  environmentId: string,
  id: string,
  change: {
    withdrawnAt: Date;
    withdrawnVia: 'api' | 'operator' | 'flow';
    withdrawalReason?: 'subject-request' | 'operator-decision' | 'other' | null | undefined;
  },
): Promise<OpenedConsentRecord | null> {
  const row = firstOrNull(
    await tx
      .update(consentRecords)
      .set({
        withdrawnAt: change.withdrawnAt,
        withdrawnVia: change.withdrawnVia,
        withdrawalReason: change.withdrawalReason ?? null,
      })
      .where(and(ofRecord(environmentId, id), isNull(consentRecords.withdrawnAt)))
      .returning(),
  );
  return row === null ? null : opened(row);
}

/** A redacted object, as the cascade names it. */
export interface ConsentRecordSubject {
  type: 'inquiry' | 'account' | 'transaction' | 'verification' | 'share-token';
  id: string;
}

/**
 * C241.3, C236.10: the subject's redaction redacts every record about it: its sealed evidence, its
 * attested text, its text keys, its session and its link to the subject are cleared, and
 * `redacted_at` set. The bare fact (time, side, purpose, recipient, categories, digest, method,
 * withdrawal) stays for `consent-proof-retention-days`. Answers the records it redacted.
 */
export async function redactConsentRecordsOfSubject(
  tx: Db,
  environmentId: string,
  subject: ConsentRecordSubject,
  at: Date,
): Promise<OpenedConsentRecord[]> {
  const rows = await tx
    .update(consentRecords)
    .set({
      redactedAt: at,
      subjectType: null,
      subjectId: null,
      textKeys: [],
      sessionId: null,
      attestedTextBody: null,
      evidenceIp: null,
      evidenceUserAgent: null,
      evidenceReference: null,
    })
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        eq(consentRecords.subjectType, subject.type),
        eq(consentRecords.subjectId, subject.id),
        isNull(consentRecords.redactedAt),
      ),
    )
    .returning();
  return rows.map(opened);
}

/**
 * C236.10 (review P10): when a redemption commits, the destination record's subject becomes the
 * destination object, the token id kept as a plain string, so the ordinary redaction cascade reaches
 * the record's evidence. Called by `api-redeem`'s job in its transaction.
 */
export async function setConsentRecordSubject(
  tx: Db,
  environmentId: string,
  id: string,
  subject: ConsentRecordSubject,
): Promise<OpenedConsentRecord | null> {
  const row = firstOrNull(
    await tx
      .update(consentRecords)
      .set({ subjectType: subject.type, subjectId: subject.id })
      .where(and(ofRecord(environmentId, id), isNull(consentRecords.redactedAt)))
      .returning(),
  );
  return row === null ? null : opened(row);
}

/**
 * C236.5 (review H05, verification V08): whether a witnessed decline for this recipient and purpose
 * still stands (`expires_at` after `now`) on one of `inquiryIds` (the attested subject), or on any
 * inquiry of one of `accountIds` (the subject's account, or the attested account itself).
 */
export async function hasStandingDecline(
  db: Db,
  environmentId: string,
  query: {
    recipientOrganizationId: string;
    purpose: string;
    inquiryIds: readonly string[];
    accountIds?: readonly string[] | undefined;
    now: Date;
  },
): Promise<boolean> {
  const accountIds = query.accountIds ?? [];
  if (query.inquiryIds.length === 0 && accountIds.length === 0) {
    return false;
  }
  const subjects = or(
    query.inquiryIds.length === 0
      ? undefined
      : inArray(consentRecords.subjectId, [...query.inquiryIds]),
    accountIds.length === 0
      ? undefined
      : inArray(
          consentRecords.subjectId,
          db
            .select({ id: inquiries.id })
            .from(inquiries)
            .where(
              and(
                eq(inquiries.environmentId, environmentId),
                inArray(inquiries.accountId, [...accountIds]),
              ),
            ),
        ),
  );
  const rows = await db
    .select({ id: consentRecords.id })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        eq(consentRecords.outcome, 'declined'),
        eq(consentRecords.method, 'flow'),
        eq(consentRecords.recipientOrganizationId, query.recipientOrganizationId),
        eq(consentRecords.purpose, query.purpose as 'share.reuse-kyc'),
        eq(consentRecords.subjectType, 'inquiry'),
        subjects,
        sql`${consentRecords.expiresAt} > ${query.now}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * C237.6 (verification V02): this session's accepted `flow` records not withdrawn or redacted,
 * oldest first, at most `limit`.
 */
export async function listSessionShareConsents(
  db: Db,
  environmentId: string,
  sessionId: string,
  limit: number,
): Promise<OpenedConsentRecord[]> {
  const rows = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        eq(consentRecords.sessionId, sessionId),
        eq(consentRecords.method, 'flow'),
        eq(consentRecords.outcome, 'accepted'),
        isNull(consentRecords.withdrawnAt),
        isNull(consentRecords.redactedAt),
      ),
    )
    .orderBy(asc(consentRecords.createdAt), asc(consentRecords.id))
    .limit(limit);
  return rows.map(opened);
}

/** The newest `flow` record of a step's side on this inquiry, for the exits' resubmission check. */
export async function listInquiryFlowConsents(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<OpenedConsentRecord[]> {
  const rows = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        eq(consentRecords.method, 'flow'),
        eq(consentRecords.subjectType, 'inquiry'),
        eq(consentRecords.subjectId, inquiryId),
      ),
    )
    .orderBy(asc(consentRecords.createdAt), asc(consentRecords.id));
  return rows.map(opened);
}

/**
 * C241.3: deletes, across environments, redacted records whose bare fact is past the environment's
 * `consent-proof-retention-days` (default 0) and that no token cites. Answers how many it deleted.
 */
export async function deleteExpiredConsentFacts(db: Db, now: Date, limit: number): Promise<number> {
  const result = await db.execute(sql`
    delete from consent_records r
     where (r.environment_id, r.id) in (
       select c.environment_id, c.id
         from consent_records c
         join environments e on e.id = c.environment_id
        where c.redacted_at is not null
          and c.redacted_at + make_interval(days => coalesce(
                (e.settings ->> 'consent-proof-retention-days')::int, 0)) <= ${now}
          and not exists (select 1 from connect_share_tokens t
                           where t.environment_id = c.environment_id
                             and t.consent_record_id = c.id)
          and not exists (select 1 from connect_share_tokens t
                           where t.destination_environment_id = c.environment_id
                             and t.destination_consent_record_id = c.id)
        limit ${limit}
        for update of c skip locked)
    returning r.id`);
  return (result as { rows: unknown[] }).rows.length;
}

/** The ids of every record whose subject is one of `subjects` (a redaction's reach). */
export async function listConsentRecordsOfSubjects(
  db: Db,
  environmentId: string,
  subjects: readonly ConsentRecordSubject[],
): Promise<OpenedConsentRecord[]> {
  if (subjects.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.environmentId, environmentId),
        or(
          ...subjects.map((subject) =>
            and(
              eq(consentRecords.subjectType, subject.type),
              eq(consentRecords.subjectId, subject.id),
            ),
          ),
        ),
      ),
    );
  return rows.map(opened);
}

/** What a consent record reads of its connection (organisation-scoped, never cross-environment). */
export interface ConsentConnection {
  id: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  status: 'pending' | 'active' | 'inactive' | 'archived';
  currentPolicyId: string | null;
  acceptedPolicyId: string | null;
}

/**
 * C236.5, C238.1: a connection the organisation is a side of, or `null`. A read of the
 * organisation's own connection (as `api-connect`'s `getConnectionOfOrganization`), kept here so the
 * consent paths read only the members they need.
 */
export async function getConsentConnection(
  db: Db,
  organizationId: string,
  id: string,
): Promise<ConsentConnection | null> {
  return firstOrNull(
    await db
      .select({
        id: connectConnections.id,
        sourceOrganizationId: connectConnections.sourceOrganizationId,
        destinationOrganizationId: connectConnections.destinationOrganizationId,
        status: connectConnections.status,
        currentPolicyId: connectConnections.currentPolicyId,
        acceptedPolicyId: connectConnections.acceptedPolicyId,
      })
      .from(connectConnections)
      .where(
        and(
          eq(connectConnections.id, id),
          or(
            eq(connectConnections.sourceOrganizationId, organizationId),
            eq(connectConnections.destinationOrganizationId, organizationId),
          ),
        ),
      ),
  );
}

/** C236.1: the token citing each source record (`share-token`), by record id. */
export async function shareTokensCitingConsentRecords(
  db: Db,
  environmentId: string,
  recordIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (recordIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ record: connectShareTokens.consentRecordId, token: connectShareTokens.id })
    .from(connectShareTokens)
    .where(
      and(
        eq(connectShareTokens.environmentId, environmentId),
        inArray(connectShareTokens.consentRecordId, [...recordIds]),
      ),
    );
  return new Map(rows.map((row) => [row.record, row.token]));
}

/**
 * C237.6 (2): a destination record withdrawn after redemption marks the destination's copies made
 * by `shareTokenId` (`provenance.consent-withdrawn-at`, the first withdrawal kept), so they stop
 * counting under `accept-cloned-results` (C235.4). Answers how many rows it marked.
 */
export async function markShareCopiesConsentWithdrawn(
  tx: Db,
  environmentId: string,
  shareTokenId: string,
  at: Date,
): Promise<number> {
  const mark = (table: string, column: string) => sql`
    update ${sql.identifier(table)}
       set ${sql.identifier(column)} = ${sql.identifier(column)}
             || jsonb_build_object('consent-withdrawn-at', ${at.toISOString()}::text)
     where environment_id = ${environmentId}
       and ${sql.identifier(column)} ->> 'kind' = 'connect-clone'
       and ${sql.identifier(column)} ->> 'share-token-id' = ${shareTokenId}
       and not (${sql.identifier(column)} ? 'consent-withdrawn-at')
    returning 1`;
  let marked = 0;
  for (const [table, column] of [
    ['inquiries', 'provenance'],
    ['verifications', 'provenance'],
    ['verification_checks', 'connect_provenance'],
    ['files', 'provenance'],
  ] as const) {
    const result: unknown = await tx.execute(mark(table, column));
    marked += (result as { rows: unknown[] }).rows.length;
  }
  return marked;
}

/**
 * C241.4 (the C16 pass, `api-consent`'s): deletes up to `limit` share tokens that ended: `expired`
 * and `failed` tokens 30 days after they ended (as one-time links are), and a `redeemed` token (the
 * disclosure record, ids only) once both its source and every destination copy are redacted or gone.
 * Across environments, as every C16 pass reads; answers how many it deleted.
 */
export async function deleteEndedShareTokens(db: Db, now: Date, limit: number): Promise<number> {
  const cutoff = new Date(now.getTime() - ENDED_TOKEN_RETENTION_DAYS * 86_400_000);
  const goneOrRedacted = (type: SQL, environment: SQL, id: SQL): SQL => sql`(case ${type}
    when 'inquiry' then not exists (select 1 from inquiries o
      where o.environment_id = ${environment} and o.id = ${id} and o.redacted_at is null)
    when 'account' then not exists (select 1 from accounts o
      where o.environment_id = ${environment} and o.id = ${id} and o.redacted_at is null)
    when 'transaction' then not exists (select 1 from transactions o
      where o.environment_id = ${environment} and o.id = ${id} and o.redacted_at is null)
    when 'verification' then not exists (select 1 from verifications v
      join inquiries o on o.environment_id = v.environment_id and o.id = v.inquiry_id
      where v.environment_id = ${environment} and v.id = ${id} and o.redacted_at is null)
    else true end)`;
  const result: unknown = await db.execute(sql`
    delete from connect_share_tokens t
     where t.id in (
       select c.id from connect_share_tokens c
        where (c.status = 'expired' and c.expired_at <= ${cutoff})
           or (c.status = 'failed' and c.failed_at <= ${cutoff})
           or (c.status = 'redeemed'
               and ${goneOrRedacted(sql.raw('c.source_type'), sql.raw('c.environment_id'), sql.raw('c.source_id'))}
               and ${goneOrRedacted(
                 sql.raw("coalesce(c.destination_type, 'inquiry')"),
                 sql.raw('c.destination_environment_id'),
                 sql.raw('coalesce(c.destination_id, c.reserved_inquiry_id)'),
               )})
        limit ${limit}
        for update of c skip locked)
    returning t.id`);
  return (result as { rows: unknown[] }).rows.length;
}
