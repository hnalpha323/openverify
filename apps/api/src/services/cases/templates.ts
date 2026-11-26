/**
 * C130 (Workflow 8B, `api-cases`): what `routes/server/case-templates.ts` calls: templates and their
 * versions.
 *
 * - A template comes with a first draft holding C130.2's defaults, unless the body says otherwise;
 *   its key is unique per environment (409 `case_template_key_taken`) and never changes. Archiving
 *   refuses new cases and keeps existing ones (C130.1).
 * - A draft changes; a published version never does (409 `case_template_version_not_draft`). A new
 *   draft starts from the newest version, and a template holds one draft at a time.
 * - Publishing runs under the template's row lock: the field schemas (F37, by pointer), the status
 *   map (C131.1: an end status unreachable from initial), every field key keeping its type across
 *   versions (C130.3), the users told of a new case seeing the template (P38); then it supersedes the
 *   published version and fires `case-template.deleted-field` for each field it drops (H29).
 * - What a version names (a queue, a policy, an SLA policy, roles, users) is checked in this
 *   environment or organisation, so nothing reaches another tenant's rows.
 */
import {
  newId,
  type archiveCaseTemplateBodySchema,
  type CaseTemplateDocument,
  type CaseTemplateListDocument,
  type CaseTemplateVersionDocument,
  type CaseTemplateVersionListDocument,
  type CreateCaseTemplateBody,
  type CreateCaseTemplateVersionBody,
  type listCaseTemplatesQuerySchema,
  type listCaseTemplateVersionsQuerySchema,
  type publishCaseTemplateVersionBodySchema,
  type UpdateCaseTemplateBody,
  type UpdateCaseTemplateVersionBody,
} from '@openverify/contracts';
import {
  CASE_HELD_OBJECT_TYPES,
  caseFieldSchemaProblems,
  caseTransitionMapProblems,
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
  type FieldSchema,
} from '@openverify/core';
import {
  caseAssignmentPolicies,
  caseQueues,
  caseSlaPolicies,
  caseTemplates,
  caseTemplateVersions,
  createCaseTemplateRow,
  createCaseTemplateVersionRow,
  getCaseTemplateRow,
  getCaseTemplateVersionRow,
  getDraftCaseTemplateVersion,
  getLatestCaseTemplateVersion,
  listCaseTemplateRows,
  listCaseTemplateVersionHeads,
  listCaseTemplateVersionRows,
  lockCaseTemplateRow,
  lockCaseTemplateVersionRow,
  publishCaseTemplateVersionRow,
  roles,
  updateCaseTemplateRow,
  updateCaseTemplateVersionRow,
  userRoles,
  users,
  type CaseTemplateRow,
  type CaseTemplateVersionContent,
  type CaseTemplateVersionRow,
  type Db,
  roleAssignmentReaches,
} from '@openverify/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ConflictError, NotFoundError, type ProblemFieldError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { versionCompletionProblems } from './layout/version-members.js';
import { CaseProblemError } from './problems.js';
import { caseTemplateResource, caseTemplateVersionResource } from './resources.js';
import type { CaseActing } from './service.js';
import {
  caseChange,
  createdAtOf,
  dateOf,
  filterList,
  statusDefinitionOf,
  statusMachineOf,
} from './shared.js';

const TEMPLATES_PATH = '/api/v1/case-templates';
const VERSIONS_PATH = '/api/v1/case-template-versions';
const ATTRIBUTES = '/data/attributes';

type VersionAttributes = Partial<
  Pick<
    CreateCaseTemplateBody['data']['attributes'],
    | 'field-schemas'
    | 'statuses'
    | 'resolutions'
    | 'transitions'
    | 'default-queue-id'
    | 'assignment-policy-id'
    | 'sla-policy-id'
    | 'sla-starts-on'
    | 'held-object-types'
    | 'attachment-policy'
    | 'notify-on-create'
    | 'layout-modules'
    | 'layout'
    | 'checklists'
    | 'preset-comments'
  >
>;

