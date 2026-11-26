import { canTransitionInquiry, InvalidInquiryTransitionError } from '@openverify/core';
import { and, asc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  inquiries,
  type Inquiry,
  type InquiryFields,
  type InquiryRow,
  type InquiryStatus,
} from '../schema.js';
import { openJson, openOptional, sealJson, sealOptional } from '../sealed.js';
import { resolveInquiryAccount } from './accounts.js';
import {
  newestFirst,
  paginate,
  type CursorTable,
  type Page,
  type PageRequest,
} from './pagination.js';
import {
  allFilters,
  createdAtRange,
  equalsAny,
  firstOrNull,
  hasAnyTag,
  inserted,
  type CreatedAtRange,
  type OneOrMany,
} from './rows.js';
import { DEFAULT_SWEEP_LIMIT, type SweepOptions } from './sweeps.js';
import { applyTagOperation, type TagOperation, type TagUpdate } from './tags.js';

export interface NewInquiryInput {
  id: string;
  inquiryTemplateId: string;
  /** The template's current version; it must belong to `inquiryTemplateId`. */
  inquiryTemplateVersionId: string;
  /**
   * C13: the inquiry's account, which must be in this environment. When omitted (Phase 1
   * callers), the account is resolved from `referenceId` like `resolveInquiryAccount` does.
   */
  accountId?: string;
  referenceId?: string | null;
  fields?: InquiryFields;
  /** C10: defaults to one day after creation. */
  expiresAt?: Date;
  tags?: readonly string[];
  /** C10 operator note; sealed for the row. */
  note?: string | null;
  /**
   * C149.4 (Workflow 9A Stage 1b (S)): the prefill to keep as the initial fields, sealed for the
   * row and never changed; left out or empty, none is kept.
   */
  initialFields?: InquiryFields;
  /** C158.4 (Workflow 9A Stage 1b (F)): the redirect the API checked; left out, none. */
  redirectUri?: string | null;
  /** C160.7 (Workflow 9A Stage 1b (H)): the theme set the API checked; left out, none. */
  themeSetId?: string | null;
  /**
   * C151.10 (Workflow 9B Stage 1b (F); contracts B44): this inquiry's own expiry windows from
   * `POST /inquiries`' `meta` (`INQUIRY_EXPIRY_OVERRIDE_COLUMNS`), in seconds within C11's bounds
   * (`INQUIRY_EXPIRY_OVERRIDE_SECONDS`); left out or `null`, the pinned version's setting decides.
   */
  expirationAfterStartSeconds?: number | null;
  expirationAfterResumeSeconds?: number | null;
  oneTimeLinkExpirationSeconds?: number | null;
}

/** An inquiry's account did not resolve: `accountId` is not in this environment. */
export class InquiryAccountNotFoundError extends Error {
  override name = 'InquiryAccountNotFoundError';
  readonly code = 'account_not_found';

  constructor() {
    super('the inquiry account is not in this environment');
  }
}

export interface ListInquiriesOptions extends PageRequest, CreatedAtRange {
  /** `filter[status]`: one status or several. */
  status?: OneOrMany<InquiryStatus> | undefined;
  /** `filter[reference-id]`: one or several. */
  referenceId?: OneOrMany<string> | undefined;
  /** C10 `filter[account-id]`. */
  accountId?: OneOrMany<string> | undefined;
  /** C10 `filter[inquiry-template-id]`. */
  inquiryTemplateId?: OneOrMany<string> | undefined;
  /** C10 `filter[tag]`: any of these tags, ignoring case. */
  tag?: OneOrMany<string> | undefined;
  /**
   * C165.3 (Workflow 9B Stage 1b (X)): the conditions the list filter hook answers
   * (`inquiryListFilters`, `api-exports`), on `inquiries`, ANDed with the rest.
   */
  where?: readonly SQL[] | undefined;
}

/** C10 `PATCH /inquiries/:id`. */
export interface InquiryChanges {
  /** Merged into the current fields. The API allows it only while `created` or `pending`. */
  fields?: InquiryFields;
  referenceId?: string | null;
  /** At most 2,000 characters (checked by the API); `null` clears it. */
  note?: string | null;
}

