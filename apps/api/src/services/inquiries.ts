/**
 * Inquiries (contracts C2, C10 and C13): creation with its account and expiry, reads with PII
 * masking (C15), changes, tags, and the status lifecycle.
 *
 * Every status change goes through {@link transitionInquiryInTx}: the core state machine
 * (`transitionInquiry`), the conditional status update, the status's own event plus
 * `inquiry.transitioned` with `meta: { from, to }`, and, when the inquiry leaves `created` or
 * `pending`, the cancellation of its active sessions (and, on expiry, of its `initiated`
 * verifications), all staged in one transaction. The API actions, the sandbox simulation, the
 * flow's start, the worker's outcome and the expiry job share it.
 */
import { checkInquiryRedirectUri } from './embed-origins.js';
import { checkThemeSetChoice } from './themes/settings.js';
import { validateInquiryFieldsWrite } from './templates/fields.js';
import {
  buildFlowUrl,
  buildInquiryResource,
  filterValues,
  idSchema,
  newSessionToken,
  tagInputSchema,
  type AuditActor,
  type CreateInquiryAttributes,
  type DecisionMeta,
  type InquiryInclude,
  type InquiryIncludeDocument,
  type InquiryListDocument,
  type InquiryRecord,
  type InquiryResource,
  type ListInquiriesQuery,
  type ResumeInquiryDocument,
  type UpdateInquiryBody,
} from '@openverify/contracts';
import {
  addTag,
  canTransitionInquiry,
  DomainError,
  InvalidInquiryTransitionError,
  inquiryStatusSchema,
  normalizeTag,
  normalizeTags,
  removeTag,
  transitionInquiry,
  type InquiryStatus,
} from '@openverify/core';
import {
  createInquiry as insertInquiry,
  createInquirySession,
  deleteFaceDataForInquiry,
  getEnvironment,
  getInquiry,
  getListScreening,
  getInquiryTemplate,
  hashSessionToken,
  InquiryAccountNotFoundError,
  listInquiries as findInquiries,
  listGovernmentIdExtractions,
  listInquiryVerifications,
  listInquiryListScreenings,
  listSelfieCaptures,
  lockInquiry,
  resolveSignalSettings,
  revokeOneTimeLinks,
  setInquiryTags,
  transitionInquiryStatus,
  updateInquiry as updateInquiryRow,
  verifications,
  type Db,
  type Inquiry,
  type ListScreening,
  type VerificationType,
} from '@openverify/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { UNMASKED, type PiiMask } from '../auth/pii.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ForbiddenError,
  RedactedError,
  TemplateArchivedError,
  UnprocessableContentError,
} from '../errors.js';
import { inquiryRecordOf } from '../jobs/records.js';
import type { Clock, ServiceContext } from '../ports.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from './context.js';
import { inquiryDecisionGuardInTx } from './decisions/guard.js';
import {
  recordInquiryDecisionInTx,
  type InquiryDecisionInput,
  type RecordInquiryDecision,
} from './decisions/record.js';
import { includedDecisionsFor } from './decisions/resources.js';
import { pinnedSettings, templateVersionSettings } from './inquiry-templates.js';
import { createInquiryReportsInTx, runsCompletionReports } from './reports/completion.js';
import { handoffReviewAfterTransitionInTx } from './handoff/review.js';
import { createGraphIndexJobInTx } from './graph/index-outbox.js';
import { createListScreeningInTx } from './lists/screening.js';
import { createSignalComputationInTx } from './signals/computation.js';
import type { SignalView } from './signals/served.js';
import { assertSessionCapInTx, sessionLimitReached } from './signals/sessions.js';
import { includedListMatchesFor } from './lists/matches.js';
import { includedReportsFor } from './reports/includes.js';
import { cancelActiveSessions } from './inquiry-sessions.js';
import { inquiryListFilters } from './list-filters/inquiries.js';
import { nextLink, pageRequest, withCursor } from './pagination.js';
import { verificationResource, type VerificationRef } from './resources.js';
import { resolveTransactionRelationships } from './transactions/relationships.js';
import { deleteObjects, selfieCaptureResources, selfieDetailsOf } from './selfie-captures.js';
import { loadVerificationAttributesOf } from './attributes/index.js';
import { cancelInitiatedVerifications, fileIdsByVerification } from './verifications.js';
import { withInquiryProvenance } from './connect/cloned-results.js';
import {
  flowInquiryAttributes,
  inquiryCompletedMeta,
  publicOutcome,
} from '../flow-engine/inquiry-attributes.js';
import {
  createdInquiryWindows,
  applyStartWindowInTx,
  extendExpiryOnResumeInTx,
  type CreateInquiryMeta,
} from '../flow-engine/expiry.js';

export const INQUIRIES_PATH = '/api/v1/inquiries';

/** Statuses in which the end user can still work on the inquiry. */
const OPEN_STATUSES: ReadonlySet<InquiryStatus> = new Set(['created', 'pending']);

export function isInquiryOpen(inquiry: Pick<Inquiry, 'status'>): boolean {
  return OPEN_STATUSES.has(inquiry.status);
}

/**
 * Who a server API call acts for: its tenant and request metadata (`ctx`), the audit actor,
 * the PII the principal may see, and its environment's kind.
 */
