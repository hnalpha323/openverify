/**
 * Inquiry templates (C2, C11): a flow plus a verification config and settings, versioned.
 * Version 1 is published when the template is created; later versions start as drafts, which
 * are edited and then published, superseding the previous published version. Inquiries pin
 * the version that was current when they were created, so publishing never changes them.
 * Settings are stored as sent; reads apply the defaults (`resolveTemplateSettings`).
 */
import {
  reportConfigSchema,
  listConfigSchema,
  signalConfigSchema,
  type ReportConfig,
  type ListConfig,
  type SignalConfig,
  buildInquiryTemplateResource,
  buildInquiryTemplateVersionResource,
  filterValues,
  idSchema,
  TEMPLATE_PROBLEM_STATUSES,
  inquiryTemplateVersionStatusSchema,
  resolveTemplateSettings,
  templatePublishProblems,
  templateSettingsSchema,
  verificationConfigSchema,
  type AuditActor,
  type CreateInquiryTemplateAttributes,
  type CreateInquiryTemplateVersionBody,
  type InquiryTemplateResource,
  type InquiryTemplateVersionResource,
  type ResolvedTemplateSettings,
  type UpdateInquiryTemplateBody,
  type UpdateInquiryTemplateVersionBody,
  type VerificationConfig,
  templateValidationSchema,
  buildDeploymentResource,
  type DeploymentResource,
  type TemplateAcknowledgement,
  type TemplateValidation,
} from '@openverify/contracts';
import type { FlowRunGrantRecord } from '@openverify/core';
import { isFlowV2, type AnyFlow, type Flow } from '@openverify/flow-spec';
import {
  createDraftInquiryTemplateVersion,
  createInquiryTemplate as insertInquiryTemplate,
  createInquiryTemplateWithDraft,
  getEnvironment,
  getInquiryTemplate as findInquiryTemplate,
  getInquiryTemplateVersion,
  lockInquiryTemplateVersionInTx,
  createDeploymentInTx,
  latestDeploymentOfTemplate,
  type Deployment,
  type TemplateVersionMembers,
  listInquiryTemplates as findInquiryTemplates,
  listInquiryTemplateVersions as findInquiryTemplateVersions,
  publishInquiryTemplateVersion,
  updateDraftInquiryTemplateVersion,
  updateInquiryTemplate as updateInquiryTemplateRow,
  type Db,
  type Inquiry,
  type InquiryTemplateVersion,
  type InquiryTemplateWithVersion,
} from '@openverify/db';
import {
  InvalidTransitionError,
  NotFoundError,
  ListProblemError,
  Phase5ProblemError,
  ReportProblemError,
  SignalProblemError,
  TemplateProblemError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../errors.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from './context.js';
import type { Acting } from './inquiries.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';
import { reportConfigPublishProblems } from './publish/report-config.js';
import { handoffPublishProblems } from './publish/handoff.js';
import { listConfigPublishProblems } from './publish/list-config.js';
import { signalConfigPublishProblems } from './publish/signal-config.js';
import { publishHookProblems } from './publish/index.js';
import { flowActionGrantProblems, flowActionPublishGrants } from '../flow-actions/grants.js';
import { storedAnyFlow, storedFlowView } from './stored-flow.js';
import { normaliseCopy } from './templates/copy-rules.js';
import { flowPublishReport } from './publish/flow-v2.js';
import type { StagedEvent } from '../events/index.js';
import {
  flowSha256Of,
  phase9MembersOf,
  saveRuleProblems,
  validationOf,
  versionEtagOf,
  versionEventResourceOf,
  type TemplateRuleProblem,
} from './templates/versions.js';
import { connectEnabled } from './connect/switch.js';

export const INQUIRY_TEMPLATES_PATH = '/api/v1/inquiry-templates';
export const INQUIRY_TEMPLATE_VERSIONS_PATH = '/api/v1/inquiry-template-versions';

/** Who changes a template: the tenant, request metadata and the audit actor. */
export type TemplateActing = Pick<Acting, 'ctx' | 'actor' | 'environmentKind'>;

/** C42.3: the optional consent text that allows comparing a selfie with earlier ones. */
export const MATCHING_CONSENT_TEXT_KEY = 'consent.biometric-matching';

/** C42.3: the checks that compare a selfie with other inquiries' face data. */
export const MATCHING_CONSENT_CHECKS = [
  'selfie_repeat_detection',
  'selfie_account_comparison',
  'selfie_similar_background_detection',
] as const;

/**
 * C42.3: a version that requires a check comparing selfies with other inquiries' face data is
 * published only when `consent.biometric-matching` is a required consent text, so every user it
 * verifies has agreed to the comparison. Returns one problem per such check, pointing at its
 * `required` flag; none when the rule holds.
 */
export function matchingConsentProblems(
  flow: Flow,
  config: VerificationConfig,
): ProblemFieldError[] {
  const consent = flow.steps.find((step) => step.type === 'consent');
  if (consent?.textKeys.includes(MATCHING_CONSENT_TEXT_KEY) === true) {
    return [];
  }
  const checks = config.selfie?.checks ?? {};
  return MATCHING_CONSENT_CHECKS.filter((check) => checks[check]?.required === true).map(
    (check) => ({
      location: 'body',
      pointer: `/data/attributes/verification-config/selfie/checks/${check}/required`,
      detail: `${check} may be required only when ${MATCHING_CONSENT_TEXT_KEY} is a required consent text.`,
    }),
  );
}

/**
 * @throws {UnprocessableContentError} when publishing `flow` and `config` would break the
 *   C42.3 matching consent rule, or a C50.4 publish rule (`templatePublishProblems`), with a JSON
 *   Pointer to each problem.
 * @throws {Phase5ProblemError} `otp_channel_not_configured` or `provider_not_configured` when a
 *   present type's async publish hook (`services/publish/`, C54.1) finds a rule broken in this
 *   environment, with a pointer to each problem.
 */
export async function assertPublishable(
  deps: ApiDependencies,
  db: Db,
  environmentId: string,
  flow: Flow,
  config: VerificationConfig,
  reportConfig: ReportConfig,
  signalConfig: SignalConfig,
  listConfig: ListConfig,
  publisher: AuditActor,
  themeSetId?: string | null,
): Promise<void> {
  const problems = matchingConsentProblems(flow, config);
  if (problems.length > 0) {
    throw new UnprocessableContentError(
      `A required check that compares selfies with earlier ones needs ${MATCHING_CONSENT_TEXT_KEY} as a required consent text.`,
      problems,
    );
  }
  const broken = templatePublishProblems(flow, config);
  if (broken.length > 0) {
    throw new UnprocessableContentError(
      'The template breaks a rule it must meet to be published.',
      broken.map(({ pointer, detail }) => ({
        location: 'body',
        pointer: `/data/attributes${pointer}`,
        detail,
      })),
    );
  }
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new NotFoundError('The environment no longer exists.');
  }
  // C152.2 (Workflow 9A Stage 1b (S); review F17): the publisher holds every `run_workflow` step's
  // grant (`flowActionGrantProblems`, `api-flow-actions`); each refusal points into the attributes.
  const grants = await flowActionGrantProblems({ db, environmentId, flow, publisher });
  const [refusedGrant] = grants;
  if (refusedGrant !== undefined) {
    throw new UnprocessableContentError(
      refusedGrant.detail,
      grants.map(({ pointer, detail }) => ({
        location: 'body',
        pointer: `/data/attributes${pointer}`,
        detail,
      })),
    );
  }
  const hooked = await publishHookProblems({
    deps,
    db,
    environment: { id: environment.id, kind: environment.kind },
    flow,
    config,
    ...(themeSetId === undefined ? {} : { themeSetId }),
  });
  const [first] = hooked;
  if (first !== undefined) {
    throw new Phase5ProblemError(first.code, first.detail, {
      errors: hooked.map(({ pointer, detail }) => ({
        location: 'body',
        pointer: `/data/attributes${pointer}`,
        detail,
      })),
    });
  }
  // C84.1 (F07): each report the version runs on completion names a published report template.
  const unpublished = await reportConfigPublishProblems({
    db,
    environment: { id: environment.id, kind: environment.kind },
    reportConfig,
  });
  if (unpublished.length > 0) {
    throw new ReportProblemError(
      'report_template_not_published',
      'A report the template runs on completion names no active, published report template.',
      {
        errors: unpublished.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
      },
    );
  }
  // C90.6, C90.7, C94.6 (Workflow 7A): the signal set, the review rules and the collection keys
  // (`api-signals`). The first problem's code answers; every problem gives its pointer.
  const signalProblems = await signalConfigPublishProblems({
    deps,
    db,
    environment: { id: environment.id, kind: environment.kind },
    flow,
    signalConfig,
  });
  const [firstSignal] = signalProblems;
  if (firstSignal !== undefined) {
    throw new SignalProblemError(firstSignal.code, firstSignal.detail, {
      errors: signalProblems.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
    });
  }
  // C96.1 (Workflow 7A; F30): the `device_handoff` step's rules (`flow-handoff`): an SMS method
  // without an SMS adapter, and the organization display name it shows.
  const handoffProblems = await handoffPublishProblems({
    deps,
    db,
    environment: { id: environment.id, kind: environment.kind },
    flow,
  });
  const [firstHandoff] = handoffProblems;
  if (firstHandoff !== undefined) {
    throw new SignalProblemError(firstHandoff.code, firstHandoff.detail, {
      errors: handoffProblems.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
    });
  }
  // C99.5 (Workflow 7B): the lists a version names (`api-lists`). The first problem's code answers;
  // every problem gives its pointer.
  const listProblems = await listConfigPublishProblems({
    deps,
    db,
    environment: { id: environment.id, kind: environment.kind },
    listConfig,
  });
  const [firstList] = listProblems;
  if (firstList !== undefined) {
    throw new ListProblemError(firstList.code, firstList.detail, {
      errors: listProblems.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
    });
  }
}

