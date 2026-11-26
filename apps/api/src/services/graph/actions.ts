/**
 * C103 (Workflow 7B; P16, V18): bulk actions from a stored graph result.
 *
 * - **Selection** is the intersection of the submitted ids with the stored result, so read access
 *   to the graph cannot act on arbitrary accounts; `all: true` is refused with 422
 *   `selection_too_large` when the result holds more than 500 accounts (decision 37).
 * - **Scopes.** Each action checks its own beside the route's `graph:read`: `add-tag`,
 *   `remove-tag` and `set-account-status` `accounts:write`; `add-to-list` `lists:write` and
 *   `pii:view` (through `ListService`, face and background lists refused with 422
 *   `biometric_list_not_bulk`); `export` `accounts:read` and `pii:view`; `create-case`
 *   `cases:write` (C140.6, Workflow 8B).
 * - **Answers.** A preview answers counts; any other call needs an `Idempotency-Key` (400 without
 *   one; the idempotency plugin replays it) and answers per-account outcomes: `done`,
 *   `skipped_redacted`, `skipped_consolidated`. The export is a CSV of at most 2,000 rows through
 *   the C100.6 writer (every string cell neutralised), answered as `text/csv`.
 * - **Audit.** One entry per action names the query, with counts, never a value.
 *
 * Each account's change goes through its own service with its own events (`PATCH /accounts/:id`,
 * the tag actions), in its own transaction. Owner: `api-graph`; `create-case` is
 * `api-case-workflows`' (C140.6): one case holding the selected accounts that are neither redacted
 * nor consolidated, through `createCaseInTx` under `case-create`, the query its origin in the case's
 * history, and never a case its creator could not see (P14). Its answer names the case, `null` for a
 * preview and for a selection with nothing to hold.
 */
import { writeCsv } from '@openverify/checks';
import type {
  GraphLink,
  GraphQueryActionBody,
  GraphQueryActionResultDocument,
} from '@openverify/contracts';
import {
  GRAPH_LIMITS,
  graphKindCode,
  LIST_KIND_REGISTRY,
  type GraphBulkOutcome,
  type GraphKind,
  type ListKind,
} from '@openverify/core';
import {
  getAccount,
  getList,
  listAccountGraphAttributes,
  type GraphQueryRow,
} from '@openverify/db';
import { requirePiiView } from '../../auth/pii.js';
import {
  BadRequestError,
  GraphProblemError,
  InvalidTransitionError,
  NotFoundError,
  NotImplementedError,
  UnprocessableContentError,
} from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import { changeAccountTags, updateAccount } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { assertCreatedCaseVisible, consumeCaseCreateRate } from '../cases/actions/service.js';
import { createCaseInTx } from '../cases/create.js';
import type { StagedEvent } from '../../events/index.js';
import { creatorOf } from '../../workflows/triggers/start.js';
import type { GraphActing } from './acting.js';
import { openGraphValue } from './node-values.js';
import { change, requireGraphQuery } from './shared.js';

/** The JSON answer, or the export's CSV, answered as `text/csv`. */
export type GraphQueryActionAnswer =
  { kind: 'document'; document: GraphQueryActionResultDocument } | { kind: 'csv'; csv: string };

type Attributes = GraphQueryActionBody['data']['attributes'];

interface Outcome {
  'account-id': string;
  outcome: GraphBulkOutcome;
}

/** C103.2: the list kind a graph kind's values go into; the rest have no list. */
const LIST_KIND_OF: Partial<Record<GraphKind, ListKind>> = {
  email_address: 'email-address',
  email_address_unconfirmed: 'email-address',
  email_domain: 'email-address',
  phone_number: 'phone-number',
  phone_number_unconfirmed: 'phone-number',
  government_id_number: 'government-id-number',
  ip_address: 'ip-address',
  name: 'name',
  device_fingerprint: 'device-fingerprint',
  browser_fingerprint: 'browser-fingerprint',
};

/** The selected accounts of the stored result, in the result's order. */
function selectionOf(query: GraphQueryRow, attributes: Attributes): string[] {
  if (attributes.all === true) {
    if (query.accountIds.length > GRAPH_LIMITS.bulkAccounts) {
      throw new GraphProblemError(
        'selection_too_large',
        `The result holds more than ${String(GRAPH_LIMITS.bulkAccounts)} accounts; select them.`,
      );
    }
    return [...query.accountIds];
  }
  const wanted = new Set(attributes['account-ids'] ?? []);
  return query.accountIds.filter((id) => wanted.has(id));
}

