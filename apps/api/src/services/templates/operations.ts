/**
 * C154.4-C154.7 (Workflow 9A, `api-templates`): the routes around a template's versions.
 *
 * - `validateTemplateVersion`: a dry run of every rule (in `publish` mode the async publish hooks too)
 *   on the stored version or an unsaved body of the members `PATCH` takes; nothing is stored.
 * - `diffTemplateVersions`: any two versions of one template, keyed by step and edge ids (a v1 flow
 *   through its lossless migration), with the changes that have consequences flagged.
 * - `restoreTemplateVersion`: a new draft copying a version (409 `draft_exists` while one stands).
 * - `copyTemplate`: a new template whose version 1 is the chosen published version (the template
 *   resource always carries a published current version, so the copy is published, as template
 *   creation is; its acknowledgements and every publish rule carry over from that publish).
 * - `templateUsage`: the workflows whose published versions name the template, by name only for a
 *   caller with `workflows:read`, otherwise counted (P34), and the version's embed origins.
 * - `promoteTemplate`: users only, with the rights in both environments; a published version copied
 *   as a draft of the template an earlier promote created (or a new one of the same name), never over
 *   a draft; each list, workflow and theme set re-resolved in the target or `promote_unresolved` at
 *   its pointer; audited in both environments.
 * - `listDeploymentsFor`, `getDeploymentFor`: the deployment history, in the caller's environment.
 */
import { userPermissionsInEnvironment } from '../access/permissions.js';
import {
  idSchema,
  listConfigSchema,
  updateInquiryTemplateVersionAttributesSchema,
  type DeploymentResource,
  type InquiryTemplateResource,
  type ListDeploymentsQuery,
  type TemplateValidation,
  type TEMPLATE_DIFF_CONSEQUENCES,
  verificationConfigSchema,
} from '@openverify/contracts';

