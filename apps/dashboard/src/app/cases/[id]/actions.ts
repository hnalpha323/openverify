'use server';

/**
 * The case page's mutations (C142.2 to C142.5, C142.7). Each one is a server action: it validates
 * its form with the contract's schemas, calls the case's own route (or the held inquiry's, for a
 * decision, C142.4) as the operator, refreshes the case page and answers `{ ok } | { problem }`.
 * Each asks for the permission its route needs and calls nothing without it. A field value or a
 * comment's words go to the API as typed and come back only as the API masks them.
 */
import {
  addCaseCommentBodySchema,
  addCaseObjectsBodySchema,
  addCaseTagBodySchema,
  assignCaseBodySchema,
  idSchema,
  runCaseActionBodySchema,
  setCaseChecklistItemBodySchema,
  setCaseStatusBodySchema,
  setCaseTagsBodySchema,
  updateCaseBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { jsonOf, optionalIntegerOf, tagNamesOf } from '../../../components/lifecycle/action-input';
import { ParameterInputError, parametersOf } from '../../../components/workflows/parameters';
import { REDACT_PHRASE } from '../../../components/lifecycle/inquiry-action-names';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../../lib/api/action';
import { setCaseChecklistItem as setChecklistItem } from '../../../lib/api/case-checklists';
import { runCaseAction as runDescribedCaseAction } from '../../../lib/api/cases';

const casePath = (id: string) => `/cases/${id}`;

/** The case the form names. */
const caseIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'case-id': idSchema('case') }), {
    'case-id': formString(formData, 'case-id'),
  })['case-id'];

/** A value typed into the form, `undefined` when blank. */
function filled(formData: FormData, name: string): string | undefined {
  const value = formString(formData, name);
  return value === undefined || value === '' ? undefined : value;
}

/** `meta.lock-version` when the page sent it (C131.2: a stale one answers 409). */
const lockVersionOf = (formData: FormData) => optionalIntegerOf(filled(formData, 'lock-version'));

