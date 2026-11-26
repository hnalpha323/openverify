'use server';

/**
 * The Connect pages' actions (C242.1): Connect's settings, and the actions each side of a
 * connection may take (C231.3-C231.6). Every refusal of the API is said in words by its code
 * (`describeConnectProblem`); the agreement reference and the step-up's code or assertion travel
 * only in the request they belong to and are never echoed (rule 11).
 */
import {
  CONSENT_PROOF_RETENTION_DAYS,
  SHARE_TOKEN_MAX_SECONDS,
  activateConnectionBodySchema,
  agreementReferenceSchema,
  idSchema,
  redeemShareTokenBodySchema,
  sharePolicySchema,
  webauthnAuthenticationResponseSchema,
  type DashboardUpdateSettingsBody,
  type RedeemShareTokenBody,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import {
  activateConnection,
  changeSharePolicy,
  deactivateConnection,
  expireShareToken,
  reactivateConnection,
  redeemShareToken,
} from '../../../components/connect/connect-api';
import { describeConnectProblem } from '../../../components/connect/connect-problem-words';
import { connectionHref } from '../../../components/connect/connections-table';
import { SHARE_TOKENS_PATH, shareTokenHref } from '../../../components/connect/share-tokens-table';
import type { ActionResult, ActionState, DisplayProblem } from '../../../lib/action-state';
import { ActionInputError, formString, runAction } from '../../../lib/api/action';
import { displayProblemOf } from '../../../lib/api/errors';
import { stepUpSession, stepUpWebauthnOptions } from '../../../lib/api/sessions';
import { getSettings, updateSettings } from '../../../lib/api/settings';
import { SETTINGS_COPY } from '../../../lib/copy/settings';

const CONNECT_PATH = '/settings/connect';
const USERS_COPY = SETTINGS_COPY.users;

function refuse(errors: NonNullable<DisplayProblem['errors']>): never {
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors,
  });
}

/**
 * The API's answer to `call`; a refusal is said in words by its code (and `consent_required` by its
 * reason). A 401 is left to `runAction`, which signs the operator out.
 */
async function inWords<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof OpenVerifyApiError && error.status !== 401) {
      const reason = (error.problem as Readonly<Record<string, unknown>>).reason;
      throw new ActionInputError(
        describeConnectProblem(
          displayProblemOf(error, { apiForbidden: 'detail' }),
          typeof reason === 'string' ? reason : null,
        ),
      );
    }
    throw error;
  }
}

/** The `cxn_` id posted in the form, refused at `/connection-id` otherwise. */
function postedConnectionId(formData: FormData): string {
  const parsed = idSchema('cxn').safeParse(formString(formData, 'connection-id'));
  if (!parsed.success) {
    refuse([{ pointer: '/connection-id', detail: 'This is not a connection id.' }]);
  }
  return parsed.data;
}

/** After a change: the connection's page and the list. */
function revalidateConnection(id: string): void {
  revalidatePath(connectionHref(id));
  revalidatePath(CONNECT_PATH);
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

const isRefusedFactor = (error: unknown) =>
  error instanceof OpenVerifyApiError && (error.status === 401 || error.status === 400);

/**
 * C168.1, C231.3: the activation needs a factor verified in the last 10 minutes. When the dialog
 * carries a passkey assertion or a code, it is verified first; a refused one is said at its field
 * and nothing else is called. Without either, the activation itself answers `step_up_required`
 * unless the session verified a factor recently.
 */
async function stepUpWith(formData: FormData): Promise<void> {
  const credential = postedCredential(formData);
  if (credential !== null) {
    await stepUpSession({ credential }).catch((error: unknown) => {
      if (isRefusedFactor(error)) {
        refuse([{ pointer: CREDENTIAL_POINTER, detail: USERS_COPY.stepUpKeyRefused }]);
      }
      throw error;
    });
    return;
  }
  const code = formString(formData, 'totp-code')?.replace(/\s+/gu, '') ?? '';
  if (code === '') {
    return;
  }
  if (!TOTP_CODE.test(code)) {
    refuse([{ pointer: '/totp-code', detail: USERS_COPY.codeFormat }]);
  }
  await stepUpSession({ 'totp-code': code }).catch((error: unknown) => {
    if (isRefusedFactor(error)) {
      refuse([{ pointer: '/totp-code', detail: USERS_COPY.codeInvalid }]);
    }
    throw error;
  });
}

/** C231.3: the activation's body, refused field by field before anything is called. */
function activationOf(formData: FormData): z.infer<typeof activateConnectionBodySchema> {
  const errors: { pointer: string; detail: string }[] = [];
  const reference = formString(formData, 'agreement-reference') ?? '';
  if (!agreementReferenceSchema.safeParse(reference).success) {
    errors.push({
      pointer: '/agreement-reference',
      detail: 'Enter the agreement’s reference, 1 to 500 characters.',
    });
  }
  if (formString(formData, 'acknowledged') !== 'true') {
    errors.push({ pointer: '/acknowledged', detail: 'Tick the box to accept the policy.' });
  }
  const version = Number(formString(formData, 'policy-version'));
  if (!Number.isInteger(version) || version < 1) {
    errors.push({ pointer: '/policy-version', detail: 'This is not a policy version.' });
  }
  if (errors.length > 0) {
    refuse(errors);
  }
  return activateConnectionBodySchema.parse({
    data: {
      type: 'connect/connection',
      attributes: {
        'policy-version': version,
        'agreement-reference': reference,
        acknowledged: true,
      },
    },
  });
}

/**
 * C231.3: the destination's administrator activates a pending connection, accepting the version the
 * page showed (409 `share_policy_changed` when it changed meanwhile), citing the agreement and with
 * a second factor verified in the last 10 minutes.
 */
export async function activateConnectionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-connections:activate'] }, async () => {
    const id = postedConnectionId(formData);
    const body = activationOf(formData);
    await stepUpWith(formData);
    await inWords(activateConnection(id, body));
    revalidateConnection(id);
    return undefined;
  });
}