type TemplateDiffConsequence = (typeof TEMPLATE_DIFF_CONSEQUENCES)[number];
import {
  createDraftInquiryTemplateVersion,
  createInquiryTemplate as insertInquiryTemplate,
  createInquiryTemplateWithDraft,
  findPromotedTemplateId,
  findTemplateDraft,
  findWorkflowReferences,
  getDeployment,
  getEnvironment,
  getInquiryTemplate as findInquiryTemplate,
  getInquiryTemplateRow,
  getInquiryTemplateVersion,
  getLists,
  getWorkflow,
  listDeployments,
  listPublishedWorkflowVersions,
  listWorkflows,
  recordInquiryTemplatePromotionInTx,
  type Db,
  type InquiryTemplateVersion,
  type TemplateVersionInput,
} from '@openverify/db';
import { canonicalJson, migrateFlow, safeParseAnyFlow, type FlowV2 } from '@openverify/flow-spec';
import type { Permission } from '@openverify/core';
import type { Principal } from '../../ports.js';
import {
  AppError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  TemplateProblemError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { referencesIn } from '../../workflows/publish/references.js';
import type { ApiDependencies } from '../context.js';
import {
  answerOf,
  assertPublishable,
  audit,
  deployInTx,
  deploymentResourceOf,
  findVersion,
  inquiryTemplateResource,
  membersOf,
  storedListConfig,
  storedReportConfig,
  storedSignalConfig,
  validateDraftInTx,
  type TemplateActing,
  type VersionAnswer,
} from '../inquiry-templates.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { flowPublishReport } from '../publish/flow-v2.js';
import { storedFlowView } from '../stored-flow.js';
import { promoteThemeReferenceInTx } from '../themes/promote.js';
import { servedLocaleReviewStatus } from './locale-review.js';
import {
  flowSha256Of,
  saveRuleProblems,
  validationOf,
  versionEventResourceOf,
  type TemplateRuleProblem,
} from './versions.js';
import { connectEnabled } from '../connect/switch.js';

const DEPLOYMENTS_PATH = '/api/v1/deployments';

// Deployments (C154.7) --------------------------------------------------------------------------

/** `GET /deployments`: newest first; another environment's id answers an empty list (H23). */
export async function listDeploymentsFor(
  { db }: ApiDependencies,
  environmentId: string,
  query: ListDeploymentsQuery,
): Promise<{ data: DeploymentResource[]; links: { next: string | null } }> {
  const filters = {
    'filter[inquiry-template-id]': query['filter[inquiry-template-id]'],
    'filter[environment-id]': query['filter[environment-id]'],
  };
  const environments = query['filter[environment-id]']?.split(',');
  if (environments !== undefined && !environments.includes(environmentId)) {
    return { data: [], links: { next: null } };
  }
  const templateIds = query['filter[inquiry-template-id]']?.split(',');
  const page = await withCursor(() =>
    listDeployments(db, environmentId, {
      ...pageRequest(query),
      ...(templateIds === undefined ? {} : { inquiryTemplateId: templateIds }),
    }),
  );
  return {
    data: page.items.map(deploymentResourceOf),
    links: { next: nextLink(DEPLOYMENTS_PATH, filters, query, page.next) },
  };
}

/** `GET /deployments/:id`. @throws {NotFoundError} outside the caller's environment. */
export async function getDeploymentFor(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<DeploymentResource> {
  const deployment = await getDeployment(db, environmentId, id);
  if (deployment === null) {
    throw new NotFoundError(`Deployment ${id} was not found.`);
  }
  return deploymentResourceOf(deployment);
}

// Validate (C154.4) -----------------------------------------------------------------------------

export interface ValidationDocument {
  data: {
    type: 'inquiry-template-version-validation';
    id: string;
    attributes: {
      validation: TemplateValidation;
      'flow-sha256': string | null;
      'acknowledgements-required': string[];
    };
  };
}

/** The version with an unsaved body applied over it, never stored. */
function withUnsaved(
  version: InquiryTemplateVersion,
  attributes: Record<string, unknown> | undefined,
  acting: TemplateActing,
): InquiryTemplateVersion {
  if (attributes === undefined) {
    return version;
  }
  const parsed = updateInquiryTemplateVersionAttributesSchema.safeParse(attributes);
  if (!parsed.success) {
    throw new UnprocessableContentError(
      'The unsaved body is not a body PATCH takes.',
      parsed.error.issues.map((issue) => ({
        location: 'body',
        pointer: `/data/attributes/${issue.path.map(String).join('/')}`,
        detail: issue.message,
      })),
    );
  }
  const body = parsed.data;
  return {
    ...version,
    ...(body.flow === undefined ? {} : { flow: body.flow }),
    ...(body['verification-config'] === undefined
      ? {}
      : { verificationConfig: body['verification-config'] }),
    ...(body.settings === undefined ? {} : { settings: body.settings }),
    ...(body['report-config'] === undefined ? {} : { reportConfig: body['report-config'] }),
    ...(body['signal-config'] === undefined ? {} : { signalConfig: body['signal-config'] }),
    ...(body['list-config'] === undefined ? {} : { listConfig: body['list-config'] }),
    ...(membersOf(body, acting) as Partial<InquiryTemplateVersion>),
  };
}

/** The problems a publish hook refused with, as validation problems (never thrown here). */
async function hookProblems(
  deps: ApiDependencies,
  acting: TemplateActing,
  version: InquiryTemplateVersion,
): Promise<TemplateRuleProblem[]> {
  try {
    await assertPublishable(
      deps,
      deps.db,
      acting.ctx.environmentId,
      storedFlowView(version.flow),
      verificationConfigSchema.parse(version.verificationConfig),
      storedReportConfig(version),
      storedSignalConfig(version),
      storedListConfig(version),
      acting.actor,
      version.themeSetId,
    );
    return [];
  } catch (thrown) {
    if (!(thrown instanceof AppError)) {
      throw thrown;
    }
    const errors: readonly ProblemFieldError[] = thrown.errors ?? [];
    return errors.map(({ pointer, detail, code }) => ({
      pointer: pointer.replace(/^\/data\/attributes/u, ''),
      code: code ?? thrown.code ?? 'publish_rule',
      detail,
      severity: 'error' as const,
    }));
  }
}

/** `POST /inquiry-template-versions/:id/validate`: every rule, nothing stored (C154.4). */
export async function validateTemplateVersion(
  deps: ApiDependencies,
  acting: TemplateActing,
  id: string,
  body: {
    data?: { attributes: Record<string, unknown> } | undefined;
    meta?: { mode?: 'save' | 'publish' | undefined } | undefined;
  },
): Promise<ValidationDocument> {
  const stored = await findVersion(deps.db, acting.ctx.environmentId, id);
  const version = withUnsaved(stored, body.data?.attributes, acting);
  const environment = { id: acting.ctx.environmentId, kind: acting.environmentKind };
  const report = await flowPublishReport(deps.db, {
    environment,
    templateId: version.inquiryTemplateId,
    version,
    // C211.9 (Workflow 10B): play_integrity_notice_missing applies while the kind binds one.
    deviceIntegrityBound: deps.providers[acting.environmentKind].deviceIntegrity !== undefined,
    // C231.10 (Workflow 11A Stage 1b (K)): the install switch the Connect publish checks read.
    connectEnabled: connectEnabled(deps.connect),
  });
  const problems =
    body.meta?.mode === 'publish'
      ? [...report.problems, ...(await hookProblems(deps, acting, version))]
      : await saveRuleProblems(
          deps.db,
          { environmentKind: acting.environmentKind },
          { environmentId: environment.id, templateId: version.inquiryTemplateId, version },
        );
  const flow = safeParseAnyFlow(version.flow);
  return {
    data: {
      type: 'inquiry-template-version-validation',
      id,
      attributes: {
        validation: validationOf(problems),
        'flow-sha256': flow.success ? flowSha256Of(flow.data) : null,
        'acknowledgements-required': report.acknowledgements.map(({ key }) => key),
      },
    },
  };
}

// Diff (C154.6) ---------------------------------------------------------------------------------

interface Change {
  pointer: string;
  before: unknown;
  after: unknown;
}

const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** The leaf changes between two JSON values, by pointer under `base`. */
function changesOf(before: unknown, after: unknown, base = ''): Change[] {
  if (canonicalJson(before ?? null) === canonicalJson(after ?? null)) {
    return [];
  }
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => changesOf(before[key], after[key], `${base}/${escape(key)}`));
  }
  return [{ pointer: base === '' ? '/' : base, before: before ?? null, after: after ?? null }];
}

