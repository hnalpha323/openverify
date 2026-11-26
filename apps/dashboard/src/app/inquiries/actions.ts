'use server';

/**
 * Inquiry mutations of the inquiry page (C10, C21). Each one is a server action: it validates its
 * form with the contract's schemas, calls the server API as the operator, refreshes the inquiry
 * page and answers `{ ok } | { problem }`.
 */
import {
  addTagBodySchema,
  decisionCommentSchema,
  expireAllInquirySessionsBodySchema,
  generateOneTimeLinkBodySchema,
  idSchema,
  performSimulateActionsBodySchema,
  removeTagBodySchema,
  setTagsBodySchema,
  updateInquiryBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { jsonOf, optionalIntegerOf, tagNamesOf } from '../../components/lifecycle/action-input';
import {
  INQUIRY_TRANSITION_ACTIONS,
  REDACT_PHRASE,
} from '../../components/lifecycle/inquiry-action-names';
import type { OneTimeLink } from '../../components/lifecycle/one-time-link-button';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';

const inquiryPath = (id: string) => `/inquiries/${id}`;

/** The inquiry the form names. */
const inquiryIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'inquiry-id': idSchema('inq') }), {
    'inquiry-id': formString(formData, 'inquiry-id'),
  })['inquiry-id'];

const transitionInputSchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  action: z.enum(INQUIRY_TRANSITION_ACTIONS),
});

/** Approve, decline, mark for review or expire, as C10's transitions allow. */
export async function transitionInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const input = parseInput(transitionInputSchema, {
      'inquiry-id': formString(formData, 'inquiry-id'),
      action: formString(formData, 'action'),
    });
    const id = input['inquiry-id'];
    switch (input.action) {
      case 'approve':
        await api.inquiries.approve(id);
        break;
      case 'decline':
        await api.inquiries.decline(id);
        break;
      case 'mark-for-review':
        await api.inquiries.markForReview(id);
        break;
      case 'expire':
        await api.inquiries.expire(id);
        break;
    }
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

const redactInputSchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  confirmation: z.literal(REDACT_PHRASE, { error: `Type ${REDACT_PHRASE} to confirm.` }),
});

/** Irreversible redaction (C16), once the operator typed the confirmation phrase. */
export async function redactInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:redact'] }, async ({ api }) => {
    const input = parseInput(redactInputSchema, {
      'inquiry-id': formString(formData, 'inquiry-id'),
      confirmation: formString(formData, 'confirmation'),
    });
    await api.inquiries.redact(input['inquiry-id']);
    revalidatePath(inquiryPath(input['inquiry-id']));
    return undefined;
  });
}

/** `POST /inquiries/:id/add-tag`. */
export async function addInquiryTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const body = parseInput(addTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.inquiries.addTag(id, body.meta);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

/** `POST /inquiries/:id/remove-tag`. */
export async function removeInquiryTag(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const body = parseInput(removeTagBodySchema, {
      meta: { 'tag-name': formString(formData, 'tag-name') },
    });
    await api.inquiries.removeTag(id, body.meta);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

/** `POST /inquiries/:id/set-tags`: the typed list, one tag per line, replaces every tag. */
export async function setInquiryTags(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const body = parseInput(setTagsBodySchema, {
      meta: { 'tag-names': tagNamesOf(formString(formData, 'tag-names')) },
    });
    await api.inquiries.setTags(id, body.meta);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

/**
 * `PATCH /inquiries/:id` with the note; a blank note clears it. It needs `pii:view` too: an
 * operator who cannot read the note must not overwrite it blind.
 */
export async function updateInquiryNote(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write', 'pii:view'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const note = formString(formData, 'note', { trim: false }) ?? '';
    const body = parseInput(updateInquiryBodySchema, {
      data: { type: 'inquiry', attributes: { note: note.trim() === '' ? null : note } },
    });
    await api.inquiries.update(id, body.data.attributes);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

/**
 * `PATCH /inquiries/:id` with fields typed as a JSON object, merged into the inquiry's (C10:
 * while it is `created` or `pending`). It needs `pii:view`, which shows the current values.
 */
export async function updateInquiryFields(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write', 'pii:view'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const fields = jsonOf(formString(formData, 'fields'), '/data/attributes/fields');
    const body = parseInput(updateInquiryBodySchema, {
      data: { type: 'inquiry', attributes: { fields } },
    });
    await api.inquiries.update(id, body.data.attributes);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

/**
 * `POST /inquiries/:id/generate-one-time-link`. The link is returned to the dialog that shows it
 * once (C21); it is never logged, stored or put in a URL here.
 */
export async function generateOneTimeLink(
  _previous: ActionState<OneTimeLink>,
  formData: FormData,
): Promise<ActionResult<OneTimeLink>> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const lifetime = optionalIntegerOf(formString(formData, 'expires-in-seconds'));
    const body = parseInput(
      generateOneTimeLinkBodySchema,
      lifetime === undefined ? undefined : { meta: { 'expires-in-seconds': lifetime } },
    );
    const { meta } = await api.inquiries.generateOneTimeLink(id, body?.meta);
    return { link: meta['one-time-link'], expiresAt: meta['expires-at'] };
  });
}

/** `POST /inquiry-sessions/:id/expire`. */
export async function expireInquirySession(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-sessions:write'] }, async ({ api }) => {
    const input = parseInput(
      z.strictObject({ 'inquiry-id': idSchema('inq'), 'inquiry-session-id': idSchema('iqse') }),
      {
        'inquiry-id': formString(formData, 'inquiry-id'),
        'inquiry-session-id': formString(formData, 'inquiry-session-id'),
      },
    );
    await api.inquirySessions.expire(input['inquiry-session-id']);
    revalidatePath(inquiryPath(input['inquiry-id']));
    return undefined;
  });
}

/** `POST /inquiry-sessions/expire-all` for the inquiry. */
export async function expireAllInquirySessions(
  _previous: ActionState<{ expiredCount: number }>,
  formData: FormData,
): Promise<ActionResult<{ expiredCount: number }>> {
  return runAction({ permissions: ['inquiry-sessions:write'] }, async ({ api }) => {
    const inquiryId = formString(formData, 'inquiry-id');
    // C91.5 (Workflow 7A): the body also takes `meta.inquiry-ids`; this action names one inquiry.
    const body = parseInput(expireAllInquirySessionsBodySchema, {
      meta: { 'inquiry-id': inquiryId },
    });
    const { meta } = await api.inquirySessions.expireAll(body.meta);
    revalidatePath(inquiryPath(inquiryId ?? ''));
    return { expiredCount: meta['expired-count'] };
  });
}

/** `POST /inquiries/:id/perform-simulate-actions` with one action (sandbox only). */
export async function simulateInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const id = inquiryIdOf(formData);
    const body = parseInput(performSimulateActionsBodySchema, {
      meta: { actions: [{ type: formString(formData, 'type') }] },
    });
    await api.inquiries.performSimulateActions(id, body.meta);
    revalidatePath(inquiryPath(id));
    return undefined;
  });
}

const reopenInputSchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  comment: decisionCommentSchema,
});

/**
 * C128.6: a user reopens a declined inquiry for human review, with a required comment that the API
 * seals in the decision record.
 */
export async function reopenInquiry(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
    const input = parseInput(reopenInputSchema, {
      'inquiry-id': formString(formData, 'inquiry-id'),
      comment: formString(formData, 'comment'),
    });
    await api.inquiries.reopen(input['inquiry-id'], { comment: input.comment });
    revalidatePath(inquiryPath(input['inquiry-id']));
    return undefined;
  });
}
