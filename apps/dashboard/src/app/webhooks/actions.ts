'use server';

/**
 * Webhook mutations (C14), as server actions built with `runAction`: each needs
 * `webhooks:write`, validates its form with the contract's request schema, and answers
 * `{ ok, data }` or `{ ok: false, problem }`. Secrets (create, clone, rotate) are answered
 * once, for the one-time secret dialog; nothing here logs or stores them.
 */
import {
  createWebhookBodySchema,
  idSchema,
  replayWebhookBodySchema,
  rotateWebhookSecretBodySchema,
  simulateWebhookBodySchema,
  updateWebhookBodySchema,
} from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type {
  CreatedWebhook,
  ReplayedEvents,
  RotatedSecret,
  SimulatedEvent,
} from '../../components/integrations/action-data';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import { replayMetaFromForm, webhookAttributesFromForm } from '../../lib/api/webhooks';

const WRITE = { permissions: ['webhooks:write'] } as const;

const webhookIdSchema = z.strictObject({ 'webhook-id': idSchema('wbh') });

/** The webhook the form is about. @throws {ActionInputError} for a malformed id. */
function webhookIdOf(formData: FormData): string {
  return parseInput(webhookIdSchema, { 'webhook-id': formString(formData, 'webhook-id') })[
    'webhook-id'
  ];
}

const EVENTS_POINTER = '/data/attributes/enabled-events';

/**
 * `schema` applied to the form's webhook body. The contract's events union only says "Invalid
 * input" when no event is chosen, so that one message is put in words.
 */
function parseWebhookBody<Schema extends z.ZodType>(
  schema: Schema,
  attributes: Record<string, unknown>,
): z.output<Schema> {
  try {
    return parseInput(schema, { data: { type: 'webhook', attributes } });
  } catch (error) {
    if (!(error instanceof ActionInputError)) {
      throw error;
    }
    const noEvents =
      Array.isArray(attributes['enabled-events']) && attributes['enabled-events'].length === 0;
    throw new ActionInputError({
      ...error.problem,
      errors: (error.problem.errors ?? []).map((item) =>
        noEvents && item.pointer === EVENTS_POINTER
          ? { pointer: EVENTS_POINTER, detail: 'Choose at least one event, or all events.' }
          : item,
      ),
    });
  }
}

function revalidateWebhook(id: string): void {
  revalidatePath('/webhooks');
  revalidatePath(`/webhooks/${id}`);
}

/** Creates a webhook; answers its id and its signing secret, once. */
export async function createWebhook(
  _previous: ActionState<CreatedWebhook>,
  formData: FormData,
): Promise<ActionResult<CreatedWebhook>> {
  return runAction({ ...WRITE, environmentForm: formData }, async ({ api }) => {
    // C169.5: optional in the API for existing clients, required by the console for new webhooks;
    // its refusal joins the other fields' errors.
    const nameErrors =
      (formString(formData, 'name') ?? '').trim() === ''
        ? [{ pointer: '/data/attributes/name', detail: SETTINGS_COPY.webhooks.nameRequired }]
        : [];
    let body;
    try {
      body = parseWebhookBody(
        createWebhookBodySchema,
        webhookAttributesFromForm(formData, { customHeaders: true }),
      );
    } catch (error) {
      if (error instanceof ActionInputError && nameErrors.length > 0) {
        throw new ActionInputError({
          ...error.problem,
          errors: [...nameErrors, ...(error.problem.errors ?? [])],
        });
      }
      throw error;
    }
    if (nameErrors.length > 0) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: nameErrors,
      });
    }
    const { data } = await api.webhooks.create(body.data.attributes);
    revalidatePath('/webhooks');
    return { id: data.id, secret: data.attributes.secret };
  });
}

/**
 * Saves a webhook's configuration, then opens its page. The custom headers are replaced only
 * when the form says so (`replace-custom-headers`): their stored values are never shown.
 */
export async function updateWebhook(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    const replaceHeaders = formString(formData, 'replace-custom-headers') === 'true';
    const body = parseWebhookBody(
      updateWebhookBodySchema,
      webhookAttributesFromForm(formData, { customHeaders: replaceHeaders }),
    );
    await api.webhooks.update(id, body.data.attributes);
    revalidateWebhook(id);
    return id;
  });
  if (result.ok) {
    redirect(`/webhooks/${result.data}`);
  }
  return result;
}

type StatusChange = keyof Pick<OpenVerifyClient['webhooks'], 'enable' | 'disable' | 'archive'>;

function changeStatus(formData: FormData, change: StatusChange): Promise<ActionResult> {
  return runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    await api.webhooks[change](id);
    revalidateWebhook(id);
    return undefined;
  });
}

export async function enableWebhook(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return changeStatus(formData, 'enable');
}

export async function disableWebhook(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return changeStatus(formData, 'disable');
}

/** Final: an archived webhook never receives events again and cannot change. */
export async function archiveWebhook(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return changeStatus(formData, 'archive');
}

/** A disabled copy with a new secret; answers its id and secret, once. */
export async function cloneWebhook(
  _previous: ActionState<CreatedWebhook>,
  formData: FormData,
): Promise<ActionResult<CreatedWebhook>> {
  return runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    const { data } = await api.webhooks.clone(id);
    revalidatePath('/webhooks');
    return { id: data.id, secret: data.attributes.secret };
  });
}

/**
 * A new signing secret, answered once. The previous one keeps signing for the overlap the form
 * gives (`previous-secret-expires-in-seconds`), or the API's default of 24 hours.
 */
export async function rotateWebhookSecret(
  _previous: ActionState<RotatedSecret>,
  formData: FormData,
): Promise<ActionResult<RotatedSecret>> {
  return runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    const overlap = formString(formData, 'previous-secret-expires-in-seconds');
    const body = parseInput(
      rotateWebhookSecretBodySchema,
      overlap === undefined || overlap === ''
        ? {}
        : { meta: { 'previous-secret-expires-in-seconds': Number(overlap) } },
    );
    const { data, meta } = await api.webhooks.rotateSecret(id, body?.meta);
    revalidateWebhook(id);
    return {
      secret: data.attributes.secret,
      previousSecretExpiresAt: meta['previous-secret-expires-at'],
    };
  });
}

/** Sends the webhook a sample event of the chosen name; answers the event's id. */
export async function simulateWebhookEvent(
  _previous: ActionState<SimulatedEvent>,
  formData: FormData,
): Promise<ActionResult<SimulatedEvent>> {
  return runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    const body = parseInput(simulateWebhookBodySchema, {
      meta: { 'event-name': formString(formData, 'event-name') },
    });
    const { meta } = await api.webhooks.simulate(id, body.meta);
    revalidateWebhook(id);
    return { eventId: meta['event-id'] };
  });
}

/** Delivers past events to the webhook again; answers how many. */
export async function replayWebhookEvents(
  _previous: ActionState<ReplayedEvents>,
  formData: FormData,
): Promise<ActionResult<ReplayedEvents>> {
  return runAction(WRITE, async ({ api }) => {
    const id = webhookIdOf(formData);
    const body = parseInput(replayWebhookBodySchema, { meta: replayMetaFromForm(formData) });
    const { meta } = await api.webhooks.replay(id, body.meta);
    revalidateWebhook(id);
    return { replayedCount: meta['replayed-count'] };
  });
}
