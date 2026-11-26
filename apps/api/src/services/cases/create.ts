/**
 * C129.2, C136, C140.3, C140.6, C128.7 (Workflow 8B): the one case-creation service that `POST /cases`,
 * the review-request route, the graph explorer's "create case" bulk action and the `create_case`
 * step share, in the caller's transaction. Owner `api-cases`.
 *
 * What it does, whoever calls it: the template must be active with a published version, which the
 * case pins (C130.2); the name comes from the template's counter (`KYC-6`, C129.2); the fields are
 * validated by that version and sealed, a searchable one keyed per template and field (C136.4, P25);
 * the held objects are attached once each with their state then (C136.1-C136.3); tags are normalised
 * (C136.5); the queue is the given one or the version's default (C132.1); the public SLA starts
 * (C133.1); `assignOnEntry` may assign (C132.2); history rows and `case.created` (with `case.assigned`
 * when a policy assigned) are staged; a run's case carries its step (C117.5). The `case-create` limit
 * (C143.3) and the audit entry are the caller's.
 */
import { newId } from '@openverify/contracts';
import {
  initialCaseStatus,
  normalizeTags,
  TooManyTagsError,
  type CaseCreatorType,
  type CaseHeldObjectType,
} from '@openverify/core';
import {
  caseQueues,
  createCaseRow,
  environments,
  getCaseTemplateRow,
  getPublishedCaseTemplateVersion,
  nextCaseNumber,
  queueCaseNotificationEmails,
  replaceCaseFieldKeys,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import { UNMASKED } from '../../auth/pii.js';
import { NotFoundError, UnprocessableContentError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import type { ApiDependencies } from '../context.js';
import { assignOnEntry } from './assignment/on-entry.js';
import { caseSearchableKeys, fieldSchemasOf, validatedCaseFields } from './fields.js';
import { CaseProblemError } from './problems.js';
import { assertSlaSeconds, setPublicSlaInTx } from './public-sla.js';
import { caseUnitIn, statusMachineOf, type CaseActor, type CaseWriteDeps } from './shared.js';
import { attachObjectsInTx, emitCaseEvent, notify } from './writes.js';

/** What a creation names; ids only, and the fields as given (the service validates them). */
export interface CaseCreationInput {
  environmentId: string;
  caseTemplateId: string;
  creator: { type: CaseCreatorType; id: string };
  caseQueueId?: string | null;
  fields?: Readonly<Record<string, unknown>>;
  tags?: readonly string[];
  /** C136.1: what the case holds from the start (`meta.object-ids`). */
  objectIds?: readonly string[];
  /** C133.1: a wall-clock deadline, 1 to 7,776,000 seconds. */
  slaExpiresInSeconds?: number | null;
  /** C117.5: the run's step that creates it. */
  workflowRunStepId?: string | null;
  /** C131.4: why it was made, as history keys (a graph query's id, an inquiry's review request). */
  origin?: Readonly<Record<string, string>>;
  requestId?: string | null;
  /**
   * The principal behind a route's creation, whose scopes a `platform-file` field needs (P12). Left
   * out, as for a step or the system, such a field is refused rather than written unchecked.
   */
  acting?: CaseActor;
}

export interface CreatedCase {
  id: string;
  name: string;
  /** Each held object as its kind reads it. */
  heldObjects: readonly { objectType: CaseHeldObjectType; objectId: string }[];
  /** Dispatched by the caller after its commit. */
  staged: readonly StagedEvent[];
}

export type CreateCaseInTx = (
  tx: Db,
  deps: ApiDependencies,
  input: CaseCreationInput,
) => Promise<CreatedCase>;

const ATTRIBUTES = '/data/attributes';

async function organizationOf(tx: Db, environmentId: string): Promise<string> {
  const [environment] = await tx
    .select({ organizationId: environments.organizationId })
    .from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);
  if (environment === undefined) {
    throw new NotFoundError(`Environment ${environmentId} was not found.`);
  }
  return environment.organizationId;
}

/** C132.1: an active queue of this environment, or a 422 naming it. */
export async function assertQueueIn(
  tx: Db,
  environmentId: string,
  queueId: string,
  pointer: string,
) {
  const [queue] = await tx
    .select({ status: caseQueues.status })
    .from(caseQueues)
    .where(and(eq(caseQueues.environmentId, environmentId), eq(caseQueues.id, queueId)))
    .limit(1);
  if (queue?.status !== 'active') {
    throw new UnprocessableContentError('The queue is not an active queue of this environment.', [
      { location: 'body', pointer, detail: 'Names no active queue of this environment.' },
    ]);
  }
}

export function tagsOf(tags: readonly string[]): string[] {
  try {
    return normalizeTags(tags);
  } catch (error) {
    if (error instanceof TooManyTagsError) {
      throw new UnprocessableContentError(error.message);
    }
    throw error;
  }
}

export async function createCaseWithDeps(
  tx: Db,
  deps: CaseWriteDeps & { blindIndexKey: Uint8Array },
  input: CaseCreationInput,
): Promise<CreatedCase> {
  const { environmentId } = input;
  const template = await getCaseTemplateRow(tx, environmentId, input.caseTemplateId);
  if (template === null) {
    throw new NotFoundError(`Case template ${input.caseTemplateId} was not found.`);
  }
  if (template.status === 'archived') {
    throw new CaseProblemError(
      'case_template_archived',
      'This template is archived; it takes no new case.',
    );
  }
  const version = await getPublishedCaseTemplateVersion(tx, environmentId, template.id);
  if (version === null) {
    throw new CaseProblemError(
      'case_template_not_published',
      'This template has no published version to make a case on.',
    );
  }
  assertSlaSeconds(input.slaExpiresInSeconds);
  const acting: CaseActor = input.acting ?? {
    ctx: {
      environmentId,
      organizationId: await organizationOf(tx, environmentId),
      ...(input.requestId === undefined || input.requestId === null
        ? {}
        : { requestId: input.requestId }),
    },
    actor: input.creator,
    mask: UNMASKED,
    principal: null,
  };
  const staged: StagedEvent[] = [];
  const unit = caseUnitIn(tx, deps, { ...acting, actor: input.creator }, staged);
  const fields = await validatedCaseFields(tx, unit.acting, version, input.fields ?? {}, false);
  const tags = tagsOf(input.tags ?? []);
  const caseQueueId = input.caseQueueId === undefined ? version.defaultQueueId : input.caseQueueId;
  if (caseQueueId !== null) {
    await assertQueueIn(tx, environmentId, caseQueueId, `${ATTRIBUTES}/case-queue-id`);
  }
  const machine = statusMachineOf(version);
  const initial = initialCaseStatus(machine);
  const number = await nextCaseNumber(tx, environmentId, template.id);
  const row = await createCaseRow(tx, environmentId, {
    id: newId('case'),
    caseTemplateId: template.id,
    caseTemplateVersionId: version.id,
    name: `${template.key}-${String(number)}`,
    status: initial.key,
    statusCategory: initial.category,
    caseQueueId,
    creatorType: input.creator.type,
    creatorId: input.creator.id,
    tags,
    fields,
    workflowRunStepId: input.workflowRunStepId ?? null,
  });
  await replaceCaseFieldKeys(
    tx,
    environmentId,
    row.id,
    caseSearchableKeys(
      deps.blindIndexKey,
      environmentId,
      template.id,
      fieldSchemasOf(version),
      fields,
    ),
  );
  const actor = { actorType: input.creator.type, actorId: input.creator.id };
  const requestId = input.requestId ?? null;
  await unit.history([
    {
      caseId: row.id,
      kind: 'created',
      ...actor,
      to: {
        status: initial.key,
        'case-template-version-id': version.id,
        ...(caseQueueId === null ? {} : { 'case-queue-id': caseQueueId }),
        ...(tags.length === 0 ? {} : { tags }),
        ...(input.origin ?? {}),
      },
      requestId,
    },
  ]);
  const attached = await attachObjectsInTx(
    unit,
    row,
    version,
    input.objectIds ?? [],
    '/meta/object-ids',
  );
  if (input.slaExpiresInSeconds !== undefined && input.slaExpiresInSeconds !== null) {
    await setPublicSlaInTx(unit, row, input.slaExpiresInSeconds, initial['pauses-sla']);
  }
  const assignee = await assignOnEntry(tx, {
    environmentId,
    caseId: row.id,
    caseTemplateVersionId: version.id,
    caseQueueId,
    at: unit.at,
  });
  await emitCaseEvent(unit, row.id, 'case.created');
  // K8-20 (C130.2, P38): `notify-on-create`'s link-only emails; who may still read the case is the
  // worker's sweep to check at send.
  await queueCaseNotificationEmails(
    tx,
    environmentId,
    version.notifyOnCreate.map((userId) => ({ userId, caseId: row.id, kind: 'created' as const })),
  );
  if (assignee !== null) {
    await emitCaseEvent(unit, row.id, 'case.assigned');
    await notify(unit, row.id, 'assigned', [assignee]);
  }
  return {
    id: row.id,
    name: row.name,
    heldObjects: attached.map(({ objectType, objectId }) => ({ objectType, objectId })),
    staged,
  };
}

/** The one creation path (C129.5, C128.7, C140.3, C140.6): see the file's header. */
export const createCaseInTx: CreateCaseInTx = (tx, deps, input) =>
  createCaseWithDeps(tx, deps, input);