/** `POST /cases/:id/set-status` (C131.1): the transition map, comment and status tag apply. */
export async function setCaseStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  // C172.2, C172.3: a refusal by the checklist or the required fields is titled in words.
  return runDescribedCaseAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(setCaseStatusBodySchema, {
      meta: {
        status: formString(formData, 'status'),
        resolution: filled(formData, 'resolution'),
        comment: filled(formData, 'comment'),
        'status-tag': filled(formData, 'status-tag'),
        'lock-version': lockVersionOf(formData),
      },
    });
    await api.cases.setStatus(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/**
 * `POST /cases/:id/assign` (C132.3): to a user by id, or to nobody (`user-id: null`). Assigning
 * oneself needs `cases:write`; anyone else `cases:assign`, which the API checks.
 */
export async function assignCase(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const userId = formString(formData, 'user-id');
    const body = parseInput(assignCaseBodySchema, {
      meta: {
        'user-id': userId === undefined || userId === '' ? null : userId,
        'lock-version': lockVersionOf(formData),
      },
    });
    await api.cases.assign(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/add-comment` (C134.1): plain text with `@[usr_…]` mentions. */
export async function addCaseComment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(addCaseCommentBodySchema, {
      meta: { message: formString(formData, 'message') },
    });
    await api.cases.addComment(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /case-comments/:id/redact` (C134.2): the author, or a holder of `cases:redact`. */
export async function redactCaseComment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const commentId = parseInput(z.strictObject({ 'comment-id': idSchema('cscm') }), {
      'comment-id': formString(formData, 'comment-id'),
    })['comment-id'];
    await api.caseComments.redact(commentId);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/add-tag` (C136.5). */
export async function addCaseTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(addCaseTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.cases.addTag(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/remove-tag` (C136.5). */
export async function removeCaseTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(addCaseTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.cases.removeTag(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/set-tags` (C136.5): replaces them all. */
export async function setCaseTags(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(setCaseTagsBodySchema, {
      meta: { 'tag-names': tagNamesOf(formString(formData, 'tag-names')) },
    });
    await api.cases.setTags(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/**
 * `PATCH /cases/:id` with `fields` (C136.4), checked by the pinned version's schemas. Only with
 * `pii:view`: a reader who sees the values masked could not edit them, only overwrite them.
 */
export async function updateCaseFields(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write', 'pii:view'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const fields = jsonOf(formString(formData, 'fields'), '/data/attributes/fields');
    const body = parseInput(updateCaseBodySchema, {
      data: { type: 'case', attributes: { fields } },
    });
    await api.cases.update(id, body);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `PATCH /cases/:id` with `case-queue-id` (C132.1): `null` takes it out of every queue. */
export async function setCaseQueue(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const queue = filled(formData, 'case-queue-id');
    const body = parseInput(updateCaseBodySchema, {
      data: { type: 'case', attributes: { 'case-queue-id': queue ?? null } },
    });
    await api.cases.update(id, body);
    revalidatePath(casePath(id));
    return undefined;
  });
}

const SLA_UNITS = { minutes: 60, hours: 3_600, days: 86_400 } as const;
const slaInputSchema = z.strictObject({
  amount: z.coerce.number().int('Enter a whole number.').positive('Enter a positive number.'),
  unit: z.enum(Object.keys(SLA_UNITS) as [keyof typeof SLA_UNITS, ...(keyof typeof SLA_UNITS)[]]),
});

/**
 * `PATCH /cases/:id` with `meta.sla-expires-in-seconds` (C133.1): a wall-clock deadline from now,
 * or `null` to clear it. The API refuses one past 90 days (`sla_out_of_range`).
 */
export async function setCaseSla(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    let seconds: number | null = null;
    if (formString(formData, 'clear') !== 'true') {
      const input = parseInput(slaInputSchema, {
        amount: formString(formData, 'amount'),
        unit: formString(formData, 'unit'),
      });
      seconds = input.amount * SLA_UNITS[input.unit];
    }
    const body = parseInput(updateCaseBodySchema, {
      meta: { 'sla-expires-in-seconds': seconds },
    });
    await api.cases.update(id, body);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/add-objects` (C136.1): ids typed into one field; at most 1,000 a case. */
export async function addCaseObjects(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const ids = (formString(formData, 'object-ids') ?? '')
      .split(/[\s,]+/)
      .filter((each) => each !== '');
    if (ids.length === 0) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        errors: [{ pointer: '/meta/object-ids', detail: 'Enter at least one id.' }],
      });
    }
    const body = parseInput(addCaseObjectsBodySchema, { meta: { 'object-ids': ids } });
    await api.cases.addObjects(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/** `POST /cases/:id/remove-objects` with one object: an absent one is a no-op (C136.2). */
export async function removeCaseObject(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const body = parseInput(addCaseObjectsBodySchema, {
      meta: { 'object-ids': [formString(formData, 'object-id')] },
    });
    await api.cases.removeObjects(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}

const redactInputSchema = z.strictObject({
  confirmation: z.literal(REDACT_PHRASE, { error: `Type ${REDACT_PHRASE} to confirm.` }),
});

/** `DELETE /cases/:id` (C139.1): irreversible, once the operator typed the phrase. */
export async function redactCase(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['cases:redact'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    parseInput(redactInputSchema, { confirmation: formString(formData, 'confirmation') });
    await api.cases.redact(id);
    revalidatePath(casePath(id));
    return undefined;
  });
}

/**
 * The case action's parameters, typed by their declared C115.3 types through the shared parameter
 * module (8C Stage 1 amendment 9; R012): a value that does not hold its type is refused at
 * `/data/parameters/<name>` before the API is called.
 */
function caseParametersOf(formData: FormData): Record<string, unknown> {
  try {
    return parametersOf(formData);
  } catch (error) {
    if (error instanceof ParameterInputError) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some parameters do not hold their declared type.',
        errors: error.names.map((name) => ({
          pointer: `/data/parameters/${name}`,
          detail: 'Does not hold the declared type.',
        })),
      });
    }
    throw error;
  }
}

/**
 * `POST /cases/:id/run-action` (C140.1): the run reads the live values under its grant, so a
 * prefilled value the viewer could not see stays empty here unless they typed one (P38).
 */
export async function runCaseAction(
  _previous: ActionState<{ runId: string }>,
  formData: FormData,
): Promise<ActionResult<{ runId: string }>> {
  return runAction({ permissions: ['cases:read', 'workflows:trigger'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const parameters = caseParametersOf(formData);
    const body = parseInput(runCaseActionBodySchema, {
      data: {
        'case-action-id': formString(formData, 'case-action-id'),
        ...(Object.keys(parameters).length === 0 ? {} : { parameters }),
      },
    });
    const run = await api.caseActions.run(id, body.data);
    revalidatePath(casePath(id));
    return { runId: run.data['workflow-run-id'] };
  });
}

/** `POST /cases/:id/print` (C138.3): the audit entry and `case.print-initiated`, before printing. */
export async function printCase(_previous: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction({ permissions: ['cases:read'] }, async ({ api }) => {
    await api.cases.print(caseIdOf(formData));
    return undefined;
  });
}

const decisionInputSchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  action: z.enum(['approve', 'decline', 'mark-for-review']),
});

/**
 * C142.4: approve, decline or mark the held inquiry for review through the inquiry's own routes and
 * scope, each behind its own confirmation. Resolving the case decides nothing (C131.3).
 */
export async function decideHeldInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = caseIdOf(formData);
    const input = parseInput(decisionInputSchema, {
      'inquiry-id': formString(formData, 'inquiry-id'),
      action: formString(formData, 'action'),
    });
    const inquiryId = input['inquiry-id'];
    switch (input.action) {
      case 'approve':
        await api.inquiries.approve(inquiryId);
        break;
      case 'decline':
        await api.inquiries.decline(inquiryId);
        break;
      case 'mark-for-review':
        await api.inquiries.markForReview(inquiryId);
        break;
    }
    revalidatePath(`/inquiries/${inquiryId}`);
    revalidatePath(casePath(id));
    return undefined;
  });
}

const checklistItemSchema = z.strictObject({
  'checklist-key': z.string(),
  'item-key': z.string(),
  checked: z.enum(['true', 'false']),
});

/**
 * `POST /cases/:id/checklist` (C172.2): one item checked or unchecked by the operator who pressed
 * its button, never on anyone's behalf. A refusal by a case problem code is titled in words.
 */
export async function checkCaseChecklistItem(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runDescribedCaseAction({ permissions: ['cases:write'] }, async () => {
    const id = caseIdOf(formData);
    const item = parseInput(checklistItemSchema, {
      'checklist-key': formString(formData, 'checklist-key'),
      'item-key': formString(formData, 'item-key'),
      checked: formString(formData, 'checked'),
    });
    const body = parseInput(setCaseChecklistItemBodySchema, {
      meta: {
        'checklist-key': item['checklist-key'],
        'item-key': item['item-key'],
        checked: item.checked === 'true',
        'lock-version': lockVersionOf(formData),
      },
    });
    await setChecklistItem(id, body.meta);
    revalidatePath(casePath(id));
    return undefined;
  });
}
