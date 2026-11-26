'use server';

/**
 * Graph mutations (C102, C103, C108): server actions that validate their form with the contract's
 * request schemas, call the server API as the operator and answer `{ ok } | { problem }`, every
 * graph problem titled in words (`describeGraphProblem`).
 *
 * - The unmask needs `graph:read` and `pii:view`, and asks for one value on an explicit press.
 * - A bulk action needs `graph:read` and the action's own scopes; without them the API is not
 *   called (C103.2: acting only within the caller's rights). A non-preview action goes through
 *   the node client, which sends an `Idempotency-Key`. Only the export's preview comes here,
 *   through `apiRequest`, because the node client refuses `export`; the file itself goes through
 *   `app/graph/[id]/export/route.ts`.
 * - Running, re-running, cancelling and expanding need `graph:write`; a person-identifying
 *   parameter also needs `pii:view`, which the API checks (P11).
 * - A template comes with a first draft holding its configuration, which the console opens by the
 *   template's `latest-version` relationship (K7B-3).
 */
import {
  GRAPH_BULK_ACTIONS,
  createGraphQueryBodySchema,
  createGraphQueryTemplateBodySchema,
  createGraphQueryTemplateVersionBodySchema,
  graphNodeIdSchema,
  graphQueryActionResultDocumentSchema,
  graphQueryActionBodySchema,
  graphTemplateConfigProblems,
  idSchema,
  updateGraphQueryTemplateBodySchema,
  updateGraphQueryTemplateVersionBodySchema,
  type GraphProblemCode,
  type GraphQueryResource,
} from '@openverify/contracts';
import type { GraphBulkAction, GraphBulkOutcome, Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  GRAPH_PROBLEM_WORDS,
  describeGraphProblem,
  graphTemplateProblemWords,
} from '../../components/graph/graph-words';
import { jsonOf } from '../../components/lifecycle/action-input';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import {
  ActionInputError,
  formString,
  formStrings,
  parseInput,
  runAction,
  type ActionContext,
  type ActionGuard,
} from '../../lib/api/action';
import { apiRequest } from '../../lib/api/client';

export interface BulkActionAnswer {
  readonly action: GraphBulkAction;
  readonly preview: boolean;
  readonly selectedCount: number;
  readonly outcomes: readonly { readonly accountId: string; readonly outcome: GraphBulkOutcome }[];
  /** C140.6: the case `create-case` made, `null` when it held no account; other actions leave it out. */
  readonly caseId?: string | null;
}

export interface DraftSaved {
  readonly publishProblems: readonly { readonly pointer: string; readonly words: string }[];
}

/** C103.2: each action's own scopes, beside `graph:read`. */
const ACTION_PERMISSIONS: Readonly<Record<GraphBulkAction, readonly Permission[]>> = Object.freeze({
  'add-tag': ['accounts:write'],
  'remove-tag': ['accounts:write'],
  'set-account-status': ['accounts:write'],
  'add-to-list': ['lists:write', 'pii:view'],
  export: ['accounts:read', 'pii:view'],
  // C140.6 (Workflow 8B): offered by 8C's button, which owns the form for that change.
  'create-case': ['cases:write'],
});

const CODES: ReadonlySet<string> = new Set(Object.keys(GRAPH_PROBLEM_WORDS));
const CONFIG_POINTER = '/data/attributes/config';

const queryPath = (id: string) => `/graph/${id}`;
const templatePath = (id: string) => `/graph/templates/${id}`;
const versionPath = (templateId: string, versionId: string) =>
  `${templatePath(templateId)}/versions/${versionId}`;

/** A problem titled in words, each field error whose detail is a graph code said in words too. */
function graphProblemOf(problem: DisplayProblem): DisplayProblem {
  const described = describeGraphProblem(problem);
  return described.errors === undefined
    ? described
    : {
        ...described,
        errors: described.errors.map((error) =>
          CODES.has(error.detail)
            ? { ...error, detail: GRAPH_PROBLEM_WORDS[error.detail as GraphProblemCode] }
            : error,
        ),
      };
}

async function runGraphAction<Data>(
  guard: ActionGuard,
  run: (context: ActionContext) => Promise<Data>,
): Promise<ActionResult<Data>> {
  const result = await runAction(guard, run);
  return result.ok ? result : { ok: false, problem: graphProblemOf(result.problem) };
}

const idOf = (formData: FormData, name: string, prefix: Parameters<typeof idSchema>[0]) =>
  parseInput(idSchema(prefix), formString(formData, name));

/** `GET /graph-queries/:id/nodes/:nodeId/value`: one audited value (C102.6). */
export async function unmaskGraphNode(
  _state: ActionState<{ value: string | null }>,
  formData: FormData,
): Promise<ActionResult<{ value: string | null }>> {
  return runGraphAction({ permissions: ['graph:read', 'pii:view'] }, async ({ api }) => {
    const queryId = idOf(formData, 'graph-query-id', 'grphq');
    const nodeId = parseInput(graphNodeIdSchema, formString(formData, 'node-id'));
    const { data } = await api.graphQueries.nodeValue(queryId, nodeId);
    return { value: data.attributes.value };
  });
}

