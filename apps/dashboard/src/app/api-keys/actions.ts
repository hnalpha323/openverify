'use server';

/**
 * API key mutations (C12), as server actions built with `runAction`: each needs
 * `api-keys:write` and validates its form with the contract's request schema. Tokens (create,
 * clone) are answered once, for the one-time secret dialog; nothing here logs or stores them.
 */
import {
  API_KEY_EXPIRE_MAX_SECONDS,
  cloneApiKeyBodySchema,
  createApiKeyBodySchema,
  expireApiKeyBodySchema,
  idSchema,
  updateApiKeyBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { CreatedApiKey, RotatedApiKeyData } from '../../components/integrations/action-data';
import {
  CUSTOM_EXPIRY,
  EXPIRE_NOW,
  EXPIRY_CHOICES,
  ROTATION_CHOICES,
} from '../../components/integrations/expiry-choices';
import { splitList, utcTimestamp } from '../../components/integrations/filter-values';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import { apiKeyAttributesFromForm, rotateApiKey as rotate } from '../../lib/api/api-keys';
import { SETTINGS_COPY } from '../../lib/copy/settings';

const WRITE = { permissions: ['api-keys:write'] } as const;

const apiKeyIdSchema = z.strictObject({ 'api-key-id': idSchema('key') });

/** The key the form is about. @throws {ActionInputError} for a malformed id. */
function apiKeyIdOf(formData: FormData): string {
  return parseInput(apiKeyIdSchema, { 'api-key-id': formString(formData, 'api-key-id') })[
    'api-key-id'
  ];
}

/** An expiry offered by the form, in seconds. */
function expirySchema(choices: readonly { readonly seconds: number }[], optional: boolean) {
  const allowed = choices.map((choice) => String(choice.seconds));
  return z.strictObject({
    'expires-in-seconds': z
      .string()
      .refine(
        (value) => allowed.includes(value) || (optional && value === ''),
        'Choose from the list.',
      ),
  });
}

/** The expiry chosen on the form: seconds, or `undefined` for none. */
function expiryOf(
  formData: FormData,
  choices: readonly { readonly seconds: number }[],
  optional: boolean,
) {
  const { 'expires-in-seconds': value } = parseInput(expirySchema(choices, optional), {
    'expires-in-seconds': formString(formData, 'expires-in-seconds') ?? '',
  });
  return value === '' ? undefined : Number(value);
}

const NAME_POINTER = '/data/attributes/name';
const RANGE_POINTER = /^\/data\/attributes\/allowed-ips\/(\d+)$/;

/**
 * `schema` applied to the form's key attributes, with the two messages the contract leaves
 * terse put in words: a missing name, and a range that is not CIDR (its union says only
 * "Invalid input").
 */
function parseKeyBody<Schema extends z.ZodType>(
  schema: Schema,
  attributes: Record<string, unknown>,
): z.output<Schema> {
  try {
    return parseInput(schema, { data: { type: 'api-key', attributes } });
  } catch (error) {
    if (!(error instanceof ActionInputError)) {
      throw error;
    }
    const ranges = Array.isArray(attributes['allowed-ips'])
      ? (attributes['allowed-ips'] as readonly unknown[])
      : [];
    const unnamed = attributes.name === undefined || attributes.name === '';
    throw new ActionInputError({
      ...error.problem,
      errors: (error.problem.errors ?? []).map((item) => {
        if (item.pointer === NAME_POINTER && unnamed) {
          return { pointer: NAME_POINTER, detail: 'Enter a name.' };
        }
        const range = RANGE_POINTER.exec(item.pointer);
        const value = range === null ? undefined : ranges[Number(range[1])];
        return typeof value === 'string'
          ? {
              pointer: item.pointer,
              detail: `${value} is not a CIDR range, such as 203.0.113.0/24 or 2001:db8::/32.`,
            }
          : item;
      }),
    });
  }
}

const EXPIRES_AT_POINTER = '/expires-at';

/** A refused `expires-at`, at its field. */
const expiresAtError = (detail: string) =>
  new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: [{ pointer: EXPIRES_AT_POINTER, detail }],
  });

/**
 * The expiry the creation form chose, in seconds from `now`: one of the offered times, a date
 * and time typed in UTC (rounded up to the next second, within the API's 30 days), or
 * `undefined` for none.
 * @throws {ActionInputError} for a choice not offered, or a time not in the next 30 days.
 */
function creationExpiryOf(formData: FormData, now: number): number | undefined {
  if (formString(formData, 'expires-in-seconds') !== CUSTOM_EXPIRY) {
    return expiryOf(formData, EXPIRY_CHOICES, true);
  }
  const at = utcTimestamp(formString(formData, 'expires-at') ?? '');
  if (at === undefined) {
    throw expiresAtError('Enter a date and time.');
  }
  const seconds = Math.ceil((Date.parse(at) - now) / 1000);
  if (seconds < 1) {
    throw expiresAtError('Choose a time in the future.');
  }
  if (seconds > API_KEY_EXPIRE_MAX_SECONDS) {
    throw expiresAtError('Choose a time within 30 days.');
  }
  return seconds;
}

type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: NonNullable<ActionInputError['problem']['errors']> };