/** An open inquiry whose `expires_at` has passed (C10 expiry sweep). */
export interface OverdueInquiry {
  id: string;
  environmentId: string;
  status: InquiryStatus;
  expiresAt: Date;
}

export interface InquiryTransition {
  /** The status the caller read; the update only applies if it is still current. */
  from: InquiryStatus;
  to: InquiryStatus;
  /** Time for the status timestamp; defaults to the database clock. */
  at?: Date;
  /** C128.6: names the `declined -> needs_review` edge (Stage 1a amendment 46). */
  reopen?: boolean;
}

type StatusTimestamp = 'startedAt' | 'completedAt' | 'failedAt' | 'expiredAt' | 'decisionedAt';

/** Which timestamp entering each status sets. `created` and `needs_review` set none. */
const STATUS_TIMESTAMP: Partial<Record<InquiryStatus, StatusTimestamp>> = {
  pending: 'startedAt',
  completed: 'completedAt',
  failed: 'failedAt',
  expired: 'expiredAt',
  approved: 'decisionedAt',
  declined: 'decisionedAt',
};

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(inquiries.id, id), eq(inquiries.environmentId, environmentId));

const inquiryCursor: CursorTable = {
  table: inquiries,
  id: inquiries.id,
  scope: inquiries.environmentId,
  createdAt: inquiries.createdAt,
};

/** Opens the row's sealed note and drops the ciphertext. */
export function toInquiry(row: InquiryRow): Inquiry {
  const { noteSealed, ...rest } = row;
  // C149.4: the initial fields never leave the row here (`getInquiryInitialFields` reads them).
  const inquiry: Omit<typeof rest, 'initialFieldsSealed'> & { initialFieldsSealed?: unknown } = {
    ...rest,
  };
  delete inquiry.initialFieldsSealed;
  return { ...inquiry, note: openOptional(SEALED.inquiryNote, row.id, noteSealed) };
}

/**
 * Creates an inquiry in status `created` (C2 `POST /inquiries`). Without `accountId`, the
 * account is resolved (or created) in the same transaction.
 *
 * @throws {InquiryAccountNotFoundError} when `accountId` is not in this environment; the
 * database would refuse it anyway, this names the reason.
 */
export async function createInquiry(
  db: Db,
  environmentId: string,
  input: NewInquiryInput,
): Promise<Inquiry> {
  return db.transaction(async (tx) => {
    const accountId = await resolveInquiryAccount(tx, environmentId, {
      accountId: input.accountId,
      referenceId: input.referenceId,
    });
    if (accountId === null) {
      throw new InquiryAccountNotFoundError();
    }
    const rows = await tx
      .insert(inquiries)
      .values({
        id: input.id,
        environmentId,
        inquiryTemplateId: input.inquiryTemplateId,
        inquiryTemplateVersionId: input.inquiryTemplateVersionId,
        accountId,
        referenceId: input.referenceId ?? null,
        fields: input.fields ?? {},
        tags: [...(input.tags ?? [])],
        noteSealed: sealOptional(SEALED.inquiryNote, input.id, input.note),
        initialFieldsSealed:
          input.initialFields === undefined || Object.keys(input.initialFields).length === 0
            ? null
            : sealJson(SEALED.inquiryInitialFields, input.id, input.initialFields),
        redirectUri: input.redirectUri ?? null,
        themeSetId: input.themeSetId ?? null,
        expirationAfterStartSeconds: input.expirationAfterStartSeconds ?? null,
        expirationAfterResumeSeconds: input.expirationAfterResumeSeconds ?? null,
        oneTimeLinkExpirationSeconds: input.oneTimeLinkExpirationSeconds ?? null,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      })
      .returning();
    return toInquiry(inserted(rows, 'createInquiry'));
  });
}

/**
 * C149.4: the fields the inquiry was created with, opened; `null` when it kept none (created without
 * fields, before Workflow 9A, or redacted), or when the inquiry is not in this environment.
 */
