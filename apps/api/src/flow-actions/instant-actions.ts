/**
 * C152.4-C152.6 (Workflow 9A): the flow actions that finish in the transaction that enters them.
 * Each runs as the system: the inquiry's flow has no principal (C121.3), so its audit entries name no
 * actor and carry the inquiry and the step, and nothing it writes is a value in a log.
 *
 * - `tag_inquiry`: literal tags only (Phase 8 C115.6), so no tag ever comes from a value.
 * - `flag_for_review`: nothing moves now; the reason code is a step-record note
 *   (`flag_for_review:<code>`), from which the engine sends the inquiry to `needs_review` at
 *   completion and the console shows it, never the person.
 * - `update_account_fields`: the inquiry's account through the accounts service, whose account type
 *   validates; an unknown (`null`) value is never written over a field; the keys written and the
 *   account are recorded on the action row (V08), which the redaction lists.
 * - `copy_extractions` (C152.3): the extracted values of a decided verification (`passed` or
 *   `needs_review`, as the scope's `verifications.<step id>.status` reads it) into the inquiry's
 *   `fields`, merged, through the version's field rules (`validateInquiryFieldsWrite`, kind
 *   `copy-extractions`: an unknown key, a write-once field that is set, or the size cap refuse the
 *   whole write, and the step takes `error` with the rule's code); an unknown (`null`) value is never
 *   written; the audit entry names the keys, never a value. Types are checked at publish.
 */
import { addTag, DomainError, removeTag } from '@openverify/core';
import {
  getEnvironment,
  setInquiryTags,
  updateInquiry as updateInquiryRow,
  type Db,
  type Inquiry,
} from '@openverify/db';
import type { FlowAction } from '@openverify/flow-spec';
import type { JsonValue } from '@openverify/workflow-engine';
import { AppError, NotFoundError, RedactedError, UnprocessableContentError } from '../errors.js';
import type { StagedEvent } from '../events/index.js';
import { updateAccountInTx, type Change } from '../services/accounts.js';
import { appendSystemAuditEntry } from '../services/audit-log.js';
import { inquiryResourceOf, isInquiryOpen } from '../services/inquiries.js';
import { validateInquiryFieldsWrite } from '../services/templates/fields.js';
import type { FlowActionDeps, FlowActionEntry } from './run-action.js';
import { resolveMapping } from './scope-values.js';

type TagInquiryAction = Extract<FlowAction, { kind: 'tag_inquiry' }>;
type FlagForReviewAction = Extract<FlowAction, { kind: 'flag_for_review' }>;
type UpdateAccountFieldsAction = Extract<FlowAction, { kind: 'update_account_fields' }>;
type CopyExtractionsAction = Extract<FlowAction, { kind: 'copy_extractions' }>;

/** How an instant action ended, before its row is finished. */
export interface InstantResult {
  port: 'next' | 'error';
  errorType: string | null;
  staged: StagedEvent[];
  notes?: readonly string[];
  copy?: { targetAccountId: string; copiedKeys: readonly string[] };
}

const next = (staged: StagedEvent[] = [], more: Partial<InstantResult> = {}): InstantResult => ({
  port: 'next',
  errorType: null,
  staged,
  ...more,
});

const error = (errorType: string): InstantResult => ({ port: 'error', errorType, staged: [] });

export async function tagInquiryInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: Inquiry,
  entry: FlowActionEntry,
  action: TagInquiryAction,
): Promise<InstantResult> {
  let tags: string[] = [...inquiry.tags];
  try {
    for (const tag of action.add ?? []) {
      tags = addTag(tags, tag);
    }
    for (const tag of action.remove ?? []) {
      tags = removeTag(tags, tag);
    }
  } catch (thrown) {
    if (thrown instanceof DomainError) {
      return error('tags_invalid');
    }
    throw thrown;
  }
  const result = await setInquiryTags(tx, inquiry.environmentId, inquiry.id, tags);
  if (!result?.changed) {
    return next();
  }
  await appendSystemAuditEntry(tx, inquiry.environmentId, {
    action: 'inquiry.updated-tags',
    resourceType: 'inquiry',
    resourceId: inquiry.id,
    metadata: { operation: 'flow-action', 'flow-step-id': entry.stepId, entry: entry.entry },
  });
  const staged = await deps.events.stage(tx, {
    environmentId: inquiry.environmentId,
    name: 'inquiry.updated-tags',
    payload: { data: await inquiryResourceOf(tx, inquiry.environmentId, result.record) },
  });
  return next([staged]);
}

export function flagForReview(action: FlagForReviewAction): InstantResult {
  return next([], { notes: [`flag_for_review:${action.reasonCode}`] });
}

type AccountValue = string | number | boolean;

const isAccountValue = (value: JsonValue): value is AccountValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** The account service's refusals, as the error port's codes; anything else is a real failure. */
function accountErrorOf(thrown: unknown): string | null {
  if (thrown instanceof UnprocessableContentError) {
    return 'account_fields_invalid';
  }
  if (thrown instanceof RedactedError) {
    return 'account_redacted';
  }
  if (thrown instanceof NotFoundError) {
    return 'account_missing';
  }
  return null;
}