/** C130.2: what a first draft holds. */
const DEFAULT_CONTENT: CaseTemplateVersionContent = {
  fieldSchemas: [],
  statuses: DEFAULT_CASE_STATUSES,
  resolutions: DEFAULT_CASE_RESOLUTIONS,
  transitions: null,
  defaultQueueId: null,
  assignmentPolicyId: null,
  slaPolicyId: null,
  slaStartsOn: 'created',
  heldObjectTypes: CASE_HELD_OBJECT_TYPES,
  attachmentPolicy: null,
  notifyOnCreate: [],
  layoutModules: null,
  // C172.1, C172.2, C172.4 (Workflow 9B, api-cases-reports): none until set.
  layout: null,
  checklists: [],
  presetComments: [],
};

/** A stored version's content, so a new draft starts from it. */
const contentOfRow = (row: CaseTemplateVersionRow): CaseTemplateVersionContent => ({
  fieldSchemas: row.fieldSchemas,
  statuses: row.statuses,
  resolutions: row.resolutions,
  transitions: row.transitions,
  defaultQueueId: row.defaultQueueId,
  assignmentPolicyId: row.assignmentPolicyId,
  slaPolicyId: row.slaPolicyId,
  slaStartsOn: row.slaStartsOn,
  heldObjectTypes: row.heldObjectTypes,
  attachmentPolicy: row.attachmentPolicy,
  notifyOnCreate: row.notifyOnCreate,
  layoutModules: row.layoutModules,
  // C172.1, C172.2, C172.4 (Workflow 9B, api-cases-reports): a new draft carries them (C2).
  layout: row.layout,
  checklists: row.checklists,
  presetComments: row.presetComments,
});

/** The members a body names, as stored content; what it leaves out is not there. */
function contentChanges(attributes: VersionAttributes): Partial<CaseTemplateVersionContent> {
  const changes: Partial<CaseTemplateVersionContent> = {};
  if (attributes['field-schemas'] !== undefined) changes.fieldSchemas = attributes['field-schemas'];
  if (attributes.statuses !== undefined) changes.statuses = attributes.statuses;
  if (attributes.resolutions !== undefined) changes.resolutions = attributes.resolutions;
  if (attributes.transitions !== undefined) changes.transitions = attributes.transitions;
  if (attributes['default-queue-id'] !== undefined)
    changes.defaultQueueId = attributes['default-queue-id'];
  if (attributes['assignment-policy-id'] !== undefined)
    changes.assignmentPolicyId = attributes['assignment-policy-id'];
  if (attributes['sla-policy-id'] !== undefined) changes.slaPolicyId = attributes['sla-policy-id'];
  if (attributes['sla-starts-on'] !== undefined) changes.slaStartsOn = attributes['sla-starts-on'];
  if (attributes['held-object-types'] !== undefined)
    changes.heldObjectTypes = attributes['held-object-types'];
  if (attributes['attachment-policy'] !== undefined)
    changes.attachmentPolicy = attributes['attachment-policy'];
  if (attributes['notify-on-create'] !== undefined)
    changes.notifyOnCreate = attributes['notify-on-create'];
  if (attributes['layout-modules'] !== undefined)
    changes.layoutModules = attributes['layout-modules'];
  // C172.1, C172.2, C172.4 (Workflow 9B, api-cases-reports); `requires-fields` rides in statuses.
  if (attributes.layout !== undefined) changes.layout = attributes.layout;
  if (attributes.checklists !== undefined) changes.checklists = attributes.checklists;
  if (attributes['preset-comments'] !== undefined)
    changes.presetComments = attributes['preset-comments'];
  return changes;
}

const unknownAt = (pointer: string, what: string): ProblemFieldError => ({
  location: 'body',
  pointer,
  detail: `Names no ${what} of this environment.`,
});

