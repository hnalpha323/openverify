'use server';

/**
 * The users page's mutations (C15, C21): invitations and changes of a user's roles or status.
 * Each needs `users:write`; the API also refuses roles that grant permissions the operator lacks
 * (403) and demoting or deactivating the last active admin (409), whose problems the page shows.
 */
import {
  dashboardInviteUserBodySchema,
  idSchema,
  setUserRolesBodySchema,
  userUpdatableStatusSchema,
  webauthnAuthenticationResponseSchema,
  type RoleAssignment,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { InvitationSent } from '../../components/operators/invite-user-button';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
} from '../../lib/api/action';
import { stepUpSession, stepUpWebauthnOptions } from '../../lib/api/sessions';
import {
  endUserSessions as endSessions,
  getUserRoles,
  reactivateUser as reactivate,
  resendInvitation as resend,
  resetUserMfa as resetMfa,
  setUserRoles,
  inviteUser as sendInvitation,
  updateUser,
} from '../../lib/api/users';
import { SETTINGS_COPY } from '../../lib/copy/settings';

const USERS_COPY = SETTINGS_COPY.users;

const USERS_PATH = '/users';
const WRITE = { permissions: ['users:write'] } as const;
const READ = { permissions: ['users:read'] } as const;

const EMAIL_HINT = 'Enter an email address, such as name@example.com.';
const ROLES_HINT = 'Choose at least one role.';
const SCOPE_HINT = 'Choose where this role applies.';

/** Refuses the form with these field errors, worded for people, before the contract check. */
function refuse(errors: DisplayProblem['errors']): never {
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    ...(errors === undefined ? {} : { errors }),
  });
}

/** The invitation body of a form: `email` and the checked (or comma-joined) `role-ids`. */
function invitationOf(email: string | undefined, roleIds: readonly string[]) {
  const errors = [
    ...(z.email().safeParse(email).success ? [] : [{ pointer: '/email', detail: EMAIL_HINT }]),
    ...(roleIds.length > 0 ? [] : [{ pointer: '/role-ids', detail: ROLES_HINT }]),
  ];
  if (errors.length > 0) {
    refuse(errors);
  }
  return parseInput(dashboardInviteUserBodySchema, { email, 'role-ids': roleIds });
}

async function invite(body: z.output<typeof dashboardInviteUserBodySchema>) {
  const invitation = await sendInvitation(body);
  revalidatePath(USERS_PATH);
  return { email: invitation.email, expiresAt: invitation.expiresAt };
}

/** Emails an invitation to a new operator with the checked roles. */
export async function inviteUser(
  _previous: ActionState<InvitationSent>,
  formData: FormData,
): Promise<ActionResult<InvitationSent>> {
  return runAction(WRITE, () =>
    invite(invitationOf(formString(formData, 'email'), formStrings(formData, 'role-ids'))),
  );
}

/**
 * Sends a fresh link to someone still invited (C168.1): `POST /invitations/:id/resend` revokes the
 * old link and the new one works for 7 days, with the roles they were invited with.
 */
export async function resendInvitation(
  _previous: ActionState<InvitationSent>,
  formData: FormData,
): Promise<ActionResult<InvitationSent>> {
  return runAction(WRITE, async () => {
    const userId = postedUserId(formData);
    const invitation = await resend(userId).catch((error: unknown) =>
      inWords(error, { ...USERS_COPY.resendRefusals, 429: USERS_COPY.resendLimited }),
    );
    revalidatePath(USERS_PATH);
    return { email: invitation.email, expiresAt: invitation.expiresAt };
  });
}

const userIdOf = (formData: FormData) =>
  parseInput(z.strictObject({ 'user-id': idSchema('usr') }), {
    'user-id': formString(formData, 'user-id'),
  })['user-id'];

/**
 * Replaces a user's assignments with the checked roles (C167.2): each everywhere, current and
 * future (`environment-ids: null`), or in the one environment chosen for it.
 */
export async function updateUserRoles(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async () => {
    const userId = userIdOf(formData);
    const roleIds = formStrings(formData, 'role-ids');
    if (roleIds.length === 0) {
      refuse([{ pointer: '/data/attributes/role-ids', detail: ROLES_HINT }]);
    }
    const unscoped = roleIds.filter(
      (roleId) => (formString(formData, `scope-${roleId}`) ?? '') === '',
    );
    if (unscoped.length > 0) {
      refuse(unscoped.map((roleId) => ({ pointer: `/scope-${roleId}`, detail: SCOPE_HINT })));
    }
    const body = parseInput(setUserRolesBodySchema, {
      assignments: roleIds.map((roleId) => {
        const scope = formString(formData, `scope-${roleId}`) ?? '';
        return { 'role-id': roleId, 'environment-ids': scope === 'all' ? null : [scope] };
      }),
    });
    await setUserRoles(userId, body.assignments).catch((error: unknown) =>
      inWords(error, {}, { role_scope_invalid: USERS_COPY.roleScopeInvalid }),
    );
    revalidatePath(USERS_PATH);
    return undefined;
  });
}

/** Deactivates a user and signs them out; reactivation goes through `reactivateUser` (AC2). */
export async function setUserStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async () => {
    const userId = userIdOf(formData);
    const { status } = parseInput(z.strictObject({ status: userUpdatableStatusSchema }), {
      status: formString(formData, 'status'),
    });
    if (status === 'active') {
      refuse([{ pointer: '/status', detail: USERS_COPY.reactivateThroughRoute }]);
    }
    await updateUser(userId, { status });
    revalidatePath(USERS_PATH);
    return undefined;
  });
}