function actionOf(formData: FormData): GraphBulkAction {
  const action = formString(formData, 'action');
  if (!(GRAPH_BULK_ACTIONS as readonly (string | undefined)[]).includes(action)) {
    throw new ActionInputError({
      title: 'Choose an action',
      errors: [{ pointer: '/data/attributes/action', detail: 'must be one of the actions' }],
    });
  }
  return action as GraphBulkAction;
}

/** The action's own members, read from the form. */
function membersOf(action: GraphBulkAction, formData: FormData): Record<string, unknown> {
  switch (action) {
    case 'add-tag':
    case 'remove-tag':
      return { tag: formString(formData, 'tag') };
    case 'set-account-status':
      return { status: formString(formData, 'status') };
    case 'add-to-list':
      return { 'list-id': formString(formData, 'list-id'), kind: formString(formData, 'kind') };
    case 'export':
      return {};
    case 'create-case': {
      // C140.6: the queue is optional; none leaves the case to its template's default.
      const queue = formString(formData, 'case-queue-id') ?? '';
      return {
        'case-template-id': formString(formData, 'case-template-id'),
        ...(queue === '' ? {} : { 'case-queue-id': queue }),
      };
    }
  }
}

/**
 * `POST /graph-queries/:id/actions` (C103): a preview answers the count of the selection that is
 * in the stored result; a non-preview answers each account's outcome.
 */
export async function graphBulkAction(
  _state: ActionState<BulkActionAnswer>,
  formData: FormData,
): Promise<ActionResult<BulkActionAnswer>> {
  let action: GraphBulkAction;
  try {
    action = actionOf(formData);
  } catch (error) {
    return { ok: false, problem: (error as ActionInputError).problem };
  }
  return runGraphAction(
    { permissions: ['graph:read', ...ACTION_PERMISSIONS[action]] },
    async ({ api }) => {
      const queryId = idOf(formData, 'graph-query-id', 'grphq');
      const preview = formString(formData, 'preview') === 'true';
      if (action === 'export' && !preview) {
        throw new ActionInputError({
          title: 'The export downloads through its own link',
          detail: 'Use Download CSV: the file streams as the API answers it.',
        });
      }
      const accountIds = formStrings(formData, 'account-id');
      const body = parseInput(graphQueryActionBodySchema, {
        data: {
          attributes: {
            action,
            ...membersOf(action, formData),
            ...(formString(formData, 'all') === 'true'
              ? { all: true }
              : { 'account-ids': accountIds }),
            ...(preview ? { preview: true } : {}),
          },
        },
      });
      // The node client refuses the export (K7B-9); its preview is JSON, and needs no key.
      const { data } =
        action === 'export'
          ? await apiRequest({
              method: 'POST',
              path: `/graph-queries/${encodeURIComponent(queryId)}/actions`,
              body,
              schema: graphQueryActionResultDocumentSchema,
            })
          : await api.graphQueries.action(queryId, body.data.attributes);
      if (!preview) {
        revalidatePath(queryPath(queryId));
      }
      const { attributes } = data;
      return {
        action: attributes.action,
        preview: attributes.preview,
        selectedCount: attributes['selected-count'],
        outcomes: attributes.outcomes.map((outcome) => ({
          accountId: outcome['account-id'],
          outcome: outcome.outcome,
        })),
        ...(attributes['case-id'] === undefined ? {} : { caseId: attributes['case-id'] }),
      };
    },
  );
}

const PARAMETER_PREFIX = 'parameter:';

/** The `parameter:<name>` fields of a run form, trimmed, the blank ones left out. */
function parameterMapOf(formData: FormData): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, value] of formData.entries()) {
    if (field.startsWith(PARAMETER_PREFIX) && typeof value === 'string' && value.trim() !== '') {
      map[field.slice(PARAMETER_PREFIX.length)] = value.trim();
    }
  }
  return map;
}

/** `POST /graph-queries`: runs a template's published version, then opens the result (C102.4). */
export async function runGraphQuery(
  _state: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const result = await runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const body = parseInput(createGraphQueryBodySchema, {
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': formString(formData, 'graph-query-template-id'),
          'parameter-map': parameterMapOf(formData),
        },
      },
    });
    const sync = formString(formData, 'run-sync') === 'on';
    const { data } = sync
      ? await api.graphQueries.createSync(body.data.attributes)
      : await api.graphQueries.create(body.data.attributes);
    return { id: data.id };
  });
  if (result.ok) {
    redirect(queryPath(result.data.id));
  }
  return result;
}

/** `POST /graph-queries/:id/rerun`: the pinned version again, as the API re-binds it. */
export async function rerunGraphQuery(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const id = idOf(formData, 'graph-query-id', 'grphq');
    await api.graphQueries.rerun(id);
    revalidatePath(queryPath(id));
    return undefined;
  });
}