export interface Acting {
  ctx: ServiceContext;
  actor: AuditActor;
  mask: PiiMask;
  environmentKind: 'sandbox' | 'production';
}

/** What a status transition needs, in the API and in the worker. */
export interface LifecycleDeps {
  events: TransactionalEventPublisher;
  clock: Clock;
}

/** Verification linkage of several inquiries in one query, each list oldest first. */
async function verificationRefs(
  db: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<Map<string, VerificationRef[]>> {
  const refs = new Map<string, VerificationRef[]>(inquiryIds.map((id) => [id, []]));
  if (inquiryIds.length === 0) {
    return refs;
  }
  const rows = await db
    .select({ id: verifications.id, type: verifications.type, inquiryId: verifications.inquiryId })
    .from(verifications)
    .where(
      and(
        eq(verifications.environmentId, environmentId),
        inArray(verifications.inquiryId, [...inquiryIds]),
      ),
    )
    .orderBy(asc(verifications.createdAt), asc(verifications.id));
  for (const row of rows) {
    refs.get(row.inquiryId)?.push({ id: row.id, type: row.type });
  }
  return refs;
}

/**
 * The inquiry resource of a row, as `mask` may see it (events and jobs see everything). With
 * `selfieCaptureIds` (newest first), it carries the C40.1 `selfies` relationship.
 */
export function inquiryResourceFor(
  row: Inquiry,
  verificationLinks: readonly { id: string; type: VerificationType }[],
  mask: PiiMask = UNMASKED,
  selfieCaptureIds?: readonly string[],
  view: SignalView = { exposeSignals: true },
  listScreening: ListScreening | null = null,
  transactionId?: string | null,
  flowNames: Pick<InquiryRecord, 'previousStepName' | 'nextStepName'> = {},
): InquiryResource {
  const record = inquiryRecordOf(row, verificationLinks, view, listScreening, transactionId);
  // C235.7(a) (Workflow 11A, api-redeem's named borrowed edit): a copy's reads and `inquiry.*` events
  // carry its `provenance`.
  return withInquiryProvenance(
    buildInquiryResource({
      ...record,
      fields: mask.fields(record.fields),
      note: mask.note(row.note),
      ...(selfieCaptureIds === undefined ? {} : { selfieCaptureIds }),
      // C151.13 (Workflow 9A): PII-free codes, served on every read.
      flowOutcome: publicOutcome(row),
      // C151.10 (Workflow 9B): the windows `POST /inquiries`' `meta` set, `null` when the version
      // decides.
      expirationAfterStartSeconds: row.expirationAfterStartSeconds,
      expirationAfterResumeSeconds: row.expirationAfterResumeSeconds,
      oneTimeLinkExpirationSeconds: row.oneTimeLinkExpirationSeconds,
      ...flowNames,
    }),
    row,
  );
}

/** The inquiry resource of a row, with its verification linkage and its captures (C40.1). */
export async function inquiryResourceOf(
  db: Db,
  environmentId: string,
  inquiry: Inquiry,
  mask: PiiMask = UNMASKED,
): Promise<InquiryResource> {
  const refs = await verificationRefs(db, environmentId, [inquiry.id]);
  const captures = await listSelfieCaptures(db, environmentId, { inquiryId: inquiry.id });
  const transactions = await resolveTransactionRelationships(db, environmentId, [inquiry.id]);
  // C151.8 (Workflow 9A): a step reached through a sensitive exit is named only with PII
  // visibility. An event payload or a job (the default, unmasked) fails closed.
  const names = await flowInquiryAttributes(db, inquiry, {
    visible: mask !== UNMASKED && mask.visible,
  });
  return inquiryResourceFor(
    inquiry,
    refs.get(inquiry.id) ?? [],
    mask,
    captures.map((capture) => capture.id),
    await signalViewOf(db, environmentId),
    await getListScreening(db, environmentId, inquiry.id),
    transactions.get(inquiry.id),
    {
      previousStepName: names['previous-step-name'],
      nextStepName: names['next-step-name'],
    },
  );
}

/** C90.8 (Workflow 7A): whether the environment's API and webhooks show signals. */
export async function signalViewOf(db: Db, environmentId: string): Promise<SignalView> {
  const environment = await getEnvironment(db, environmentId);
  return {
    exposeSignals:
      environment === null || resolveSignalSettings(environment.settings)['expose-signals'],
  };
}

/**
 * `value`, unless the inquiry it was read for is missing from this environment.
 * @throws {NotFoundError} for `null`.
 */
function found<T>(value: T | null, id: string): T {
  if (value === null) {
    throw new NotFoundError(`Inquiry ${id} was not found.`);
  }
  return value;
}

/** @throws {NotFoundError} when the inquiry is not in this environment. */
export async function findInquiry(db: Db, environmentId: string, id: string): Promise<Inquiry> {
  return found(await getInquiry(db, environmentId, id), id);
}

/**
 * Locks the inquiry's row for the rest of `tx` and reads it.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 */
export async function lockedInquiry(tx: Db, environmentId: string, id: string): Promise<Inquiry> {
  found(await lockInquiry(tx, environmentId, id), id);
  return findInquiry(tx, environmentId, id);
}

/** Records `action` about the inquiry in `tx` (C15). */
function auditInquiry(
  deps: Pick<ApiDependencies, 'audit'>,
  tx: Db,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  inquiryId: string,
  action: string,
  metadata?: AuditedAction['metadata'],
): Promise<void> {
  return deps.audit.record(
    tx,
    auditEntryOf(acting.ctx, acting.actor, {
      action,
      resourceType: 'inquiry',
      resourceId: inquiryId,
      metadata,
    }),
  );
}

// Creation and reads -------------------------------------------------------------------------

/**
 * Creates an inquiry in status `created` on the template's current version (C2), on the
 * account `AccountsService.resolveForInquiry` resolves in the same transaction (C13), expiring
 * after `meta`'s `expiration-after-create-interval-seconds`, else the version's
 * `inquiry-expiration-seconds` (C10, C151.10); `meta`'s other windows are kept for this inquiry.
 * `inquiry.created` and the audit entry are written in that transaction too.
 * @throws {NotFoundError} when the template or the given account is not in this environment.
 * @throws {TemplateArchivedError} when the template is archived (C11).
 */
export async function createInquiry(
  deps: ApiDependencies,
  acting: Acting,
  attributes: CreateInquiryAttributes,
  meta: CreateInquiryMeta = {},
): Promise<InquiryResource> {
  const { inquiry, staged } = await deps.db.transaction((tx) =>
    createInquiryInTx(tx, deps, acting, attributes, meta),
  );
  await deps.events.dispatch(staged);
  return inquiryResourceFor(inquiry, [], acting.mask);
}

/**
 * {@link createInquiry} in the caller's transaction (C117.5). The caller dispatches `staged` after
 * the commit.
 */
export async function createInquiryInTx(
  tx: Db,
  deps: ApiDependencies,
  acting: Acting,
  attributes: CreateInquiryAttributes,
  meta: CreateInquiryMeta = {},
): Promise<{ inquiry: Inquiry; staged: StagedEvent[] }> {
  const { ids, events, clock, accounts } = deps;
  const { environmentId } = acting.ctx;
  const templateId = attributes['inquiry-template-id'];
  const template = await getInquiryTemplate(tx, environmentId, templateId);
  if (template === null) {
    throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
  }
  if (template.status === 'archived') {
    throw new TemplateArchivedError(`Inquiry template ${templateId} is archived.`);
  }
  const version = template.currentVersion;
  const settings = templateVersionSettings(version);
  // C151.10 (Workflow 9B): `meta`'s creation window, else the version's; the other three are kept
  // on the inquiry for its start, its resumes and its one-time links (`flow-engine/expiry.ts`).
  const { expiresInSeconds, ...windows } = createdInquiryWindows(meta, settings);
  const expiresAt = new Date(clock.now().getTime() + expiresInSeconds * 1000);
  const referenceId = attributes['reference-id'];
  // C158.4 (Workflow 9A Stage 1b (F)): a redirect is checked against the environment's redirect
  // origins and the version's schemes (`services/embed-origins.ts`, `flow-server-embed`).
  const redirectUri = attributes['redirect-uri'];
  if (redirectUri !== undefined) {
    await checkInquiryRedirectUri(tx, {
      environmentId,
      environmentKind: acting.environmentKind,
      versionId: version.id,
      redirectUri,
    });
  }
  // C160.7 (Workflow 9A Stage 1b (H)): an active theme set of the environment (`api-themes`).
  const themeSetId = attributes['theme-set-id'];
  if (themeSetId !== undefined) {
    await checkThemeSetChoice(tx, {
      environmentId,
      themeSetId,
      pointer: '/data/attributes/theme-set-id',
    });
  }
  // `account.created` of a new account, dispatched after the commit with the inquiry's event.
  const accountEvents: StagedEvent[] = [];
  const accountId = await accounts.resolveForInquiry(
    tx,
    acting.ctx,
    {
      ...(attributes['account-id'] === undefined ? {} : { accountId: attributes['account-id'] }),
      ...(referenceId === undefined ? {} : { referenceId }),
    },
    accountEvents,
  );
  // C149.2, C149.3 (Workflow 9A Stage 1b (T)): the version's field rules (`api-templates`); the
  // values written are the ones they answer, `strip-html` applied (C149.5).
  const fields =
    attributes.fields === undefined
      ? undefined
      : await validateInquiryFieldsWrite(tx, {
          kind: 'create',
          environmentId,
          versionId: version.id,
          fields: attributes.fields,
        });
  let created: Inquiry;
  try {
    created = await insertInquiry(tx, environmentId, {
      id: ids.newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: version.id,
      accountId,
      referenceId: referenceId ?? null,
      fields: fields ?? {},
      // C149.4 (Workflow 9A Stage 1b (S)): the prefill is also kept, sealed and never changed, as
      // the initial fields the comparison checks read (`comparisonSourceFor`, `api-flow-engine`).
      ...(fields === undefined ? {} : { initialFields: fields }),
      ...(redirectUri === undefined ? {} : { redirectUri }),
      ...(themeSetId === undefined ? {} : { themeSetId }),
      expiresAt,
      ...windows,
    });
  } catch (error) {
    if (error instanceof InquiryAccountNotFoundError) {
      throw new NotFoundError(`Account ${accountId} was not found.`);
    }
    throw error;
  }
  await auditInquiry(deps, tx, acting, created.id, 'inquiry.created');
  return {
    inquiry: created,
    staged: [
      ...accountEvents,
      await events.stage(tx, {
        environmentId,
        name: 'inquiry.created',
        payload: { data: inquiryResourceFor(created, []) },
      }),
    ],
  };
}

/**
 * The inquiry, with its captures (C40.1); `include` adds its verifications with checks and files
 * (`verifications`) and its captures, newest first (`selfies`).
 */
export async function getInquiryDocument(
  { db }: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  id: string,
  include: readonly InquiryInclude[] = [],
): Promise<InquiryIncludeDocument> {
  const { environmentId } = acting.ctx;
  const inquiry = await findInquiry(db, environmentId, id);
  const rows = await listInquiryVerifications(db, environmentId, id);
  const captures = await listSelfieCaptures(db, environmentId, { inquiryId: id });
  // C105.7 (Workflow 7B): the inquiry's, and each included verification's.
  const transactions = await resolveTransactionRelationships(db, environmentId, [
    id,
    ...rows.map((row) => row.id),
  ]);
  // C151.8 (Workflow 9A): a step reached through a sensitive exit is named only with PII visibility.
  const names = await flowInquiryAttributes(db, inquiry, acting.mask);
  const data = inquiryResourceFor(
    inquiry,
    rows,
    acting.mask,
    captures.map((capture) => capture.id),
    await signalViewOf(db, environmentId),
    await getListScreening(db, environmentId, id),
    transactions.get(id),
    { previousStepName: names['previous-step-name'], nextStepName: names['next-step-name'] },
  );
  if (include.length === 0) {
    return { data };
  }
  const included: NonNullable<InquiryIncludeDocument['included']> = [];
  if (include.includes('verifications')) {
    const ids = rows.map((row) => row.id);
    const files = await fileIdsByVerification(db, environmentId, ids);
    const extractions = await listGovernmentIdExtractions(db, environmentId, ids);
    const attributes = await loadVerificationAttributesOf(db, rows);
    included.push(
      ...rows.map((row) =>
        verificationResource(row, files.get(row.id) ?? [], {
          extraction: extractions.get(row.id) ?? null,
          mask: acting.mask,
          ...(row.type === 'selfie' ? { selfie: selfieDetailsOf(captures, row.id) } : {}),
          attributes: attributes.get(row.id),
          transactionId: transactions.get(row.id),
        }),
      ),
    );
  }
  if (include.includes('selfies')) {
    included.push(...(await selfieCaptureResources(db, captures)));
  }
  if (include.includes('reports')) {
    // C70.5: the inquiry's reports, masked as `GET /reports/:id` serves them.
    included.push(...(await includedReportsFor(db, environmentId, { inquiryId: id }, acting.mask)));
  }
  if (include.includes('list-matches')) {
    // C107.6: the `GET /list-matches` view.
    included.push(
      ...(await includedListMatchesFor(db, environmentId, { inquiryId: id }, acting.mask)),
    );
  }
  if (include.includes('decisions')) {
    // C128.1, C143.6: under `inquiries:read` alone; a comment follows the caller's mask.
    included.push(...(await includedDecisionsFor(db, environmentId, id, acting.mask)));
  }
  return { data, included };
}

/** The C9 created-at range of a list query. */
export interface CreatedAtRangeQuery {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

/** `GET /inquiries` with the C2 and C10 filters, newest first. */
export async function listInquiries(
  { db }: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  query: ListInquiriesQuery,
): Promise<InquiryListDocument> {
  const { environmentId } = acting.ctx;
  // The query schema accepts the created-at range, but its inferred type leaves it out.
  const range = query as CreatedAtRangeQuery;
  const filters = {
    'filter[status]': query['filter[status]'],
    'filter[reference-id]': query['filter[reference-id]'],
    'filter[account-id]': query['filter[account-id]'],
    'filter[inquiry-template-id]': query['filter[inquiry-template-id]'],
    'filter[tag]': query['filter[tag]'],
    'filter[created-at-start]': range['filter[created-at-start]'],
    'filter[created-at-end]': range['filter[created-at-end]'],
  };
  const start = filters['filter[created-at-start]'];
  const end = filters['filter[created-at-end]'];
  // C165.3 (Workflow 9B Stage 1b (X); B16): the new filters, `api-exports`', with the principal's PII
  // visibility; until built it refuses any of them with 501 rather than answer unfiltered.
  const added = await inquiryListFilters(db, {
    environmentId,
    query,
    piiVisible: acting.mask.visible,
  });
  const page = await withCursor(() =>
    findInquiries(db, environmentId, {
      where: added.where,
      ...pageRequest(query),
      status: filterValues(filters['filter[status]'], inquiryStatusSchema),
      referenceId: filters['filter[reference-id]'],
      accountId: filterValues(filters['filter[account-id]'], idSchema('acc')),
      inquiryTemplateId: filterValues(filters['filter[inquiry-template-id]'], idSchema('itmpl')),
      tag: filterValues(filters['filter[tag]'], tagInputSchema)?.map(normalizeTag),
      ...(start === undefined ? {} : { createdAtStart: new Date(start) }),
      ...(end === undefined ? {} : { createdAtEnd: new Date(end) }),
    }),
  );
  const refs = await verificationRefs(
    db,
    environmentId,
    page.items.map((inquiry) => inquiry.id),
  );
  const view = await signalViewOf(db, environmentId);
  // C90.5, V06 (Workflow 7B): the rows `inquiry/list_match_count` is merged from.
  const screenings = await listInquiryListScreenings(
    db,
    environmentId,
    page.items.map((inquiry) => inquiry.id),
  );
  const transactions = await resolveTransactionRelationships(
    db,
    environmentId,
    page.items.map((inquiry) => inquiry.id),
  );
  return {
    data: page.items.map((inquiry) =>
      inquiryResourceFor(
        inquiry,
        refs.get(inquiry.id) ?? [],
        acting.mask,
        undefined,
        view,
        screenings.get(inquiry.id) ?? null,
        transactions.get(inquiry.id),
      ),
    ),
    links: { next: nextLink(INQUIRIES_PATH, { ...filters, ...added.links }, query, page.next) },
  };
}

// Changes ------------------------------------------------------------------------------------

/**
 * `PATCH /inquiries/:id` (C10): `fields` are merged and change only while the inquiry is
 * `created` or `pending`; `reference-id` and the encrypted `note` change at any time. Fields
 * and notes of a redacted inquiry are refused (C16). Audited with the attribute names only.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {RedactedError} for fields or a note on a redacted inquiry.
 * @throws {InvalidTransitionError} for fields once the inquiry left `created`/`pending`.
 */
export async function updateInquiry(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  attributes: UpdateInquiryBody['data']['attributes'],
): Promise<InquiryResource> {
  const updated = await deps.db.transaction((tx) =>
    updateInquiryInTx(tx, deps, acting, id, attributes),
  );
  return inquiryResourceOf(deps.db, acting.ctx.environmentId, updated, acting.mask);
}

/** {@link updateInquiry} in the caller's transaction (C117.5). */
export async function updateInquiryInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'audit'>,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  id: string,
  attributes: UpdateInquiryBody['data']['attributes'],
): Promise<Inquiry> {
  const { environmentId } = acting.ctx;
  const { fields, note } = attributes;
  const referenceId = attributes['reference-id'];
  const inquiry = await lockedInquiry(tx, environmentId, id);
  if ((fields !== undefined || note !== undefined) && inquiry.redactedAt !== null) {
    throw new RedactedError(`Inquiry ${id} was redacted; its fields and note cannot change.`);
  }
  if (fields !== undefined && !isInquiryOpen(inquiry)) {
    throw new InvalidTransitionError(
      `The inquiry is ${inquiry.status}; fields change only while it is created or pending.`,
    );
  }
  // C149.2, C149.3 (Workflow 9A Stage 1b (T)): the pinned version's field rules (`api-templates`);
  // the values written are the ones they answer, `strip-html` applied (C149.5).
  const written =
    fields === undefined
      ? undefined
      : await validateInquiryFieldsWrite(tx, {
          kind: 'patch',
          environmentId,
          versionId: inquiry.inquiryTemplateVersionId,
          inquiryId: id,
          fields,
        });
  const row = found(
    await updateInquiryRow(tx, environmentId, id, {
      ...(written === undefined ? {} : { fields: written }),
      ...(referenceId === undefined ? {} : { referenceId }),
      ...(note === undefined ? {} : { note }),
    }),
    id,
  );
  await auditInquiry(deps, tx, acting, id, 'inquiry.updated', {
    attributes: Object.keys(attributes),
  });
  return row;
}

export type TagChange =
  | { kind: 'add'; tag: string }
  | { kind: 'remove'; tag: string }
  | { kind: 'set'; tags: readonly string[] };

/** The tags after `change`, by the C9 rules of `@openverify/core`. */
function applyTagChange(current: readonly string[], change: TagChange): string[] {
  switch (change.kind) {
    case 'add':
      return addTag(current, change.tag);
    case 'remove':
      return removeTag(current, change.tag);
    case 'set':
      return normalizeTags(change.tags);
  }
}

/**
 * The tags after `change`. Core caps an object at 50 tags, so the repository's own limit is
 * never reached.
 * @throws {UnprocessableContentError} when a tag is invalid or the inquiry would hold too many.
 */
function changedTags(current: readonly string[], change: TagChange): string[] {
  try {
    return applyTagChange(current, change);
  } catch (error) {
    throw error instanceof DomainError ? new UnprocessableContentError(error.message) : error;
  }
}

/**
 * `add-tag`, `remove-tag` and `set-tags` (C9, C10) under the inquiry's row lock. A change
 * emits `inquiry.updated-tags` and is audited; a request that changes nothing does neither.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {UnprocessableContentError} when the inquiry would hold more than 50 tags.
 */
export async function changeInquiryTags(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  change: TagChange,
): Promise<InquiryResource> {
  const { db, events } = deps;
  const { inquiry, staged } = await db.transaction((tx) =>
    changeInquiryTagsInTx(tx, deps, acting, id, change),
  );
  await events.dispatch(staged);
  return inquiryResourceOf(db, acting.ctx.environmentId, inquiry, acting.mask);
}

/**
 * {@link changeInquiryTags} in the caller's transaction (C117.5). The caller dispatches `staged`
 * after the commit.
 */
export async function changeInquiryTagsInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'audit' | 'events'>,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  id: string,
  change: TagChange,
): Promise<{ inquiry: Inquiry; staged: StagedEvent[] }> {
  const { events } = deps;
  const { environmentId } = acting.ctx;
  const current = await lockedInquiry(tx, environmentId, id);
  const tags = changedTags(current.tags, change);
  const result = found(await setInquiryTags(tx, environmentId, id, tags), id);
  if (!result.changed) {
    return { inquiry: result.record, staged: [] };
  }
  await auditInquiry(deps, tx, acting, id, 'inquiry.updated-tags', { operation: change.kind });
  const resource = await inquiryResourceOf(tx, environmentId, result.record);
  return {
    inquiry: result.record,
    staged: [
      await events.stage(tx, {
        environmentId,
        name: 'inquiry.updated-tags',
        payload: { data: resource },
      }),
    ],
  };
}

