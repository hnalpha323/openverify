'use server';

import {
  confirmTotpBodySchema,
  enrollTotpBodySchema,
  idSchema,
  webauthnRegistrationVerifyBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { formString, parseInput, runAction } from '../../lib/api/action';
import {
  confirmTotp,
  deleteMfaFactor,
  enrollTotp,
  regenerateRecoveryCodes,
  verifyWebauthnRegistration,
  webauthnRegistrationOptions,
} from '../../lib/api/mfa';
import { deleteSession } from '../../lib/api/sessions';
import type { FactorActivated, TotpEnrolmentData } from '../../lib/mfa-enrolment';
import { qrCode } from '../../lib/qr';
import { SIGN_OUT_INCOMPLETE_PATH, clearSessionCookie } from '../../lib/session';
import { z } from 'zod';

const SECURITY_PATH = '/account/security';
/** C15: a session without a factor in an organization that requires MFA may enrol one. */
const ENROLMENT = { allowWithoutMfa: true } as const;

/** An optional factor name: an empty field means none. */
const optionalName = (formData: FormData) => {
  const name = formString(formData, 'name');
  return name === undefined || name === '' ? undefined : name;
};

/** Starts a TOTP factor: its secret and a QR code of its `otpauth://` URI, shown once. */
export async function startTotpEnrolment(
  _previous: ActionState<TotpEnrolmentData>,
  formData: FormData,
): Promise<ActionResult<TotpEnrolmentData>> {
  return runAction(ENROLMENT, async () => {
    const { name } = parseInput(enrollTotpBodySchema, { name: optionalName(formData) });
    const enrolment = await enrollTotp(name);
    revalidatePath(SECURITY_PATH);
    return {
      factorId: enrolment.factor.id,
      secret: enrolment.secret,
      otpauthUri: enrolment['otpauth-uri'],
      qr: qrCode(enrolment['otpauth-uri']),
    };
  });
}

/** Activates a pending TOTP factor with a current code. */
export async function confirmTotpEnrolment(
  _previous: ActionState<FactorActivated>,
  formData: FormData,
): Promise<ActionResult<FactorActivated>> {
  return runAction(ENROLMENT, async () => {
    const body = parseInput(confirmTotpBodySchema, {
      'factor-id': formString(formData, 'factor-id'),
      'totp-code': formString(formData, 'totp-code'),
    });
    const { recoveryCodes } = await confirmTotp(body['factor-id'], body['totp-code']);
    revalidatePath(SECURITY_PATH);
    return { recoveryCodes };
  });
}

/** Creation options for the browser's `navigator.credentials.create()`. */
export async function startWebauthnEnrolment(): Promise<
  ActionResult<{ options: Record<string, unknown> }>
> {
  return runAction(ENROLMENT, async () => ({ options: await webauthnRegistrationOptions() }));
}

/** Stores the security key the browser registered. */
export async function finishWebauthnEnrolment(input: {
  credential: unknown;
  name?: string;
}): Promise<ActionResult<FactorActivated>> {
  return runAction(ENROLMENT, async () => {
    const name = input.name?.trim();
    const body = parseInput(webauthnRegistrationVerifyBodySchema, {
      credential: input.credential,
      ...(name === undefined || name === '' ? {} : { name }),
    });
    const { recoveryCodes } = await verifyWebauthnRegistration(body.credential, body.name);
    revalidatePath(SECURITY_PATH);
    return { recoveryCodes };
  });
}

const removeSchema = z.strictObject({ 'factor-id': idSchema('mfa') });

/** Removes a factor; removing the last active one also removes the recovery codes. */
export async function removeMfaFactor(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(ENROLMENT, async () => {
    const body = parseInput(removeSchema, { 'factor-id': formString(formData, 'factor-id') });
    await deleteMfaFactor(body['factor-id']);
    revalidatePath(SECURITY_PATH);
    return undefined;
  });
}

/** A new set of recovery codes, shown once; needs a session that passed MFA. */
export async function regenerateCodes(): Promise<ActionResult<readonly string[]>> {
  return runAction({}, () => regenerateRecoveryCodes());
}

/**
 * Ends a session that predates the operator's first factor: it can no longer enrol or remove
 * factors, and must sign in with the factor (2B F002).
 */
export async function signInAgain(): Promise<void> {
  const ended = await deleteSession();
  await clearSessionCookie();
  redirect(ended === 'ended' ? '/login?reason=mfa-reauth' : SIGN_OUT_INCOMPLETE_PATH);
}
