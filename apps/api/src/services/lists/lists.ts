/**
 * C97.1, C97.2, C97.5 (Workflow 7B): the list routes' service. Owner: `api-lists`.
 *
 * - A list is created per kind, with the kind's own members. A face or background list needs
 *   `biometric-lists-basis` (409 `biometric_lists_not_acknowledged`, C97.4) and a retention no
 *   longer than the environment's `face-template-retention-days` (422 `retention_exceeds_consent`,
 *   P08).
 * - `PATCH` takes the four members C97.1 names, and refuses a member the kind does not have. The
 *   members a stored key depends on (`case-sensitive`, `allow-fuzzy-name-first`) never change.
 * - `DELETE` archives: its items stay readable and stop matching.
 * - Every write is audited, with the list's id and kind and never a value.
 */
import {
  listKindSchema,
  type ListDocument,
  type ListKind,
  type ListResourceListDocument,
  type MatchListsBody,
  type MatchListsResponse,
  type UpdateListBody,
  filterValues,
  newId,
} from '@openverify/contracts';
import type { listListsQuerySchema } from '@openverify/contracts';
import {
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  listStatusSchema,
  toListItemResourceType,
  type ListPurpose,
} from '@openverify/core';
import {
  archiveList as archiveListRow,
  countActiveLists,
  createList as createListRow,
  getEnvironment,
  getList,
  getLists,
  listActiveListsOfKinds,
  listLists as listListRows,
  lockListLimit,
  resolveFaceTemplateSettings,
  updateList as updateListRow,
  type Db,
  type ListRow,
} from '@openverify/db';
import type { z } from 'zod';
import { ListProblemError, NotFoundError } from '../../errors.js';
import { biometricListsGate } from './biometric/index.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from '../context.js';
import type { Acting } from '../inquiries.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { fieldError } from './field-error.js';
import { matchLists as runMatchLists, type FoundListMatch, type ListProbe } from './match.js';
import { consumeListMatch } from './rate.js';
import { listDocument, listResource } from './resources.js';

export type ListListsQuery = z.infer<typeof listListsQuerySchema>;
export type ListActing = Pick<Acting, 'ctx' | 'mask' | 'actor'>;

type ProbeBody = MatchListsBody['data']['attributes']['probes'][number];
type MatchResult = MatchListsResponse['data']['attributes']['matches'][number];

const LISTS_PATH = '/api/v1/lists';

/** @throws {NotFoundError} for a list this environment does not hold. */
export async function requireList(db: Db, environmentId: string, id: string): Promise<ListRow> {
  const list = await getList(db, environmentId, id);
  if (list === null) {
    throw new NotFoundError(`List ${id} was not found.`);
  }
  return list;
}

function audit(deps: ApiDependencies, tx: Db, acting: ListActing, action: AuditedAction) {
  return deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action));
}

/** C97.2 (P08): a biometric list keeps items no longer than the source consent promises. */
async function assertRetentionFitsConsent(
  db: Db,
  environmentId: string,
  days: number | null | undefined,
): Promise<void> {
  const environment = await getEnvironment(db, environmentId);
  const window = resolveFaceTemplateSettings(environment?.settings ?? {})[
    'face-template-retention-days'
  ];
  if (days == null || days > window) {
    throw new ListProblemError(
      'retention_exceeds_consent',
      'A face or background list keeps its items for at most the environment’s ' +
        '`face-template-retention-days`.',
      {
        errors: [
          fieldError(
            '/data/attributes/item-retention-days',
            'Must be at most the face template retention.',
          ),
        ],
      },
    );
  }
}