// Sessions -----------------------------------------------------------------------------------

/**
 * Opens a hosted-flow session: a new `ovs_` token, stored only as its SHA-256 and valid for
 * the pinned version's `session-expiration-seconds` (24 hours by default), returned once with
 * the flow URL that carries it in the fragment. Audited as `inquiry.resumed`. In the same
 * transaction the expiry moves to `max(expires-at, now + after-resume window)` (C151.10).
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {RedactedError} when the inquiry was redacted (Workflow 2B F018).
 * @throws {ConflictError} when the inquiry is already finished.
 */
export async function resumeInquiry(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
): Promise<ResumeInquiryDocument> {
  const { db, ids, clock, flowPublicUrl } = deps;
  const { environmentId } = acting.ctx;
  const resumable = (inquiry: Inquiry): Inquiry => {
    if (inquiry.redactedAt !== null) {
      throw new RedactedError(`Inquiry ${id} was redacted; it cannot be resumed.`);
    }
    if (!isInquiryOpen(inquiry)) {
      throw new ConflictError(`The inquiry is ${inquiry.status} and can no longer be resumed.`);
    }
    return inquiry;
  };
  const settings = await pinnedSettings(db, resumable(await findInquiry(db, environmentId, id)));
  const token = newSessionToken();
  const created = await db.transaction(async (tx) => {
    // Under the inquiry's row lock, which its transitions take (2B F016): a decision or expiry
    // that committed meanwhile, and so canceled its sessions, is seen, and no session is opened.
    const current = resumable(await lockedInquiry(tx, environmentId, id));
    // C91.5 (Workflow 7A): the session cap. A plain refusal rolls back; an expiry commits.
    const cap = await assertSessionCapInTx(tx, deps, current, settings);
    if (cap.limited) {
      if (!cap.expired) {
        throw sessionLimitReached();
      }
      return { limited: cap };
    }
    const session = await createInquirySession(tx, environmentId, {
      id: ids.newId('iqse'),
      inquiryId: current.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(clock.now().getTime() + settings['session-expiration-seconds'] * 1000),
    });
    await auditInquiry(deps, tx, acting, current.id, 'inquiry.resumed', {
      'inquiry-session-id': session.id,
    });
    // C151.10 (Workflow 9B): a resume moves the expiry to `max(expires-at, now + after-resume)`.
    const expiresAt = await extendExpiryOnResumeInTx(tx, current, clock.now());
    return { inquiry: { ...current, expiresAt } };
  });
  if ('limited' in created) {
    await deps.events.dispatch(created.limited.staged);
    await deleteObjects(deps.storage, created.limited.storageKeys);
    throw sessionLimitReached();
  }
  const { inquiry } = created;
  return {
    data: await inquiryResourceOf(db, environmentId, inquiry, acting.mask),
    meta: { 'session-token': token, 'flow-url': buildFlowUrl(flowPublicUrl, inquiry.id, token) },
  };
}