function flowV2Of(version: InquiryTemplateVersion): FlowV2 | null {
  const parsed = safeParseAnyFlow(version.flow);
  return parsed.success ? migrateFlow(parsed.data) : null;
}

type Checks = Record<
  string,
  { checks?: Record<string, { enabled?: boolean; required?: boolean }> }
>;

/** `GET /inquiry-template-versions/:id/diff?against=` (C154.6). */
export async function diffTemplateVersions(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
  against: string,
) {
  const to = await findVersion(db, environmentId, id);
  const from = await findVersion(db, environmentId, against);
  if (from.inquiryTemplateId !== to.inquiryTemplateId) {
    throw new NotFoundError(`Version ${against} is not a version of this template.`);
  }
  const before = flowV2Of(from);
  const after = flowV2Of(to);
  const stepsBefore = new Map((before?.steps ?? []).map((step) => [step.id, step]));
  const stepsAfter = new Map((after?.steps ?? []).map((step) => [step.id, step]));
  const edgesBefore = new Map((before?.edges ?? []).map((edge) => [edge.id, edge]));
  const edgesAfter = new Map((after?.edges ?? []).map((edge) => [edge.id, edge]));
  const changed = [...stepsAfter.entries()].flatMap(([stepId, step]) => {
    const old = stepsBefore.get(stepId);
    const changes = old === undefined ? [] : changesOf(old, step);
    return changes.length === 0 ? [] : [{ 'step-id': stepId, changes }];
  });
  const routeOrder = [...stepsAfter.values()].flatMap((step) => {
    const old = stepsBefore.get(step.id);
    if (step.type !== 'branch' || old?.type !== 'branch') return [];
    const keys = (routes: readonly { key: string }[]) => routes.map(({ key }) => key).join(',');
    return keys(step.routes) === keys(old.routes) ? [] : [step.id];
  });
  const consequences: { code: TemplateDiffConsequence; pointer: string }[] = [];
  const configBefore = from.verificationConfig as Checks;
  const configAfter = to.verificationConfig as Checks;
  for (const [type, typeConfig] of Object.entries(configBefore)) {
    for (const [name, check] of Object.entries(typeConfig.checks ?? {})) {
      const next = configAfter[type]?.checks?.[name];
      if (
        check.enabled === true &&
        check.required === true &&
        !(next?.enabled === true && next.required === true)
      ) {
        consequences.push({
          code: 'required_check_relaxed',
          pointer: `/verification-config/${escape(type)}/checks/${escape(name)}`,
        });
      }
    }
  }
  const verificationTypes = (flow: FlowV2 | null) =>
    new Map(
      (flow?.steps ?? [])
        .filter(
          (step) =>
            ![
              'consent',
              'screen',
              'branch',
              'action',
              'completion',
              'failure',
              'device_handoff',
            ].includes(step.type),
        )
        .map((step) => [step.type, step.id]),
    );
  for (const [type, stepId] of verificationTypes(before)) {
    if (!verificationTypes(after).has(type)) {
      consequences.push({
        code: 'verification_step_removed',
        pointer: `/flow/steps/${escape(stepId)}`,
      });
    }
  }
  const consentOf = (flow: FlowV2 | null) =>
    canonicalJson((flow?.steps ?? []).filter((step) => step.type === 'consent'));
  const consentCopy = (version: InquiryTemplateVersion) =>
    canonicalJson(
      Object.fromEntries(
        Object.entries(
          (version.copy as { messages?: Record<string, Record<string, string>> }).messages ?? {},
        ).map(([locale, texts]) => [
          locale,
          Object.fromEntries(Object.entries(texts).filter(([key]) => key.startsWith('consent.'))),
        ]),
      ),
    );
  if (consentOf(before) !== consentOf(after) || consentCopy(from) !== consentCopy(to)) {
    consequences.push({ code: 'consent_text_changed', pointer: '/flow' });
  }
  for (const locale of to.enabledLocales) {
    // R004: the status the locale is served with, held to its catalog now.
    const status = servedLocaleReviewStatus(locale).status;
    if (!from.enabledLocales.includes(locale) && status !== 'source' && status !== 'reviewed') {
      consequences.push({ code: 'unreviewed_locale_enabled', pointer: '/enabled-locales' });
    }
  }
  const sections = {
    'verification-config': changesOf(
      from.verificationConfig,
      to.verificationConfig,
      '/verification-config',
    ),
    settings: changesOf(from.settings, to.settings, '/settings'),
    'report-config': changesOf(from.reportConfig, to.reportConfig, '/report-config'),
    'field-schemas': changesOf(from.fieldSchemas, to.fieldSchemas, '/field-schemas'),
    copy: changesOf(from.copy, to.copy, '/copy'),
    locales: [
      ...changesOf(from.enabledLocales, to.enabledLocales, '/enabled-locales'),
      ...changesOf(from.defaultLocale, to.defaultLocale, '/default-locale'),
    ],
  };
  const steps = {
    added: [...stepsAfter.keys()].filter((key) => !stepsBefore.has(key)),
    removed: [...stepsBefore.keys()].filter((key) => !stepsAfter.has(key)),
    changed,
  };
  const edges = {
    added: [...edgesAfter.keys()].filter((key) => !edgesBefore.has(key)),
    removed: [...edgesBefore.keys()].filter((key) => !edgesAfter.has(key)),
    retargeted: [...edgesAfter.entries()]
      .filter(([key, edge]) => {
        const old = edgesBefore.get(key);
        return old !== undefined && canonicalJson(old) !== canonicalJson(edge);
      })
      .map(([key]) => key),
  };
  const themeSet =
    from.themeSetId === to.themeSetId
      ? null
      : { pointer: '/theme-set-id', before: from.themeSetId, after: to.themeSetId };
  const substantive =
    steps.added.length +
      steps.removed.length +
      steps.changed.length +
      edges.added.length +
      edges.removed.length +
      edges.retargeted.length +
      routeOrder.length +
      Object.values(sections).reduce((count, list) => count + list.length, 0) +
      consequences.length >
      0 || themeSet !== null;
  const layoutChanged =
    canonicalJson(before?.layout ?? null) !== canonicalJson(after?.layout ?? null);
  return {
    data: {
      type: 'inquiry-template-version-diff' as const,
      id: `${id}..${against}`,
      attributes: {
        'from-version-id': against,
        'to-version-id': id,
        steps,
        edges,
        'route-order': routeOrder,
        ...sections,
        'theme-set-id': themeSet,
        'layout-only': layoutChanged && !substantive,
        consequences,
      },
    },
  };
}

