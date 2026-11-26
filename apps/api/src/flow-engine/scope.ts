/**
 * C150.2, C150.3, C150.9 (Workflow 9A, api-flow-engine): the flow scope a branch reads, assembled
 * on the server from what is stored, in the transaction that advances. Every fact is read as it is
 * now; an unknown fact is `null`, never `false`:
 *
 * - `inquiry`: `status`, `fields.<key>` (the decrypted values, never leaving the server), `tags`,
 *   `created-at`, `started-at`;
 * - `verifications.<step id>`: `status` (the step's outcome), `attempts`, `attempts-remaining`,
 *   `checks.<name>.status` of the latest sent attempt through `checkScopeStatus` (a pending or
 *   errored check reads `null`, H03), and the extractions `FLOW_SCOPE_EXTRACTIONS` names;
 * - `account`: `account-type-id`, `status`, `tags`;
 * - `device`: `kind` (`deviceKindOf` of the newest session that reported one) and `platform`;
 * - `signals.<name>`: the branch entry's provisional snapshots (C150.9), never the inquiry's own;
 * - `workflows.<step id>`: `status`, `error-type` and `outputs` of a `run_workflow` step's latest
 *   entry, read by `api-flow-actions` (`flowWorkflowScopeInTx`), an errored run's outputs `null`;
 * - `session`: `locale` (the newest consent's), `resumed`, `handoff.state` (Phase 7's state of the
 *   flow's handoff step, `null` without one);
 * - `lists`: nothing (no list screening finishes before completion, inventory 7).
 *
 * Each `null` that has a reason in a `needs_review` class (Phase 7's `ON_NULL_DEFAULTS`; a check
 * errored by an outage or an unconfigured provider) is listed in `reviewClassPaths`, so the branch
 * flags review whatever its `onNull` says (C150.3).
 */
import { checkErrorClassOf } from '@openverify/core';
import { ON_NULL_DEFAULTS, type SignalNullReason } from '@openverify/contracts';
import {
  FlowRepositoryNotBuiltError,
  getAccount,
  getDocumentExtraction,
  getGovernmentIdExtraction,
  getLatestInquiryConsent,
  listInquiryFlowSignalSnapshots,
  listInquiryHandoffSteps,
  listInquirySessions,
  type Db,
  type Inquiry,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  FLOW_SCOPE_EXTRACTIONS,
  checkScopeStatus,
  deviceKindOf,
  type FlowV2,
  type FlowV2Step,
} from '@openverify/flow-spec';
import { FlowActionNotBuiltError } from '../flow-actions/not-built.js';
import { flowWorkflowScopeInTx } from '../flow-actions/workflow-scope.js';
import { stepVerificationOutcome } from './verification-state.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

export interface AssembledScope {
  /** The scope's roots, as the evaluator reads them. */
  values: JsonObject;
  /** The paths whose `null` is of the `needs_review` class (C150.3). */
  reviewClassPaths: ReadonlySet<string>;
}

export interface ScopeInput {
  inquiry: Inquiry;
  flow: FlowV2;
  /** Every verification of the inquiry, oldest first. */
  verifications: readonly VerificationWithChecks[];
  /** AAMVA attempts the server created, by id, with the government ID they copied (C59.6). */
  sources?: ReadonlyMap<string, string | null>;
  now: Date;
  /** The branch entry whose provisional signal snapshots are read (C150.9). */
  branchSeq?: number | null;
  /** Whether a condition reads `signals.*` or `workflows.*`; the reads are skipped otherwise. */
  reads?: { signals: boolean; workflows: boolean };
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** Whole years from `birthdate` (`YYYY-MM-DD`) to `now`, in UTC; `null` for no or a bad date. */
export function ageYears(birthdate: string | null, now: Date): number | null {
  const match = birthdate === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/** A JSON copy of a stored value: anything that is not JSON reads `null`. */
function json(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(json);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, json(member)]));
  }
  return null;
}

/** C150.3: a check errored by an outage or an unconfigured provider is a gap: it flags review. */
const checkNullIsReview = (reasons: readonly string[]): boolean =>
  checkErrorClassOf(reasons) !== null && !reasons.includes('input_missing');

async function verificationScope(
  db: Db,
  input: ScopeInput,
  step: FlowV2Step,
  review: Set<string>,
): Promise<JsonObject | null> {
  const outcome = stepVerificationOutcome(step, input.verifications, input.sources);
  if (outcome?.latest == null) {
    return null;
  }
  const base = `verifications.${step.id}`;
  const checks: JsonObject = {};
  for (const check of outcome.latest.checks) {
    const status = checkScopeStatus(check.status, check.reasons);
    checks[check.name] = { status };
    if (status === null && checkNullIsReview(check.reasons)) {
      review.add(`${base}.checks.${check.name}.status`);
    }
  }
  const scope: JsonObject = {
    status: outcome.status === 'pending' ? outcome.latest.status : outcome.status,
    attempts: outcome.attempts,
    'attempts-remaining': outcome.attemptsRemaining,
    checks,
  };
  if (Object.hasOwn(FLOW_SCOPE_EXTRACTIONS, step.type) && step.type === 'government_id') {
    const extraction = await getGovernmentIdExtraction(
      db,
      input.inquiry.environmentId,
      outcome.latest.id,
    );
    const birthdate = extraction?.fields?.birthdate ?? null;
    scope['country-code'] = outcome.latest.country ?? null;
    scope['id-class'] = outcome.latest.idClass ?? null;
    scope.birthdate = birthdate;
    scope['age-years'] = ageYears(birthdate, input.now);
    scope['expiration-date'] = extraction?.fields?.['expiration-date'] ?? null;
  }
  if (step.type === 'document') {
    const extraction = await getDocumentExtraction(
      db,
      input.inquiry.environmentId,
      outcome.latest.id,
    );
    scope['document-type'] = extraction?.documentType ?? null;
  }
  return scope;
}