// Status lifecycle ---------------------------------------------------------------------------

/** What a move carries beyond its target status. */
export interface InquiryTransitionInTxOptions {
  /** C128.6: names the `declined -> needs_review` edge. */
  reopen?: boolean;
  /** C128.1: what `inquiry.declined` says of its decision. */
  decision?: DecisionMeta | null;
}

export interface InquiryTransitionResult {
  inquiry: Inquiry;
  /** The events written with the change, to dispatch once `tx` committed. */
  staged: StagedEvent[];
  /**
   * C40.2: storage objects whose file rows the change deleted (the files of a canceled
   * selfie capture), to delete once `tx` committed, best effort.
   */
  storageKeys: string[];
}

/**
 * Moves `inquiry` (as read in `tx`) to `to` through the C10 state machine, and stages, in
 * `tx`: the status's event, `inquiry.transitioned` with `meta: { from, to }`, and, when the
 * inquiry leaves `created`/`pending`, `inquiry-session.canceled` for each active session
 * (unused one-time links are revoked) and, on expiry, `verification.canceled` for each
 * `initiated` verification. Returns `null` when a concurrent change moved the inquiry first, and
 * for a move to `pending`, `completed` or `failed` of a redacted inquiry (owner decision 5 after
 * Workflow 6C: redaction ends its processing; it still expires). Nothing is staged then.
 * With `reopen`, the move takes the C128.6 edge and its own event; `decision` goes on
 * `inquiry.declined` as `meta.decision` (C128.1, P40).
 * @throws {InvalidInquiryTransitionError} when the state machine forbids the change.
 */
