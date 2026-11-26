'use server';

/**
 * Queue and assignment policy mutations of the case console (C132, C142.1), with
 * `case-queues:write`, which a reviewer lacks. Each is saved through the API, and a refusal keeps
 * its problems by JSON Pointer (a member's row, a source's place), titled in words when it has a
 * case problem code. Replacing the members gives a leaving member's open cases of the queue back at
 * once (8B item 73); archiving is permanent and returns the queue's unassigned cases to no queue.
 */
import {
  createCaseAssignmentPolicyBodySchema,
  createCaseQueueBodySchema,
  idSchema,
  setCaseQueueMembersBodySchema,
  updateCaseAssignmentPolicyBodySchema,
  updateCaseQueueBodySchema,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, formStrings, parseInput } from '../../lib/api/action';
import { runCaseAction } from '../../lib/api/cases';

const queuePath = (id: string) => `/case-queues/${id}`;
const policyPath = (id: string) => `/case-queues/policies/${id}`;

const queueIdOf = (formData: FormData) =>
  parseInput(idSchema('cqueue'), formString(formData, 'case-queue-id'));

/** A whole number as typed, or the text itself for the schema to refuse. */
const integerOf = (text: string | undefined): number | string | undefined => {
  const value = (text ?? '').trim();
  if (value === '') {
    return undefined;
  }
  return /^\d+$/u.test(value) ? Number(value) : value;
};

/** Ids typed one per line, or separated by spaces or commas, in the order typed. */
const idsOf = (text: string | undefined) =>
  (text ?? '').split(/[\s,]+/u).filter((entry) => entry !== '');

/** `POST /case-queues`: a queue by its name, with no member yet. */
export async function createCaseQueue(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction(
    { permissions: ['case-queues:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createCaseQueueBodySchema, {
        data: { attributes: { name: formString(formData, 'name') } },
      });
      const { data } = await api.caseQueues.create(body.data.attributes);
      revalidatePath('/case-queues');
      return { id: data.id };
    },
  );
}

/** `PATCH /case-queues/:id`: the name and the policy that assigns its cases (none: by hand or pulled). */
export async function updateCaseQueue(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = queueIdOf(formData);
    const policy = formString(formData, 'case-assignment-policy-id') ?? '';
    const body = parseInput(updateCaseQueueBodySchema, {
      data: {
        attributes: {
          name: formString(formData, 'name'),
          'case-assignment-policy-id': policy === '' ? null : policy,
        },
      },
    });
    await api.caseQueues.update(id, body.data.attributes);
    revalidatePath(queuePath(id));
    revalidatePath('/case-queues');
    return undefined;
  });
}

/** `PATCH /case-queues/:id` with `status: archived`: permanent (C132.1). */
export async function archiveCaseQueue(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = queueIdOf(formData);
    await api.caseQueues.update(id, { status: 'archived' });
    revalidatePath(queuePath(id));
    revalidatePath('/case-queues');
    return undefined;
  });
}

/** `PUT /case-queues/:id/members`: the whole list, each row its user, capacity and pause. */
export async function setCaseQueueMembers(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = queueIdOf(formData);
    const capacities = formStrings(formData, 'member-max-open');
    const pauses = formStrings(formData, 'member-paused');
    const members = formStrings(formData, 'member-user-id').map((userId, index) => ({
      'user-id': userId.trim(),
      'max-open': integerOf(capacities[index]),
      paused: pauses[index] === 'true',
    }));
    const body = parseInput(setCaseQueueMembersBodySchema, { data: { attributes: { members } } });
    await api.caseQueues.setMembers(id, body.data.attributes.members);
    revalidatePath(queuePath(id));
    return undefined;
  });
}

/** C132.2: each source by its prefix, in the order typed; anything else refused at its place. */
function sourcesOf(text: string | undefined) {
  const sources = idsOf(text).map((id) => ({
    id,
    type: id.startsWith('ctmpl_')
      ? 'case-template'
      : id.startsWith('cqueue_')
        ? 'case-queue'
        : null,
  }));
  const wrong = sources.flatMap((source, index) =>
    source.type === null
      ? [
          {
            pointer: `/data/attributes/sources/${String(index)}`,
            detail: 'Name a case template (ctmpl_…) or a queue (cqueue_…).',
          },
        ]
      : [],
  );
  if (wrong.length > 0) {
    throw new ActionInputError({ title: 'Check the values you entered', errors: wrong });
  }
  return sources;
}

/** The policy's attributes as the form gives them: no agents means the queue's members. */
function policyAttributesOf(formData: FormData) {
  const agents = idsOf(formString(formData, 'agents'));
  return {
    name: formString(formData, 'name'),
    distribution: formString(formData, 'distribution'),
    sort: formString(formData, 'sort'),
    agents: agents.length === 0 ? null : agents,
    'max-capacity': integerOf(formString(formData, 'max-capacity')) ?? null,
    sources: sourcesOf(formString(formData, 'sources')),
  };
}

/** `POST /case-assignment-policies`. */
export async function createAssignmentPolicy(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runCaseAction(
    { permissions: ['case-queues:write'], environmentForm: formData },
    async ({ api }) => {
      const body = parseInput(createCaseAssignmentPolicyBodySchema, {
        data: { attributes: policyAttributesOf(formData) },
      });
      const { data } = await api.caseAssignmentPolicies.create(body.data.attributes);
      revalidatePath('/case-queues/policies');
      return { id: data.id };
    },
  );
}

/** `PATCH /case-assignment-policies/:id`: what it sends replaces; assigned cases stay so. */
export async function updateAssignmentPolicy(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runCaseAction({ permissions: ['case-queues:write'] }, async ({ api }) => {
    const id = parseInput(idSchema('cap'), formString(formData, 'case-assignment-policy-id'));
    const body = parseInput(updateCaseAssignmentPolicyBodySchema, {
      data: { attributes: policyAttributesOf(formData) },
    });
    await api.caseAssignmentPolicies.update(id, body.data.attributes);
    revalidatePath(policyPath(id));
    revalidatePath('/case-queues/policies');
    return undefined;
  });
}