// Restore and copy (C154.4) ---------------------------------------------------------------------

/** The content of `version` as a new version's input, its publish-time members left out. */
export function contentOf(version: InquiryTemplateVersion, id: string): TemplateVersionInput {
  return {
    id,
    flow: version.flow,
    verificationConfig: version.verificationConfig,
    settings: version.settings,
    reportConfig: version.reportConfig,
    signalConfig: version.signalConfig,
    listConfig: version.listConfig,
    members: {
      fieldSchemas: version.fieldSchemas,
      copy: version.copy,
      enabledLocales: version.enabledLocales,
      defaultLocale: version.defaultLocale,
      themeSetId: version.themeSetId,
      embedOrigins: version.embedOrigins,
      redirectUri: version.redirectUri,
      redirectUriSchemes: version.redirectUriSchemes,
      redirectIncludeStatus: version.redirectIncludeStatus,
      helpUrl: version.helpUrl,
      privacyUrl: version.privacyUrl,
      description: version.description,
    },
  };
}

/** A version of the template in this environment. @throws {NotFoundError} otherwise. */
async function versionOfTemplate(
  db: Db,
  environmentId: string,
  templateId: string,
  versionId: string,
): Promise<InquiryTemplateVersion> {
  const version = await getInquiryTemplateVersion(db, environmentId, versionId);
  if (version?.inquiryTemplateId !== templateId) {
    throw new NotFoundError(`Version ${versionId} is not a version of template ${templateId}.`);
  }
  return version;
}

