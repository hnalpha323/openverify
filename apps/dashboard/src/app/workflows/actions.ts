'use server';

/**
 * Workflow mutations of the console (C141; Workflow 8C). Each one is a server action: it validates
 * its form with the contract's schemas, calls the server API as the operator, refreshes the page
 * it changed and answers `{ ok } | { problem }`.
 */
import {
  anyIdSchema,
  contestRouteSchema,
  createWorkflowBodySchema,
  createWorkflowManualRunsBodySchema,
  createWorkflowTestRunBodySchema,
  idSchema,
  sandboxEmailSearchBodySchema,
  sandboxWorkflowSmsSearchBodySchema,
  workflowAcknowledgementKeySchema,
  type WorkflowDefinition,
} from '@openverify/contracts';
import { biometricBasisSchema, decisionBasisSchema } from '@openverify/core';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  DECISION_TEMPLATE_KEYS,
  decisionTemplateDefinition,
} from '../../components/workflows/decision-templates';
import type { DraftResult } from '../../components/workflows/draft-editor';
import { ParameterInputError, parametersOf } from '../../components/workflows/parameters';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
} from '../../lib/api/action';

/** What a started run answers: the run to link. */
export interface StartedRun {
  readonly runId: string;
}

/** `text` parsed as JSON, or the input problem at `pointer` saying where it breaks. */
function jsonOf(text: string, pointer: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'The definition is not valid JSON.',
      errors: [{ pointer, detail: 'Is not valid JSON.' }],
    });
  }
}

/** The typed parameters of a form, or the input problem naming each one by its pointer. */
function parametersOrRefuse(formData: FormData, pointer: string): Record<string, unknown> {
  try {
    return parametersOf(formData);
  } catch (error) {
    if (error instanceof ParameterInputError) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some parameters do not hold their declared type.',
        errors: error.names.map((name) => ({
          pointer: `${pointer}/${name}`,
          detail: 'Does not hold the declared type.',
        })),
      });
    }
    throw error;
  }
}

const runAccountActionInputSchema = z.strictObject({
  'account-id': idSchema('acc'),
  'account-action-id': idSchema('accac'),
});

/** C118.7: runs an account action with its parameters, as the operator, under the grant. */
export async function runAccountAction(
  _previous: ActionState<StartedRun>,
  formData: FormData,
): Promise<ActionResult<StartedRun>> {
  return runAction({ permissions: ['workflows:trigger'] }, async ({ api }) => {
    const input = parseInput(runAccountActionInputSchema, {
      'account-id': formString(formData, 'account-id'),
      'account-action-id': formString(formData, 'account-action-id'),
    });
    const parameters = parametersOrRefuse(formData, '/data/parameters');
    const { data } = await api.accountActions.run(input['account-id'], {
      'account-action-id': input['account-action-id'],
      parameters: parameters as Record<string, z.core.util.JSONType>,
    });
    return { runId: data['workflow-run-id'] };
  });
}

const recipeInputSchema = z.strictObject({
  'recipe-key': z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
});

/** C140.5: installs a recipe as a paused workflow with a draft in the session's environment. */
export async function installRecipe(
  _previous: ActionState<{ readonly workflowId: string }>,
  formData: FormData,
): Promise<ActionResult<{ readonly workflowId: string }>> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const input = parseInput(recipeInputSchema, {
      'recipe-key': formString(formData, 'recipe-key'),
    });
    const { data } = await api.workflows.installRecipe(input['recipe-key']);
    revalidatePath('/workflows');
    return { workflowId: data.id };
  });
}

const statusInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  action: z.enum(['pause', 'activate', 'archive']),
});

/** C112.6: pause, activate or archive, with `workflows:write`. */
export async function setWorkflowStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const input = parseInput(statusInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      action: formString(formData, 'action'),
    });
    const id = input['workflow-id'];
    switch (input.action) {
      case 'pause':
        await api.workflows.pause(id);
        break;
      case 'activate':
        await api.workflows.activate(id);
        break;
      case 'archive':
        await api.workflows.archive(id);
        break;
    }
    revalidatePath(`/workflows/${id}`);
    return undefined;
  });
}

/** What a run action answers: the run to show, a new one for a rerun. */
export interface RunControlResult {
  readonly runId: string;
}

