/**
 * The action pattern (C21): every mutation is a server action (Next.js checks its Origin) that
 * validates its input with the contract's request schema and returns `{ ok: true, data }` or
 * `{ ok: false, problem }`. Forms render the problem's title and detail, never a stack.
 *
 * ```ts
 * 'use server';
 * export async function approveInquiry(
 *   _previous: ActionState, formData: FormData,
 * ): Promise<ActionResult> {
 *   return runAction({ permissions: ['inquiries:write'] }, async ({ api }) => {
 *     const id = parseInput(inquiryIdSchema, formString(formData, 'inquiry-id'));
 *     await api.inquiries.approve(id);
 *     revalidatePath(`/inquiries/${id}`);
 *   });
 * }
 * ```
 *
 * `runAction` sends a signed-out operator to `/login` and a session that must pass MFA to
 * `/account/security` (a redirect, as for pages); a missing permission answers "You do not have
 * access" without calling the API, and a 403 from the API keeps its own title and detail, which
 * name what was refused (Workflow 2D K004); a programming error is rethrown to the error boundary.
 */
import 'server-only';
import type { Permission } from '@openverify/core';
import type { OpenVerifyClient } from '@openverify/node';
import { redirect } from 'next/navigation';
import type { z } from 'zod';
import { ENVIRONMENT_FIELD } from '../../components/environment-field';
import { getApiClient } from './client';
import type { ActionResult, DisplayProblem } from '../action-state';
import {
  FORBIDDEN_PROBLEM,
  SECURITY_PATH,
  classifyApiError,
  displayProblemOf,
  redirectIfSignedOut,
} from './errors';
import { getSession, type DashboardSession } from './me';

export type { ActionResult, ActionState, DisplayProblem } from '../action-state';

export interface ActionGuard {
  /** Every permission the action needs; without one the API is not called. */
  readonly permissions?: readonly Permission[];
  /** For the actions a session that has not passed required MFA may run (MFA enrolment). */
  readonly allowWithoutMfa?: boolean;
  /**
   * The form of an action that works in the session's environment without naming a resource of
   * it (settings, creations). It must carry the `environment-id` its page rendered
   * (`EnvironmentField`); when that is not the session's environment, which another tab may have
   * switched, the API is not called (Workflow 2D F002).
   */
  readonly environmentForm?: FormData;
}

/** The answer to a form rendered for another environment than the session's (Workflow 2D F002). */
export const ENVIRONMENT_CHANGED_PROBLEM: DisplayProblem = Object.freeze({
  title: 'The environment changed',
  detail:
    'You switched environment after this page was opened, so nothing was saved. Reload the page and try again.',
});

export interface ActionContext {
  readonly session: DashboardSession;
  readonly api: OpenVerifyClient;
}

/** Input that failed its schema; `runAction` answers it with the field errors. */
export class ActionInputError extends Error {
  override name = 'ActionInputError';
  readonly problem: DisplayProblem;

  constructor(problem: DisplayProblem) {
    super(problem.title);
    this.problem = problem;
  }
}

const pointerOf = (path: readonly PropertyKey[]) =>
  `/${path.map((key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;

/**
 * `value` parsed with a contract request schema.
 * @throws {ActionInputError} with one field error per issue, by JSON Pointer.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: parsed.error.issues.map((issue) => ({
      pointer: pointerOf(issue.path),
      detail: issue.message,
    })),
  });
}

/** One text value of a form, trimmed by default; `undefined` when absent or a file. */
export function formString(
  formData: FormData,
  name: string,
  { trim = true }: { trim?: boolean } = {},
): string | undefined {
  const value = formData.get(name);
  if (typeof value !== 'string') {
    return undefined;
  }
  return trim ? value.trim() : value;
}

/** Every text value of a repeated form field (checkboxes, multi-selects). */
export function formStrings(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string');
}

export async function runAction<Data>(
  guard: ActionGuard,
  run: (context: ActionContext) => Promise<Data>,
): Promise<ActionResult<Data>> {
  const session = await getSession();
  if (!session.mfaSatisfied && guard.allowWithoutMfa !== true) {
    redirect(SECURITY_PATH);
  }
  if (!(guard.permissions ?? []).every((permission) => session.permissions.has(permission))) {
    return { ok: false, problem: FORBIDDEN_PROBLEM };
  }
  if (
    guard.environmentForm !== undefined &&
    formString(guard.environmentForm, ENVIRONMENT_FIELD) !== session.environment.id
  ) {
    return { ok: false, problem: ENVIRONMENT_CHANGED_PROBLEM };
  }
  try {
    return { ok: true, data: await run({ session, api: await getApiClient() }) };
  } catch (error) {
    if (error instanceof ActionInputError) {
      return { ok: false, problem: error.problem };
    }
    redirectIfSignedOut(error);
    if (classifyApiError(error) === null) {
      throw error;
    }
    return { ok: false, problem: displayProblemOf(error, { apiForbidden: 'detail' }) };
  }
}
