/**
 * The signed-in operator's MFA factors (C15): enrolment, removal and recovery codes. A session
 * that has not passed required MFA may call these while the user has no active factor; once
 * they have one, it must sign in with it (2B F002: 401 `mfa-required`).
 */
import 'server-only';
import {
  confirmTotpResponseSchema,
  enrollTotpResponseSchema,
  mfaFactorListDocumentSchema,
  recoveryCodesResponseSchema,
  webauthnRegistrationOptionsResponseSchema,
  type MfaFactorResource,
} from '@openverify/contracts';
import { z } from 'zod';
import { apiRequest } from './client';

const ME = '/dashboard/me';

export async function listMfaFactors(): Promise<MfaFactorResource[]> {
  const { data } = await apiRequest({
    method: 'GET',
    path: `${ME}/mfa-factors`,
    schema: mfaFactorListDocumentSchema,
  });
  return data;
}

/** A pending TOTP factor, with its secret and `otpauth-uri` shown this once. */
export async function enrollTotp(name: string | undefined) {
  const { data, meta } = await apiRequest({
    method: 'POST',
    path: `${ME}/mfa-factors/totp`,
    body: name === undefined ? {} : { name },
    schema: enrollTotpResponseSchema,
  });
  return { factor: data, 'otpauth-uri': meta['otpauth-uri'], secret: meta.secret };
}

export interface ActivatedFactor {
  readonly factor: MfaFactorResource;
  readonly recoveryCodes: string[] | null;
}

export async function confirmTotp(factorId: string, totpCode: string): Promise<ActivatedFactor> {
  const { data, meta } = await apiRequest({
    method: 'POST',
    path: `${ME}/mfa-factors/totp/confirm`,
    body: { 'factor-id': factorId, 'totp-code': totpCode },
    schema: confirmTotpResponseSchema,
  });
  return { factor: data, recoveryCodes: meta?.['recovery-codes'] ?? null };
}

/** Creation options for `navigator.credentials.create()`. */
export async function webauthnRegistrationOptions(): Promise<Record<string, unknown>> {
  const { options } = await apiRequest({
    method: 'POST',
    path: `${ME}/mfa-factors/webauthn/options`,
    body: {},
    schema: webauthnRegistrationOptionsResponseSchema,
  });
  return options;
}

export async function verifyWebauthnRegistration(
  credential: unknown,
  name: string | undefined,
): Promise<ActivatedFactor> {
  const { data, meta } = await apiRequest({
    method: 'POST',
    path: `${ME}/mfa-factors/webauthn/verify`,
    body: name === undefined ? { credential } : { credential, name },
    schema: confirmTotpResponseSchema,
  });
  return { factor: data, recoveryCodes: meta?.['recovery-codes'] ?? null };
}

export async function deleteMfaFactor(id: string): Promise<void> {
  await apiRequest({
    method: 'DELETE',
    path: `${ME}/mfa-factors/${encodeURIComponent(id)}`,
    schema: z.unknown(),
  });
}

/** A new set of 10 recovery codes, shown once; the previous codes stop working. */
export async function regenerateRecoveryCodes(): Promise<string[]> {
  const answer = await apiRequest({
    method: 'POST',
    path: `${ME}/recovery-codes`,
    body: {},
    schema: recoveryCodesResponseSchema,
  });
  return answer['recovery-codes'];
}