const runControlInputSchema = z.strictObject({
  'run-id': idSchema('wfr'),
  control: z.enum(['resume', 'rerun', 'cancel']),
  /** Sent only when the operator ticked the acknowledgement (C120.3). */
  'skip-unknown-effects': z.literal('acknowledged').optional(),
});

/**
 * C120.3, C120.4, C120.5: resume an errored run (an unknown effect is skipped only when the
 * operator acknowledged it; otherwise the API refuses with `run_not_resumable`), rerun a run on the
 * latest published version (answering the new run), or cancel a run in progress.
 */
export async function controlRun(
  _previous: ActionState<RunControlResult>,
  formData: FormData,
): Promise<ActionResult<RunControlResult>> {
  return runAction({ permissions: ['workflow-runs:write'] }, async ({ api }) => {
    const skip = formString(formData, 'skip-unknown-effects');
    const input = parseInput(runControlInputSchema, {
      'run-id': formString(formData, 'run-id'),
      control: formString(formData, 'control'),
      ...(skip === undefined ? {} : { 'skip-unknown-effects': skip }),
    });
    const id = input['run-id'];
    let runId: string = id;
    switch (input.control) {
      case 'resume':
        await api.workflowRuns.resume(
          id,
          input['skip-unknown-effects'] === undefined
            ? undefined
            : { 'skip-unknown-effects': true },
        );
        break;
      case 'rerun':
        runId = (await api.workflowRuns.rerun(id)).data.id;
        break;
      case 'cancel':
        await api.workflowRuns.cancel(id);
        break;
    }
    revalidatePath(`/workflows/runs/${id}`);
    return { runId };
  });
}

/** C120.9: nulls one run's sealed values for good, under `workflow-runs:redact`. */
export async function redactRun(_previous: ActionState, formData: FormData): Promise<ActionResult> {
  return runAction({ permissions: ['workflow-runs:redact'] }, async ({ api }) => {
    const id = parseInput(idSchema('wfr'), formString(formData, 'run-id'));
    await api.workflowRuns.redact(id);
    revalidatePath(`/workflows/runs/${id}`);
    return undefined;
  });
}

/**
 * C128.5: the decision template the create form names, with what the operator filled in, or
 * `null` for an empty draft. Each value is checked before anything is created, and named by its own
 * pointer; nothing is filled in on the operator's behalf.
 */
function decisionTemplateOf(formData: FormData): WorkflowDefinition | null {
  const key = formString(formData, 'template') ?? '';
  if (key === '') {
    return null;
  }
  const errors: { pointer: string; detail: string }[] = [];
  const text = (name: string) => {
    const value = formString(formData, name) ?? '';
    return value === '' ? undefined : value;
  };
  const check = <Value>(
    schema: z.ZodType<Value>,
    value: unknown,
    pointer: string,
  ): Value | undefined => {
    if (value === undefined) {
      return undefined;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    for (const issue of parsed.error.issues) {
      errors.push({
        pointer: [pointer, ...issue.path.map(String)].join('/'),
        detail: issue.message,
      });
    }
    return undefined;
  };
  const template = check(z.enum(DECISION_TEMPLATE_KEYS), key, '/template');
  const caseTemplateId = check(idSchema('ctmpl'), text('case-template-id'), '/case-template-id');
  const decisionBasis = check(decisionBasisSchema, text('decision-basis'), '/decision-basis');
  const url = text('contest-url');
  const contact = text('contest-contact');
  const contestRoute =
    url === undefined && contact === undefined
      ? undefined
      : check(
          contestRouteSchema,
          { ...(url === undefined ? {} : { url }), ...(contact === undefined ? {} : { contact }) },
          '/contest-route',
        );
  const biometricBasis = check(biometricBasisSchema, text('biometric-basis'), '/biometric-basis');
  if (errors.length > 0 || template === undefined) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'Some of the template’s values are not valid.',
      errors,
    });
  }
  return decisionTemplateDefinition(template, {
    ...(caseTemplateId === undefined ? {} : { caseTemplateId }),
    ...(decisionBasis === undefined ? {} : { decisionBasis }),
    ...(contestRoute === undefined ? {} : { contestRoute }),
    ...(biometricBasis === undefined ? {} : { biometricBasis }),
  });
}

/**
 * C112.6: a workflow with its empty draft, in the session's environment. With a decision template
 * (C128.5), the template is then saved as that draft at its lock version; nothing is published.
 */