export async function transitionInquiryInTx(
  tx: Db,
  deps: LifecycleDeps,
  inquiry: Inquiry,
  to: InquiryStatus,
  options: InquiryTransitionInTxOptions = {},
): Promise<InquiryTransitionResult | null> {
  const { events } = deps;
  const { environmentId, id, status: from } = inquiry;
  const reopen = options.reopen === true;
  const name = transitionInquiry(from, to, { reopen });
  const at = deps.clock.now();
  const updated = await transitionInquiryStatus(tx, environmentId, id, { from, to, at, reopen });
  if (updated === null) {
    return null;
  }
  const resource = await inquiryResourceOf(tx, environmentId, updated);
  const staged = [
    await events.stage(tx, {
      environmentId,
      name,
      payload: {
        data: resource,
        ...(name === 'inquiry.declined' && options.decision != null
          ? { meta: { decision: options.decision } }
          : {}),
        // C151.13 (Workflow 9A): a flow's completion says how it was reached.
        ...(name === 'inquiry.completed' && inquiryCompletedMeta(updated) !== undefined
          ? { meta: inquiryCompletedMeta(updated) }
          : {}),
      },
    }),
    await events.stage(tx, {
      environmentId,
      name: 'inquiry.transitioned',
      payload: { data: resource, meta: { from, to } },
    }),
  ];
  const storageKeys: string[] = [];
  if (OPEN_STATUSES.has(from) && !OPEN_STATUSES.has(to)) {
    staged.push(...(await cancelActiveSessions(tx, events, environmentId, id, at)));
    await revokeOneTimeLinks(tx, environmentId, id, at);
    if (to === 'expired') {
      const canceled = await cancelInitiatedVerifications(tx, events, environmentId, id, at);
      staged.push(...canceled.staged);
      storageKeys.push(...canceled.storageKeys);
    }
  }
  if (to === 'declined' || to === 'failed') {
    // C42.2: a declined or failed inquiry never keeps a face template or background row.
    await deleteFaceDataForInquiry(tx, environmentId, id);
  }
  if (runsCompletionReports(from, to)) {
    // C84.2 (V08): the version's report list, created in this transaction (an outbox: the
    // report sweep enqueues the runs; no account is locked here, F04).
    await createInquiryReportsInTx(
      tx,
      { events, clock: deps.clock },
      { inquiry: updated, from, to },
    );
  }
  // C90.5 (Workflow 7A; F02, F03): the signals outbox row on the first move into `completed`,
  // `failed` or `expired`, none for a redacted inquiry; the sweep enqueues it, nothing is decrypted.
  await createSignalComputationInTx(tx, { inquiry: updated, from, to });
  // C99.4 (Workflow 7B; H23, V17): the list screening outbox row on the same moves, when the pinned
  // version selects a list, none for a redacted inquiry; the sweep enqueues it, nothing is opened.
  await createListScreeningInTx(tx, { inquiry: updated, from, to });
  // C101.3 (Workflow 7B; H23, V17): the graph index outbox row on the same moves, failed and expired
  // inquiries included (decision 49), none for a redacted inquiry; nothing is opened here.
  await createGraphIndexJobInTx(tx, { inquiry: updated, from, to });
  // C96.3 (Workflow 7A; P15, V02): a rejected handoff's finished verifications send the inquiry
  // to review once it completes (`flow-handoff`), in this transaction, with both moves' events.
  const review = await handoffReviewAfterTransitionInTx(tx, { inquiry: updated, from, to });
  if (review === 'needs_review' && to === 'completed') {
    const followed = await transitionInquiryInTx(tx, deps, updated, 'needs_review');
    if (followed !== null) {
      return {
        inquiry: followed.inquiry,
        staged: [...staged, ...followed.staged],
        storageKeys: [...storageKeys, ...followed.storageKeys],
      };
    }
  }
  return { inquiry: updated, staged, storageKeys };
}