export async function getInquiryInitialFields(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryFields | null> {
  const row = firstOrNull(
    await db
      .select({ sealed: inquiries.initialFieldsSealed })
      .from(inquiries)
      .where(inEnvironment(environmentId, id))
      .limit(1),
  );
  return row?.sealed == null
    ? null
    : (openJson(SEALED.inquiryInitialFields, id, row.sealed) as InquiryFields);
}

export async function getInquiry(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Inquiry | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(inquiries)
      .where(and(eq(inquiries.id, id), eq(inquiries.environmentId, environmentId)))
      .limit(1),
  );
  return row === null ? null : toInquiry(row);
}

/**
 * Locks the inquiry's row (`SELECT ... FOR UPDATE`) until the caller's transaction ends, so
 * work that reads and then writes the inquiry's verifications is serialized per inquiry.
 * Returns the inquiry's status, or `null` when it is not in this environment. Call it with a
 * transaction; on a plain client the lock ends with the statement.
 */
export async function lockInquiry(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryStatus | null> {
  const row = firstOrNull(
    await db
      .select({ status: inquiries.status })
      .from(inquiries)
      .where(and(eq(inquiries.id, id), eq(inquiries.environmentId, environmentId)))
      .for('update'),
  );
  return row?.status ?? null;
}

/** C2/C10 `GET /inquiries`: newest first, with the C10 filters. */
export async function listInquiries(
  db: Db,
  environmentId: string,
  options: ListInquiriesOptions = {},
): Promise<Page<Inquiry>> {
  const filters = allFilters([
    eq(inquiries.environmentId, environmentId),
    equalsAny(inquiries.status, options.status),
    equalsAny(inquiries.referenceId, options.referenceId),
    equalsAny(inquiries.accountId, options.accountId),
    equalsAny(inquiries.inquiryTemplateId, options.inquiryTemplateId),
    hasAnyTag(inquiries.tags, options.tag),
    ...createdAtRange(inquiries.createdAt, options),
    ...(options.where ?? []),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, inquiryCursor, environmentId, options, async (after, limit) =>
    (
      await db
        .select()
        .from(inquiries)
        .where(and(...filters, after))
        .orderBy(...newestFirst(inquiryCursor))
        .limit(limit)
    ).map(toInquiry),
  );
}

/**
 * C10 `PATCH /inquiries/:id`: merges `fields`, sets the reference id and the sealed note,
 * under a row lock. `null` when the inquiry is not in this environment.
 */
export async function updateInquiry(
  db: Db,
  environmentId: string,
  id: string,
  changes: InquiryChanges,
): Promise<Inquiry | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx.select().from(inquiries).where(inEnvironment(environmentId, id)).for('update'),
    );
    if (current === null) {
      return null;
    }
    const set: Partial<typeof inquiries.$inferInsert> = {};
    if (changes.fields !== undefined) set.fields = { ...current.fields, ...changes.fields };
    if (changes.referenceId !== undefined) set.referenceId = changes.referenceId;
    if (changes.note !== undefined)
      set.noteSealed = sealOptional(SEALED.inquiryNote, id, changes.note);
    if (Object.keys(set).length === 0) {
      return toInquiry(current);
    }
    const row = firstOrNull(
      await tx.update(inquiries).set(set).where(inEnvironment(environmentId, id)).returning(),
    );
    return row === null ? null : toInquiry(row);
  });
}

async function changeInquiryTags(
  db: Db,
  environmentId: string,
  id: string,
  operation: TagOperation,
): Promise<TagUpdate<Inquiry> | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx.select().from(inquiries).where(inEnvironment(environmentId, id)).for('update'),
    );
    if (current === null) {
      return null;
    }
    const { tags, changed } = applyTagOperation(current.tags, operation);
    if (!changed) {
      return { record: toInquiry(current), changed };
    }
    const row = inserted(
      await tx.update(inquiries).set({ tags }).where(inEnvironment(environmentId, id)).returning(),
      'changeInquiryTags',
    );
    return { record: toInquiry(row), changed };
  });
}

