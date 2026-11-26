'use server';

/**
 * Dismissing a list match (C99.3, C108): `POST /list-matches/:id/dismiss` with a required reason
 * (`lists:write`). The reason is PII and goes only to the API. A match dismissed already answers
 * 409 `list_match_not_open`, said in words. The page the dismissal came from is refreshed: the
 * inquiry or account page, and the case page when it came from one (K8-39), each path built from an
 * id the schema checked, never a path taken from the form.
 */
import { LIST_LIMITS, dismissListMatchBodySchema, idSchema } from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';

const REASON = '/data/attributes/reason';

const NOT_OPEN = 'This list match is no longer open: it was dismissed already.';

const inputSchema = z.strictObject({
  'list-match-id': idSchema('lmt'),
  'inquiry-id': idSchema('inq').optional(),
  'account-id': idSchema('acc').optional(),
  'case-id': idSchema('case').optional(),
});

const optional = (formData: FormData, name: string) => {
  const value = formString(formData, name);
  return value === '' ? undefined : value;
};

export async function dismissListMatch(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction({ permissions: ['lists:write'] }, async ({ api }) => {
    const input = parseInput(inputSchema, {
      'list-match-id': formString(formData, 'list-match-id'),
      'inquiry-id': optional(formData, 'inquiry-id'),
      'account-id': optional(formData, 'account-id'),
      'case-id': optional(formData, 'case-id'),
    });
    const reason = optional(formData, 'reason');
    if (reason === undefined) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [{ pointer: REASON, detail: 'Say why you dismiss this match.' }],
      });
    }
    if (reason.length > LIST_LIMITS.dismissReasonLength) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [
          {
            pointer: REASON,
            detail: `Use at most ${String(LIST_LIMITS.dismissReasonLength)} characters.`,
          },
        ],
      });
    }
    const body = parseInput(dismissListMatchBodySchema, { data: { attributes: { reason } } });
    await api.listMatches.dismiss(input['list-match-id'], body.data.attributes);
    if (input['inquiry-id'] !== undefined) {
      revalidatePath(`/inquiries/${input['inquiry-id']}`);
    }
    if (input['account-id'] !== undefined) {
      revalidatePath(`/accounts/${input['account-id']}`);
    }
    if (input['case-id'] !== undefined) {
      revalidatePath(`/cases/${input['case-id']}`);
    }
    return undefined;
  });
  if (!result.ok && result.problem.code === 'list_match_not_open') {
    return { ok: false, problem: { ...result.problem, title: NOT_OPEN } };
  }
  return result;
}
