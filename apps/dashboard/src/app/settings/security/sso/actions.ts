'use server';

/**
 * C248.3, C248.8 (Phase 11, Workflow 11B, `sso-oidc`): the actions of Settings → Security → Single
 * sign-on. The organisation's sign-in name is a setting (`settings:write` through an
 * organisation-wide assignment; the API answers 403 otherwise). Every provider write needs Phase 9's
 * step-up: a code typed in the form is verified first (`POST /sessions/current/step-up`), as the team
 * page does; a refused code is said at its field and nothing else is called.
 */
import {
  createSsoProviderBodySchema,
  idSchema,
  organizationSlugSchema,
  updateSsoProviderBodySchema,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import {
  ActionInputError,
  formString,
  parseInput,
  runAction,
  type ActionResult,
  type ActionState,
} from '../../../../lib/api/action';
import { stepUpSession } from '../../../../lib/api/sessions';
import { updateSettings } from '../../../../lib/api/settings';
import { SSO_PROVIDER_FIELDS, SSO_SETTINGS_PATH, providerRequestOf } from './sso-form-input';
import { createSsoProvider, deleteSsoProvider, updateSsoProvider } from './sso-providers-api';

const STEP_UP_POINTER = `/${SSO_PROVIDER_FIELDS.stepUpCode}`;
const TOTP_CODE = /^\d{6}$/;

function refuse(pointer: string, detail: string): never {
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: [{ pointer, detail }],
  });
}

/** C168.1: a code typed in the form is checked first; a refused one stops the write. */
async function stepUpIfGiven(formData: FormData): Promise<void> {
  const code = formString(formData, SSO_PROVIDER_FIELDS.stepUpCode)?.replace(/\s+/gu, '') ?? '';
  if (code === '') {
    return;
  }
  if (!TOTP_CODE.test(code)) {
    refuse(STEP_UP_POINTER, 'Enter the 6-digit code from your authenticator app.');
  }
  try {
    await stepUpSession({ 'totp-code': code });
  } catch (error) {
    if (error instanceof OpenVerifyApiError && (error.status === 401 || error.status === 400)) {
      refuse(STEP_UP_POINTER, 'That code is not valid. Enter the current code.');
    }
    throw error;
  }
}

/** The API's step-up refusal, said where the code is typed. */
function stepUpRefusal(error: unknown): never {
  if (error instanceof OpenVerifyApiError && error.code === 'step_up_required') {
    throw new ActionInputError({
      title: 'Confirm it is you',
      detail:
        'Changing single sign-on needs a second factor checked in the last 10 minutes. Enter a code from your authenticator app, or re-authenticate with single sign-on.',
      status: 403,
      code: 'step_up_required',
      errors: [{ pointer: STEP_UP_POINTER, detail: 'Enter the current code to confirm.' }],
    });
  }
  throw error;
}

/** `PATCH /dashboard/settings` with `organization-slug` (C248.8): empty clears it. */
export async function saveSignInName(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['settings:write'], environmentForm: formData }, async () => {
    const value = formString(formData, 'organization-slug')?.toLowerCase() ?? '';
    const slug = value === '' ? null : organizationSlugSchema.safeParse(value);
    if (slug !== null && !slug.success) {
      refuse(
        '/organization-slug',
        'Use 3 to 63 characters: lower-case letters, digits and inner hyphens.',
      );
    }
    await updateSettings({ 'organization-slug': slug === null ? null : slug.data });
    revalidatePath(SSO_SETTINGS_PATH);
    return undefined;
  });
}

/** `POST /dashboard/sso-providers`. */
export async function createSsoProviderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['settings:write'], environmentForm: formData }, async () => {
    const body = parseInput(createSsoProviderBodySchema, providerRequestOf(formData));
    await stepUpIfGiven(formData);
    await createSsoProvider(body).catch(stepUpRefusal);
    revalidatePath(SSO_SETTINGS_PATH);
    return undefined;
  });
}

const providerIdOf = (formData: FormData): string => {
  const parsed = idSchema('ssop').safeParse(formString(formData, SSO_PROVIDER_FIELDS.providerId));
  if (!parsed.success) {
    refuse(`/${SSO_PROVIDER_FIELDS.providerId}`, 'This provider no longer exists.');
  }
  return parsed.data;
};

/** `PATCH /dashboard/sso-providers/:id`: every member the form shows; the secret only if typed. */
export async function updateSsoProviderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['settings:write'], environmentForm: formData }, async () => {
    const id = providerIdOf(formData);
    const body = parseInput(updateSsoProviderBodySchema, providerRequestOf(formData));
    await stepUpIfGiven(formData);
    await updateSsoProvider(id, body).catch(stepUpRefusal);
    revalidatePath(SSO_SETTINGS_PATH);
    return undefined;
  });
}

/** `DELETE /dashboard/sso-providers/:id`. */
export async function deleteSsoProviderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['settings:write'], environmentForm: formData }, async () => {
    const id = providerIdOf(formData);
    await stepUpIfGiven(formData);
    await deleteSsoProvider(id).catch(stepUpRefusal);
    revalidatePath(SSO_SETTINGS_PATH);
    return undefined;
  });
}
