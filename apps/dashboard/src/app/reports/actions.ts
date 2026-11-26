'use server';

/**
 * Report mutations of the reports console (C72, C73.5, C74.5, C75, C86). Each one is a server
 * action: it validates its form with the contract's schemas, calls the server API as the
 * operator, refreshes the report page and answers `{ ok } | { problem }`. A refusal by a report
 * problem code is titled in words (`describeReportProblem`), keeping the API's detail, field
 * errors and request id. No action answers report data to the browser: creation answers the new
 * report's id only.
 *
 * Review and dismissal need `pii:view` beside `reports:review`: the matches are personal data,
 * and nobody decides on evidence the API hides from them (as the note editor needs it). A review
 * needs a comment, as a dismissal needs a reason (C86); the API asks one of a false positive only.
 */
import {
  REPORT_QUERY_FIELDS,
  REPORT_QUERY_LIMITS,
  addTagBodySchema,
  createReportBodySchema,
  dismissReportBodySchema,
  idSchema,
  removeTagBodySchema,
  reviewReportBodySchema,
  setTagsBodySchema,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { tagNamesOf } from '../../components/lifecycle/action-input';
import { REDACT_PHRASE } from '../../components/lifecycle/inquiry-action-names';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  parseInput,
  runAction,
  type ActionContext,
} from '../../lib/api/action';
import { FORBIDDEN_PROBLEM } from '../../lib/api/errors';
import { REVIEW_NEEDS_PII_VIEW, describeReportProblem } from '../../lib/report-problem-words';

/** What creating a report answers: the new report's id, for its page. */
export interface ReportCreated {
  readonly id: string;
}

const reportPath = (id: string) => `/reports/${id}`;

/** The report the form names. */
const reportIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'report-id': idSchema('rep') }), {
    'report-id': formString(formData, 'report-id'),
  })['report-id'];

/** `runAction`, with a refusal by a report problem code titled in words. */
async function reportAction<Data>(
  permissions: readonly Permission[],
  run: (context: ActionContext) => Promise<Data>,
  environmentForm?: FormData,
): Promise<ActionResult<Data>> {
  const result = await runAction(
    { permissions, ...(environmentForm === undefined ? {} : { environmentForm }) },
    run,
  );
  return result.ok ? result : { ok: false, problem: describeReportProblem(result.problem) };
}

/**
 * `reportAction` for a review or dismissal: `reports:review` and `pii:view`. A refusal for either,
 * the console's own (`FORBIDDEN_PROBLEM`) or the API's 403 (owner decision 16), says why in words,
 * keeping the API's status and request id; any other refusal is as `reportAction` says it.
 */
async function reviewAction(
  run: (context: ActionContext) => Promise<undefined>,
): Promise<ActionResult> {
  const result = await reportAction(['reports:review', 'pii:view'], run);
  if (result.ok) {
    return result;
  }
  const { problem } = result;
  if (problem !== FORBIDDEN_PROBLEM && problem.status !== 403) {
    return result;
  }
  return {
    ok: false,
    problem: {
      ...REVIEW_NEEDS_PII_VIEW,
      ...(problem.status === undefined ? {} : { status: problem.status }),
      ...(problem.requestId === undefined ? {} : { requestId: problem.requestId }),
    },
  };
}

/** A text value of the form, or nothing when it was left empty. */
function optional(formData: FormData, name: string): string | undefined {
  const value = formString(formData, name);
  return value === undefined || value === '' ? undefined : value;
}

const ADDITIONAL_NAMES = 'additional-names';
/** The members of a query of any type; the posted type's own schema refuses the others. */
const QUERY_MEMBERS: ReadonlySet<string> = new Set(
  Object.values(REPORT_QUERY_FIELDS)
    .flat()
    .filter((member) => member !== ADDITIONAL_NAMES),
);
/** The parts of an additional name (C84.2), as the create form names their fields. */
const NAME_PARTS: ReadonlySet<string> = new Set(['name-first', 'name-middle', 'name-last', 'term']);
const MEMBER_FIELD = /^query\/(?<member>[^/]+)$/u;
const ADDITIONAL_NAME_FIELD = /^query\/additional-names\/(?<index>0|[1-9][0-9]?)\/(?<part>[^/]+)$/u;