export async function createWorkflow(
  _previous: ActionState<{ readonly workflowId: string }>,
  formData: FormData,
): Promise<ActionResult<{ readonly workflowId: string }>> {
  return runAction(
    { permissions: ['workflows:write'], environmentForm: formData },
    async ({ api }) => {
      const description = formString(formData, 'description') ?? '';
      const body = parseInput(createWorkflowBodySchema, {
        data: {
          type: 'workflow',
          attributes: {
            name: formString(formData, 'name') ?? '',
            ...(description === '' ? {} : { description }),
          },
        },
      });
      const definition = decisionTemplateOf(formData);
      const { data } = await api.workflows.create(body.data.attributes);
      if (definition !== null) {
        const { data: draft } = await api.workflows.draft(data.id);
        await api.workflows.saveDraft(data.id, {
          definition,
          'lock-version': draft.attributes['lock-version'],
        });
      }
      revalidatePath('/workflows');
      return { workflowId: data.id };
    },
  );
}

const draftInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'lock-version': z.coerce.number().int().min(0),
  intent: z.enum(['check', 'save']),
});

const issueOf = (issue: { pointer: string; code: string; detail?: string | undefined }) => ({
  pointer: issue.pointer,
  code: issue.code,
  detail: issue.detail ?? issue.code,
});

/**
 * C113.6, C116.1: checks the definition (saving nothing), or checks it and, when it has no error,
 * saves it at the lock version the page was rendered with; a stale lock version answers the API's
 * 409. Problems come back by their pointer inside the definition, for the outline's badges and the
 * errors panel.
 */
export async function saveWorkflowDraft(
  _previous: ActionState<DraftResult>,
  formData: FormData,
): Promise<ActionResult<DraftResult>> {
  return runAction({ permissions: ['workflows:write'] }, async ({ api }) => {
    const input = parseInput(draftInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      'lock-version': formString(formData, 'lock-version'),
      intent: formString(formData, 'intent'),
    });
    const definition = jsonOf(formString(formData, 'definition') ?? '', '/definition');
    const id = input['workflow-id'];
    const { meta } = await api.workflows.validateDraft(id, definition);
    const errors = meta.errors.map(issueOf);
    const warnings = meta.warnings.map(issueOf);
    if (input.intent === 'check' || errors.length > 0) {
      return { saved: false, lockVersion: null, errors, warnings };
    }
    const { data } = await api.workflows.saveDraft(id, {
      definition: definition as never,
      'lock-version': input['lock-version'],
    });
    revalidatePath(`/workflows/${id}`);
    revalidatePath(`/workflows/${id}/draft`);
    return {
      saved: true,
      lockVersion: data.attributes['lock-version'],
      errors: [],
      warnings: data.attributes.warnings.map(issueOf),
    };
  });
}

const publishInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'rollout-percentage': z.coerce.number().int().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  acknowledgements: z.array(workflowAcknowledgementKeySchema).max(400),
});

/**
 * C116.4: publishes the draft (user-only, `workflows:publish`) with its rollout percentage and change
 * note, and the acknowledgements the operator ticked. A publish that still needs one answers the
 * API's `publish_acknowledgement_missing`, whose errors name each key at `/meta/acknowledgements`,
 * for the form to ask about; nothing is acknowledged on the operator's behalf.
 */
export async function publishWorkflow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['workflows:publish'] }, async ({ api }) => {
    const percentage = formString(formData, 'rollout-percentage') ?? '';
    const description = formString(formData, 'description') ?? '';
    const input = parseInput(publishInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      ...(percentage === '' ? {} : { 'rollout-percentage': percentage }),
      ...(description === '' ? {} : { description }),
      acknowledgements: formStrings(formData, 'acknowledgement'),
    });
    const id = input['workflow-id'];
    await api.workflows.publish(id, {
      ...(input['rollout-percentage'] === undefined
        ? {}
        : { 'rollout-percentage': input['rollout-percentage'] }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.acknowledgements.length === 0 ? {} : { acknowledgements: input.acknowledgements }),
    });
    revalidatePath(`/workflows/${id}`);
    revalidatePath(`/workflows/${id}/draft`);
    return undefined;
  });
}

const rolloutInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'rollout-percentage': z.enum(['0', '100']),
});