/** The kind's own members of a create body, as the row stores them. */
function kindColumns(attributes: Readonly<Record<string, unknown>>) {
  const present = <Value>(member: string, value: unknown) =>
    value === undefined ? {} : ({ [member]: value } as Record<string, Value>);
  return {
    ...present<string>('fieldKey', attributes['field-key']),
    ...present<boolean>('caseSensitive', attributes['case-sensitive']),
    ...present<string | null>('defaultRegion', attributes['default-region']),
    ...present<boolean>('useForCompromisedIds', attributes['use-for-compromised-ids']),
    ...present<boolean>('allowFuzzyNameFirst', attributes['allow-fuzzy-name-first']),
  };
}

export async function createList(
  deps: ApiDependencies,
  acting: ListActing,
  kind: ListKind,
  attributes: Readonly<Record<string, unknown>>,
): Promise<ListDocument> {
  const { environmentId } = acting.ctx;
  const days = attributes['item-retention-days'] as number | null | undefined;
  if (LIST_KIND_REGISTRY[kind].biometric) {
    const gate = deps.biometricListsGate ?? biometricListsGate;
    if (!(await gate.isAcknowledged(deps.db, environmentId))) {
      throw new ListProblemError(
        'biometric_lists_not_acknowledged',
        'Set `biometric-lists-basis` before creating a face or background list.',
      );
    }
    await assertRetentionFitsConsent(deps.db, environmentId, days);
  }
  const list = await deps.db.transaction(async (tx) => {
    await lockListLimit(tx, environmentId);
    if ((await countActiveLists(tx, environmentId)) >= LIST_LIMITS.activeListsPerEnvironment) {
      throw new ListProblemError(
        'list_limit_reached',
        'This environment holds as many active lists as its limit allows.',
      );
    }
    const row = await createListRow(tx, environmentId, {
      id: newId('lst'),
      type: kind,
      name: attributes.name as string,
      itemRetentionDays: days ?? null,
      ...(attributes['screen-at-completion'] === undefined
        ? {}
        : { screenAtCompletion: attributes['screen-at-completion'] as boolean }),
      ...kindColumns(attributes),
      ...(attributes.purpose === undefined ? {} : { purpose: attributes.purpose as ListPurpose }),
    });
    await audit(deps, tx, acting, {
      action: 'list.created',
      resourceType: 'list',
      resourceId: row.id,
      metadata: { kind },
    });
    return row;
  });
  return listDocument(list);
}

export async function listLists(
  deps: ApiDependencies,
  acting: ListActing,
  query: ListListsQuery,
): Promise<ListResourceListDocument> {
  const page = await withCursor(() =>
    listListRows(
      deps.db,
      acting.ctx.environmentId,
      {
        statuses: filterValues(query['filter[status]'], listStatusSchema),
        kinds: filterValues(query['filter[type]'], listKindSchema),
      },
      pageRequest(query),
    ),
  );
  const filters = {
    'filter[status]': query['filter[status]'],
    'filter[type]': query['filter[type]'],
  };
  return {
    data: page.items.map(listResource),
    links: { next: nextLink(LISTS_PATH, filters, query, page.next) },
  };
}

export async function getListDocument(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
): Promise<ListDocument> {
  return listDocument(await requireList(deps.db, acting.ctx.environmentId, id));
}

export async function updateList(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
  attributes: UpdateListBody['data']['attributes'],
): Promise<ListDocument> {
  const { environmentId } = acting.ctx;
  const list = await requireList(deps.db, environmentId, id);
  const compromised = attributes['use-for-compromised-ids'];
  if (compromised !== undefined && list.type !== 'government-id-number') {
    throw new ListProblemError(
      'list_kind_mismatch',
      'Only a government ID number list reads `use-for-compromised-ids`.',
      {
        errors: [
          fieldError(
            '/data/attributes/use-for-compromised-ids',
            'This kind of list has no such member.',
          ),
        ],
      },
    );
  }
  const days = attributes['item-retention-days'];
  if (days !== undefined && LIST_KIND_REGISTRY[list.type].biometric) {
    await assertRetentionFitsConsent(deps.db, environmentId, days);
  }
  const updated = await deps.db.transaction(async (tx) => {
    const row = await updateListRow(tx, environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(days === undefined ? {} : { itemRetentionDays: days }),
      ...(attributes['screen-at-completion'] === undefined
        ? {}
        : { screenAtCompletion: attributes['screen-at-completion'] }),
      ...(compromised === undefined ? {} : { useForCompromisedIds: compromised }),
      ...(attributes.purpose === undefined ? {} : { purpose: attributes.purpose }),
    });
    await audit(deps, tx, acting, {
      action: 'list.updated',
      resourceType: 'list',
      resourceId: id,
      metadata: { members: Object.keys(attributes).sort() },
    });
    return row;
  });
  if (updated === null) {
    throw new NotFoundError(`List ${id} was not found.`);
  }
  return listDocument(updated);
}