/** `parse()`, with the field errors of the input it refuses kept rather than thrown. */
function settle<T>(parse: () => T): Settled<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof ActionInputError) {
      return { ok: false, errors: error.problem.errors ?? [] };
    }
    throw error;
  }
}

/**
 * Creates a key with the expiry chosen, in one call (C25.5); answers its id, its token, once,
 * and when it expires. A form with a bad expiry and bad key attributes is refused with every
 * error at once (E003).
 */
export async function createApiKey(
  _previous: ActionState<CreatedApiKey>,
  formData: FormData,
): Promise<ActionResult<CreatedApiKey>> {
  return runAction({ ...WRITE, environmentForm: formData }, async ({ api }) => {
    const expiry = settle(() => creationExpiryOf(formData, Date.now()));
    const expiresIn = expiry.ok ? expiry.value : undefined;
    const parsed = settle(() =>
      parseKeyBody(createApiKeyBodySchema, {
        ...apiKeyAttributesFromForm(formData),
        ...(expiresIn === undefined ? {} : { 'expires-in-seconds': expiresIn }),
      }),
    );
    if (!expiry.ok || !parsed.ok) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [...(parsed.ok ? [] : parsed.errors), ...(expiry.ok ? [] : expiry.errors)],
      });
    }
    const body = parsed.value;
    // A scope the operator does not hold answers 403 with the API's own words, which
    // `runAction` keeps for actions (Workflow 2D K004).
    const { data, meta } = await api.apiKeys.create(body.data.attributes);
    revalidatePath('/api-keys');
    return { id: data.id, secret: meta.token, expiresAt: data.attributes['expires-at'] };
  });
}

/**
 * Renames a key and sets the IP ranges it may be used from (none: every address), its note and its
 * attribute blocklist (C169.1, C169.3).
 */
export async function updateApiKey(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async ({ api }) => {
    const id = apiKeyIdOf(formData);
    const note = formString(formData, 'note');
    const blocklist = formString(formData, 'attribute-blocklist');
    const body = parseKeyBody(updateApiKeyBodySchema, {
      name: formString(formData, 'name'),
      'allowed-ips': splitList(formString(formData, 'allowed-ips')),
      // C169.1, C169.3: sent only from the form that shows them; an emptied note removes it.
      ...(note === undefined ? {} : { note: note.trim() === '' ? null : note.trim() }),
      ...(blocklist === undefined ? {} : { 'attribute-blocklist': splitList(blocklist) }),
    });
    await api.apiKeys.update(id, body.data.attributes);
    revalidatePath('/api-keys');
    revalidatePath(`/api-keys/${id}`);
    return undefined;
  });
}

/** A copy with the same scopes, ranges and version; answers its id and token, once. */
export async function cloneApiKey(
  _previous: ActionState<CreatedApiKey>,
  formData: FormData,
): Promise<ActionResult<CreatedApiKey>> {
  return runAction(WRITE, async ({ api }) => {
    const id = apiKeyIdOf(formData);
    const name = formString(formData, 'name');
    const body = parseInput(
      cloneApiKeyBodySchema,
      name === undefined || name === '' ? {} : { meta: { name } },
    );
    const { data, meta } = await api.apiKeys.clone(id, body?.meta);
    revalidatePath('/api-keys');
    return { id: data.id, secret: meta.token };
  });
}

/** Sets when the key stops working: now, or after one of the offered times. */
export async function expireApiKey(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(WRITE, async ({ api }) => {
    const id = apiKeyIdOf(formData);
    const seconds = expiryOf(formData, [EXPIRE_NOW, ...EXPIRY_CHOICES], false) ?? 0;
    const body = parseInput(expireApiKeyBodySchema, { meta: { 'expires-in-seconds': seconds } });
    await api.apiKeys.expire(id, body.meta);
    revalidatePath('/api-keys');
    revalidatePath(`/api-keys/${id}`);
    return undefined;
  });
}

/**
 * Rotates a key in one call (C169.1): a new key with the old one's scopes, IP ranges, version, note
 * and blocklist, its token answered once, and the old token working until the chosen end, which is
 * answered so the console can show it. One audit entry links both keys.
 */
export async function rotateApiKey(
  _previous: ActionState<RotatedApiKeyData>,
  formData: FormData,
): Promise<ActionResult<RotatedApiKeyData>> {
  return runAction(WRITE, async () => {
    const id = apiKeyIdOf(formData);
    const seconds = Number(formString(formData, 'previous-expires-in-seconds') ?? Number.NaN);
    if (!ROTATION_CHOICES.includes(seconds)) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        errors: [
          { pointer: '/previous-expires-in-seconds', detail: SETTINGS_COPY.keys.choiceInvalid },
        ],
      });
    }
    const name = formString(formData, 'name')?.trim() ?? '';
    const rotated = await rotate(id, {
      previousExpiresInSeconds: seconds,
      ...(name === '' ? {} : { name }),
    });
    revalidatePath('/api-keys');
    revalidatePath(`/api-keys/${id}`);
    return {
      id: rotated.key.id,
      secret: rotated.token,
      previousExpiresAt: rotated.previousExpiresAt,
    };
  });
}