/** The values of one object of the query, and the member a field fills in it. */
interface QuerySlot {
  readonly values: Map<string, string>;
  readonly key: string;
}

/**
 * Where a `query/…` field goes: a member of the query, or a part of one of the additional names;
 * `undefined` for any other name, which the create form never renders (Workflow 6B R012).
 */
function slotOf(
  name: string,
  members: Map<string, string>,
  additionalNames: readonly Map<string, string>[],
): QuerySlot | undefined {
  const member = MEMBER_FIELD.exec(name)?.groups?.member;
  if (member !== undefined) {
    return QUERY_MEMBERS.has(member) ? { values: members, key: member } : undefined;
  }
  const { index, part } = ADDITIONAL_NAME_FIELD.exec(name)?.groups ?? {};
  const values = index === undefined ? undefined : additionalNames[Number(index)];
  return values !== undefined && part !== undefined && NAME_PARTS.has(part)
    ? { values, key: part }
    : undefined;
}

/**
 * The query typed into the form: each `query/<member>` field, and
 * `query/additional-names/<index>/<part>` for the additional names; blank fields are left out, so
 * the API's own pointer names the member that is missing. A field name is never used as a
 * property path: the values are gathered by allow-listed names and the query is built with
 * `Object.fromEntries`, so no name reaches a prototype.
 * @throws {ActionInputError} for a `query/…` field of any other shape.
 */
function queryOf(formData: FormData): Record<string, unknown> {
  const members = new Map<string, string>();
  const additionalNames = Array.from(
    { length: REPORT_QUERY_LIMITS.additionalNames },
    () => new Map<string, string>(),
  );
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith('query/') || typeof raw !== 'string') {
      continue;
    }
    const slot = slotOf(name, members, additionalNames);
    if (slot === undefined) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [
          { pointer: '/data/attributes/query', detail: 'has a field the query does not take' },
        ],
      });
    }
    const value = raw.trim();
    if (value !== '') {
      slot.values.set(slot.key, value);
    }
  }
  const named = additionalNames
    .filter((values) => values.size > 0)
    .map((values) => Object.fromEntries(values));
  return {
    ...Object.fromEntries(members),
    ...(named.length === 0 ? {} : { [ADDITIONAL_NAMES]: named }),
  };
}

/**
 * `POST /reports` (C72.1) from the console: the template and the typed query, an existing
 * account when the operator names one, and a new account only when asked. The API records the
 * origin as `dashboard` for an operator.
 */
export async function createReport(
  _previous: ActionState<ReportCreated>,
  formData: FormData,
): Promise<ActionResult<ReportCreated>> {
  return reportAction(
    ['reports:write'],
    async ({ api }) => {
      const accountId = optional(formData, 'account-id');
      const body = parseInput(createReportBodySchema, {
        data: {
          type: formString(formData, 'type'),
          attributes: {
            'report-template-id': formString(formData, 'report-template-id'),
            query: queryOf(formData),
            ...(accountId === undefined ? {} : { 'account-id': accountId }),
          },
        },
        meta: { 'auto-create-account': formString(formData, 'auto-create-account') === 'true' },
      });
      const { data } = await api.reports.create(body.data.type, body.data.attributes, body.meta);
      revalidatePath('/reports');
      return { id: data.id };
    },
    formData,
  );
}

/** `POST /reports/:id/dismiss` (C75.2): the open matches, or one entry's or article's. */
export async function dismissReportMatches(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reviewAction(async ({ api }) => {
    const id = reportIdOf(formData);
    const entityId = optional(formData, 'entity-id');
    const dismissType = optional(formData, 'dismiss-type');
    const body = parseInput(dismissReportBodySchema, {
      data: {
        attributes: {
          reason: optional(formData, 'reason'),
          ...(entityId === undefined ? {} : { 'entity-id': entityId }),
          ...(dismissType === undefined ? {} : { 'dismiss-type': dismissType }),
        },
      },
    });
    await api.reports.dismiss(id, body.data.attributes);
    revalidatePath(reportPath(id));
    return undefined;
  });
}