function authorize(acting: GraphActing, attributes: Attributes): void {
  switch (attributes.action) {
    case 'add-tag':
    case 'remove-tag':
    case 'set-account-status':
      authorizePrincipal(acting.principal, ['accounts:write']);
      return;
    case 'add-to-list':
      authorizePrincipal(acting.principal, ['lists:write']);
      requirePiiView(acting.principal);
      return;
    case 'export':
      authorizePrincipal(acting.principal, ['accounts:read']);
      requirePiiView(acting.principal);
      return;
    case 'create-case':
      // C140.6: one case holding the selection; a case holds ids, so no value is read here.
      authorizePrincipal(acting.principal, ['cases:write']);
      return;
  }
}

/** Runs `act` for each account that is neither redacted nor absorbed by a consolidation. */
async function eachAccount(
  deps: ApiDependencies,
  acting: GraphActing,
  accountIds: readonly string[],
  act: (accountId: string) => Promise<void>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const accountId of accountIds) {
    const account = await getAccount(deps.db, acting.ctx.environmentId, accountId);
    let outcome: GraphBulkOutcome = 'done';
    if (account?.redactedAt !== null) {
      outcome = 'skipped_redacted';
    } else if (account.consolidatedInto !== null) {
      outcome = 'skipped_consolidated';
    } else {
      try {
        await act(accountId);
      } catch (error) {
        if (!(error instanceof InvalidTransitionError)) {
          throw error;
        }
        outcome = 'skipped_consolidated';
      }
    }
    outcomes.push({ 'account-id': accountId, outcome });
  }
  return outcomes;
}

/** The list item of one value of `kind` (C97.1's members), or `null` when it has none. */
function itemOf(
  kind: GraphKind,
  value: string,
  plain: unknown,
): Readonly<Record<string, unknown>> | null {
  switch (LIST_KIND_OF[kind]) {
    case 'email-address':
      return kind === 'email_domain'
        ? { value, 'match-type': 'domain' }
        : { value, 'match-type': 'email_address' };
    case 'government-id-number':
      return { 'id-number': value };
    case 'name':
      return plain !== null && typeof plain === 'object'
        ? (plain as Record<string, unknown>)
        : null;
    case undefined:
      return null;
    default:
      return { value };
  }
}

async function addToList(
  deps: ApiDependencies,
  acting: GraphActing,
  query: GraphQueryRow,
  attributes: Extract<Attributes, { action: 'add-to-list' }>,
  accountIds: readonly string[],
): Promise<Outcome[]> {
  const { environmentId } = acting.ctx;
  const list = await getList(deps.db, environmentId, attributes['list-id']);
  if (list === null) {
    throw new NotFoundError(`List ${attributes['list-id']} was not found.`);
  }
  if (LIST_KIND_REGISTRY[list.type].biometric) {
    throw new GraphProblemError(
      'biometric_list_not_bulk',
      'Face and background list items come only from one consenting inquiry at a time.',
    );
  }
  if (LIST_KIND_OF[attributes.kind] !== list.type) {
    throw new UnprocessableContentError(`A ${attributes.kind} value does not fit this list.`, [
      { location: 'body', pointer: '/data/attributes/kind', detail: 'not the list kind' },
    ]);
  }
  const service = deps.listService;
  if (service === undefined) {
    throw new NotImplementedError('Adding to a list needs the list service.');
  }
  const code = graphKindCode(attributes.kind);
  const creator = { type: acting.actor.type, id: acting.actor.id };
  return eachAccount(deps, acting, accountIds, async (accountId) => {
    const rows = await listAccountGraphAttributes(deps.db, environmentId, {
      accountIds: [accountId],
      kinds: [code],
    });
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.valueKey)) {
        continue;
      }
      seen.add(row.valueKey);
      const value = await openGraphValue(
        deps,
        { ...query, accountIds: [accountId] },
        attributes.kind,
        row,
      );
      const item = value === null ? null : itemOf(attributes.kind, value, null);
      if (item !== null) {
        await service.createItem({
          environmentId,
          listId: list.id,
          item: { attributes: item, creator },
        });
      }
    }
  });
}

/** C140.6: one case holding the selected accounts that can be held; `null` when none can. */
async function createCase(
  deps: ApiDependencies,
  acting: GraphActing,
  queryId: string,
  attributes: Extract<Attributes, { action: 'create-case' }>,
  accountIds: readonly string[],
): Promise<{ outcomes: Outcome[]; caseId: string | null }> {
  const { environmentId } = acting.ctx;
  const held: string[] = [];
  const outcomes = await eachAccount(deps, acting, accountIds, (accountId) => {
    held.push(accountId);
    return Promise.resolve();
  });
  if (held.length === 0) {
    return { outcomes, caseId: null };
  }
  await consumeCaseCreateRate(deps, environmentId);
  const caseTemplateId = attributes['case-template-id'];
  const staged: StagedEvent[] = [];
  const caseId = await deps.db.transaction(async (tx) => {
    const created = await createCaseInTx(tx, deps, {
      environmentId,
      caseTemplateId,
      caseQueueId: attributes['case-queue-id'] ?? null,
      creator: creatorOf(acting.principal),
      objectIds: held,
      origin: { 'graph-query-id': queryId },
      requestId: acting.ctx.requestId ?? null,
    });
    staged.push(...created.staged);
    await assertCreatedCaseVisible(tx, acting, created.id, caseTemplateId);
    return created.id;
  });
  await deps.events.dispatch(staged);
  return { outcomes, caseId };
}