/** What a version names exists in this environment (the composite keys would refuse it as a 500). */
async function assertReferencesExist(
  db: Db,
  environmentId: string,
  changes: Partial<CaseTemplateVersionContent>,
): Promise<void> {
  const errors: ProblemFieldError[] = [];
  const exists = async (
    table: typeof caseQueues | typeof caseAssignmentPolicies | typeof caseSlaPolicies,
    id: string,
  ) =>
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.environmentId, environmentId), eq(table.id, id)))
        .limit(1)
    ).length > 0;
  if (
    typeof changes.defaultQueueId === 'string' &&
    !(await exists(caseQueues, changes.defaultQueueId))
  ) {
    errors.push(unknownAt(`${ATTRIBUTES}/default-queue-id`, 'queue'));
  }
  if (
    typeof changes.assignmentPolicyId === 'string' &&
    !(await exists(caseAssignmentPolicies, changes.assignmentPolicyId))
  ) {
    errors.push(unknownAt(`${ATTRIBUTES}/assignment-policy-id`, 'assignment policy'));
  }
  if (
    typeof changes.slaPolicyId === 'string' &&
    !(await exists(caseSlaPolicies, changes.slaPolicyId))
  ) {
    errors.push(unknownAt(`${ATTRIBUTES}/sla-policy-id`, 'SLA policy'));
  }
  if (errors.length > 0) {
    // K8-27 (Workflow 9B, contracts B41): named, with each error by pointer.
    throw new CaseProblemError(
      'case_template_invalid',
      'The version names something this environment does not hold.',
      { errors },
    );
  }
}

/** C130.1 (P14): the roles a template lists are roles of this organisation. */
async function assertRolesExist(
  db: Db,
  organizationId: string,
  roleIds: readonly string[],
): Promise<void> {
  if (roleIds.length === 0) {
    return;
  }
  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), inArray(roles.id, [...roleIds])));
  const known = new Set(found.map(({ id }) => id));
  const errors = roleIds.flatMap((id, index) =>
    known.has(id) ? [] : [unknownAt(`${ATTRIBUTES}/visible-to-roles/${String(index)}`, 'role')],
  );
  if (errors.length > 0) {
    throw new CaseProblemError('case_template_invalid', 'A role is not one of this organisation.', {
      errors,
    });
  }
}

async function requireTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateRow> {
  const template = await getCaseTemplateRow(db, environmentId, id);
  if (template === null) {
    throw new NotFoundError(`Case template ${id} was not found.`);
  }
  return template;
}

