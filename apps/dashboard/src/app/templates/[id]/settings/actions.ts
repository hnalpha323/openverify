'use server';

/**
 * The template settings tab's save (C153.3): one member of the draft, posted as JSON by a
 * `MemberForm`, checked with the draft PATCH contract (errors by JSON Pointer into the request),
 * then saved through `dashboard-flow-builder`'s version client with `If-Match` and
 * `meta.allow-invalid` (C154.2, C154.3): a draft with problems is kept and says so; a draft
 * changed since the page read it answers 412, which is said in words and saves nothing.
 */
import { idSchema, updateInquiryTemplateVersionBodySchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  FORM_MEMBER_KEYS,
  attributesOf,
  type FormMemberKey,
} from '../../../../components/schema-form/template-members';
import type { ActionResult, ActionState } from '../../../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../../../lib/api/action';
import {
  isPreconditionFailed,
  updateTemplateVersion,
} from '../../../../lib/api/inquiry-template-versions';
import { TEMPLATE_FORMS_COPY } from '../../../../lib/copy/template-forms';

const inputSchema = z.strictObject({
  'inquiry-template-id': idSchema('itmpl'),
  'version-id': idSchema('itmplv'),
  etag: z.string().min(1).max(200),
  // The check panels save the whole `verification-config` (C153.1).
  member: z.enum([...FORM_MEMBER_KEYS, 'verification-config']),
});

type SavedMember = FormMemberKey | 'verification-config';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The posted member value: a JSON object, else a field error at the member. */
function valueOf(member: SavedMember, text: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text ?? '');
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Answered below.
  }
  throw new ActionInputError({
    title: 'Check the values you entered',
    errors: [
      {
        pointer: member === 'links' ? '/data/attributes' : `/data/attributes/${member}`,
        detail: 'must be a JSON object',
      },
    ],
  });
}

export async function saveTemplateMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['inquiry-templates:write'] }, async () => {
    const input = parseInput(inputSchema, {
      'inquiry-template-id': formString(formData, 'inquiry-template-id'),
      'version-id': formString(formData, 'version-id'),
      etag: formString(formData, 'etag'),
      member: formString(formData, 'member'),
    });
    const value = valueOf(input.member, formString(formData, 'value', { trim: false }));
    const body = parseInput(updateInquiryTemplateVersionBodySchema, {
      data: {
        type: 'inquiry-template-version',
        attributes:
          input.member === 'verification-config'
            ? { 'verification-config': value }
            : attributesOf(input.member, value),
      },
    });
    try {
      await updateTemplateVersion(input['version-id'], body.data.attributes, input.etag);
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new ActionInputError({
          title: TEMPLATE_FORMS_COPY.memberForm.stale,
          status: 412,
          code: 'precondition_failed',
        });
      }
      throw error;
    }
    revalidatePath(`/templates/${input['inquiry-template-id']}/settings`);
    return undefined;
  });
}