/** The 409 `invalid-transition` of a refused status change. */
export function invalidTransition(from: InquiryStatus, to: InquiryStatus): InvalidTransitionError {
  return new InvalidTransitionError(`An inquiry cannot move from ${from} to ${to}.`);
}

/** How a caller of {@link applyInquiryAction} marks its decision. */
export interface InquiryActionOptions {
  /** Webhook simulation: no decision record (decision 77). */
  simulated?: boolean;
  /** C128.6: names the `declined -> needs_review` edge, a user's act alone. */
  reopen?: boolean;
  decision?: InquiryDecisionInput;
}

/** C128.1: the kind of record a move makes; an expiry is nobody's decision. */
function decisionKindOf(
  to: InquiryStatus,
  reopen: boolean,
): RecordInquiryDecision['kind'] | undefined {
  if (reopen) {
    return 'reopen';
  }
  switch (to) {
    case 'approved':
      return 'approve';
    case 'declined':
      return 'decline';
    case 'needs_review':
      return 'review';
    default:
      return undefined;
  }
}

/**
 * C128.6: a reopen is a user's act (a run or a key answers 403), on an unredacted inquiry, whose
 * redaction the conditional update does not cover (Stage 1a amendment 46; outcome 6).
 */
function assertReopenable(acting: Acting, inquiry: Inquiry): void {
  if (acting.actor.type !== 'user') {
    throw new ForbiddenError('Only a user can reopen a declined inquiry.');
  }
  if (inquiry.redactedAt !== null) {
    throw new RedactedError(`Inquiry ${inquiry.id} was redacted; it cannot be reopened.`);
  }
}