export async function archiveList(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
): Promise<ListDocument> {
  const { environmentId } = acting.ctx;
  const { archived, staged } = await deps.db.transaction(async (tx) => {
    const before = await requireList(tx, environmentId, id);
    const row = await archiveListRow(tx, environmentId, id, deps.clock.now());
    if (before.status !== 'active') {
      return { archived: row, staged: [] };
    }
    await audit(deps, tx, acting, {
      action: 'list.archived',
      resourceType: 'list',
      resourceId: id,
    });
    // Outcome 25 (C127.12): a monitored report reads `list_archived`, never an old "no match".
    return {
      archived: row,
      staged: await stageListUpdated(tx, deps, environmentId, [
        { listId: id, changeKind: 'archived', items: 0 },
      ]),
    };
  });
  await deps.events.dispatch(staged);
  if (archived === null) {
    throw new NotFoundError(`List ${id} was not found.`);
  }
  return listDocument(archived);
}

/** A probe of the body in the shape `matchLists` reads: its members, without its kind. */
function requestProbe({ kind, ...value }: ProbeBody): ListProbe {
  return { source: 'request', kind, values: [value] };
}

function matchResult(match: FoundListMatch): MatchResult {
  return {
    'list-id': match.listId,
    'list-item': { type: toListItemResourceType(match.listKind), id: match.listItemId },
    'list-version': match.listVersion,
    source: match.source,
    method: match.method,
    tier: match.tier,
    confidence: match.confidence,
    approximate: match.approximate,
    score: match.score,
    'distance-meters': match.distanceMeters,
  };
}

/**
 * C99.4: on demand: exact, CIDR and radius only; writes no record. Without `list-ids`, every
 * active list of the probes' kinds. The answer names items, never the value compared.
 * A named list this environment does not hold reads as `list_archived`, saying nothing of it.
 * @throws {RateLimitedError} past the C12 policy `lists-match`, per key.
 */
export async function matchLists(
  deps: ApiDependencies,
  acting: ListActing,
  attributes: MatchListsBody['data']['attributes'],
): Promise<MatchListsResponse> {
  const { environmentId } = acting.ctx;
  await consumeListMatch(deps, acting.actor.id);
  const named = attributes['list-ids'];
  const lists =
    named === undefined
      ? await listActiveListsOfKinds(deps.db, environmentId, [
          ...new Set(attributes.probes.map(({ kind }) => kind)),
        ])
      : await getLists(deps.db, environmentId, named);
  const held = new Set(lists.map(({ id }) => id));
  const outcome = await runMatchLists(
    deps.db,
    environmentId,
    attributes.probes.map(requestProbe),
    { key: deps.blindIndexKey, lists, onDemand: true },
  );
  return {
    data: {
      type: 'list-match-result',
      attributes: {
        matches: outcome.matches.map(matchResult),
        unscreened: [
          ...(named ?? [])
            .filter((id) => !held.has(id))
            .map((id) => ({ 'list-id': id, reason: 'list_archived' as const })),
          ...outcome.unscreened,
        ],
        'not-applicable': outcome.notApplicable,
      },
    },
  };
}