/** The stored `signal-config` of a version, checked against the contract (C90.6). */
export function storedSignalConfig(
  version: Pick<InquiryTemplateVersion, 'signalConfig'>,
): SignalConfig {
  return signalConfigSchema.parse(version.signalConfig);
}

/** C99.5 (Workflow 7B): the version's stored `list-config`. */
export function storedListConfig(version: Pick<InquiryTemplateVersion, 'listConfig'>): ListConfig {
  return listConfigSchema.parse(version.listConfig);
}

/** The stored `report-config` of a version, checked against the contract. */
export function storedReportConfig(
  version: Pick<InquiryTemplateVersion, 'reportConfig'>,
): ReportConfig {
  return reportConfigSchema.parse(version.reportConfig);
}

/** The settings in force for a version: what it stores, with the C11 defaults. */
export function templateVersionSettings(
  version: Pick<InquiryTemplateVersion, 'settings'>,
): ResolvedTemplateSettings {
  return resolveTemplateSettings(templateSettingsSchema.parse(version.settings));
}

/**
 * The settings of the version an inquiry pinned.
 * @throws {Error} when the version is missing, which the database's keys rule out.
 */
export async function pinnedSettings(
  db: Db,
  inquiry: Pick<Inquiry, 'id' | 'environmentId' | 'inquiryTemplateVersionId'>,
): Promise<ResolvedTemplateSettings> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  return templateVersionSettings(version);
}