export async function updateAccountFieldsInTx(
  tx: Db,
  deps: FlowActionDeps,
  inquiry: Inquiry,
  entry: FlowActionEntry,
  action: UpdateAccountFieldsAction,
): Promise<InstantResult> {
  const resolved = resolveMapping(action.mapping, entry.scope);
  if (resolved === undefined) {
    return error('scope_unavailable');
  }
  // C152.4: an unknown value is not a value; the field keeps what it holds.
  const known = resolved.filter(([, value]) => value !== null);
  if (known.some(([, value]) => !isAccountValue(value))) {
    return error('account_fields_invalid');
  }
  if (known.length === 0) {
    return next();
  }
  const environment = await getEnvironment(tx, inquiry.environmentId);
  if (environment === null) {
    return error('account_missing');
  }
  const fields = Object.fromEntries(known) as Record<string, AccountValue>;
  const staged: StagedEvent[] = [];
  try {
    // A savepoint: a refusal leaves the caller's transaction, and the flow's move, intact.
    await tx.transaction(async (savepoint) => {
      const unit: Omit<Change, 'actor'> = {
        tx: savepoint,
        ctx: { organizationId: environment.organizationId, environmentId: inquiry.environmentId },
        emit: async (name, payload) => {
          staged.push(
            await deps.events.stage(savepoint, {
              environmentId: inquiry.environmentId,
              name,
              payload,
            }),
          );
        },
        audit: (audited) =>
          appendSystemAuditEntry(savepoint, inquiry.environmentId, {
            action: audited.action,
            resourceType: audited.resourceType,
            resourceId: audited.resourceId,
            metadata: {
              ...audited.metadata,
              'inquiry-id': inquiry.id,
              'flow-step-id': entry.stepId,
            },
          }),
      };
      // The flow has no principal (C121.3): `updateAccountInTx` never reads `actor`, and its audit
      // entry is written above as the system's.
      await updateAccountInTx(unit as Change, inquiry.accountId, { fields });
    });
  } catch (thrown) {
    const code = accountErrorOf(thrown);
    if (code === null) {
      throw thrown;
    }
    return error(code);
  }
  return next(staged, {
    copy: { targetAccountId: inquiry.accountId, copiedKeys: known.map(([key]) => key) },
  });
}

/** C152.3: the statuses of a decided verification whose extractions may be copied. */
const DECIDED_STATUSES: ReadonlySet<unknown> = new Set(['passed', 'needs_review']);

/** The field rules' refusals (C149.2, C149.3), as the error port's codes. */
const FIELD_RULE_CODES: ReadonlySet<string> = new Set([
  'field_unknown',
  'field_write_once',
  'fields_too_large',
]);

const recordOf = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;

export async function copyExtractionsInTx(
  tx: Db,
  inquiry: Inquiry,
  entry: FlowActionEntry,
  action: CopyExtractionsAction,
): Promise<InstantResult> {
  if (entry.scope === undefined) {
    return error('scope_unavailable');
  }
  const facts = recordOf(recordOf(entry.scope.verifications)?.[action.fromStep]);
  if (facts === null || !DECIDED_STATUSES.has(facts.status)) {
    return error('verification_not_decided');
  }
  if (!isInquiryOpen(inquiry)) {
    return error('inquiry_not_open');
  }
  // C152.3: an unknown extraction is not a value; the field keeps what it holds.
  const known = Object.entries(action.mapping).flatMap(([key, attribute]) => {
    const value = facts[attribute];
    return value === undefined || value === null ? [] : [[key, value] as const];
  });
  if (known.length === 0) {
    return next();
  }
  const extracted = Object.fromEntries(known);
  let fields: Awaited<ReturnType<typeof validateInquiryFieldsWrite>>;
  try {
    // C149.5: the values written are the ones the field rules answer, `strip-html` applied.
    fields = await validateInquiryFieldsWrite(tx, {
      kind: 'copy-extractions',
      environmentId: inquiry.environmentId,
      versionId: inquiry.inquiryTemplateVersionId,
      inquiryId: inquiry.id,
      fields: extracted,
    });
  } catch (thrown) {
    if (
      thrown instanceof AppError &&
      thrown.code !== undefined &&
      FIELD_RULE_CODES.has(thrown.code)
    ) {
      return error(thrown.code);
    }
    throw thrown;
  }
  await updateInquiryRow(tx, inquiry.environmentId, inquiry.id, { fields });
  await appendSystemAuditEntry(tx, inquiry.environmentId, {
    action: 'inquiry.updated',
    resourceType: 'inquiry',
    resourceId: inquiry.id,
    metadata: {
      attributes: ['fields'],
      'field-keys': Object.keys(fields).sort(),
      'flow-step-id': entry.stepId,
      entry: entry.entry,
    },
  });
  return next();
}