/** A repository its owner has not built yet reads as nothing stored: every fact `null`. */
async function orNothing<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof FlowRepositoryNotBuiltError) {
      return [];
    }
    throw error;
  }
}

async function signalScope(db: Db, input: ScopeInput, review: Set<string>): Promise<JsonObject> {
  const seq = input.branchSeq ?? null;
  if (seq === null || input.reads?.signals === false) {
    return {};
  }
  const snapshots = await orNothing(() =>
    listInquiryFlowSignalSnapshots(db, input.inquiry.environmentId, {
      inquiryId: input.inquiry.id,
      stepRecordSeq: seq,
    }),
  );
  const signals: JsonObject = {};
  for (const snapshot of snapshots) {
    signals[snapshot.name] = json(snapshot.value);
    const reason = snapshot.nullReason as SignalNullReason | null;
    if (
      snapshot.value === null &&
      reason !== null &&
      Object.hasOwn(ON_NULL_DEFAULTS, reason) &&
      ON_NULL_DEFAULTS[reason] !== 'ignore'
    ) {
      review.add(`signals.${snapshot.name}`);
    }
  }
  return signals;
}

/** C150.2, C152.7: each `run_workflow` step's facts, read by `api-flow-actions` (never copied). */
async function workflowScope(db: Db, input: ScopeInput): Promise<JsonObject> {
  const runs = input.flow.steps.some(
    (step) => step.type === 'action' && step.action.kind === 'run_workflow',
  );
  if (!runs || input.reads?.workflows === false) {
    return {};
  }
  try {
    return json(
      await flowWorkflowScopeInTx(db, {
        environmentId: input.inquiry.environmentId,
        inquiryId: input.inquiry.id,
      }),
    ) as JsonObject;
  } catch (error) {
    if (error instanceof FlowActionNotBuiltError) {
      return {};
    }
    throw error;
  }
}

/** Phase 7's state of the flow's first `device_handoff` step that has one (C96.3), else `null`. */
async function handoffState(db: Db, inquiry: Inquiry, flow: FlowV2): Promise<string | null> {
  const handoffSteps = flow.steps.filter((step) => step.type === 'device_handoff');
  if (handoffSteps.length === 0) {
    return null;
  }
  const rows = await listInquiryHandoffSteps(db, inquiry.environmentId, inquiry.id);
  for (const step of handoffSteps) {
    const row = rows.find((candidate) => candidate.stepId === step.id);
    if (row !== undefined) {
      return row.state;
    }
  }
  return null;
}

async function deviceAndSession(
  db: Db,
  inquiry: Inquiry,
  flow: FlowV2,
): Promise<{ device: JsonObject; session: JsonObject }> {
  const sessions = (
    await listInquirySessions(db, inquiry.environmentId, { inquiryId: inquiry.id, size: 100 })
  ).items;
  const reporting = sessions.find(
    (session) => session.deviceType !== null || session.mobileSdkName !== null,
  );
  const kind =
    reporting === undefined
      ? null
      : deviceKindOf({
          deviceType: reporting.deviceType ?? null,
          mobileSdkName: reporting.mobileSdkName ?? null,
        });
  const platform =
    reporting === undefined
      ? null
      : reporting.mobileSdkName === 'openverify-android'
        ? 'android'
        : reporting.mobileSdkName == null
          ? 'web'
          : null;
  const consent = await getLatestInquiryConsent(db, inquiry.environmentId, inquiry.id);
  return {
    device: { kind, platform },
    session: {
      locale: consent?.locale ?? null,
      resumed: sessions.length > 1,
      handoff: { state: await handoffState(db, inquiry, flow) },
    },
  };
}

/** Assembles the scope of `input`'s inquiry, read with `db` (the advancing transaction). */
export async function assembleFlowScope(db: Db, input: ScopeInput): Promise<AssembledScope> {
  const review = new Set<string>();
  const { inquiry } = input;
  const verifications: JsonObject = {};
  for (const step of input.flow.steps) {
    const scope = await verificationScope(db, input, step, review);
    if (scope !== null) {
      verifications[step.id] = scope;
    }
  }
  const account = await getAccount(db, inquiry.environmentId, inquiry.accountId);
  const { device, session } = await deviceAndSession(db, inquiry, input.flow);
  return {
    values: {
      inquiry: {
        status: inquiry.status,
        fields: json(inquiry.fields),
        tags: [...inquiry.tags],
        'created-at': iso(inquiry.createdAt),
        'started-at': iso(inquiry.startedAt),
      },
      verifications,
      account:
        account === null
          ? {}
          : {
              'account-type-id': account.accountTypeId,
              status: (account as { status?: string }).status ?? null,
              tags: [...account.tags],
            },
      device,
      signals: await signalScope(db, input, review),
      workflows: await workflowScope(db, input),
      session,
      lists: {},
    },
    reviewClassPaths: review,
  };
}