const draftExists = () =>
  new TemplateProblemError('draft_exists', 'The template has a draft; publish or edit it first.');

/** `POST /inquiry-templates/:id/restore`: a new draft copying `meta.version-id` (C154.4). */
export async function restoreTemplateVersion(
  deps: ApiDependencies,
  acting: TemplateActing,
  templateId: string,
  versionId: string,
): Promise<VersionAnswer> {
  const { environmentId } = acting.ctx;
  const staged: StagedEvent[] = [];
  const version = await deps.db.transaction(async (tx) => {
    if ((await getInquiryTemplateRow(tx, environmentId, templateId)) === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    const source = await versionOfTemplate(tx, environmentId, templateId, versionId);
    if ((await findTemplateDraft(tx, environmentId, templateId)) !== null) {
      throw draftExists();
    }
    const input = contentOf(source, deps.ids.newId('itmplv'));
    const draft = await createDraftInquiryTemplateVersion(tx, environmentId, templateId, {
      ...input,
      members: { ...input.members, lastUpdater: membersOf({}, acting).lastUpdater ?? null },
    });
    if (draft === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    // A restored version may break a rule added since: it is stored with its problems.
    const validated = await validateDraftInTx(tx, acting, draft, true);
    staged.push(
      await deps.events.stage(tx, {
        environmentId,
        name: 'inquiry-template-version.created',
        payload: { data: versionEventResourceOf(validated) },
      }),
    );
    await audit(deps, tx, acting, {
      action: 'inquiry-template-version.created',
      resourceType: 'inquiry-template-version',
      resourceId: draft.id,
      metadata: { 'inquiry-template-id': templateId, 'restored-from-version-id': versionId },
    });
    return validated;
  });
  await deps.events.dispatch(staged);
  return answerOf(version);
}

/** `POST /inquiry-templates/:id/copy`: a new template from a published version (C154.4). */
export async function copyTemplate(
  deps: ApiDependencies,
  acting: TemplateActing,
  templateId: string,
  meta: { name: string; 'version-id'?: string | undefined },
): Promise<InquiryTemplateResource> {
  const { environmentId } = acting.ctx;
  const staged: StagedEvent[] = [];
  const template = await deps.db.transaction(async (tx) => {
    const sourceTemplate = await findInquiryTemplate(tx, environmentId, templateId);
    if (sourceTemplate === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    const source =
      meta['version-id'] === undefined
        ? sourceTemplate.currentVersion
        : await versionOfTemplate(tx, environmentId, templateId, meta['version-id']);
    if (source.status === 'draft') {
      throw new InvalidTransitionError(
        'A copy is made from a published version: publish the draft first, or copy another version.',
      );
    }
    const input = contentOf(source, deps.ids.newId('itmplv'));
    const created = await insertInquiryTemplate(tx, environmentId, {
      id: deps.ids.newId('itmpl'),
      name: meta.name,
      version: {
        ...input,
        members: {
          ...input.members,
          lastUpdater: membersOf({}, acting).lastUpdater ?? null,
          validation: source.validation,
          flowSha256: source.flowSha256,
          acknowledgements: source.acknowledgements,
          // C152.2 (foundation-9b F3): the run grants its publish recorded, as its acknowledgements.
          flowRunGrants: source.flowRunGrants,
        },
      },
    });
    await deployInTx(deps, tx, acting, created.currentVersion, staged);
    await audit(deps, tx, acting, {
      action: 'inquiry-template.created',
      resourceType: 'inquiry-template',
      resourceId: created.id,
      metadata: { 'copied-from-template-id': templateId, 'copied-from-version-id': source.id },
    });
    return created;
  });
  await deps.events.dispatch(staged);
  return inquiryTemplateResource(template);
}

// Used by (C154.4) ------------------------------------------------------------------------------

/** `GET /inquiry-templates/:id/used-by`: named only where the caller can read (P34). */
export async function templateUsage(
  { db }: ApiDependencies,
  principal: Principal,
  templateId: string,
) {
  const template = await findInquiryTemplate(db, principal.environmentId, templateId);
  if (template === null) {
    throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
  }
  const named: { id: string; name: string }[] = [];
  let after: string | undefined;
  do {
    const page = await listWorkflows(
      db,
      principal.environmentId,
      {},
      {
        size: 100,
        ...(after === undefined ? {} : { after }),
      },
    );
    for (const workflow of page.items) {
      const versions = await listPublishedWorkflowVersions(
        db,
        principal.environmentId,
        workflow.id,
      );
      const names = versions.some((version) =>
        referencesIn(version.definition as never).some(({ id }) => id === templateId),
      );
      if (names) named.push({ id: workflow.id, name: workflow.name });
    }
    after = page.next ?? undefined;
  } while (after !== undefined);
  const readable = principal.permissions.has('workflows:read');
  return {
    data: {
      type: 'inquiry-template-usage' as const,
      id: templateId,
      attributes: {
        workflows: readable ? named : [],
        'workflows-hidden': readable ? 0 : named.length,
        'report-templates': [],
        'report-templates-hidden': 0,
        'case-templates': [],
        'case-templates-hidden': 0,
        'embed-origins': template.currentVersion.embedOrigins,
      },
    },
  };
}

// Promote (C154.5) ------------------------------------------------------------------------------

/** One reference the target environment could not resolve, at its pointer. */
function unresolved(pointer: string, detail: string): ProblemFieldError {
  return {
    location: 'body',
    pointer: `/data/attributes${pointer}`,
    detail,
    code: 'promote_unresolved',
  };
}

/** The version's references re-resolved in the target (lists by kind and name, workflows by name). */
async function resolveReferences(
  db: Db,
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  version: InquiryTemplateVersion,
): Promise<{ input: Partial<TemplateVersionInput>; problems: ProblemFieldError[] }> {
  const problems: ProblemFieldError[] = [];
  const listConfig = listConfigSchema.parse(version.listConfig);
  let screen = listConfig.screen;
  if (Array.isArray(screen)) {
    const sources = await getLists(db, sourceEnvironmentId, screen);
    const resolved: string[] = [];
    for (const [index, listId] of screen.entries()) {
      const source = sources.find((list) => list.id === listId);
      const named =
        source === undefined
          ? []
          : await findWorkflowReferences(db, targetEnvironmentId, 'list', source.name);
      const candidates = (
        await getLists(
          db,
          targetEnvironmentId,
          named.map(({ id }) => id),
        )
      ).filter((list) => list.type === source?.type);
      const [only] = candidates;
      if (only === undefined || candidates.length > 1) {
        problems.push(
          unresolved(
            `/list-config/screen/${String(index)}`,
            candidates.length > 1
              ? 'Several lists of this kind and name.'
              : 'No list of this kind and name.',
          ),
        );
      } else {
        resolved.push(only.id);
      }
    }
    screen = resolved;
  }
  const flow = safeParseAnyFlow(version.flow);
  let promotedFlow: unknown = version.flow;
  if (flow.success && 'edges' in flow.data) {
    const steps = await Promise.all(
      flow.data.steps.map(async (step, index) => {
        if (step.type !== 'action' || step.action.kind !== 'run_workflow') return step;
        const action = step.action as { workflowId: string; version: string };
        const workflow = await getWorkflow(db, sourceEnvironmentId, action.workflowId);
        const named =
          workflow === null
            ? []
            : await findWorkflowReferences(db, targetEnvironmentId, 'workflow', workflow.name);
        const [only] = named;
        if (only === undefined || named.length > 1 || action.version !== 'latest-published') {
          problems.push(
            unresolved(
              `/flow/steps/${String(index)}/action/workflowId`,
              'No single workflow of this name, or a pinned version, in the target.',
            ),
          );
          return step;
        }
        return { ...step, action: { ...step.action, workflowId: only.id } };
      }),
    );
    promotedFlow = { ...flow.data, steps };
  }
  return {
    input: {
      listConfig: { ...listConfig, screen },
      flow: promotedFlow as Record<string, unknown>,
    },
    problems,
  };
}

/** `POST /inquiry-templates/:id/promote` (C154.5). */
export async function promoteTemplate(
  deps: ApiDependencies,
  acting: TemplateActing,
  principal: Principal,
  templateId: string,
  meta: { 'environment-id': string; 'version-id'?: string | undefined },
): Promise<VersionAnswer & { copied: { type: 'theme-set'; id: string }[] }> {
  if (principal.kind !== 'user') {
    throw new ForbiddenError('A person promotes a template: an API key cannot.');
  }
  const sourceEnvironmentId = acting.ctx.environmentId;
  const targetEnvironmentId = idSchema('env').parse(meta['environment-id']);
  const target = await getEnvironment(deps.db, targetEnvironmentId);
  if (
    target?.organizationId !== acting.ctx.organizationId ||
    targetEnvironmentId === sourceEnvironmentId
  ) {
    throw new NotFoundError(`Environment ${targetEnvironmentId} was not found.`);
  }
  const production = target.kind === 'production' || acting.environmentKind === 'production';
  const required: readonly Permission[] = [
    'inquiry-templates:write',
    ...(production ? (['environments:production'] as const) : []),
  ];
  // C167.2 (Workflow 9B): the session's permissions are the source environment's; the target's
  // are read from the user's stored assignments, so a narrower role never carries a promote.
  const targetPermissions = await userPermissionsInEnvironment(
    deps.db,
    principal,
    targetEnvironmentId,
  );
  if (
    required.some(
      (permission) => !principal.permissions.has(permission) || !targetPermissions.has(permission),
    )
  ) {
    throw new ForbiddenError('A promote needs the rights in both environments.');
  }
  const staged: StagedEvent[] = [];
  const result = await deps.db.transaction(async (tx) => {
    const sourceTemplate = await findInquiryTemplate(tx, sourceEnvironmentId, templateId);
    if (sourceTemplate === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    const source =
      meta['version-id'] === undefined
        ? sourceTemplate.currentVersion
        : await versionOfTemplate(tx, sourceEnvironmentId, templateId, meta['version-id']);
    if (source.status === 'draft') {
      throw new InvalidTransitionError('A promote copies a published version.');
    }
    const { input: resolved, problems } = await resolveReferences(
      tx,
      sourceEnvironmentId,
      targetEnvironmentId,
      source,
    );
    const theme = await promoteThemeReferenceInTx(tx, {
      sourceEnvironmentId,
      targetEnvironmentId,
      themeSetId: source.themeSetId,
      actor: acting.actor,
      mayWriteThemeSets: targetPermissions.has('theme-sets:write'),
      // K9-32 (P5): a set's logo and font are copied as stored (re-sealed, never re-uploaded).
      assets: { storage: deps.storage, keyring: deps.keyring, ids: deps.ids },
    });
    if (problems.length > 0) {
      throw new TemplateProblemError(
        'promote_unresolved',
        'A reference has no single match in the target environment.',
        problems,
      );
    }
    const base = contentOf(source, deps.ids.newId('itmplv'));
    const input: TemplateVersionInput = {
      ...base,
      ...resolved,
      members: {
        ...base.members,
        themeSetId: theme.themeSetId,
        lastUpdater: { type: 'user', id: principal.userId },
      },
    };
    const existing = await findPromotedTemplateId(tx, targetEnvironmentId, templateId);
    let draft: InquiryTemplateVersion | null;
    if (existing === null) {
      draft = await createInquiryTemplateWithDraft(tx, targetEnvironmentId, {
        id: deps.ids.newId('itmpl'),
        name: sourceTemplate.name,
        version: input,
      });
    } else {
      if ((await findTemplateDraft(tx, targetEnvironmentId, existing)) !== null) {
        throw draftExists();
      }
      draft = await createDraftInquiryTemplateVersion(tx, targetEnvironmentId, existing, input);
    }
    if (draft === null) {
      throw new NotFoundError('The promoted template is gone.');
    }
    await recordInquiryTemplatePromotionInTx(tx, targetEnvironmentId, {
      templateId: draft.inquiryTemplateId,
      versionId: draft.id,
      sourceEnvironmentId,
      sourceTemplateId: templateId,
      sourceVersionId: source.id,
      promotedBy: principal.userId,
    });
    const targetActing: TemplateActing = {
      ...acting,
      ctx: { ...acting.ctx, environmentId: targetEnvironmentId },
      environmentKind: target.kind,
    };
    const validated = await validateDraftInTx(tx, targetActing, draft, true);
    staged.push(
      await deps.events.stage(tx, {
        environmentId: targetEnvironmentId,
        name: 'inquiry-template-version.created',
        payload: { data: versionEventResourceOf(validated) },
      }),
    );
    const metadata = {
      'source-environment-id': sourceEnvironmentId,
      'target-environment-id': targetEnvironmentId,
      'source-version-id': source.id,
      'target-version-id': draft.id,
      'copied-theme-set': theme.copied,
    };
    await audit(deps, tx, acting, {
      action: 'inquiry-template.promoted',
      resourceType: 'inquiry-template',
      resourceId: templateId,
      metadata,
    });
    await audit(deps, tx, targetActing, {
      action: 'inquiry-template.promoted',
      resourceType: 'inquiry-template',
      resourceId: draft.inquiryTemplateId,
      metadata,
    });
    const copied: { type: 'theme-set'; id: string }[] =
      theme.copied && theme.themeSetId !== null
        ? [{ type: 'theme-set', id: theme.themeSetId }]
        : [];
    return { version: validated, copied };
  });
  await deps.events.dispatch(staged);
  return { ...answerOf(result.version), copied: result.copied };
}
