'use server';

/**
 * Workflow secret mutations of the console (C125, C141.7; Workflow 8C review). Each one is a server
 * action under `secrets:write`: it validates its form with the contract's schemas, calls the server
 * API as the operator and refreshes the secrets page. A value goes to the API once, in the
 * session's own environment, and never comes back: no answer here carries it, and a refused value
 * is named by its pointer only (P21).
 */
import {
  createWorkflowSecretBodySchema,
  putWorkflowSecretValueBodySchema,
  updateWorkflowSecretBodySchema,
  workflowSecretKeySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';

const SECRETS_PATH = '/secrets';
const VALUE_POINTER = '/data/attributes/secret-value';

/** Hosts typed one per line (or separated by commas), without blanks. */
function hostsOf(text: string | undefined): string[] {
  return (text ?? '')
    .split(/[\n,]/)
    .map((host) => host.trim())
    .filter((host) => host !== '');
}

/** C125.1: a key with its description and allowed hosts; values are set per environment. */
export async function createSecret(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction(
    { permissions: ['secrets:write'], environmentForm: formData },
    async ({ api }) => {
      const description = formString(formData, 'description') ?? '';
      const body = parseInput(createWorkflowSecretBodySchema, {
        data: {
          type: 'workflow-secret',
          attributes: {
            key: formString(formData, 'key') ?? '',
            ...(description === '' ? {} : { description }),
            'allowed-hosts': hostsOf(formString(formData, 'allowed-hosts')),
          },
        },
      });
      await api.workflowSecrets.create(body.data.attributes);
      revalidatePath(SECRETS_PATH);
      return undefined;
    },
  );
}

const valueInputSchema = z.strictObject({
  key: workflowSecretKeySchema,
  mode: z.enum(['set', 'rotate']),
});

/**
 * C125.2: sets the value in the session's environment, or rotates it (the previous value of a
 * signing secret keeps verifying for 24 hours). The value is never trimmed: it is sent as typed.
 */
export async function setSecretValue(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['secrets:write'] }, async ({ session, api }) => {
    const input = parseInput(valueInputSchema, {
      key: formString(formData, 'key'),
      mode: formString(formData, 'mode'),
    });
    const typed = formString(formData, 'secret-value', { trim: false }) ?? '';
    if (typed === '') {
      throw new ActionInputError({
        title: 'Check the values you entered',
        errors: [{ pointer: VALUE_POINTER, detail: 'Enter a value.' }],
      });
    }
    const body = parseInput(putWorkflowSecretValueBodySchema, {
      data: { attributes: { 'secret-value': typed } },
    });
    const value = body.data.attributes['secret-value'];
    const environmentId = session.environment.id;
    if (input.mode === 'rotate') {
      await api.workflowSecrets.rotateValue(input.key, environmentId, value);
    } else {
      await api.workflowSecrets.putValue(input.key, environmentId, value);
    }
    revalidatePath(SECRETS_PATH);
    return undefined;
  });
}

/** C125.1: refused with `secret_in_use` while a published version names the key. */
export async function deleteSecret(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['secrets:write'] }, async ({ api }) => {
    const key = parseInput(workflowSecretKeySchema, formString(formData, 'key'));
    await api.workflowSecrets.delete(key);
    revalidatePath(SECRETS_PATH);
    return undefined;
  });
}

/** Lines typed one per line (or separated by commas), without blanks. */
const listOf = hostsOf;

/**
 * C125.2: a key's description, allowed hosts and placements (`PATCH /workflow-secrets/:key`),
 * under `secrets:write`. The key never changes and no value is sent or read. Changing hosts or
 * placements needs a production user session when any production value exists; the API's refusal
 * comes back by its pointer.
 */
export async function updateSecret(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['secrets:write'] }, async ({ api }) => {
    const key = parseInput(workflowSecretKeySchema, formString(formData, 'key'));
    const description = formString(formData, 'description') ?? '';
    const body = parseInput(updateWorkflowSecretBodySchema, {
      data: {
        type: 'workflow-secret',
        attributes: {
          description: description === '' ? null : description,
          'allowed-hosts': hostsOf(formString(formData, 'allowed-hosts')),
          'allowed-placements': {
            headers: listOf(formString(formData, 'header-placements')),
            'body-pointers': listOf(formString(formData, 'body-pointers')),
          },
        },
      },
    });
    await api.workflowSecrets.update(key, body.data.attributes);
    revalidatePath(SECRETS_PATH);
    return undefined;
  });
}