/** Hops from the result's start nodes over its links, as the explorer draws them. */
function hopsOf(query: GraphQueryRow): Map<string, number> {
  const links = query.links as GraphLink[];
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of links) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  const hops = new Map<string, number>();
  const queue: string[] = [];
  for (const [nodeId, entry] of Object.entries(query.nodeMap)) {
    if ((entry as { start?: unknown }).start === true) {
      hops.set(nodeId, 0);
      queue.push(nodeId);
    }
  }
  // The queue grows while it is read: for-of visits what is pushed.
  for (const node of queue) {
    for (const next of neighbours.get(node) ?? []) {
      if (!hops.has(next)) {
        hops.set(next, (hops.get(node) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  return hops;
}

async function exportCsv(
  deps: ApiDependencies,
  acting: GraphActing,
  query: GraphQueryRow,
  accountIds: readonly string[],
): Promise<string> {
  const hops = hopsOf(query);
  const links = query.links as GraphLink[];
  const rows: (string | number | null)[][] = [];
  for (const accountId of accountIds.slice(0, GRAPH_LIMITS.exportRows)) {
    const account = await getAccount(deps.db, acting.ctx.environmentId, accountId);
    if (account?.redactedAt !== null) {
      continue;
    }
    const kinds = [
      ...new Set(
        links
          .filter((link) => link.from === accountId || link.to === accountId)
          .map((link) => link.kind),
      ),
    ].sort();
    rows.push([
      account.id,
      account.referenceId,
      account.status,
      account.tags.join(' '),
      hops.get(accountId) ?? null,
      kinds.join(' '),
    ]);
  }
  return writeCsv(
    ['account-id', 'reference-id', 'status', 'tags', 'hop-distance', 'linking-kinds'],
    rows,
  );
}

export async function runGraphQueryAction(
  deps: ApiDependencies,
  acting: GraphActing,
  id: string,
  attributes: Attributes,
  request: { idempotencyKey: string | undefined },
): Promise<GraphQueryActionAnswer> {
  const { environmentId } = acting.ctx;
  const query = await requireGraphQuery(deps.db, environmentId, id);
  if (query.redactedAt !== null) {
    throw new GraphProblemError('graph_query_redacted', `Graph query ${id} was redacted.`);
  }
  const selected = selectionOf(query, attributes);
  authorize(acting, attributes);
  const preview = attributes.preview === true;
  const answer = (outcomes: Outcome[], caseId: string | null = null): GraphQueryActionAnswer => ({
    kind: 'document',
    document: {
      data: {
        type: 'graph-query-action',
        attributes: {
          action: attributes.action,
          preview,
          'selected-count': selected.length,
          outcomes,
          // C140.6: only create-case names its case.
          ...(attributes.action === 'create-case' ? { 'case-id': caseId } : {}),
        },
      },
    },
  });
  if (preview) {
    return answer([]);
  }
  if (request.idempotencyKey === undefined) {
    throw new BadRequestError('An action that is not a preview needs an Idempotency-Key header.');
  }
  let outcomes: Outcome[] = [];
  let csv: string | null = null;
  let caseId: string | null = null;
  switch (attributes.action) {
    case 'add-tag':
    case 'remove-tag': {
      const kind = attributes.action === 'add-tag' ? 'add' : 'remove';
      outcomes = await eachAccount(deps, acting, selected, async (accountId) => {
        await changeAccountTags(deps, acting.ctx, acting.actor, accountId, {
          kind,
          tag: attributes.tag,
        });
      });
      break;
    }
    case 'set-account-status':
      outcomes = await eachAccount(deps, acting, selected, async (accountId) => {
        await updateAccount(deps, acting.ctx, acting.actor, accountId, {
          status: attributes.status,
        });
      });
      break;
    case 'add-to-list':
      outcomes = await addToList(deps, acting, query, attributes, selected);
      break;
    case 'export':
      csv = await exportCsv(deps, acting, query, selected);
      break;
    case 'create-case':
      ({ outcomes, caseId } = await createCase(deps, acting, id, attributes, selected));
      break;
  }
  await change(deps, acting, async ({ audit }) => {
    await audit({
      action: 'graph-query.action',
      resourceType: 'graph-query',
      resourceId: id,
      metadata: {
        action: attributes.action,
        'selected-count': selected.length,
        'done-count': outcomes.filter(({ outcome }) => outcome === 'done').length,
        ...(caseId === null ? {} : { 'case-id': caseId }),
      },
    });
  });
  return csv === null ? answer(outcomes, caseId) : { kind: 'csv', csv };
}