/** `POST /graph-queries/:id/cancel`: a submitted query only. */
export async function cancelGraphQuery(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const id = idOf(formData, 'graph-query-id', 'grphq');
    await api.graphQueries.cancel(id);
    revalidatePath(queryPath(id));
    return undefined;
  });
}

/**
 * Expands around an account (owner decision 20 after Workflow 7B): the template run
 * synchronously with `account_id` bound to it, answered for the canvas and the table to merge.
 * Only an account: a shared value's id is local to its result.
 */
export async function expandAroundAccount(
  _state: ActionState<GraphQueryResource>,
  formData: FormData,
): Promise<ActionResult<GraphQueryResource>> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const templateId = idOf(formData, 'graph-query-template-id', 'grqt');
    const accountId = idOf(formData, 'account-id', 'acc');
    const { data } = await api.graphQueries.createSync({
      'graph-query-template-id': templateId,
      'parameter-map': { account_id: accountId },
    });
    return data;
  });
}

const configOf = (formData: FormData) =>
  jsonOf(formString(formData, 'config', { trim: false }), CONFIG_POINTER);

/**
 * `POST /graph-query-templates`, which makes the first draft, then that draft's editor. A server
 * that names no latest version opens the template's page instead.
 */
export async function createGraphTemplate(
  _state: ActionState<{ path: string }>,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const result = await runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const body = parseInput(createGraphQueryTemplateBodySchema, {
      data: {
        type: 'graph-query-template',
        attributes: { name: formString(formData, 'name'), config: configOf(formData) },
      },
    });
    const { data: template } = await api.graphQueryTemplates.create(body.data.attributes);
    const latestId = template.relationships['latest-version']?.data.id;
    revalidatePath('/graph/templates');
    return {
      path: latestId === undefined ? templatePath(template.id) : versionPath(template.id, latestId),
    };
  });
  if (result.ok) {
    redirect(result.data.path);
  }
  return result;
}

/** `PATCH /graph-query-templates/:id`: the name only. */
export async function renameGraphTemplate(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const id = idOf(formData, 'graph-query-template-id', 'grqt');
    const body = parseInput(updateGraphQueryTemplateBodySchema, {
      data: { type: 'graph-query-template', attributes: { name: formString(formData, 'name') } },
    });
    await api.graphQueryTemplates.update(id, body.data.attributes);
    revalidatePath(templatePath(id));
    revalidatePath('/graph/templates');
    return undefined;
  });
}

/** `DELETE /graph-query-templates/:id`: archives it; its queries stay. */
export async function archiveGraphTemplate(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const id = idOf(formData, 'graph-query-template-id', 'grqt');
    await api.graphQueryTemplates.archive(id);
    revalidatePath(templatePath(id));
    revalidatePath('/graph/templates');
    return undefined;
  });
}

/** `POST /graph-query-template-versions`: a new draft, then its editor. */
export async function createGraphDraft(
  _state: ActionState<{ path: string }>,
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const result = await runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const body = parseInput(createGraphQueryTemplateVersionBodySchema, {
      data: {
        type: 'graph-query-template-version',
        attributes: {
          'graph-query-template-id': formString(formData, 'graph-query-template-id'),
          config: configOf(formData),
        },
      },
    });
    const { data } = await api.graphQueryTemplates.versions.create(body.data.attributes);
    const templateId = body.data.attributes['graph-query-template-id'];
    revalidatePath(templatePath(templateId));
    return { path: versionPath(templateId, data.id) };
  });
  if (result.ok) {
    redirect(result.data.path);
  }
  return result;
}

const versionIdsOf = (formData: FormData) => ({
  templateId: idOf(formData, 'graph-query-template-id', 'grqt'),
  versionId: idOf(formData, 'version-id', 'grqtv'),
});

/**
 * `PATCH /graph-query-template-versions/:id` (drafts only), answering in words what publishing
 * the saved draft would refuse (`graphTemplateConfigProblems`), at its pointers.
 */
export async function updateGraphDraft(
  _state: ActionState<DraftSaved>,
  formData: FormData,
): Promise<ActionResult<DraftSaved>> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const { templateId, versionId } = versionIdsOf(formData);
    const body = parseInput(updateGraphQueryTemplateVersionBodySchema, {
      data: { type: 'graph-query-template-version', attributes: { config: configOf(formData) } },
    });
    await api.graphQueryTemplates.versions.update(versionId, body.data.attributes);
    revalidatePath(versionPath(templateId, versionId));
    return {
      publishProblems: graphTemplateConfigProblems(body.data.attributes.config).map((problem) => ({
        pointer: problem.pointer,
        words: graphTemplateProblemWords(problem.code),
      })),
    };
  });
}

/** `POST /graph-query-template-versions/:id/publish`: the draft becomes the published version. */
export async function publishGraphDraft(
  _state: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runGraphAction({ permissions: ['graph:write'] }, async ({ api }) => {
    const { templateId, versionId } = versionIdsOf(formData);
    await api.graphQueryTemplates.versions.publish(versionId);
    revalidatePath(templatePath(templateId));
    revalidatePath(versionPath(templateId, versionId));
    return undefined;
  });
}