/** C168.1 (K9-11): the passkey step-up's options for the activation dialog. */
export async function startConnectStepUpWebauthn(): Promise<
  ActionResult<{ readonly options: Record<string, unknown> }>
> {
  return runAction({ permissions: ['connect-connections:activate'] }, async () => ({
    options: await stepUpWebauthnOptions(),
  }));
}

/** C231.4: either side deactivates; every created token of the connection expires with it. */
export async function deactivateConnectionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-connections:write'] }, async () => {
    const id = postedConnectionId(formData);
    await inWords(deactivateConnection(id));
    revalidateConnection(id);
    return undefined;
  });
}

/** C231.5: the source reactivates; the connection is pending until the destination activates. */
export async function reactivateConnectionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-connections:write'] }, async () => {
    const id = postedConnectionId(formData);
    await inWords(reactivateConnection(id));
    revalidateConnection(id);
    return undefined;
  });
}

const POLICY_POINTER = '/share-policy';

const pointerOf = (path: readonly PropertyKey[]) =>
  path.map((key) => `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');

/**
 * C231.6: the source writes version n + 1 from the JSON the dialog holds. JSON that does not parse,
 * or a policy that breaks a rule of C230.3, is refused at its pointer before the API is called; the
 * API's own 422 `share_policy_invalid` keeps its pointers.
 */
export async function changeSharePolicyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-connections:write'] }, async () => {
    const id = postedConnectionId(formData);
    let posted: unknown;
    try {
      posted = JSON.parse(formString(formData, 'share-policy') ?? '');
    } catch (error) {
      refuse([
        {
          pointer: POLICY_POINTER,
          detail: `This is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
    const policy = sharePolicySchema.safeParse(posted);
    if (!policy.success) {
      refuse(
        policy.error.issues.map((issue) => ({
          pointer: `${POLICY_POINTER}${pointerOf(issue.path)}`,
          detail: issue.message,
        })),
      );
    }
    await inWords(changeSharePolicy(id, policy.data));
    revalidateConnection(id);
    return undefined;
  });
}

const SECONDS = /^\d{1,7}$/;
const DAYS = /^\d{1,4}$/;

/** A whole number in `range`, or the field's error. */
function wholeIn(
  formData: FormData,
  name: string,
  pattern: RegExp,
  range: { readonly min: number; readonly max: number },
  detail: string,
  errors: { pointer: string; detail: string }[],
): number | undefined {
  const value = formString(formData, name) ?? '';
  const parsed = pattern.test(value) ? Number(value) : Number.NaN;
  if (parsed >= range.min && parsed <= range.max) {
    return parsed;
  }
  errors.push({ pointer: `/${name}`, detail });
  return undefined;
}

/**
 * C231.10, C232.1, C241.3: Connect's settings. Only what changed is sent, so the audit entry names
 * exactly that; the organisation's opt-in is refused by the API (403) to a role scoped to one
 * environment, whose words the form shows.
 */