/** C116.3: finishes (100) or undoes (0) the rollout in progress, under `workflows:publish`. */
export async function changeRollout(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['workflows:publish'] }, async ({ api }) => {
    const input = parseInput(rolloutInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      'rollout-percentage': formString(formData, 'rollout-percentage'),
    });
    const id = input['workflow-id'];
    await api.workflows.rollout(id, {
      'rollout-percentage': Number(input['rollout-percentage']),
    });
    revalidatePath(`/workflows/${id}`);
    return undefined;
  });
}

/** What a promote answers: the environment its draft was made in. */
export interface PromotedDraft {
  readonly environmentId: string;
}

const promoteInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'environment-id': idSchema('env'),
});

/**
 * C112.2: copies the live version into another environment of the organisation as a draft
 * (user-only, `workflows:publish`). The API never replaces a draft there (`draft_exists`) and
 * never publishes: someone holding the rights in that environment publishes the draft.
 */
export async function promoteWorkflow(
  _previous: ActionState<PromotedDraft>,
  formData: FormData,
): Promise<ActionResult<PromotedDraft>> {
  return runAction({ permissions: ['workflows:publish'] }, async ({ api }) => {
    const input = parseInput(promoteInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      'environment-id': formString(formData, 'environment-id'),
    });
    const id = input['workflow-id'];
    await api.workflows.promote(id, { 'environment-id': input['environment-id'] });
    revalidatePath(`/workflows/${id}`);
    return { environmentId: input['environment-id'] };
  });
}

/** What a cancel of older runs answers: how many runs it canceled. */
export interface CanceledRuns {
  readonly canceledCount: number;
}

const cancelRunsInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'before-version-id': idSchema('wfv'),
});

/**
 * C116.2: cancels the unfinished runs of every version older than the one named, under
 * `workflow-runs:write`. Effects those runs already made stay made (C120.5).
 */
export async function cancelOlderRuns(
  _previous: ActionState<CanceledRuns>,
  formData: FormData,
): Promise<ActionResult<CanceledRuns>> {
  return runAction({ permissions: ['workflow-runs:write'] }, async ({ api }) => {
    const input = parseInput(cancelRunsInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      'before-version-id': formString(formData, 'before-version-id'),
    });
    const id = input['workflow-id'];
    const { meta } = await api.workflows.cancelRuns(id, {
      'before-version-id': input['before-version-id'],
    });
    revalidatePath(`/workflows/${id}`);
    return { canceledCount: meta['canceled-count'] };
  });
}

const restoreInputSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'version-id': idSchema('wfv'),
});

/**
 * C116.5: a draft made from a published version (user-only, `workflows:publish`). It is published
 * like any draft, so a restore never bypasses a publish rule.
 */
export async function restoreVersion(
  _previous: ActionState<{ readonly workflowId: string }>,
  formData: FormData,
): Promise<ActionResult<{ readonly workflowId: string }>> {
  return runAction({ permissions: ['workflows:publish'] }, async ({ api }) => {
    const input = parseInput(restoreInputSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
      'version-id': formString(formData, 'version-id'),
    });
    const id = input['workflow-id'];
    await api.workflows.restore(id, { 'version-id': input['version-id'] });
    revalidatePath(`/workflows/${id}`);
    revalidatePath(`/workflows/${id}/draft`);
    return { workflowId: id };
  });
}

/** `text` parsed as JSON, or `undefined` when empty; a parse failure is named at `pointer`. */
function optionalJsonOf(
  text: string | undefined,
  pointer: string,
  failures: { pointer: string; detail: string }[],
): unknown {
  if (text === undefined || text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failures.push({ pointer, detail: 'Is not valid JSON.' });
    return undefined;
  }
}