/**
 * C10 `add-tag`; a tag already present (ignoring case) changes nothing.
 * @throws {TagLimitError} when the inquiry already has 50 tags.
 */
export const addInquiryTag = (db: Db, environmentId: string, id: string, tag: string) =>
  changeInquiryTags(db, environmentId, id, { kind: 'add', tag });

/** C10 `remove-tag`, ignoring case. */
export const removeInquiryTag = (db: Db, environmentId: string, id: string, tag: string) =>
  changeInquiryTags(db, environmentId, id, { kind: 'remove', tag });

/**
 * C10 `set-tags`: replaces the list, deduplicated ignoring case.
 * @throws {TagLimitError} with more than 50 tags.
 */
export const setInquiryTags = (
  db: Db,
  environmentId: string,
  id: string,
  tags: readonly string[],
) => changeInquiryTags(db, environmentId, id, { kind: 'set', tags });

/**
 * The C10 `inquiry-expiry` sweep: `created` and `pending` inquiries whose `expires_at` has
 * passed, oldest expiry first, across environments (each row carries its environment for
 * the tenant-scoped transition that follows). With `lock`, rows are taken `FOR UPDATE
 * SKIP LOCKED` inside the caller's transaction.
 */
export async function listOverdueInquiries(
  db: Db,
  options: SweepOptions = {},
): Promise<OverdueInquiry[]> {
  const query = db
    .select({
      id: inquiries.id,
      environmentId: inquiries.environmentId,
      status: inquiries.status,
      expiresAt: inquiries.expiresAt,
    })
    .from(inquiries)
    .where(
      and(
        inArray(inquiries.status, ['created', 'pending']),
        lte(inquiries.expiresAt, options.now ?? new Date()),
      ),
    )
    .orderBy(asc(inquiries.expiresAt), asc(inquiries.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true ? query.for('update', { skipLocked: true }) : query;
}

/**
 * Owner decision 5 after Workflow 6C: the moves that a redaction ends. A redacted open inquiry is
 * never started, completed or failed; it still expires at its `expires_at` (so it leaves the
 * expiry sweep's selection), and moves out of `completed`, `failed` and `needs_review` stay as
 * they were.
 */
const ENDED_BY_REDACTION: ReadonlySet<InquiryStatus> = new Set(['pending', 'completed', 'failed']);

/**
 * Moves an inquiry from `from` to `to` and stamps the matching timestamp. The update is
 * conditional on the status still being `from` (optimistic concurrency), so two workers
 * cannot both complete an inquiry: the loser gets `null`, as does a missing inquiry.
 *
 * A move to `pending`, `completed` or `failed` is also conditional on `redacted_at` being null
 * (owner decision 5 after Workflow 6C), and gives `null` for a redacted inquiry. Redaction locks
 * the row (`redactInquiryRecords`), and under read committed Postgres re-checks this WHERE clause
 * against the row a concurrent redaction committed, so whichever commits first wins.
 *
 * @throws {InvalidInquiryTransitionError} when the state machine forbids the transition.
 */
export async function transitionInquiryStatus(
  db: Db,
  environmentId: string,
  id: string,
  transition: InquiryTransition,
): Promise<Inquiry | null> {
  const { from, to, reopen } = transition;
  if (!canTransitionInquiry(from, to, { reopen: reopen === true })) {
    throw new InvalidInquiryTransitionError(from, to);
  }
  const set: PgUpdateSetSource<typeof inquiries> = { status: to };
  const stamp = STATUS_TIMESTAMP[to];
  if (stamp !== undefined) {
    set[stamp] = transition.at ?? sql`now()`;
  }
  const row = firstOrNull(
    await db
      .update(inquiries)
      .set(set)
      .where(
        and(
          eq(inquiries.id, id),
          eq(inquiries.environmentId, environmentId),
          eq(inquiries.status, from),
          ENDED_BY_REDACTION.has(to) ? isNull(inquiries.redactedAt) : undefined,
        ),
      )
      .returning(),
  );
  return row === null ? null : toInquiry(row);
}