async function requireVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateVersionRow> {
  const version = await getCaseTemplateVersionRow(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Case template version ${id} was not found.`);
  }
  return version;
}

async function templateDocument(
  db: Db,
  environmentId: string,
  template: CaseTemplateRow,
): Promise<CaseTemplateDocument> {
  const heads = await listCaseTemplateVersionHeads(db, environmentId, [template.id]);
  return {
    data: caseTemplateResource(
      template,
      heads.get(template.id) ?? { published: null, draft: null },
    ),
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

export async function listCaseTemplates(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseTemplatesQuerySchema>,
): Promise<CaseTemplateListDocument> {
  const { environmentId } = acting.ctx;
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseTemplateRows(
      deps.db,
      environmentId,
      {
        statuses: filterList(query['filter[status]']),
        keys: filterList(query['filter[key]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  const heads = await listCaseTemplateVersionHeads(
    deps.db,
    environmentId,
    page.items.map(({ id }) => id),
  );
  return {
    data: page.items.map((template) =>
      caseTemplateResource(template, heads.get(template.id) ?? { published: null, draft: null }),
    ),
    links: {
      next: nextLink(
        TEMPLATES_PATH,
        {
          'filter[status]': query['filter[status]'],
          'filter[key]': query['filter[key]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** A first draft comes with it (C130.2). */
export async function createCaseTemplate(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseTemplateBody,
): Promise<CaseTemplateDocument> {
  const { environmentId, organizationId } = acting.ctx;
  const attributes = body.data.attributes;
  const visibleToRoles = attributes['visible-to-roles'] ?? [];
  await assertRolesExist(deps.db, organizationId, visibleToRoles);
  const changes = contentChanges(attributes);
  await assertReferencesExist(deps.db, environmentId, changes);
  const taken = await deps.db
    .select({ id: caseTemplates.id })
    .from(caseTemplates)
    .where(
      and(eq(caseTemplates.environmentId, environmentId), eq(caseTemplates.key, attributes.key)),
    )
    .limit(1);
  if (taken.length > 0) {
    throw new CaseProblemError(
      'case_template_key_taken',
      'A template of this environment has this key.',
    );
  }
  try {
    const template = await caseChange(deps, acting, async (unit) => {
      const created = await createCaseTemplateRow(unit.tx, environmentId, {
        id: newId('ctmpl'),
        name: attributes.name,
        key: attributes.key,
        visibleToRoles,
      });
      await createCaseTemplateVersionRow(unit.tx, environmentId, {
        id: newId('ctmplv'),
        caseTemplateId: created.id,
        content: { ...DEFAULT_CONTENT, ...changes },
      });
      await unit.audit({
        action: 'case-template.created',
        resourceType: 'case-template',
        resourceId: created.id,
      });
      return created;
    });
    return await templateDocument(deps.db, environmentId, template);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CaseProblemError(
        'case_template_key_taken',
        'A template of this environment has this key.',
      );
    }
    throw error;
  }
}

export async function getCaseTemplate(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseTemplateDocument> {
  const { environmentId } = acting.ctx;
  return templateDocument(
    deps.db,
    environmentId,
    await requireTemplate(deps.db, environmentId, id),
  );
}

export async function updateCaseTemplate(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseTemplateBody,
): Promise<CaseTemplateDocument> {
  const { environmentId, organizationId } = acting.ctx;
  const attributes = body.data.attributes;
  if (attributes['visible-to-roles'] !== undefined) {
    await assertRolesExist(deps.db, organizationId, attributes['visible-to-roles']);
  }
  const template = await caseChange(deps, acting, async (unit) => {
    if ((await lockCaseTemplateRow(unit.tx, environmentId, id)) === null) {
      throw new NotFoundError(`Case template ${id} was not found.`);
    }
    const changed = await updateCaseTemplateRow(unit.tx, environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes['visible-to-roles'] === undefined
        ? {}
        : { visibleToRoles: attributes['visible-to-roles'] }),
    });
    await unit.audit({
      action: 'case-template.updated',
      resourceType: 'case-template',
      resourceId: id,
      metadata: { attributes: Object.keys(attributes).sort() },
    });
    return changed ?? (await requireTemplate(unit.tx, environmentId, id));
  });
  return templateDocument(deps.db, environmentId, template);
}

/** C130.1: refuses new cases and keeps existing ones. */
export const archiveCaseTemplate: (
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof archiveCaseTemplateBodySchema>,
) => Promise<CaseTemplateDocument> = (deps, acting, id) => archiveTemplate(deps, acting, id);

async function archiveTemplate(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseTemplateDocument> {
  const { environmentId } = acting.ctx;
  const template = await caseChange(deps, acting, async (unit) => {
    const locked = await lockCaseTemplateRow(unit.tx, environmentId, id);
    if (locked === null) {
      throw new NotFoundError(`Case template ${id} was not found.`);
    }
    if (locked.status === 'archived') {
      return locked;
    }
    const archived = await updateCaseTemplateRow(unit.tx, environmentId, id, {
      status: 'archived',
      archivedAt: unit.at,
    });
    await unit.audit({
      action: 'case-template.archived',
      resourceType: 'case-template',
      resourceId: id,
    });
    return archived ?? locked;
  });
  return templateDocument(deps.db, environmentId, template);
}

export async function listCaseTemplateVersions(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseTemplateVersionsQuerySchema>,
): Promise<CaseTemplateVersionListDocument> {
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseTemplateVersionRows(
      deps.db,
      acting.ctx.environmentId,
      {
        caseTemplateIds: filterList(query['filter[case-template-id]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(caseTemplateVersionResource),
    links: {
      next: nextLink(
        VERSIONS_PATH,
        {
          'filter[case-template-id]': query['filter[case-template-id]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** A draft from the template's newest version; the members the body names replace its own. */
export async function createCaseTemplateVersion(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseTemplateVersionBody,
): Promise<CaseTemplateVersionDocument> {
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const templateId = attributes['case-template-id'];
  const changes = contentChanges(attributes);
  await assertReferencesExist(deps.db, environmentId, changes);
  const version = await caseChange(deps, acting, async (unit) => {
    const template = await lockCaseTemplateRow(unit.tx, environmentId, templateId);
    if (template === null) {
      throw new NotFoundError(`Case template ${templateId} was not found.`);
    }
    if (template.status === 'archived') {
      throw new CaseProblemError(
        'case_template_archived',
        'This template is archived; it takes no new version.',
      );
    }
    if ((await getDraftCaseTemplateVersion(unit.tx, environmentId, templateId)) !== null) {
      throw new ConflictError('This template has a draft already; change or publish it.');
    }
    const latest = await getLatestCaseTemplateVersion(unit.tx, environmentId, templateId);
    const created = await createCaseTemplateVersionRow(unit.tx, environmentId, {
      id: newId('ctmplv'),
      caseTemplateId: templateId,
      content: { ...(latest === null ? DEFAULT_CONTENT : contentOfRow(latest)), ...changes },
    });
    await unit.audit({
      action: 'case-template-version.created',
      resourceType: 'case-template-version',
      resourceId: created.id,
    });
    return created;
  });
  return { data: caseTemplateVersionResource(version) };
}

export async function getCaseTemplateVersion(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseTemplateVersionDocument> {
  return {
    data: caseTemplateVersionResource(await requireVersion(deps.db, acting.ctx.environmentId, id)),
  };
}

export async function updateCaseTemplateVersion(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseTemplateVersionBody,
): Promise<CaseTemplateVersionDocument> {
  const { environmentId } = acting.ctx;
  const changes = contentChanges(body.data.attributes);
  await assertReferencesExist(deps.db, environmentId, changes);
  const version = await caseChange(deps, acting, async (unit) => {
    const locked = await lockCaseTemplateVersionRow(unit.tx, environmentId, id);
    if (locked === null) {
      throw new NotFoundError(`Case template version ${id} was not found.`);
    }
    if (locked.status !== 'draft') {
      throw new CaseProblemError(
        'case_template_version_not_draft',
        'A published or superseded version never changes; make a new draft.',
      );
    }
    const updated = await updateCaseTemplateVersionRow(unit.tx, environmentId, id, changes);
    await unit.audit({
      action: 'case-template-version.updated',
      resourceType: 'case-template-version',
      resourceId: id,
      metadata: { attributes: Object.keys(body.data.attributes).sort() },
    });
    return updated ?? locked;
  });
  return { data: caseTemplateVersionResource(version) };
}

/** The top-level field keys and types every earlier version of the template gave. */
async function earlierFieldTypes(
  db: Db,
  environmentId: string,
  templateId: string,
  versionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ fieldSchemas: caseTemplateVersions.fieldSchemas })
    .from(caseTemplateVersions)
    .where(
      and(
        eq(caseTemplateVersions.environmentId, environmentId),
        eq(caseTemplateVersions.caseTemplateId, templateId),
        ne(caseTemplateVersions.id, versionId),
        ne(caseTemplateVersions.status, 'draft'),
      ),
    );
  const types = new Map<string, string>();
  for (const row of rows) {
    for (const field of row.fieldSchemas as FieldSchema[]) {
      types.set(field.key, field.type);
    }
  }
  return types;
}

/**
 * P38: each user told of a new case is a person of this organisation who reads cases and sees the
 * template; the pointers of the others.
 */
async function unreachableRecipients(
  db: Db,
  organizationId: string,
  version: CaseTemplateVersionRow,
  template: CaseTemplateRow,
): Promise<ProblemFieldError[]> {
  if (version.notifyOnCreate.length === 0) {
    return [];
  }
  const listed =
    template.visibleToRoles.length === 0
      ? sql``
      : sql`and ur.role_id in (${sql.join(
          template.visibleToRoles.map((roleId) => sql`${roleId}`),
          sql`, `,
        )})`;
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.id, [...version.notifyOnCreate]),
        // C167.2 (Workflow 9B): a role reaching the template's environment.
        sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id
          where ur.user_id = ${users.id} and 'cases:read' = any(r.permissions) ${listed}
            and ${roleAssignmentReaches(sql`ur`, template.environmentId)})`,
      ),
    );
  const reachable = new Set(found.map(({ id }) => id));
  return version.notifyOnCreate.flatMap((id, index) =>
    reachable.has(id)
      ? []
      : [
          {
            location: 'body',
            pointer: `${ATTRIBUTES}/notify-on-create/${String(index)}`,
            detail: 'Names nobody of this organisation who reads this template’s cases.',
          },
        ],
  );
}