/** The template resource (C2, C11) with its status and current version's settings. */
export function inquiryTemplateResource(row: InquiryTemplateWithVersion): InquiryTemplateResource {
  const version = row.currentVersion;
  return buildInquiryTemplateResource({
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    currentVersion: {
      id: version.id,
      versionNumber: version.version,
      flow: storedAnyFlow(version.flow),
      verificationConfig: verificationConfigSchema.parse(version.verificationConfig),
      settings: templateSettingsSchema.parse(version.settings),
      reportConfig: storedReportConfig(version),
      createdAt: version.createdAt,
    },
  });
}

/** The template version resource (C11), with the default settings applied. */
export function inquiryTemplateVersionResource(
  version: InquiryTemplateVersion,
): InquiryTemplateVersionResource {
  return buildInquiryTemplateVersionResource({
    id: version.id,
    inquiryTemplateId: version.inquiryTemplateId,
    versionNumber: version.version,
    status: version.status,
    flow: storedAnyFlow(version.flow),
    verificationConfig: verificationConfigSchema.parse(version.verificationConfig),
    settings: templateSettingsSchema.parse(version.settings),
    reportConfig: storedReportConfig(version),
    signalConfig: storedSignalConfig(version),
    listConfig: storedListConfig(version),
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    phase9: phase9MembersOf(version, storedValidation(version)),
  });
}

/**
 * C154.2: the validation a save stored. A version stored before Workflow 9A has none; it passed the
 * rules of its time (today's 422 on every write), so it reads as valid.
 */
function storedValidation(version: InquiryTemplateVersion): TemplateValidation {
  const parsed = templateValidationSchema.safeParse(version.validation);
  return parsed.success ? parsed.data : { status: 'valid', problems: [] };
}

/** A version as a route answers it: the resource and its strong ETag (C154.3). */
export interface VersionAnswer {
  resource: InquiryTemplateVersionResource;
  etag: string;
}

export const answerOf = (version: InquiryTemplateVersion): VersionAnswer => ({
  resource: inquiryTemplateVersionResource(version),
  etag: versionEtagOf(version),
});

export function audit(
  deps: Pick<ApiDependencies, 'audit'>,
  tx: Db,
  acting: TemplateActing,
  action: AuditedAction,
): Promise<void> {
  return deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action));
}

// Templates ----------------------------------------------------------------------------------

/**
 * C147.1, C154.2, C154.9 (Workflow 9B, `api-templates-carry`): a template whose version 1 holds a
 * flow-spec 2 flow. The version is validated as a draft's is (the save rules, refused with 422 as a
 * draft without `meta.allow-invalid` is) and then held to every publish rule a draft's publish meets
 * before it is published, in one transaction: the template is first stored holding only its draft
 * (`createInquiryTemplateWithDraft`, never listed or served), and nothing stays when a rule refuses.
 * A creation carries no `meta.acknowledgements`, so a flow that needs one is refused
 * (`publish_acknowledgement_missing`): such a flow is drafted on a template and published with them.
 * Like a flow-spec 1 creation it writes no deployment and fires no event (9A amendment 45 (d)).
 * Its `run_workflow` targets' grants are recorded as a draft's publish records them (C152.2).
 */