/** The non-empty lines of a text area, trimmed. */
const linesOf = (text: string | undefined): string[] =>
  (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** C120.7: the words of the API's refusal outside a sandbox environment. */
const SANDBOX_ONLY_PROBLEM = {
  title: 'Test runs run only in a sandbox environment',
  detail:
    'A test run records every message and makes no real request, which only a sandbox ' +
    'environment allows. Switch to a sandbox environment to test this workflow.',
} as const;

/**
 * C120.7: a test run in a sandbox environment, on the draft or a named version, from an existing
 * object or a synthetic payload, with an optional step range, output overrides, the hosts a real
 * request may reach, and the acknowledgements the operator ticked (an irreversible step runs only
 * with its `irreversible:<step>`, a real request only with its `egress:<step>`). Every message goes
 * to the recording provider whatever its recipient; nothing is acknowledged for the operator.
 */
export async function startTestRun(
  _previous: ActionState<StartedRun>,
  formData: FormData,
): Promise<ActionResult<StartedRun>> {
  return runAction({ permissions: ['workflows:trigger'] }, async ({ api }) => {
    const workflowId = parseInput(idSchema('wfl'), formString(formData, 'workflow-id'));
    const failures: { pointer: string; detail: string }[] = [];
    const fromPayload = formString(formData, 'trigger-source') === 'payload';
    const payload = fromPayload
      ? optionalJsonOf(
          formString(formData, 'trigger-payload'),
          '/data/attributes/trigger-payload',
          failures,
        )
      : undefined;
    const overrides = optionalJsonOf(
      formString(formData, 'overrides'),
      '/data/attributes/overrides',
      failures,
    );
    if (failures.length > 0) {
      throw new ActionInputError({
        title: 'Check the values you entered',
        detail: 'Some values are not valid JSON.',
        errors: failures,
      });
    }
    const text = (name: string) => {
      const value = formString(formData, name) ?? '';
      return value === '' ? undefined : value;
    };
    const versionId = text('version-id');
    const startStep = text('start-step');
    const endStep = text('end-step');
    const objectId = fromPayload ? undefined : text('object-id');
    const hosts = linesOf(formString(formData, 'allow-hosts'));
    const acknowledgements = formStrings(formData, 'acknowledgement');
    const body = parseInput(createWorkflowTestRunBodySchema, {
      data: {
        type: 'workflow-run',
        attributes: {
          ...(versionId === undefined ? {} : { 'workflow-version-id': versionId }),
          ...(objectId === undefined ? {} : { 'object-id': objectId }),
          ...(payload === undefined ? {} : { 'trigger-payload': payload }),
          ...(startStep === undefined ? {} : { 'start-step': startStep }),
          ...(endStep === undefined ? {} : { 'end-step': endStep }),
          ...(overrides === undefined ? {} : { overrides }),
          ...(hosts.length === 0 ? {} : { 'allow-hosts': hosts }),
          ...(formString(formData, 'allow-triggers') === 'true' ? { 'allow-triggers': true } : {}),
        },
      },
      ...(acknowledgements.length === 0 ? {} : { meta: { acknowledgements } }),
    });
    try {
      const { data } = await api.workflowTestRuns.create(
        workflowId,
        body.data.attributes,
        body.meta,
      );
      return { runId: data.id };
    } catch (error) {
      if (error instanceof OpenVerifyApiError && error.problem.code === 'test_runs_sandbox_only') {
        throw new ActionInputError(SANDBOX_ONLY_PROBLEM);
      }
      throw error;
    }
  });
}

/** A message a sandbox provider recorded, as the console shows it (C126.4). */
export interface RecordedMessage {
  readonly messageRef: string;
  readonly stepId: string;
  readonly recordedAt: string;
  /** `null` when withheld: the console shows bodies only with `pii:view`. */
  readonly subject: string | null;
  readonly text: string | null;
}

const recordedSearchInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    'run-id': idSchema('wfr'),
    kind: z.literal('email'),
    recipient: sandboxEmailSearchBodySchema.shape['email-address'],
  }),
  z.strictObject({
    'run-id': idSchema('wfr'),
    kind: z.literal('workflow-sms'),
    recipient: sandboxWorkflowSmsSearchBodySchema.shape['phone-number'],
  }),
  z.strictObject({
    'run-id': idSchema('wfr'),
    kind: z.literal('slack'),
    recipient: idSchema('wsec'),
  }),
]);

interface SearchedRecord {
  readonly 'message-ref': string;
  readonly 'workflow-run-id': string;
  readonly 'step-id': string;
  readonly 'recorded-at': string;
  readonly 'message-subject'?: string;
  readonly 'message-text': string;
}

/**
 * C126.4: the messages a test run recorded, found by the sandbox searches (`sandbox:read`), whose
 * recipient travels in the request body, never in a URL. Only this run's records are answered, and
 * their subject and text only to a reader with `pii:view`: the searches serve bodies whole, so the
 * console withholds them from anyone the API would mask a person's values from.
 */