/** C130.2, C130.3: under the template lock; a dropped field fires `case-template.deleted-field`. */
export const publishCaseTemplateVersion: (
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof publishCaseTemplateVersionBodySchema>,
) => Promise<CaseTemplateVersionDocument> = (deps, acting, id) => publishVersion(deps, acting, id);

async function publishVersion(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseTemplateVersionDocument> {
  const { environmentId, organizationId } = acting.ctx;
  const version = await caseChange(deps, acting, async (unit) => {
    const found = await requireVersion(unit.tx, environmentId, id);
    const template = await lockCaseTemplateRow(unit.tx, environmentId, found.caseTemplateId);
    if (template === null) {
      throw new NotFoundError(`Case template version ${id} was not found.`);
    }
    const draft = await lockCaseTemplateVersionRow(unit.tx, environmentId, id);
    if (draft?.status !== 'draft') {
      throw new CaseProblemError(
        'case_template_version_not_draft',
        'Only a draft is published; this version was published already.',
      );
    }
    const fieldSchemas = draft.fieldSchemas as FieldSchema[];
    const errors: ProblemFieldError[] = [
      ...caseFieldSchemaProblems(fieldSchemas).map((problem) => ({
        location: 'body',
        pointer: `${ATTRIBUTES}${problem.pointer}`,
        detail: 'This field schema cannot be published.',
        code: problem.code,
      })),
      ...caseTransitionMapProblems(
        draft.statuses.map(statusDefinitionOf),
        statusMachineOf(draft).transitions,
      ).map((problem) => ({
        location: 'body',
        pointer: `${ATTRIBUTES}${problem.pointer}`,
        detail: 'The statuses and their map cannot be published.',
        code: problem.code,
      })),
    ];
    const earlier = await earlierFieldTypes(unit.tx, environmentId, template.id, id);
    for (const [index, field] of fieldSchemas.entries()) {
      const before = earlier.get(field.key);
      if (before !== undefined && before !== field.type) {
        errors.push({
          location: 'body',
          pointer: `${ATTRIBUTES}/field-schemas/${String(index)}/type`,
          detail: 'A field key keeps its type across versions (C130.3).',
          code: 'field_type_changed',
        });
      }
    }
    errors.push(...(await unreachableRecipients(unit.tx, organizationId, draft, template)));
    // C172.1-C172.3 (Workflow 9B, api-cases-reports): the layout, checklists and required fields.
    errors.push(...versionCompletionProblems(draft, acting.principal.permissions));
    if (errors.length > 0) {
      throw new CaseProblemError('case_template_invalid', 'This version cannot be published.', {
        errors,
      });
    }
    const { published, superseded } = await publishCaseTemplateVersionRow(
      unit.tx,
      environmentId,
      id,
      unit.at,
    );
    const kept = new Set(fieldSchemas.map(({ key }) => key));
    const dropped = ((superseded?.fieldSchemas ?? []) as FieldSchema[])
      .map(({ key }) => key)
      .filter((key) => !kept.has(key));
    if (dropped.length > 0) {
      const heads = await listCaseTemplateVersionHeads(unit.tx, environmentId, [template.id]);
      const resource = caseTemplateResource(
        template,
        heads.get(template.id) ?? { published, draft: null },
      );
      for (const key of dropped) {
        await unit.emit('case-template.deleted-field', {
          data: resource,
          meta: { 'field-key': key, 'version-number': published.version },
        });
      }
    }
    await unit.audit({
      action: 'case-template-version.published',
      resourceType: 'case-template-version',
      resourceId: id,
      metadata: { 'case-template-id': template.id, 'version-number': published.version },
    });
    return published;
  });
  return { data: caseTemplateVersionResource(version) };
}