/**
 * Applies `to` to the locked inquiry and audits it, in `tx`. Shared by the actions and the
 * simulation; `simulated` marks the audit entries of the latter, and writes no decision record
 * (decision 77). A decline passes the human-review guard first (C128.6). The record is written
 * before the move, so `inquiry.declined` can carry it (C128.1), and a refused move writes none.
 */
export async function applyInquiryAction(
  tx: Db,
  deps: ApiDependencies,
  acting: Acting,
  inquiry: Inquiry,
  to: InquiryStatus,
  options: InquiryActionOptions = {},
): Promise<InquiryTransitionResult> {
  const from = inquiry.status;
  const reopen = options.reopen === true;
  if (reopen) {
    assertReopenable(acting, inquiry);
  }
  if (!canTransitionInquiry(from, to, { reopen })) {
    throw invalidTransition(from, to);
  }
  if (to === 'declined') {
    await inquiryDecisionGuardInTx(tx, {
      environmentId: inquiry.environmentId,
      inquiryId: inquiry.id,
      actor: acting.actor,
    });
  }
  const kind = decisionKindOf(to, reopen);
  const decision =
    kind === undefined || options.simulated === true
      ? null
      : await recordInquiryDecisionInTx(tx, deps, {
          inquiry,
          kind,
          actor: acting.actor,
          decision: options.decision ?? {},
        });
  let result: InquiryTransitionResult | null;
  try {
    result = await transitionInquiryInTx(tx, deps, inquiry, to, { reopen, decision });
  } catch (error) {
    if (error instanceof InvalidInquiryTransitionError) {
      throw invalidTransition(from, to);
    }
    throw error;
  }
  if (result === null) {
    // The row is locked, so only a concurrent change before the lock gets here.
    throw invalidTransition(from, to);
  }
  await auditInquiry(deps, tx, acting, inquiry.id, transitionInquiry(from, to, { reopen }), {
    from,
    to,
    ...(options.simulated === true ? { simulated: true } : {}),
  });
  return result;
}

