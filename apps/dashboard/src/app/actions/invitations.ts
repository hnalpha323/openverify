'use server';

import { dashboardAcceptInvitationBodySchema } from '@openverify/contracts';
import { redirect } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput } from '../../lib/api/action';
import {
  acceptInvitation as acceptInvitationInApi,
  createSession,
  type InvitationOutcome,
} from '../../lib/api/sessions';
import { continueWithMfa, openConsole } from '../../lib/sign-in';

type InvitationFailure = Extract<InvitationOutcome, { kind: 'failed' }>['reason'];

const FAILURES: Readonly<Record<InvitationFailure, string>> = {
  invalid_token: 'This invitation is not valid any more. Ask your administrator for a new one.',
  invalid_input: 'Check the name and password, then try again.',
  unavailable: 'The invitation could not be accepted right now. Try again later.',
};

/**
 * Accepts an invitation (C22): `{ token, password, name }` from the form (the token comes from
 * the link's fragment, never a URL the server sees), then signs the new operator in.
 */
export async function acceptInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const password = formString(formData, 'password', { trim: false });
  // eslint-disable-next-line security/detect-possible-timing-attacks -- the password and its confirmation are one person's own submission; no stored secret is compared
  if (formString(formData, 'password-confirmation', { trim: false }) !== password) {
    return {
      ok: false,
      problem: {
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [{ pointer: '/password-confirmation', detail: 'The passwords do not match.' }],
      },
    };
  }
  let body;
  try {
    body = parseInput(dashboardAcceptInvitationBodySchema, {
      token: formString(formData, 'token'),
      password,
      name: formString(formData, 'name'),
    });
  } catch (error) {
    if (error instanceof ActionInputError) {
      return { ok: false, problem: error.problem };
    }
    throw error;
  }

  const accepted = await acceptInvitationInApi(body);
  if (accepted.kind === 'failed') {
    return {
      ok: false,
      problem: { title: 'The invitation was not accepted', detail: FAILURES[accepted.reason] },
    };
  }
  const login = await createSession({ email: accepted.email, password: body.password });
  if (login.kind === 'session') {
    return openConsole(login.session);
  }
  if (login.kind === 'mfa') {
    return continueWithMfa(login.challenge);
  }
  redirect('/login?reason=invitation-accepted');
}