export async function saveConnectSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['settings:write'], environmentForm: formData }, async () => {
    const errors: { pointer: string; detail: string }[] = [];
    const maxSeconds = wholeIn(
      formData,
      'share-token-max-seconds',
      SECONDS,
      SHARE_TOKEN_MAX_SECONDS,
      'Enter a whole number of seconds from 60 to 1,814,400.',
      errors,
    );
    const proofDays = wholeIn(
      formData,
      'consent-proof-retention-days',
      DAYS,
      CONSENT_PROOF_RETENTION_DAYS,
      'Enter a whole number of days from 0 to 3,650.',
      errors,
    );
    if (errors.length > 0) {
      refuse(errors);
    }
    const current = await getSettings();
    const wanted: DashboardUpdateSettingsBody = {
      'connect-inbound': formString(formData, 'connect-inbound') === 'true',
      ...(maxSeconds === undefined ? {} : { 'share-token-max-seconds': maxSeconds }),
      ...(proofDays === undefined ? {} : { 'consent-proof-retention-days': proofDays }),
    };
    const changes = Object.fromEntries(
      Object.entries(wanted).filter(
        ([name, value]) => current[name as keyof typeof current] !== value,
      ),
    ) as DashboardUpdateSettingsBody;
    if (Object.keys(changes).length > 0) {
      await inWords(updateSettings(changes));
    }
    revalidatePath(CONNECT_PATH);
    return undefined;
  });
}

/** The `cnst_` id posted in the form, refused at `/share-token-id` otherwise. */
function postedTokenId(formData: FormData): string {
  const parsed = idSchema('cnst').safeParse(formString(formData, 'share-token-id'));
  if (!parsed.success) {
    refuse([{ pointer: '/share-token-id', detail: 'This is not a share token id.' }]);
  }
  return parsed.data;
}

/** After a change: the token's page and the list. */
function revalidateToken(id: string): void {
  revalidatePath(shareTokenHref(id));
  revalidatePath(SHARE_TOKENS_PATH);
}

/** C232.4: the source expires a token that is not redeemed yet. */
export async function expireShareTokenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-share-tokens:write'] }, async () => {
    const id = postedTokenId(formData);
    await inWords(expireShareToken(id));
    revalidateToken(id);
    return undefined;
  });
}

/** One field mapping per line: `source -> destination` (C234.1, C234.5). */
const MAPPING = /^\s*([^\s>-][^\s>]*?)\s*->\s*(\S+)\s*$/u;

/** The redeem body the form describes (C234.1); field errors at the body's own pointers. */
function redemptionOf(formData: FormData): RedeemShareTokenBody {
  const errors: { pointer: string; detail: string }[] = [];
  const text = (name: string) => {
    const value = formString(formData, name) ?? '';
    return value === '' ? undefined : value;
  };
  const hydrate = formString(formData, 'mode') === 'hydrate';
  const link = formString(formData, 'account-link');
  const mappings = hydrate
    ? (formString(formData, 'field-mappings', { trim: false }) ?? '')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .flatMap((line, index) => {
          const match = MAPPING.exec(line);
          if (match === null) {
            errors.push({
              pointer: `/meta/field-mappings/${String(index)}`,
              detail: 'Write each mapping as source field -> destination field.',
            });
            return [];
          }
          return [
            { 'source-field-name': match[1] ?? '', 'destination-field-name': match[2] ?? '' },
          ];
        })
    : [];
  const consent = text('destination-consent-record-id');
  if (consent === undefined) {
    errors.push({
      pointer: '/meta/destination-consent-record-id',
      detail: 'Enter your destination consent record’s ID (cnsr_…).',
    });
  }
  if (errors.length > 0) {
    refuse(errors);
  }
  const meta = {
    ...(hydrate && mappings.length > 0 ? { 'field-mappings': mappings } : {}),
    ...(hydrate
      ? {}
      : {
          'inquiry-template-id': text('inquiry-template-id'),
          'inquiry-template-version-id': text('inquiry-template-version-id'),
          'inquiry-id': text('inquiry-id'),
          ...(link === 'existing' ? { 'account-id': text('account-id') } : {}),
          ...(link === 'new'
            ? {
                'auto-create-account-reference-id': text('auto-create-account-reference-id'),
                'auto-create-account-type-id': text('auto-create-account-type-id'),
              }
            : {}),
        }),
    'destination-consent-record-id': consent,
  };
  const body = {
    ...(hydrate
      ? {
          data: {
            type: 'connect/share-token',
            attributes: { 'destination-id': text('destination-id') },
          },
        }
      : {}),
    meta: Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)),
  };
  const parsed = redeemShareTokenBodySchema.safeParse(body);
  if (!parsed.success) {
    refuse(
      parsed.error.issues.map((issue) => ({
        pointer: pointerOf(issue.path),
        detail: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * C234.1: the destination redeems a created token, citing its own destination-side consent record.
 * The answer is 202 with the token pending; the copy is made by the job. `consent_required` is said
 * with its reason in words.
 */
export async function redeemShareTokenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-share-tokens:redeem'] }, async () => {
    const id = postedTokenId(formData);
    await inWords(redeemShareToken(id, redemptionOf(formData)));
    revalidateToken(id);
    return undefined;
  });
}