async function createFlowV2Template(
  deps: ApiDependencies,
  acting: TemplateActing,
  attributes: CreateInquiryTemplateAttributes,
  flow: AnyFlow,
): Promise<InquiryTemplateResource> {
  const { db, ids } = deps;
  const { environmentId } = acting.ctx;
  const templateId = ids.newId('itmpl');
  const template = await db.transaction(async (tx) => {
    const draft = await createInquiryTemplateWithDraft(tx, environmentId, {
      id: templateId,
      name: attributes.name,
      version: {
        id: ids.newId('itmplv'),
        flow,
        verificationConfig: attributes['verification-config'],
        settings: attributes.settings ?? {},
        reportConfig: attributes['report-config'] ?? {},
        members: { lastUpdater: lastUpdaterOf(acting) },
      },
    });
    const validated = await validateDraftInTx(tx, acting, draft, false);
    const acknowledgements = await publishRulesInTx(deps, tx, acting, validated, []);
    await assertPublishable(
      deps,
      tx,
      environmentId,
      storedFlowView(validated.flow),
      verificationConfigSchema.parse(validated.verificationConfig),
      storedReportConfig(validated),
      storedSignalConfig(validated),
      storedListConfig(validated),
      acting.actor,
      validated.themeSetId,
    );
    const published = await publishInquiryTemplateVersion(
      tx,
      environmentId,
      validated.id,
      deps.clock.now(),
      {
        lastUpdater: lastUpdaterOf(acting),
        acknowledgements,
        flowRunGrants: await flowActionPublishGrants({ db: tx, environmentId, flow }),
      },
    );
    if (published?.status !== 'published') {
      throw new Error('A template created in this transaction holds its draft.');
    }
    await audit(deps, tx, acting, {
      action: 'inquiry-template.created',
      resourceType: 'inquiry-template',
      resourceId: templateId,
    });
    return findTemplate(tx, environmentId, templateId);
  });
  return inquiryTemplateResource(template);
}

/** Creates the template and its version 1, published, with its settings (C11). */
export async function createInquiryTemplate(
  deps: ApiDependencies,
  acting: TemplateActing,
  attributes: CreateInquiryTemplateAttributes,
): Promise<InquiryTemplateResource> {
  const { db, ids } = deps;
  // Version 1 is published with the template.
  const flow = attributes.flow;
  if (isFlowV2(flow)) {
    return createFlowV2Template(deps, acting, attributes, flow);
  }
  await assertPublishable(
    deps,
    db,
    acting.ctx.environmentId,
    flow,
    attributes['verification-config'],
    attributes['report-config'] ?? {},
    {},
    {},
    acting.actor,
  );
  const template = await db.transaction(async (tx) => {
    const created = await insertInquiryTemplate(tx, acting.ctx.environmentId, {
      id: ids.newId('itmpl'),
      name: attributes.name,
      version: {
        id: ids.newId('itmplv'),
        flow,
        verificationConfig: attributes['verification-config'],
        settings: attributes.settings ?? {},
        reportConfig: attributes['report-config'] ?? {},
      },
    });
    await audit(deps, tx, acting, {
      action: 'inquiry-template.created',
      resourceType: 'inquiry-template',
      resourceId: created.id,
    });
    return created;
  });
  return inquiryTemplateResource(template);
}

/** @throws {NotFoundError} when the template is not in this environment. */
async function findTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateWithVersion> {
  const template = await findInquiryTemplate(db, environmentId, id);
  if (template === null) {
    throw new NotFoundError(`Inquiry template ${id} was not found.`);
  }
  return template;
}

/** @throws {NotFoundError} when the template is not in this environment. */
export async function getInquiryTemplate(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateResource> {
  return inquiryTemplateResource(await findTemplate(db, environmentId, id));
}

export async function listInquiryTemplates(
  { db }: ApiDependencies,
  environmentId: string,
  query: PageQuery,
): Promise<{ data: InquiryTemplateResource[]; links: { next: string | null } }> {
  const page = await withCursor(() => findInquiryTemplates(db, environmentId, pageRequest(query)));
  return {
    data: page.items.map(inquiryTemplateResource),
    links: { next: nextLink(INQUIRY_TEMPLATES_PATH, {}, query, page.next) },
  };
}

/**
 * `PATCH /inquiry-templates/:id` (C11): the name and the status (`active` ↔ `archived`).
 * @throws {NotFoundError} when the template is not in this environment.
 */
export async function updateInquiryTemplate(
  deps: ApiDependencies,
  acting: TemplateActing,
  id: string,
  attributes: UpdateInquiryTemplateBody['data']['attributes'],
): Promise<InquiryTemplateResource> {
  const updated = await deps.db.transaction(async (tx) => {
    const row = await updateInquiryTemplateRow(tx, acting.ctx.environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes.status === undefined ? {} : { status: attributes.status }),
    });
    if (row === null) {
      throw new NotFoundError(`Inquiry template ${id} was not found.`);
    }
    await audit(deps, tx, acting, {
      action: 'inquiry-template.updated',
      resourceType: 'inquiry-template',
      resourceId: id,
      metadata: { attributes: Object.keys(attributes) },
    });
    return row;
  });
  return inquiryTemplateResource(updated);
}