/** A `usr_` id posted in the form, refused at `/user-id` otherwise. */
function postedUserId(formData: FormData): string {
  const parsed = idSchema('usr').safeParse(formString(formData, 'user-id'));
  if (!parsed.success) {
    refuse([{ pointer: '/user-id', detail: USERS_COPY.userIdHint }]);
  }
  return parsed.data;
}

/** An API refusal said in this page's words, when it has words for its code or status. */
function inWords(
  error: unknown,
  byStatus: Readonly<Record<number, string>> = {},
  byCode: Readonly<Record<string, string>> = {},
): never {
  if (error instanceof OpenVerifyApiError) {
    const code = error.code ?? undefined;
    const title =
      (code === 'step_up_required' || code === 'user_more_privileged'
        ? USERS_COPY.refusals[code]
        : code === undefined
          ? undefined
          : byCode[code]) ?? byStatus[error.status];
    if (title !== undefined) {
      throw new ActionInputError({
        title,
        status: error.status,
        ...(code === undefined ? {} : { code }),
      });
    }
  }
  throw error;
}

const TOTP_CODE = /^\d{6}$/;
const CREDENTIAL_POINTER = '/step-up-credential';

/** The browser's assertion the dialog carries (K9-11), or null when it carries none. */
function postedCredential(
  formData: FormData,
): z.infer<typeof webauthnAuthenticationResponseSchema> | null {
  const posted = formString(formData, 'step-up-credential') ?? '';
  if (posted === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(posted);
  } catch {
    parsed = null;
  }
  const credential = webauthnAuthenticationResponseSchema.safeParse(parsed);
  if (!credential.success) {
    refuse([{ pointer: CREDENTIAL_POINTER, detail: USERS_COPY.stepUpKeyMalformed }]);
  }
  return credential.data;
}

/**
 * C168.1: a reset or a reactivation needs a factor verified in the last 10 minutes. When the dialog
 * carries a passkey assertion (K9-11) or a code, it is verified first (`POST
 * /sessions/current/step-up`); a refused one is said at its field and nothing else is called.
 */
async function stepUpWith(formData: FormData): Promise<void> {
  const credential = postedCredential(formData);
  if (credential !== null) {
    try {
      await stepUpSession({ credential });
    } catch (error) {
      if (error instanceof OpenVerifyApiError && (error.status === 401 || error.status === 400)) {
        refuse([{ pointer: CREDENTIAL_POINTER, detail: USERS_COPY.stepUpKeyRefused }]);
      }
      throw error;
    }
    return;
  }
  const code = formString(formData, 'totp-code')?.replace(/\s+/gu, '') ?? '';
  if (code === '') {
    return;
  }
  if (!TOTP_CODE.test(code)) {
    refuse([{ pointer: '/totp-code', detail: USERS_COPY.codeFormat }]);
  }
  try {
    await stepUpSession({ 'totp-code': code });
  } catch (error) {
    if (error instanceof OpenVerifyApiError && (error.status === 401 || error.status === 400)) {
      refuse([{ pointer: '/totp-code', detail: USERS_COPY.codeInvalid }]);
    }
    throw error;
  }
}

/** What the passkey step-up's start answers the dialog: the request options for the browser. */
export interface StepUpWebauthnStart {
  readonly options: Record<string, unknown>;
}

/**
 * K9-22 (DS8): where each role of a user applies today (`GET /dashboard/users/:id/roles`,
 * `users:read`), for the assignments dialog to start from. A malformed id is refused before any call.
 */
export async function readUserAssignments(
  userId: string,
): Promise<ActionResult<readonly RoleAssignment[]>> {
  return runAction(READ, async () => {
    const parsed = idSchema('usr').safeParse(userId);
    if (!parsed.success) {
      refuse([{ pointer: '/user-id', detail: USERS_COPY.userIdHint }]);
    }
    return getUserRoles(parsed.data);
  });
}

/**
 * C168.1 (K9-11): the request options for a passkey step-up in the reset and reactivate dialogs, so
 * an operator whose only factor is a passkey can confirm it is them.
 */
export async function startStepUpWebauthn(): Promise<ActionResult<StepUpWebauthnStart>> {
  return runAction(WRITE, async () => ({ options: await stepUpWebauthnOptions() }));
}

/**
 * Reactivates a deactivated user through `POST /reactivate` only (C168.1; the plan's orchestrator
 * decision AC2): a new invitation, the user's history kept, and no role back.
 */
export async function reactivateUser(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async () => {
    const userId = postedUserId(formData);
    await stepUpWith(formData);
    await reactivate(userId).catch((error: unknown) =>
      inWords(error, USERS_COPY.reactivateRefusals),
    );
    revalidatePath(USERS_PATH);
    return undefined;
  });
}

/**
 * Removes another user's factors and recovery codes and signs them out everywhere (C168.3); never
 * on oneself (the Security page is for one's own factors).
 */
export async function resetUserMfa(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async ({ session }) => {
    const userId = postedUserId(formData);
    if (userId === session.user.id) {
      throw new ActionInputError({ title: USERS_COPY.resetOwn });
    }
    await stepUpWith(formData);
    await resetMfa(userId).catch((error: unknown) => inWords(error, USERS_COPY.resetRefusals));
    revalidatePath(USERS_PATH);
    return undefined;
  });
}

/**
 * C245.3 (Workflow 11B): ends every session of another user at once; never on oneself (Account,
 * Sessions ends one's own other sessions).
 */
export async function endUserSessions(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async ({ session }) => {
    const userId = postedUserId(formData);
    if (userId === session.user.id) {
      throw new ActionInputError({ title: USERS_COPY.endSessionsOwn });
    }
    await endSessions(userId).catch((error: unknown) => inWords(error));
    revalidatePath(USERS_PATH);
    return undefined;
  });
}