export async function searchRecordedMessages(
  _previous: ActionState<{ readonly records: readonly RecordedMessage[] }>,
  formData: FormData,
): Promise<ActionResult<{ readonly records: readonly RecordedMessage[] }>> {
  return runAction({ permissions: ['sandbox:read'] }, async ({ session, api }) => {
    const input = parseInput(recordedSearchInputSchema, {
      'run-id': formString(formData, 'run-id'),
      kind: formString(formData, 'kind'),
      recipient: formString(formData, 'recipient'),
    });
    let records: readonly SearchedRecord[];
    switch (input.kind) {
      case 'email':
        records = (await api.sandboxEmailMessages.search(input.recipient)).data;
        break;
      case 'workflow-sms':
        records = (await api.sandboxWorkflowSmsMessages.search(input.recipient)).data;
        break;
      case 'slack':
        records = (await api.sandboxSlackMessages.search(input.recipient)).data;
        break;
    }
    const bodies = session.permissions.has('pii:view');
    return {
      records: records
        .filter((record) => record['workflow-run-id'] === input['run-id'])
        .map((record) => ({
          messageRef: record['message-ref'],
          stepId: record['step-id'],
          recordedAt: record['recorded-at'],
          subject: bodies ? (record['message-subject'] ?? null) : null,
          text: bodies ? record['message-text'] : null,
        })),
    };
  });
}

/** What a manual run answers: the runs started, and each id or row that started none, by code. */
export interface ManualRunsResult {
  readonly runIds: readonly string[];
  readonly refused: readonly {
    readonly objectId: string | null;
    readonly row: number | null;
    readonly code: string;
  }[];
}

const manualRunsWorkflowSchema = z.strictObject({ 'workflow-id': idSchema('wfl') });

/**
 * C118.5: one run per object, as the operator, from ids typed (split on lines, spaces or commas) or
 * a CSV file of one `object-id` column. A token that is not an id is refused by its position and
 * never echoed (C143.5); the API answers the runs it started and each id or row it refused, by code.
 */
export async function startManualRuns(
  _previous: ActionState<ManualRunsResult>,
  formData: FormData,
): Promise<ActionResult<ManualRunsResult>> {
  return runAction({ permissions: ['workflows:trigger'] }, async ({ api }) => {
    const { 'workflow-id': id } = parseInput(manualRunsWorkflowSchema, {
      'workflow-id': formString(formData, 'workflow-id'),
    });
    let attributes: { 'object-ids': string[] } | { csv: string };
    if (formString(formData, 'source') === 'csv') {
      const file = formData.get('csv');
      const csv = file instanceof File ? await file.text() : '';
      if (csv.trim() === '') {
        throw new ActionInputError({
          title: 'Check the values you entered',
          detail: 'Choose a CSV file of object ids.',
          errors: [{ pointer: '/data/attributes/csv', detail: 'Choose a CSV file.' }],
        });
      }
      attributes = { csv };
    } else {
      const tokens = (formString(formData, 'object-ids') ?? '')
        .split(/[\s,]+/)
        .filter((token) => token !== '');
      if (tokens.length === 0) {
        throw new ActionInputError({
          title: 'Check the values you entered',
          detail: 'Enter at least one object id.',
          errors: [{ pointer: '/data/attributes/object-ids', detail: 'Enter at least one id.' }],
        });
      }
      const errors = tokens.flatMap((token, index) =>
        anyIdSchema.safeParse(token).success
          ? []
          : [
              {
                pointer: `/data/attributes/object-ids/${String(index)}`,
                detail: 'Is not an object id.',
              },
            ],
      );
      if (errors.length > 0) {
        throw new ActionInputError({
          title: 'Check the values you entered',
          detail: 'Some entries are not object ids.',
          errors,
        });
      }
      attributes = { 'object-ids': tokens };
    }
    const body = parseInput(createWorkflowManualRunsBodySchema, {
      data: { type: 'workflow-run', attributes },
    });
    const { meta } = await api.workflows.manualRuns(id, body.data.attributes);
    revalidatePath(`/workflows/${id}`);
    return {
      runIds: meta['workflow-run-ids'],
      refused: meta.refused.map((refusal) => ({
        objectId: refusal['object-id'],
        row: refusal.row,
        code: refusal.code,
      })),
    };
  });
}