// Versions -----------------------------------------------------------------------------------

/** @throws {NotFoundError} when the version is not in this environment. */
export async function findVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateVersion> {
  const version = await getInquiryTemplateVersion(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Inquiry template version ${id} was not found.`);
  }
  return version;
}

export const notDraft = (version: InquiryTemplateVersion) =>
  new InvalidTransitionError(
    `Version ${String(version.version)} is ${version.status}; only drafts can change.`,
  );

/** C154.1: who changed a version last: a user or an API key, never an email address. */
export function lastUpdaterOf(
  acting: TemplateActing,
): NonNullable<TemplateVersionMembers['lastUpdater']> | null {
  const { actor } = acting;
  return actor.type === 'user' || actor.type === 'api-key'
    ? { type: actor.type, id: actor.id }
    : null;
}

type MemberAttributes = Partial<
  Pick<
    UpdateInquiryTemplateVersionBody['data']['attributes'],
    | 'field-schemas'
    | 'copy'
    | 'enabled-locales'
    | 'default-locale'
    | 'theme-set-id'
    | 'embed-origins'
    | 'redirect-uri'
    | 'redirect-uri-schemes'
    | 'redirect-include-status'
    | 'help-url'
    | 'privacy-url'
    | 'description'
  >
>;

/** C154.1: the members a request sends, as the repository stores them (copy NFC-normalised). */
export function membersOf(
  attributes: MemberAttributes,
  acting: TemplateActing,
): TemplateVersionMembers {
  const members: TemplateVersionMembers = { lastUpdater: lastUpdaterOf(acting) };
  if (attributes['field-schemas'] !== undefined) members.fieldSchemas = attributes['field-schemas'];
  if (attributes.copy !== undefined) members.copy = normaliseCopy(attributes.copy);
  if (attributes['enabled-locales'] !== undefined) {
    members.enabledLocales = [...attributes['enabled-locales']];
  }
  if (attributes['default-locale'] !== undefined)
    members.defaultLocale = attributes['default-locale'];
  if (attributes['theme-set-id'] !== undefined) members.themeSetId = attributes['theme-set-id'];
  if (attributes['embed-origins'] !== undefined) members.embedOrigins = attributes['embed-origins'];
  if (attributes['redirect-uri'] !== undefined) members.redirectUri = attributes['redirect-uri'];
  if (attributes['redirect-uri-schemes'] !== undefined) {
    members.redirectUriSchemes = attributes['redirect-uri-schemes'];
  }
  if (attributes['redirect-include-status'] !== undefined) {
    members.redirectIncludeStatus = attributes['redirect-include-status'];
  }
  if (attributes['help-url'] !== undefined) members.helpUrl = attributes['help-url'];
  if (attributes['privacy-url'] !== undefined) members.privacyUrl = attributes['privacy-url'];
  if (attributes.description !== undefined) members.description = attributes.description;
  return members;
}

/**
 * C154.2: refuses a save that breaks a rule unless the caller allows a draft with problems. A
 * coherence problem keeps today's 422; every other one answers `definition_invalid` (or its own
 * template code) with each problem at its pointer under `/data/attributes`.
 */
export function refuseUnlessAllowed(
  problems: readonly TemplateRuleProblem[],
  allowInvalid: boolean,
): void {
  const errors = problems.filter((problem) => problem.severity === 'error');
  const [first] = errors;
  if (allowInvalid || first === undefined) {
    return;
  }
  const fieldErrors = errors.map(({ pointer, code, detail }) => ({
    location: 'body',
    pointer: `/data/attributes${pointer}`,
    detail,
    code,
  }));
  if (first.code === 'version_incoherent') {
    throw new UnprocessableContentError(
      'The version would no longer be a valid template.',
      fieldErrors,
    );
  }
  throw new TemplateProblemError(
    first.code in TEMPLATE_PROBLEM_STATUSES
      ? (first.code as keyof typeof TEMPLATE_PROBLEM_STATUSES)
      : 'definition_invalid',
    'The version breaks a rule; every problem is listed at its pointer.',
    fieldErrors,
  );
}

/**
 * Runs the save rules on the stored draft and stores its validation and flow digest, in the
 * caller's transaction (C154.2, C147.7).
 */
export async function validateDraftInTx(
  tx: Db,
  acting: TemplateActing,
  draft: InquiryTemplateVersion,
  allowInvalid: boolean,
): Promise<InquiryTemplateVersion> {
  const problems = await saveRuleProblems(
    tx,
    { environmentKind: acting.environmentKind },
    {
      environmentId: acting.ctx.environmentId,
      templateId: draft.inquiryTemplateId,
      version: draft,
    },
  );
  refuseUnlessAllowed(problems, allowInvalid);
  const stored = await updateDraftInquiryTemplateVersion(tx, acting.ctx.environmentId, draft.id, {
    members: {
      validation: validationOf(problems),
      flowSha256: flowSha256Of(storedAnyFlow(draft.flow)),
    },
  });
  if (stored === null) {
    throw notDraft(draft);
  }
  return stored;
}

/** C154.3: refuses a change whose `If-Match` is not the version's current ETag. */
function assertIfMatch(version: InquiryTemplateVersion, ifMatch: string | undefined): void {
  if (ifMatch === undefined) {
    return;
  }
  const current = versionEtagOf(version);
  if (ifMatch !== current) {
    throw new TemplateProblemError(
      'precondition_failed',
      'The version changed since it was read; read it again and retry.',
      undefined,
      { headers: { etag: current } },
    );
  }
}

/**
 * `POST /inquiry-template-versions` (C11): a draft numbered `max + 1`, of either flow-spec version,
 * with the C154.1 members. Without `meta.allow-invalid` (which this route does not take), a rule
 * broken answers 422 as today. The current version does not change.
 * @throws {NotFoundError} when the template is not in this environment.
 */
export async function createInquiryTemplateVersion(
  deps: ApiDependencies,
  acting: TemplateActing,
  attributes: CreateInquiryTemplateVersionBody['data']['attributes'],
): Promise<VersionAnswer> {
  const { db, ids } = deps;
  const templateId = attributes['inquiry-template-id'];
  const staged: StagedEvent[] = [];
  const version = await db.transaction(async (tx) => {
    const draft = await createDraftInquiryTemplateVersion(
      tx,
      acting.ctx.environmentId,
      templateId,
      {
        id: ids.newId('itmplv'),
        flow: attributes.flow,
        verificationConfig: attributes['verification-config'],
        settings: attributes.settings ?? {},
        reportConfig: attributes['report-config'] ?? {},
        signalConfig: attributes['signal-config'] ?? {},
        listConfig: attributes['list-config'] ?? {},
        members: membersOf(attributes, acting),
      },
    );
    if (draft === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    const validated = await validateDraftInTx(tx, acting, draft, false);
    staged.push(
      await deps.events.stage(tx, {
        environmentId: acting.ctx.environmentId,
        name: 'inquiry-template-version.created',
        payload: { data: versionEventResourceOf(validated) },
      }),
    );
    await audit(deps, tx, acting, {
      action: 'inquiry-template-version.created',
      resourceType: 'inquiry-template-version',
      resourceId: draft.id,
      metadata: { 'inquiry-template-id': templateId, 'version-number': draft.version },
    });
    return validated;
  });
  await deps.events.dispatch(staged);
  return answerOf(version);
}

/** How a `PATCH` or `publish` asks to be applied (C154.2, C154.3). */
export interface VersionWriteOptions {
  /** `meta.allow-invalid`: store the draft with its problems. */
  allowInvalid?: boolean;
  /** The `If-Match` header, a strong ETag. */
  ifMatch?: string | undefined;
  /** `publish`'s `meta.acknowledgements` (C154.9). */
  acknowledgements?: readonly string[] | undefined;
  /** `publish`'s `meta.publish-note`, locked with the version (C154.1). */
  publishNote?: string | undefined;
}

/**
 * C154.9: every publish rule of the draft and the acknowledgements it needs, each given by the
 * publishing user (an API key gives none: an acknowledgement is a person's). Answers them as stored.
 * @throws {TemplateProblemError} `definition_invalid` (or a rule's own code) for a broken rule;
 *   `publish_acknowledgement_missing` naming each acknowledgement not given.
 */
export async function publishRulesInTx(
  deps: ApiDependencies,
  tx: Db,
  acting: TemplateActing,
  draft: InquiryTemplateVersion,
  given: readonly string[],
): Promise<TemplateAcknowledgement[]> {
  const report = await flowPublishReport(tx, {
    environment: { id: acting.ctx.environmentId, kind: acting.environmentKind },
    templateId: draft.inquiryTemplateId,
    version: draft,
    // C211.9 (Workflow 10B): play_integrity_notice_missing applies while the kind binds one.
    deviceIntegrityBound: deps.providers[acting.environmentKind].deviceIntegrity !== undefined,
    // C231.10 (Workflow 11A Stage 1b (K)): the install switch the Connect publish checks read.
    connectEnabled: connectEnabled(deps.connect),
    // C235.8 (Workflow 11A, api-consent's named borrowed edit): the Connect hook reads them.
    givenAcknowledgements: given,
  });
  refuseUnlessAllowed(report.problems, false);
  const required = report.acknowledgements.map(({ key }) => key);
  const held = new Set(given);
  const missing =
    acting.actor.type === 'user' ? required.filter((key) => !held.has(key)) : required;
  if (missing.length > 0) {
    throw new TemplateProblemError(
      'publish_acknowledgement_missing',
      acting.actor.type === 'user'
        ? 'The version needs an acknowledgement this publish does not carry.'
        : 'The version needs acknowledgements, which a user gives; an API key cannot.',
      missing.map((key) => ({
        location: 'body',
        pointer: '/meta/acknowledgements',
        detail: key,
        code: 'publish_acknowledgement_missing',
      })),
    );
  }
  const at = deps.clock.now().toISOString();
  return acting.actor.type === 'user'
    ? required.map((key) => ({ key, 'acknowledged-by': acting.actor.id, 'acknowledged-at': at }))
    : [];
}

/**
 * C154.7, C154.8: the deployment a publish writes in the template's own environment, superseding
 * the template's last one, with `inquiry-template-version.published` and `deployment.completed`.
 */
export async function deployInTx(
  deps: ApiDependencies,
  tx: Db,
  acting: TemplateActing,
  version: InquiryTemplateVersion,
  staged: StagedEvent[],
): Promise<Deployment> {
  const { environmentId } = acting.ctx;
  const creator = lastUpdaterOf(acting);
  if (creator === null) {
    throw new Error('A template version is published by a user or an API key.');
  }
  const previous = await latestDeploymentOfTemplate(tx, environmentId, version.inquiryTemplateId);
  const deployment = await createDeploymentInTx(tx, environmentId, {
    id: deps.ids.newId('dply'),
    templateId: version.inquiryTemplateId,
    versionId: version.id,
    sourceDeploymentId: previous?.id ?? null,
    creator,
  });
  staged.push(
    await deps.events.stage(tx, {
      environmentId,
      name: 'inquiry-template-version.published',
      payload: { data: versionEventResourceOf(version) },
    }),
    await deps.events.stage(tx, {
      environmentId,
      name: 'deployment.completed',
      payload: { data: deploymentResourceOf(deployment) },
    }),
  );
  return deployment;
}

/** C154.7: the deployment resource of a stored deployment. */
export function deploymentResourceOf(deployment: Deployment): DeploymentResource {
  return buildDeploymentResource({
    id: deployment.id,
    templateId: deployment.inquiryTemplateId,
    environmentId: deployment.environmentId,
    versionId: deployment.inquiryTemplateVersionId,
    sourceDeploymentId: deployment.sourceDeploymentId,
    creator: { type: deployment.creatorType, id: deployment.creatorId },
    createdAt: deployment.createdAt,
  });
}

/**
 * `PATCH /inquiry-template-versions/:id` (C11, C154.2, C154.3), drafts only. The members sent
 * replace the stored ones; the result is checked by every save rule and stored with its validation.
 * @throws {NotFoundError} when the version is not in this environment.
 * @throws {InvalidTransitionError} when the version is not a draft.
 * @throws {TemplateProblemError} `precondition_failed` for a stale `If-Match`; `definition_invalid`
 *   (or another template code) for a broken rule without `meta.allow-invalid`.
 * @throws {UnprocessableContentError} when the merged content is not a coherent template.
 */
export async function updateInquiryTemplateVersion(
  deps: ApiDependencies,
  acting: TemplateActing,
  id: string,
  attributes: UpdateInquiryTemplateVersionBody['data']['attributes'],
  options: VersionWriteOptions = {},
): Promise<VersionAnswer> {
  const { environmentId } = acting.ctx;
  const version = await deps.db.transaction(async (tx) => {
    const current = await lockInquiryTemplateVersionInTx(tx, environmentId, id);
    if (current === null) {
      throw new NotFoundError(`Inquiry template version ${id} was not found.`);
    }
    if (current.status !== 'draft') {
      throw notDraft(current);
    }
    assertIfMatch(current, options.ifMatch);
    const updated = await updateDraftInquiryTemplateVersion(tx, environmentId, id, {
      ...(attributes.flow === undefined ? {} : { flow: attributes.flow }),
      ...(attributes['verification-config'] === undefined
        ? {}
        : { verificationConfig: attributes['verification-config'] }),
      ...(attributes.settings === undefined ? {} : { settings: attributes.settings }),
      ...(attributes['report-config'] === undefined
        ? {}
        : { reportConfig: attributes['report-config'] }),
      ...(attributes['signal-config'] === undefined
        ? {}
        : { signalConfig: attributes['signal-config'] }),
      ...(attributes['list-config'] === undefined ? {} : { listConfig: attributes['list-config'] }),
      members: membersOf(attributes, acting),
    });
    if (updated === null) {
      throw notDraft(await findVersion(tx, environmentId, id));
    }
    const validated = await validateDraftInTx(tx, acting, updated, options.allowInvalid === true);
    await audit(deps, tx, acting, {
      action: 'inquiry-template-version.updated',
      resourceType: 'inquiry-template-version',
      resourceId: id,
      metadata: { attributes: Object.keys(attributes) },
    });
    return validated;
  });
  return answerOf(version);
}

/**
 * `POST /inquiry-template-versions/:id/publish` (C11): the draft becomes the template's current
 * version and the previous published one `superseded`. Existing inquiries keep their version.
 * @throws {NotFoundError} when the version is not in this environment.
 * @throws {InvalidTransitionError} when the version is not a draft.
 * @throws {TemplateProblemError} `precondition_failed` for a stale `If-Match`.
 */
export async function publishTemplateVersion(
  deps: ApiDependencies,
  acting: TemplateActing,
  id: string,
  options: VersionWriteOptions = {},
): Promise<VersionAnswer> {
  const { db, clock } = deps;
  const staged: StagedEvent[] = [];
  const version = await db.transaction(async (tx) => {
    const draft = await lockInquiryTemplateVersionInTx(tx, acting.ctx.environmentId, id);
    if (draft === null) {
      throw new NotFoundError(`Inquiry template version ${id} was not found.`);
    }
    assertIfMatch(draft, options.ifMatch);
    let stored: TemplateAcknowledgement[] = [];
    let flowRunGrants: FlowRunGrantRecord[] | undefined;
    if (draft.status === 'draft') {
      stored = await publishRulesInTx(deps, tx, acting, draft, options.acknowledgements ?? []);
      await assertPublishable(
        deps,
        tx,
        acting.ctx.environmentId,
        storedFlowView(draft.flow),
        verificationConfigSchema.parse(draft.verificationConfig),
        storedReportConfig(draft),
        storedSignalConfig(draft),
        storedListConfig(draft),
        acting.actor,
        draft.themeSetId,
      );
      // C152.2 (9A amendment 31; review P07): each `run_workflow` target's grant and egress as
      // resolved in this transaction, which every entry is checked against (`run-workflow.ts`).
      flowRunGrants = await flowActionPublishGrants({
        db: tx,
        environmentId: acting.ctx.environmentId,
        flow: storedAnyFlow(draft.flow),
      });
    }
    const result = await publishInquiryTemplateVersion(
      tx,
      acting.ctx.environmentId,
      id,
      clock.now(),
      {
        lastUpdater: lastUpdaterOf(acting),
        acknowledgements: stored,
        ...(flowRunGrants === undefined ? {} : { flowRunGrants }),
        ...(options.publishNote === undefined ? {} : { publishNote: options.publishNote }),
      },
    );
    if (result === null) {
      throw new NotFoundError(`Inquiry template version ${id} was not found.`);
    }
    if (result.status === 'not_draft') {
      throw notDraft(result.version);
    }
    const deployment = await deployInTx(deps, tx, acting, result.version, staged);
    await audit(deps, tx, acting, {
      action: 'inquiry-template-version.published',
      resourceType: 'inquiry-template-version',
      resourceId: id,
      metadata: {
        'inquiry-template-id': result.version.inquiryTemplateId,
        'superseded-version-id': result.superseded?.id ?? null,
        'deployment-id': deployment.id,
        acknowledgements: stored.map(({ key }) => key),
      },
    });
    return result.version;
  });
  await deps.events.dispatch(staged);
  return answerOf(version);
}

/** `GET /inquiry-template-versions/:id`. @throws {NotFoundError} outside this environment. */
export async function getInquiryTemplateVersionResource(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<VersionAnswer> {
  return answerOf(await findVersion(db, environmentId, id));
}

export interface ListInquiryTemplateVersionsQuery extends PageQuery {
  'filter[inquiry-template-id]'?: string | undefined;
  'filter[status]'?: string | undefined;
}

/** `GET /inquiry-template-versions`: newest first, by template and status. */
export async function listInquiryTemplateVersions(
  { db }: ApiDependencies,
  environmentId: string,
  query: ListInquiryTemplateVersionsQuery,
): Promise<{ data: InquiryTemplateVersionResource[]; links: { next: string | null } }> {
  const filters = {
    'filter[inquiry-template-id]': query['filter[inquiry-template-id]'],
    'filter[status]': query['filter[status]'],
  };
  const page = await withCursor(() =>
    findInquiryTemplateVersions(db, environmentId, {
      ...pageRequest(query),
      inquiryTemplateId: filterValues(filters['filter[inquiry-template-id]'], idSchema('itmpl')),
      status: filterValues(filters['filter[status]'], inquiryTemplateVersionStatusSchema),
    }),
  );
  return {
    data: page.items.map(inquiryTemplateVersionResource),
    links: { next: nextLink(INQUIRY_TEMPLATE_VERSIONS_PATH, filters, query, page.next) },
  };
}