/**
 * `approve`, `decline`, `mark-for-review` and `expire` (C10): the transition to `to` under the
 * inquiry's row lock, with its events, audit entry and decision record (C128.1).
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {InvalidTransitionError} when the current status does not allow `to`.
 */
export async function performInquiryAction(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  to: InquiryStatus,
  decision: InquiryDecisionInput = {},
): Promise<InquiryResource> {
  const { db, events } = deps;
  const { environmentId } = acting.ctx;
  const result = await db.transaction(async (tx) =>
    applyInquiryAction(tx, deps, acting, await lockedInquiry(tx, environmentId, id), to, {
      decision,
    }),
  );
  await events.dispatch(result.staged);
  await deleteObjects(deps.storage, result.storageKeys);
  return inquiryResourceOf(db, environmentId, result.inquiry, acting.mask);
}

/**
 * Moves a `created` inquiry to `pending` (C3: the first flow session call starts it), with
 * `inquiry.started` and `inquiry.transitioned` in the same transaction, so the inquiry never
 * starts without its events. Only the caller that wins the transition publishes; anyone else
 * gets the inquiry as it is now, as does the caller of a redacted inquiry, which never starts
 * (owner decision 5 after Workflow 6C).
 */
export async function startInquiry(deps: ApiDependencies, inquiry: Inquiry): Promise<Inquiry> {
  if (inquiry.status !== 'created') {
    return inquiry;
  }
  const { db, events } = deps;
  const result = await db.transaction(async (tx) => {
    const started = await transitionInquiryInTx(tx, deps, inquiry, 'pending');
    if (started === null) {
      return null;
    }
    // FE2 (K9-28): the after-start window applies to a start outside the engine too.
    const expiresAt = await applyStartWindowInTx(
      tx,
      { ...inquiry, status: 'pending' },
      started.inquiry.startedAt ?? deps.clock.now(),
    );
    return { ...started, inquiry: { ...started.inquiry, expiresAt } };
  });
  if (result === null) {
    return findInquiry(db, inquiry.environmentId, inquiry.id);
  }
  await events.dispatch(result.staged);
  return result.inquiry;
}

/**
 * `POST /inquiries/:id/redact` (C16), delegated to the redaction service with the principal
 * as actor; it writes the `inquiry.redacted` event and the audit entry.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 */
export async function redactInquiry(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
): Promise<InquiryResource> {
  const { db } = deps;
  const { environmentId } = acting.ctx;
  await findInquiry(db, environmentId, id);
  await deps.redaction.redactInquiry(acting.ctx, id, acting.actor);
  return inquiryResourceOf(
    db,
    environmentId,
    await findInquiry(db, environmentId, id),
    acting.mask,
  );
}