/** `POST /reports/:id/review` (C75.5): one match by its record token, or every open one. */
export async function reviewReportMatches(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reviewAction(async ({ api }) => {
    const id = reportIdOf(formData);
    const recordToken = optional(formData, 'record-token');
    const riskLevel = optional(formData, 'risk-level');
    const comment = optional(formData, 'comment');
    if (comment === undefined) {
      // C86: a review, as a dismissal, says why; the API requires it for a false positive only.
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [{ pointer: '/data/attributes/comment', detail: 'Say why you decided this.' }],
      });
    }
    const body = parseInput(reviewReportBodySchema, {
      data: {
        attributes: {
          'review-type': formString(formData, 'review-type'),
          ...(recordToken === undefined ? {} : { 'record-token': recordToken }),
          'review-status': formString(formData, 'review-status'),
          ...(riskLevel === undefined ? {} : { 'risk-level': riskLevel }),
          comment,
          'notify-on-change': formString(formData, 'notify-on-change') === 'true',
        },
      },
    });
    await api.reports.review(id, body.data.attributes);
    revalidatePath(reportPath(id));
    return undefined;
  });
}

type MonitoringCall = (api: ActionContext['api'], id: string) => Promise<unknown>;

function monitoringAction(call: MonitoringCall) {
  return (formData: FormData): Promise<ActionResult> =>
    reportAction(['reports:write'], async ({ api }) => {
      const id = reportIdOf(formData);
      await call(api, id);
      revalidatePath(reportPath(id));
      return undefined;
    });
}

const pause = monitoringAction((api, id) => api.reports.pause(id));
const resume = monitoringAction((api, id) => api.reports.resume(id));
const run = monitoringAction((api, id) => api.reports.run(id));

/** `POST /reports/:id/pause` (C74.5): needs an upcoming run. */
export async function pauseReport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return pause(formData);
}

/** `POST /reports/:id/resume` (C74.5): a paused report; a list changed meanwhile runs at once. */
export async function resumeReport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return resume(formData);
}

/** `POST /reports/:id/run` (C74.5): a manual run of a type that recurs, also while paused. */
export async function runReport(_previous: ActionState, formData: FormData): Promise<ActionResult> {
  return run(formData);
}

const redactInputSchema = z.strictObject({
  'report-id': idSchema('rep'),
  confirmation: z.literal(REDACT_PHRASE, { error: `Type ${REDACT_PHRASE} to confirm.` }),
});

/** `DELETE /reports/:id` (C73.5): irreversible, once the operator typed the phrase. */
export async function redactReport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reportAction(['reports:redact'], async ({ api }) => {
    const input = parseInput(redactInputSchema, {
      'report-id': formString(formData, 'report-id'),
      confirmation: formString(formData, 'confirmation'),
    });
    await api.reports.redact(input['report-id']);
    revalidatePath(reportPath(input['report-id']));
    return undefined;
  });
}

/** `POST /reports/:id/add-tag`. */
export async function addReportTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reportAction(['reports:write'], async ({ api }) => {
    const id = reportIdOf(formData);
    const body = parseInput(addTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.reports.addTag(id, body.meta);
    revalidatePath(reportPath(id));
    return undefined;
  });
}

/** `POST /reports/:id/remove-tag`. */
export async function removeReportTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reportAction(['reports:write'], async ({ api }) => {
    const id = reportIdOf(formData);
    const body = parseInput(removeTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.reports.removeTag(id, body.meta);
    revalidatePath(reportPath(id));
    return undefined;
  });
}

/** `POST /reports/:id/set-tags`: the typed list, one tag per line, replaces every tag. */
export async function setReportTags(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return reportAction(['reports:write'], async ({ api }) => {
    const id = reportIdOf(formData);
    const body = parseInput(setTagsBodySchema, {
      meta: { 'tag-names': tagNamesOf(formString(formData, 'tag-names')) },
    });
    await api.reports.setTags(id, body.meta);
    revalidatePath(reportPath(id));
    return undefined;
  });
}
