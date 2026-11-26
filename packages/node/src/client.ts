/**
 * The OpenVerify server API client (contract C18): one method per C2 and C10-C14 endpoint,
 * grouped by resource, each returning the response document parsed with the endpoint's
 * `@openverify/contracts` schema.
 *
 * ```ts
 * const client = createClient({ apiKey: process.env.OPENVERIFY_API_KEY, baseUrl });
 * const { data: inquiry } = await client.inquiries.create({ 'inquiry-template-id': id });
 * for await (const event of client.events.listAll({ filter: { 'object-id': inquiry.id } })) { ... }
 * ```
 *
 * Bodies use the API's kebab-case attribute and meta names. `list()` returns one page;
 * `listAll()` iterates over every item of every page. See `transport.ts` for retries,
 * idempotency keys and timeouts.
 */
import {
  accountActionDocumentSchema,
  accountActionListDocumentSchema,
  accountAvailableActionListDocumentSchema,
  accountGraphComponentDocumentSchema,
  accountDocumentSchema,
  activateWorkflowBodySchema,
  archiveWorkflowBodySchema,
  cancelWorkflowRunBodySchema,
  cancelWorkflowRunsBodySchema,
  cancelWorkflowRunsDocumentSchema,
  createAccountActionBodySchema,
  createWorkflowBodySchema,
  createWorkflowManualRunsBodySchema,
  listAccountActionsQuerySchema,
  listWorkflowRunsQuerySchema,
  listWorkflowsQuerySchema,
  listWorkflowVersionsQuerySchema,
  pauseWorkflowBodySchema,
  promoteWorkflowBodySchema,
  publishWorkflowBodySchema,
  putWorkflowDraftBodySchema,
  rerunWorkflowRunBodySchema,
  restoreWorkflowBodySchema,
  resumeWorkflowRunBodySchema,
  rolloutWorkflowBodySchema,
  runAccountActionDocumentSchema,
  updateAccountActionBodySchema,
  updateWorkflowBodySchema,
  workflowActionListDocumentSchema,
  workflowDefinitionCheckDocumentSchema,
  workflowDocumentSchema,
  workflowIncludeDocumentSchema,
  workflowListDocumentSchema,
  workflowManualRunsDocumentSchema,
  workflowRecipeListDocumentSchema,
  workflowRunDocumentSchema,
  workflowRunIncludeDocumentSchema,
  workflowRunListDocumentSchema,
  workflowRunStepListDocumentSchema,
  workflowTriggerDeliveryListDocumentSchema,
  workflowVersionDiffDocumentSchema,
  workflowVersionDocumentSchema,
  workflowVersionListDocumentSchema,
  type CreateWorkflowTestRunBody,
  type RunAccountActionBody,
  type WorkflowInclude,
  type WorkflowRunInclude,
  ACCOUNT_INCLUDES,
  accountIncludeDocumentSchema,
  accountListDocumentSchema,
  accountRelationListDocumentSchema,
  accountTypeDocumentSchema,
  accountTypeListDocumentSchema,
  addAccountObjectsBodySchema,
  addAccountRelationBodySchema,
  addTagBodySchema,
  apiKeyDocumentSchema,
  apiKeyListDocumentSchema,
  apiLogDocumentSchema,
  apiLogListDocumentSchema,
  approveInquiryBodySchema,
  createWorkflowSecretBodySchema,
  decisionListDocumentSchema,
  listWorkflowSecretsQuerySchema,
  sandboxEmailSearchResponseSchema,
  sandboxSlackSearchResponseSchema,
  sandboxWorkflowSmsSearchResponseSchema,
  updateWorkflowSecretBodySchema,
  workflowSecretDocumentSchema,
  workflowSecretListDocumentSchema,
  listDecisionsQuerySchema,
  reopenInquiryBodySchema,
  trustDeviceBodySchema,
  archiveWebhookBodySchema,
  cloneApiKeyBodySchema,
  cloneWebhookBodySchema,
  consolidateAccountsBodySchema,
  createAccountBodySchema,
  createAccountTypeBodySchema,
  createApiKeyBodySchema,
  createdApiKeyDocumentSchema,
  createdWebhookDocumentSchema,
  createInquiryBodySchema,
  createInquiryTemplateBodySchema,
  createInquiryTemplateVersionBodySchema,
  createWebhookBodySchema,
  declineInquiryBodySchema,
  disableWebhookBodySchema,
  emptyActionBodySchema,
  enableWebhookBodySchema,
  eventDocumentSchema,
  eventListDocumentSchema,
  expireAllInquirySessionsBodySchema,
  expireAllInquirySessionsResponseSchema,
  expireApiKeyBodySchema,
  expireInquiryBodySchema,
  expireInquirySessionBodySchema,
  generateOneTimeLinkBodySchema,
  generateOneTimeLinkDocumentSchema,
  generateSessionOneTimeLinkDocumentSchema,
  inquiryDocumentSchema,
  inquiryIncludeDocumentSchema,
  inquiryListDocumentSchema,
  selfieCaptureDocumentSchema,
  type InquiryInclude,
  type InquirySessionInclude,
  deviceDocumentSchema,
  deviceListDocumentSchema,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  createImporterBodySchema,
  dismissListMatchBodySchema,
  importerDocumentSchema,
  importerErrorListDocumentSchema,
  importerListDocumentSchema,
  listImportersQuerySchema,
  listItemDocumentSchema,
  listItemListDocumentSchema,
  listListItemsQuerySchema,
  listListMatchesQuerySchema,
  listListsQuerySchema,
  listMatchDocumentSchema,
  listMatchListDocumentSchema,
  listResourceDocumentSchema,
  listResourceListDocumentSchema,
  matchListsBodySchema,
  matchListsResponseSchema,
  updateListBodySchema,
  cancelGraphQueryBodySchema,
  createGraphQueryBodySchema,
  createGraphQueryTemplateBodySchema,
  createGraphQueryTemplateVersionBodySchema,
  graphNodeValueDocumentSchema,
  graphQueryActionBodySchema,
  graphQueryActionResultDocumentSchema,
  graphQueryDocumentSchema,
  graphQueryListDocumentSchema,
  graphQueryTemplateDocumentSchema,
  graphQueryTemplateListDocumentSchema,
  graphQueryTemplateVersionDocumentSchema,
  listGraphQueriesQuerySchema,
  listGraphQueryTemplatesQuerySchema,
  publishGraphQueryTemplateVersionBodySchema,
  rerunGraphQueryBodySchema,
  updateGraphQueryTemplateBodySchema,
  updateGraphQueryTemplateVersionBodySchema,
  createTransactionBodySchema,
  createTransactionTypeBodySchema,
  createTransactionTypeVersionBodySchema,
  labelTransactionBodySchema,
  listTransactionTypesQuerySchema,
  listTransactionsQuerySchema,
  publishTransactionTypeVersionBodySchema,
  transactionDocumentSchema,
  transactionListDocumentSchema,
  transactionObjectsBodySchema,
  transactionLabelListDocumentSchema,
  transactionRelationBodySchema,
  transactionRelationListDocumentSchema,
  transactionStatusChangeListDocumentSchema,
  transactionTypeDocumentSchema,
  transactionTypeListDocumentSchema,
  transactionTypeVersionDocumentSchema,
  updateTransactionBodySchema,
  updateTransactionTypeBodySchema,
  updateTransactionTypeVersionBodySchema,
  type ListKind,
  inquirySessionDocumentSchema,
  inquirySessionIncludeDocumentSchema,
  inquirySessionListDocumentSchema,
  inquiryTemplateDocumentSchema,
  inquiryTemplateListDocumentSchema,
  inquiryTemplateVersionDocumentSchema,
  inquiryTemplateVersionListDocumentSchema,
  listAccountsQuerySchema,
  listAccountTypesQuerySchema,
  listApiKeysQuerySchema,
  listApiLogsQuerySchema,
  listEventsQuerySchema,
  listInquiriesQuerySchema,
  listDevicesQuerySchema,
  listInquirySessionsQuerySchema,
  listInquiryTemplatesQuerySchema,
  listInquiryTemplateVersionsQuerySchema,
  listUserAuditLogsQuerySchema,
  listWebhookDeliveriesQuerySchema,
  listWebhooksQuerySchema,
  markInquiryForReviewBodySchema,
  performSimulateActionsBodySchema,
  publishInquiryTemplateVersionBodySchema,
  rateLimitListDocumentSchema,
  sandboxSmsSearchResponseSchema,
  redactAccountBodySchema,
  redactInquiryBodySchema,
  removeAccountObjectsBodySchema,
  removeAccountRelationBodySchema,
  removeTagBodySchema,
  replayWebhookBodySchema,
  replayWebhookDocumentSchema,
  resumeInquiryDocumentSchema,
  rotateWebhookSecretBodySchema,
  rotateWebhookSecretDocumentSchema,
  setTagsBodySchema,
  simulateWebhookBodySchema,
  simulateWebhookDocumentSchema,
  updateAccountBodySchema,
  updateAccountTypeBodySchema,
  updateApiKeyBodySchema,
  updateInquiryBodySchema,
  updateInquiryTemplateBodySchema,
  updateInquiryTemplateVersionBodySchema,
  updateWebhookBodySchema,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
  verificationDocumentSchema,
  webhookDeliveryDocumentSchema,
  webhookDeliveryListDocumentSchema,
  webhookDocumentSchema,
  webhookListDocumentSchema,
  createReportBodySchema,
  createReportTemplateBodySchema,
  createReportTemplateVersionBodySchema,
  dismissReportBodySchema,
  listReportsQuerySchema,
  listReportTemplatesQuerySchema,
  listReportTemplateVersionsQuerySchema,
  pauseReportBodySchema,
  publishReportTemplateVersionBodySchema,
  reportDocumentSchema,
  reportHistoryDocumentSchema,
  reportListDocumentSchema,
  reportTemplateDocumentSchema,
  reportTemplateListDocumentSchema,
  reportTemplateVersionDocumentSchema,
  reportTemplateVersionListDocumentSchema,
  resumeReportBodySchema,
  reviewReportBodySchema,
  runReportBodySchema,
  updateReportTemplateBodySchema,
  updateReportTemplateVersionBodySchema,
  type ReportResourceType,
  graphQueryTemplateVersionListDocumentSchema,
  listGraphQueryTemplateVersionsQuerySchema,
  listTransactionTypeVersionsQuerySchema,
  transactionTypeVersionListDocumentSchema,
  redactTransactionBiometricsBodySchema,
  CASE_INCLUDES,
  addCaseCommentBodySchema,
  addCaseObjectsBodySchema,
  addCaseTagBodySchema,
  archiveCaseTemplateBodySchema,
  assignCaseBodySchema,
  caseActionDocumentSchema,
  caseActionListDocumentSchema,
  caseAssignmentPolicyDocumentSchema,
  caseAssignmentPolicyListDocumentSchema,
  caseCalendarDocumentSchema,
  caseCalendarImportDocumentSchema,
  caseCalendarListDocumentSchema,
  caseExportDocumentSchema,
  caseExportListDocumentSchema,
  createCaseExportBodySchema,
  listCaseExportsQuerySchema,
  caseQueueDocumentSchema,
  caseQueueListDocumentSchema,
  caseSlaPolicyDocumentSchema,
  caseSlaPolicyListDocumentSchema,
  createCaseAssignmentPolicyBodySchema,
  createCaseCalendarBodySchema,
  createCaseQueueBodySchema,
  createCaseSlaPolicyBodySchema,
  listCaseAssignmentPoliciesQuerySchema,
  listCaseCalendarsQuerySchema,
  listCaseQueuesQuerySchema,
  listCaseSlaPoliciesQuerySchema,
  nextCaseDocumentSchema,
  updateCaseAssignmentPolicyBodySchema,
  updateCaseCalendarBodySchema,
  updateCaseQueueBodySchema,
  updateCaseSlaPolicyBodySchema,
  type ImportCaseCalendarHolidaysBody,
  type NextCaseBody,
  type SetCaseQueueMembersBody,
  caseAvailableActionListDocumentSchema,
  caseBulkActionDocumentSchema,
  caseCommentDocumentSchema,
  caseCommentListDocumentSchema,
  caseDocumentSchema,
  caseHeldObjectListDocumentSchema,
  caseHistoryListDocumentSchema,
  caseIncludeDocumentSchema,
  caseListDocumentSchema,
  caseSearchDocumentSchema,
  caseTemplateDocumentSchema,
  caseTemplateListDocumentSchema,
  caseTemplateVersionDocumentSchema,
  caseTemplateVersionListDocumentSchema,
  createCaseActionBodySchema,
  createCaseTemplateBodySchema,
  createCaseTemplateVersionBodySchema,
  listCaseActionsQuerySchema,
  listCaseTemplatesQuerySchema,
  listCaseTemplateVersionsQuerySchema,
  listCasesQuerySchema,
  printCaseBodySchema,
  publishCaseTemplateVersionBodySchema,
  redactCaseCommentBodySchema,
  removeCaseObjectsBodySchema,
  removeCaseTagBodySchema,
  runCaseActionDocumentSchema,
  setCaseStatusBodySchema,
  setCaseTagsBodySchema,
  updateCaseActionBodySchema,
  updateCaseTemplateBodySchema,
  updateCaseTemplateVersionBodySchema,
  type CaseSearchBody,
  type CreateCaseBody,
  type CreateCaseBulkActionBody,
  type CreateInquiryReviewRequestBody,
  type RunCaseActionBody,
  type UpdateCaseBody,
  // Workflow 9A (C154.7, C162.7).
  deploymentDocumentSchema,
  deploymentListDocumentSchema,
  inquiryTemplateTranslationsDocumentSchema,
  listDeploymentsQuerySchema,
  type ImportTranslationsBody,
  // Workflow 9A (C160).
  THEME_ASSET_FILE_FIELD,
  createThemeSetBodySchema,
  listThemeSetsQuerySchema,
  themeAssetDocumentSchema,
  themeSetDocumentSchema,
  themeSetListDocumentSchema,
  themeSetRevisionListDocumentSchema,
  updateThemeSetBodySchema,
  type ThemeAssetKind,
  // Workflow 9B (C164.8, C166).
  analyticsCasesDocumentSchema,
  analyticsCasesQuerySchema,
  analyticsChecksDocumentSchema,
  analyticsChecksQuerySchema,
  analyticsFunnelDocumentSchema,
  analyticsFunnelQuerySchema,
  analyticsInquiriesDocumentSchema,
  analyticsInquiriesQuerySchema,
  analyticsSignalsDocumentSchema,
  analyticsSignalsQuerySchema,
  analyticsVerificationsDocumentSchema,
  analyticsVerificationsQuerySchema,
  createExportBodySchema,
  exportDocumentSchema,
  exportListDocumentSchema,
  listExportsQuerySchema,
  attestConsentRecordBodySchema,
  changeSharePolicyBodySchema,
  connectionDocumentSchema,
  connectionListDocumentSchema,
  consentRecordDocumentSchema,
  consentRecordListDocumentSchema,
  createConnectionBodySchema,
  createShareTokenBodySchema,
  listConnectionsQuerySchema,
  listConsentRecordsQuerySchema,
  listShareTokensQuerySchema,
  redeemShareTokenBodySchema,
  shareTokenDocumentSchema,
  shareTokenListDocumentSchema,
  withdrawConsentRecordBodySchema,
  accountExportDocumentSchema,
  accountExportManifestSchema,
} from '@openverify/contracts';
import type { z } from 'zod';
import { parseApiAnswer } from './answers.js';
import {
  createTransport,
  type ClientOptions,
  type RequestOptions,
  type Transport,
} from './transport.js';

export * from './errors.js';
export {
  API_PATH_PREFIX,
  CLIENT_USER_AGENT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type ClientOptions,
  type RequestOptions,
} from './transport.js';

/** An `include` query: one name or several, comma-separated; none sends nothing. */
function includeQuery(include: string | readonly string[] | undefined): URLSearchParams {
  if (include === undefined) {
    return new URLSearchParams();
  }
  return new URLSearchParams({
    include: typeof include === 'string' ? include : include.join(','),
  });
}

/** C70.5, Workflow 7B: what `accounts.retrieve` can include. */
type AccountInclude = (typeof ACCOUNT_INCLUDES)[number];

/** A list filter value: one value, several (OR), a time (sent as ISO-8601) or a boolean. */
export type FilterValue = string | number | boolean | Date | readonly (string | number)[];

/** The C9 creation range: `filter[created-at-start]` (inclusive) and `-end` (exclusive). */
const CREATED_AT_FILTERS: readonly string[] = ['created-at-start', 'created-at-end'];
type CreatedAtFilter = 'created-at-start' | 'created-at-end';

/**
 * The filter names a list query schema accepts: `filter[status]` gives `status`. The schema
 * types leave out the C9 creation range (`listQuerySchema()` spreads it from a union), so each
 * list states whether it takes it: every list does except `GET /inquiry-templates` and
 * `GET /webhooks`, whose queries answer 400 for it (2B F029).
 */
/** The literal keys of `T`, leaving out an index signature (a list's dynamic filters). */
type KnownKeys<T> = keyof {
  [Key in keyof T as string extends Key ? never : number extends Key ? never : Key]: T[Key];
};

type FilterNames<Query extends z.ZodType, CreatedAt extends boolean> =
  | {
      [Key in KnownKeys<z.input<Query>>]-?: Key extends `filter[${infer Name}]` ? Name : never;
    }[KnownKeys<z.input<Query>>]
  // C165.3 (Workflow 9B): a list with dynamic filters (`filter[fields.<key>]` on transactions).
  | (string extends keyof z.input<Query> ? `fields.${string}` : never)
  | (CreatedAt extends true ? CreatedAtFilter : never);

/** `list()` and `listAll()` parameters: C9 filters and the C1 page. A list without filters takes none. */
export interface ListParams<Filter extends string = string> {
  filter?: [Filter] extends [never] ? never : Partial<Record<Filter, FilterValue | undefined>>;
  page?: { after?: string; size?: number };
}

/** Filters that take exactly one value: commas in them are part of the value. */
const SINGLE_VALUE_FILTERS: ReadonlySet<string> = new Set([
  'reference-id',
  'route',
  'resource-type',
  'object-id',
]);

function filterText(value: FilterValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return Array.isArray(value) ? value.map(String).join(',') : String(value);
}

/**
 * The query string of a list request.
 * @throws {TypeError} for several values of a filter that takes one.
 */
function listQuery(params: ListParams | undefined): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params?.filter ?? {})) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value) && SINGLE_VALUE_FILTERS.has(name)) {
      throw new TypeError(`filter[${name}] takes one value`);
    }
    query.append(`filter[${name}]`, filterText(value));
  }
  if (params?.page?.size !== undefined) {
    query.append('page[size]', String(params.page.size));
  }
  if (params?.page?.after !== undefined) {
    query.append('page[after]', params.page.after);
  }
  return query;
}

/**
 * @throws {TypeError} when `params` sends the creation range to a list that refuses it.
 */
function refuseCreatedAt(params: ListParams | undefined): void {
  for (const name of CREATED_AT_FILTERS) {
    if (params?.filter?.[name] !== undefined) {
      throw new TypeError(`filter[${name}] is not accepted by this list`);
    }
  }
}

type Attributes<Body extends z.ZodType> =
  z.input<Body> extends { data: { attributes: infer A } } ? A : never;
type Meta<Body extends z.ZodType> =
  NonNullable<z.input<Body>> extends { meta?: infer M } ? M : never;
type Item<List extends z.ZodType> =
  z.output<List> extends { data: readonly (infer R)[] } ? R : never;

const document = (type: string, attributes: unknown) => ({ data: { type, attributes } });
const actionBody = (meta: unknown) => (meta === undefined ? {} : { meta });

/** A list kind's path segment (C97.1), plural as the public paths are. */
export type ListKindPlural = (typeof LIST_KIND_REGISTRY)[keyof typeof LIST_KIND_REGISTRY]['plural'];

/** The singular kind of a path segment. @throws {TypeError} for a plural no kind has. */
function listKindOf(plural: ListKindPlural): ListKind {
  const kind = LIST_KINDS.find((name) => LIST_KIND_REGISTRY[name].plural === plural);
  if (kind === undefined) {
    throw new TypeError('Not a list kind');
  }
  return kind;
}

/*
 * The client's type is written out, method by method, against the contracts' schema names:
 * inferred from `resources()`, its declaration spelled out every response schema in full, and
 * with the eleven verification types of Phase 5 (C50.1) it outgrew what the compiler will
 * serialize (TS7056). `resources()` is checked against it.
 */

/** A method's answer: the response document, parsed with the endpoint's schema. */
type Answer<Schema extends z.ZodType> = Promise<z.output<Schema>>;

/** `POST <base>` with `{ data: { type, attributes } }`. */
type CreateMethod<Body extends z.ZodType, Schema extends z.ZodType> = (
  attributes: Attributes<Body>,
  options?: RequestOptions,
) => Answer<Schema>;

/** `PATCH <base>/:id` with `{ data: { type, attributes } }`. */
type UpdateMethod<Body extends z.ZodType, Schema extends z.ZodType> = (
  id: string,
  attributes: Attributes<Body>,
  options?: RequestOptions,
) => Answer<Schema>;

/** `GET <base>/:id`. */
type RetrieveMethod<Schema extends z.ZodType> = (
  id: string,
  options?: RequestOptions,
) => Answer<Schema>;

/** `POST <base>/:id/<action>` whose meta may be left out. */
type ActionMethod<Body extends z.ZodType, Schema extends z.ZodType> = (
  id: string,
  meta?: Meta<Body>,
  options?: RequestOptions,
) => Answer<Schema>;

/** `POST <base>/:id/<action>` that needs its meta. */
type MetaActionMethod<Body extends z.ZodType, Schema extends z.ZodType> = (
  id: string,
  meta: Meta<Body>,
  options?: RequestOptions,
) => Answer<Schema>;

/** `list()` (one page) and `listAll()` (every item of every page). */
interface PageMethods<
  Query extends z.ZodType,
  Schema extends z.ZodType,
  CreatedAt extends boolean,
> {
  list: (
    params?: ListParams<FilterNames<Query, CreatedAt>>,
    options?: RequestOptions,
  ) => Answer<Schema>;
  listAll: (
    params?: ListParams<FilterNames<Query, CreatedAt>>,
    options?: RequestOptions,
  ) => AsyncGenerator<Item<Schema>, void, undefined>;
}

/** C2, C10 and C13: inquiries, their actions and sandbox simulation. */
interface InquiryMethods extends PageMethods<
  typeof listInquiriesQuerySchema,
  typeof inquiryListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createInquiryBodySchema, typeof inquiryDocumentSchema>;
  /**
   * `include: 'verifications'` adds them to `included`; `'selfies'` (C40.1) adds the
   * captures; a list asks for both.
   */
  retrieve: (
    id: string,
    params?: { include?: InquiryInclude | readonly InquiryInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof inquiryIncludeDocumentSchema>;
  update: UpdateMethod<typeof updateInquiryBodySchema, typeof inquiryDocumentSchema>;
  /** A new session token and hosted-flow URL (`meta`). */
  resume: ActionMethod<typeof emptyActionBodySchema, typeof resumeInquiryDocumentSchema>;
  approve: ActionMethod<typeof approveInquiryBodySchema, typeof inquiryDocumentSchema>;
  decline: ActionMethod<typeof declineInquiryBodySchema, typeof inquiryDocumentSchema>;
  /** C128.6: a user reopens a declined inquiry for review, with a comment. */
  reopen: MetaActionMethod<typeof reopenInquiryBodySchema, typeof inquiryDocumentSchema>;
  markForReview: ActionMethod<typeof markInquiryForReviewBodySchema, typeof inquiryDocumentSchema>;
  expire: ActionMethod<typeof expireInquiryBodySchema, typeof inquiryDocumentSchema>;
  addTag: MetaActionMethod<typeof addTagBodySchema, typeof inquiryDocumentSchema>;
  removeTag: MetaActionMethod<typeof removeTagBodySchema, typeof inquiryDocumentSchema>;
  setTags: MetaActionMethod<typeof setTagsBodySchema, typeof inquiryDocumentSchema>;
  generateOneTimeLink: ActionMethod<
    typeof generateOneTimeLinkBodySchema,
    typeof generateOneTimeLinkDocumentSchema
  >;
  redact: ActionMethod<typeof redactInquiryBodySchema, typeof inquiryDocumentSchema>;
  /** Sandbox only (production answers 403 `sandbox-only`). */
  performSimulateActions: MetaActionMethod<
    typeof performSimulateActionsBodySchema,
    typeof inquiryDocumentSchema
  >;
}

/** C10: inquiry sessions. */
interface InquirySessionMethods extends PageMethods<
  typeof listInquirySessionsQuerySchema,
  typeof inquirySessionListDocumentSchema,
  true
> {
  /** C91.1 (Phase 7): `include: 'network'` and `'device'` add them to `included`. */
  retrieve: (
    id: string,
    params?: { include?: InquirySessionInclude | readonly InquirySessionInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof inquirySessionIncludeDocumentSchema>;
  expire: ActionMethod<typeof expireInquirySessionBodySchema, typeof inquirySessionDocumentSchema>;
  /** C91.5: a C10 one-time link to the session's inquiry; `meta.expires-in-seconds` is optional. */
  generateOneTimeLink: ActionMethod<
    typeof generateOneTimeLinkBodySchema,
    typeof generateSessionOneTimeLinkDocumentSchema
  >;
  /** Expires every active session of `meta.inquiry-id`. */
  expireAll: (
    meta: Meta<typeof expireAllInquirySessionsBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof expireAllInquirySessionsResponseSchema>;
}

/** C91.2 (Phase 7): devices, listed for one inquiry session; scope `inquiry-sessions:read`. */
interface DeviceMethods extends PageMethods<
  typeof listDevicesQuerySchema,
  typeof deviceListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof deviceDocumentSchema>;
  /** C127.9: sets or clears the trust mark, read by workflow conditions and by no check. */
  trust: MetaActionMethod<typeof trustDeviceBodySchema, typeof deviceDocumentSchema>;
}

/** C128.1: the decision records of one subject, by `filter[subject-id]`, which is required. */
type DecisionMethods = PageMethods<
  typeof listDecisionsQuerySchema,
  typeof decisionListDocumentSchema,
  true
>;

/**
 * C97 (Workflow 7B): lists. A list is created on its kind's path (`email-addresses`, ...); `match`
 * asks which lists hold a value, and answers what it could not read beside what it matched (H02).
 */
interface ListMethods extends PageMethods<
  typeof listListsQuerySchema,
  typeof listResourceListDocumentSchema,
  true
> {
  create: (
    kind: ListKindPlural,
    attributes: Readonly<Record<string, unknown>>,
    options?: RequestOptions,
  ) => Answer<typeof listResourceDocumentSchema>;
  retrieve: RetrieveMethod<typeof listResourceDocumentSchema>;
  update: (
    id: string,
    attributes: Attributes<typeof updateListBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof listResourceDocumentSchema>;
  /** Archives the list: it stays readable and stops matching. */
  archive: RetrieveMethod<typeof listResourceDocumentSchema>;
  match: (
    attributes: Attributes<typeof matchListsBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof matchListsResponseSchema>;
}

/** C97.1 (Workflow 7B): list items, on their kind's path, and `GET /list-items` (ours). */
interface ListItemMethods extends PageMethods<
  typeof listListItemsQuerySchema,
  typeof listItemListDocumentSchema,
  false
> {
  create: (
    kind: ListKindPlural,
    attributes: Readonly<Record<string, unknown>>,
    options?: RequestOptions,
  ) => Answer<typeof listItemDocumentSchema>;
  retrieve: (
    kind: ListKindPlural,
    id: string,
    options?: RequestOptions,
  ) => Answer<typeof listItemDocumentSchema>;
  /** Archives the item: it stops matching and stays readable. */
  archive: (
    kind: ListKindPlural,
    id: string,
    options?: RequestOptions,
  ) => Answer<typeof listItemDocumentSchema>;
}

/** C99.3 (Workflow 7B): list matches and their dismissal. */
interface ListMatchMethods extends PageMethods<
  typeof listListMatchesQuerySchema,
  typeof listMatchListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof listMatchDocumentSchema>;
  dismiss: (
    id: string,
    attributes: Attributes<typeof dismissListMatchBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof listMatchDocumentSchema>;
}

/** C100 (Workflow 7B): list importers, as JSON with a base64 `file`. */
interface ImporterMethods extends PageMethods<
  typeof listImportersQuerySchema,
  typeof importerListDocumentSchema,
  true
> {
  create: (
    kind: ListKindPlural,
    attributes: Attributes<typeof createImporterBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof importerDocumentSchema>;
  retrieve: RetrieveMethod<typeof importerDocumentSchema>;
  /** The error rows of an import: a row, a column and a code, never a value (C100.4). */
  errors: (id: string, options?: RequestOptions) => Answer<typeof importerErrorListDocumentSchema>;
}

/** C103.1: the accounts of a result an export takes. */
export type GraphExportSelection = { 'account-ids': readonly string[] } | { all: true };

/** What `transactions.uploadFile` sends. */
export interface TransactionFileUpload {
  bytes: Uint8Array;
  filename: string;
  /** Checked by the API against the bytes' signature. */
  mimeType?: string;
}

/** What `transactions.fileContent` answers. */
export interface TransactionFileContent {
  bytes: Uint8Array;
  mimeType: string | null;
}

/** C105 (Workflow 7B): transactions. A file's content goes through its own route, not JSON. */
interface TransactionMethods extends PageMethods<
  typeof listTransactionsQuerySchema,
  typeof transactionListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createTransactionBodySchema, typeof transactionDocumentSchema>;
  retrieve: RetrieveMethod<typeof transactionDocumentSchema>;
  update: UpdateMethod<typeof updateTransactionBodySchema, typeof transactionDocumentSchema>;
  /** `DELETE`: redacts now, except `never` fields (`transactions:redact`). */
  redact: RetrieveMethod<typeof transactionDocumentSchema>;
  label: MetaActionMethod<typeof labelTransactionBodySchema, typeof transactionDocumentSchema>;
  addObjects: MetaActionMethod<
    typeof transactionObjectsBodySchema,
    typeof transactionDocumentSchema
  >;
  removeObjects: MetaActionMethod<
    typeof transactionObjectsBodySchema,
    typeof transactionDocumentSchema
  >;
  addRelation: MetaActionMethod<
    typeof transactionRelationBodySchema,
    typeof transactionDocumentSchema
  >;
  removeRelation: MetaActionMethod<
    typeof transactionRelationBodySchema,
    typeof transactionDocumentSchema
  >;
  addTag: MetaActionMethod<typeof addTagBodySchema, typeof transactionDocumentSchema>;
  removeTag: MetaActionMethod<typeof removeTagBodySchema, typeof transactionDocumentSchema>;
  setTags: MetaActionMethod<typeof setTagsBodySchema, typeof transactionDocumentSchema>;
  /** C105.6: needs `transactions:redact` and `inquiries:redact`. */
  redactBiometrics: ActionMethod<
    typeof redactTransactionBiometricsBodySchema,
    typeof transactionDocumentSchema
  >;
  /** C105.2: a `file` field's content, as multipart. */
  uploadFile: (
    id: string,
    fieldKey: string,
    file: TransactionFileUpload,
    options?: RequestOptions,
  ) => Answer<typeof transactionDocumentSchema>;
  /** C105.2 (P12): the decrypted file with its type; needs `pii:view` for users. */
  fileContent: (
    id: string,
    fileId: string,
    options?: RequestOptions,
  ) => Promise<TransactionFileContent>;
  /** Newest first; a status is `null` once redacted (owner decision 8 after 7B). */
  statusChanges: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof transactionStatusChangeListDocumentSchema>;
  /** Newest first; a redacted label is left out (owner decision 8 after 7B). */
  labels: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof transactionLabelListDocumentSchema>;
  /** Newest first, each target by its id; a redaction leaves them (K7C-2). */
  relations: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof transactionRelationListDocumentSchema>;
}

/** C104.1 (Workflow 7B): transaction types, and their versions: a draft, then published. */
interface TransactionTypeMethods extends PageMethods<
  typeof listTransactionTypesQuerySchema,
  typeof transactionTypeListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createTransactionTypeBodySchema,
    typeof transactionTypeDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof transactionTypeDocumentSchema>;
  update: UpdateMethod<
    typeof updateTransactionTypeBodySchema,
    typeof transactionTypeDocumentSchema
  >;
  archive: RetrieveMethod<typeof transactionTypeDocumentSchema>;
  versions: {
    create: CreateMethod<
      typeof createTransactionTypeVersionBodySchema,
      typeof transactionTypeVersionDocumentSchema
    >;
    retrieve: RetrieveMethod<typeof transactionTypeVersionDocumentSchema>;
    update: UpdateMethod<
      typeof updateTransactionTypeVersionBodySchema,
      typeof transactionTypeVersionDocumentSchema
    >;
    publish: ActionMethod<
      typeof publishTransactionTypeVersionBodySchema,
      typeof transactionTypeVersionDocumentSchema
    >;
  };
}

/** C102, C103 (Workflow 7B): graph queries, the audited unmask and bulk actions. */
interface GraphQueryMethods extends PageMethods<
  typeof listGraphQueriesQuerySchema,
  typeof graphQueryListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createGraphQueryBodySchema, typeof graphQueryDocumentSchema>;
  /** `meta.run-sync`: runs the query at once, at most 10 s, two at a time per environment. */
  createSync: CreateMethod<typeof createGraphQueryBodySchema, typeof graphQueryDocumentSchema>;
  retrieve: RetrieveMethod<typeof graphQueryDocumentSchema>;
  rerun: ActionMethod<typeof rerunGraphQueryBodySchema, typeof graphQueryDocumentSchema>;
  cancel: ActionMethod<typeof cancelGraphQueryBodySchema, typeof graphQueryDocumentSchema>;
  /**
   * Owner decision 20 after Workflow 7B (Workflow 9B): a new query from a stored property node of
   * this query's result (`graph:write`, and `pii:view` for a person-identifying kind).
   */
  expandNode: (
    id: string,
    nodeId: string,
    options?: RequestOptions & { runSync?: boolean },
  ) => Answer<typeof graphQueryDocumentSchema>;
  /** One audited plaintext value (`pii:view`; policy `graph-unmask`). */
  nodeValue: (
    id: string,
    nodeId: string,
    options?: RequestOptions,
  ) => Answer<typeof graphNodeValueDocumentSchema>;
  /**
   * A bulk action on the stored result. The `export` action answers CSV, so it is refused here:
   * use {@link GraphQueryMethods.exportCsv}.
   */
  action: (
    id: string,
    attributes: Attributes<typeof graphQueryActionBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof graphQueryActionResultDocumentSchema>;
  /** C103.2: the CSV text of the selection; sends an `Idempotency-Key` like every `POST`. */
  exportCsv: (
    id: string,
    selection: GraphExportSelection,
    options?: RequestOptions,
  ) => Promise<string>;
}

/** C112, C116, C118, C122.4, C140.5 (Workflow 8A): workflows, their drafts and how runs start. */
interface WorkflowMethods extends PageMethods<
  typeof listWorkflowsQuerySchema,
  typeof workflowListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createWorkflowBodySchema, typeof workflowDocumentSchema>;
  retrieve: (
    id: string,
    params?: { include?: WorkflowInclude | readonly WorkflowInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof workflowIncludeDocumentSchema>;
  update: UpdateMethod<typeof updateWorkflowBodySchema, typeof workflowDocumentSchema>;
  pause: ActionMethod<typeof pauseWorkflowBodySchema, typeof workflowDocumentSchema>;
  activate: ActionMethod<typeof activateWorkflowBodySchema, typeof workflowDocumentSchema>;
  archive: ActionMethod<typeof archiveWorkflowBodySchema, typeof workflowDocumentSchema>;
  draft: RetrieveMethod<typeof workflowVersionDocumentSchema>;
  /** C116.1: replaces the definition; 409 when `lock-version` is out of date. */
  saveDraft: (
    id: string,
    attributes: Attributes<typeof putWorkflowDraftBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof workflowVersionDocumentSchema>;
  /** C113.6: checks the given definition, or the stored draft, and saves nothing. */
  validateDraft: (
    id: string,
    definition?: unknown,
    options?: RequestOptions,
  ) => Answer<typeof workflowDefinitionCheckDocumentSchema>;
  publish: ActionMethod<typeof publishWorkflowBodySchema, typeof workflowVersionDocumentSchema>;
  rollout: MetaActionMethod<typeof rolloutWorkflowBodySchema, typeof workflowVersionDocumentSchema>;
  restore: MetaActionMethod<typeof restoreWorkflowBodySchema, typeof workflowVersionDocumentSchema>;
  promote: MetaActionMethod<typeof promoteWorkflowBodySchema, typeof workflowVersionDocumentSchema>;
  /** C118.2: `fields` are validated by the live version's inputs. */
  trigger: (
    id: string,
    fields: Readonly<Record<string, unknown>>,
    options?: RequestOptions,
  ) => Answer<typeof workflowRunDocumentSchema>;
  manualRuns: (
    id: string,
    attributes: Attributes<typeof createWorkflowManualRunsBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof workflowManualRunsDocumentSchema>;
  cancelRuns: MetaActionMethod<
    typeof cancelWorkflowRunsBodySchema,
    typeof cancelWorkflowRunsDocumentSchema
  >;
  /** C122.4: every action version, for a palette. */
  actions: (options?: RequestOptions) => Answer<typeof workflowActionListDocumentSchema>;
  recipes: (options?: RequestOptions) => Answer<typeof workflowRecipeListDocumentSchema>;
  /** C140.5: a paused workflow with a draft, in the caller's environment. */
  installRecipe: (key: string, options?: RequestOptions) => Answer<typeof workflowDocumentSchema>;
}

interface WorkflowVersionMethods extends PageMethods<
  typeof listWorkflowVersionsQuerySchema,
  typeof workflowVersionListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof workflowVersionDocumentSchema>;
  /** C116.6: what changed against another version of the workflow. */
  diff: (
    id: string,
    against: string,
    options?: RequestOptions,
  ) => Answer<typeof workflowVersionDiffDocumentSchema>;
}

interface WorkflowRunMethods extends PageMethods<
  typeof listWorkflowRunsQuerySchema,
  typeof workflowRunListDocumentSchema,
  true
> {
  retrieve: (
    id: string,
    params?: { include?: WorkflowRunInclude | readonly WorkflowRunInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof workflowRunIncludeDocumentSchema>;
  steps: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof workflowRunStepListDocumentSchema>;
  /** C118.1: refused, filtered and expired deliveries, with their reason codes. */
  deliveries: (
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof workflowTriggerDeliveryListDocumentSchema>;
  resume: ActionMethod<typeof resumeWorkflowRunBodySchema, typeof workflowRunDocumentSchema>;
  rerun: ActionMethod<typeof rerunWorkflowRunBodySchema, typeof workflowRunDocumentSchema>;
  cancel: ActionMethod<typeof cancelWorkflowRunBodySchema, typeof workflowRunDocumentSchema>;
  /** C120.9: `DELETE`, under `workflow-runs:redact`. */
  redact: RetrieveMethod<typeof workflowRunDocumentSchema>;
}

interface WorkflowTestRunMethods {
  /** C120.7: on the draft unless a version is named; sandbox environments only. */
  create: (
    workflowId: string,
    attributes: CreateWorkflowTestRunBody['data']['attributes'],
    meta?: CreateWorkflowTestRunBody['meta'],
    options?: RequestOptions,
  ) => Answer<typeof workflowRunDocumentSchema>;
}

interface AccountActionMethods extends PageMethods<
  typeof listAccountActionsQuerySchema,
  typeof accountActionListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createAccountActionBodySchema, typeof accountActionDocumentSchema>;
  retrieve: RetrieveMethod<typeof accountActionDocumentSchema>;
  update: UpdateMethod<typeof updateAccountActionBodySchema, typeof accountActionDocumentSchema>;
  /** C118.7: needs the version's grant as well as `workflows:trigger` and `accounts:read`. */
  run: (
    accountId: string,
    data: RunAccountActionBody['data'],
    options?: RequestOptions,
  ) => Answer<typeof runAccountActionDocumentSchema>;
  /** C118.7: filtered by the caller's grant, prefilled under the caller's mask. */
  available: (
    accountId: string,
    options?: RequestOptions,
  ) => Answer<typeof accountAvailableActionListDocumentSchema>;
}

/** C135.1 (Workflow 8B): what `cases.uploadAttachment` sends; the API sniffs the type itself. */
export interface CaseAttachmentFile {
  bytes: Uint8Array;
  /** Sealed by the API; never in a header, a path or a key (C135.2). */
  filename: string;
  mimeType?: string;
}

/** C135.4, C138.1 (Workflow 8B): an attachment's rendition or original, or an export's file. */
export interface CaseFileContent {
  bytes: Uint8Array;
  mimeType: string | null;
}

/** C143.6 (Workflow 8B): what `cases.retrieve` can include. */
type CaseInclude = (typeof CASE_INCLUDES)[number];

/** C129.5 (Workflow 8B): cases, what is done to them, and what reads them. */
interface CaseMethods extends PageMethods<
  typeof listCasesQuerySchema,
  typeof caseListDocumentSchema,
  true
> {
  /** C129.5: `meta` holds `object-ids` and `sla-expires-in-seconds`. */
  create: (
    attributes: CreateCaseBody['data']['attributes'],
    meta?: CreateCaseBody['meta'],
    options?: RequestOptions,
  ) => Answer<typeof caseDocumentSchema>;
  retrieve: (
    id: string,
    params?: { include?: CaseInclude | readonly CaseInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof caseIncludeDocumentSchema>;
  update: (
    id: string,
    body: UpdateCaseBody,
    options?: RequestOptions,
  ) => Answer<typeof caseDocumentSchema>;
  /** `DELETE`: redacts the case alone; what it holds keeps its own lifecycle (C139.1). */
  redact: RetrieveMethod<typeof caseDocumentSchema>;
  setStatus: MetaActionMethod<typeof setCaseStatusBodySchema, typeof caseDocumentSchema>;
  addComment: MetaActionMethod<typeof addCaseCommentBodySchema, typeof caseDocumentSchema>;
  addObjects: MetaActionMethod<typeof addCaseObjectsBodySchema, typeof caseDocumentSchema>;
  removeObjects: MetaActionMethod<typeof removeCaseObjectsBodySchema, typeof caseDocumentSchema>;
  addTag: MetaActionMethod<typeof addCaseTagBodySchema, typeof caseDocumentSchema>;
  removeTag: MetaActionMethod<typeof removeCaseTagBodySchema, typeof caseDocumentSchema>;
  setTags: MetaActionMethod<typeof setCaseTagsBodySchema, typeof caseDocumentSchema>;
  /** C138.3: audits and fires `case.print-initiated`, before the browser's print dialog. */
  print: ActionMethod<typeof printCaseBodySchema, typeof caseDocumentSchema>;
  /** C137.2: read after write; a `fields.*` leaf needs PII visibility. */
  search: (
    body: CaseSearchBody,
    options?: RequestOptions,
  ) => Answer<typeof caseSearchDocumentSchema>;
  /** C137.4: asynchronous; `bulkAction` reads the outcomes. */
  bulk: (
    body: CreateCaseBulkActionBody,
    options?: RequestOptions,
  ) => Answer<typeof caseBulkActionDocumentSchema>;
  bulkAction: RetrieveMethod<typeof caseBulkActionDocumentSchema>;
  /** C134.1: newest first. */
  comments: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof caseCommentListDocumentSchema>;
  /** C131.4: the timeline, newest first; PII-free by rule. */
  history: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof caseHistoryListDocumentSchema>;
  /** C136.3: each held object with its state as attached; the live object has its own route. */
  objects: (
    id: string,
    params?: ListParams,
    options?: RequestOptions,
  ) => Answer<typeof caseHeldObjectListDocumentSchema>;
  /** C132.3: `cases:assign`, or `cases:write` to assign oneself; `user-id: null` unassigns. */
  assign: MetaActionMethod<typeof assignCaseBodySchema, typeof caseDocumentSchema>;
  /** C132.3: pulls the most urgent unassigned case of the caller's queues; `data` is `null` if none. */
  next: (
    meta?: NonNullable<NextCaseBody>['meta'],
    options?: RequestOptions,
  ) => Answer<typeof nextCaseDocumentSchema>;
  /** C135.1: one attachment as multipart, at most 10 MiB; answers the case. */
  uploadAttachment: (
    id: string,
    file: CaseAttachmentFile,
    options?: RequestOptions,
  ) => Answer<typeof caseDocumentSchema>;
  /**
   * C135.4: the rendition (a PDF's page `page`, 1-based), never the original; `cases:read` and
   * `pii:view`. A rendition not made yet answers 202 with a JSON document holding
   * `meta.retry-after-seconds`, returned here as its bytes with that type; a scan not done answers
   * 409, which throws.
   */
  attachmentContent: (
    id: string,
    attachmentId: string,
    params?: { page?: number },
    options?: RequestOptions,
  ) => Promise<CaseFileContent>;
  /** C135.4 (P23): the sealed original, audited; `cases:redact` and `pii:view`. */
  attachmentOriginal: (
    id: string,
    attachmentId: string,
    options?: RequestOptions,
  ) => Promise<CaseFileContent>;
  /** C128.7: opens a review on the contest route's case template, with the person's statement. */
  requestReview: (
    inquiryId: string,
    meta: CreateInquiryReviewRequestBody['meta'],
    options?: RequestOptions,
  ) => Answer<typeof caseDocumentSchema>;
}

/** C130 (Workflow 8B): case templates. */
interface CaseTemplateMethods extends PageMethods<
  typeof listCaseTemplatesQuerySchema,
  typeof caseTemplateListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseTemplateBodySchema, typeof caseTemplateDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseTemplateDocumentSchema>;
  update: UpdateMethod<typeof updateCaseTemplateBodySchema, typeof caseTemplateDocumentSchema>;
  /** C130.1: refuses new cases and keeps existing ones. */
  archive: ActionMethod<typeof archiveCaseTemplateBodySchema, typeof caseTemplateDocumentSchema>;
}

/** C130.2, owner decision 7 after 7B: a template's versions, newest first. */
interface CaseTemplateVersionMethods extends PageMethods<
  typeof listCaseTemplateVersionsQuerySchema,
  typeof caseTemplateVersionListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createCaseTemplateVersionBodySchema,
    typeof caseTemplateVersionDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof caseTemplateVersionDocumentSchema>;
  update: UpdateMethod<
    typeof updateCaseTemplateVersionBodySchema,
    typeof caseTemplateVersionDocumentSchema
  >;
  publish: ActionMethod<
    typeof publishCaseTemplateVersionBodySchema,
    typeof caseTemplateVersionDocumentSchema
  >;
}

/** C154.7 (Workflow 9A): the read-only history of template publishes (`deployments:read`). */
interface DeploymentMethods extends PageMethods<
  typeof listDeploymentsQuerySchema,
  typeof deploymentListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof deploymentDocumentSchema>;
}

/**
 * C162.7 (Workflow 9A): a template's translations, from its latest draft, else its latest published
 * version. `import` writes rows into the draft (creating one when none exists), never publishes, and
 * a blank value deletes nothing.
 */
interface InquiryTemplateTranslationMethods {
  retrieve: (
    templateId: string,
    options?: RequestOptions,
  ) => Answer<typeof inquiryTemplateTranslationsDocumentSchema>;
  import: (
    templateId: string,
    translations: ImportTranslationsBody['data']['attributes']['translations'],
    options?: RequestOptions,
  ) => Answer<typeof inquiryTemplateTranslationsDocumentSchema>;
}

/** C160.6 (Workflow 9A): a theme asset's bytes, as uploaded. */
export interface ThemeAssetFile {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}

/** C160.6: a font's licence attestation (decision 27) and its optional `unicode-range`. */
export interface ThemeAssetUploadOptions extends RequestOptions {
  licenceAttested?: boolean;
  unicodeRange?: string;
}

/**
 * C160 (Workflow 9A): the environment's theme sets. `update`'s `styles`, when sent, replaces the
 * whole tree; `archive` is `DELETE`; each save is a revision, which `restore` copies into a new one.
 * `uploadAsset` answers once a logo's rendition is stored; `assetContent` reads that rendition.
 */
interface ThemeSetMethods extends PageMethods<
  typeof listThemeSetsQuerySchema,
  typeof themeSetListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createThemeSetBodySchema, typeof themeSetDocumentSchema>;
  retrieve: RetrieveMethod<typeof themeSetDocumentSchema>;
  update: UpdateMethod<typeof updateThemeSetBodySchema, typeof themeSetDocumentSchema>;
  archive: RetrieveMethod<typeof themeSetDocumentSchema>;
  revisions: (
    id: string,
    params?: { page?: { size?: number; before?: number } },
    options?: RequestOptions,
  ) => Answer<typeof themeSetRevisionListDocumentSchema>;
  restore: (
    id: string,
    revision: number,
    options?: RequestOptions,
  ) => Answer<typeof themeSetDocumentSchema>;
  uploadAsset: (
    kind: ThemeAssetKind,
    file: ThemeAssetFile,
    options?: ThemeAssetUploadOptions,
  ) => Answer<typeof themeAssetDocumentSchema>;
  assetContent: (id: string, options?: RequestOptions) => Promise<CaseFileContent>;
}

/**
 * C164.8 (Workflow 9B): one read of the aggregates API (`analytics:read`), its query as the route
 * takes it (`filter[from]`, `filter[to]`, `bucket`, ...). Every answer is suppressed by the server.
 */
type AnalyticsRead<Query extends z.ZodType, Document extends z.ZodType> = (
  query: z.input<Query>,
  options?: RequestOptions,
) => Answer<Document>;

/** C164.8 (Workflow 9B): the six answers, always the caller's one environment. */
interface AnalyticsMethods {
  inquiries: AnalyticsRead<
    typeof analyticsInquiriesQuerySchema,
    typeof analyticsInquiriesDocumentSchema
  >;
  funnel: AnalyticsRead<typeof analyticsFunnelQuerySchema, typeof analyticsFunnelDocumentSchema>;
  verifications: AnalyticsRead<
    typeof analyticsVerificationsQuerySchema,
    typeof analyticsVerificationsDocumentSchema
  >;
  checks: AnalyticsRead<typeof analyticsChecksQuerySchema, typeof analyticsChecksDocumentSchema>;
  cases: AnalyticsRead<typeof analyticsCasesQuerySchema, typeof analyticsCasesDocumentSchema>;
  signals: AnalyticsRead<typeof analyticsSignalsQuerySchema, typeof analyticsSignalsDocumentSchema>;
}

/** C166 (Workflow 9B): the caller's own exports; `download` re-checks the type's `:export`. */
interface ExportMethods extends PageMethods<
  typeof listExportsQuerySchema,
  typeof exportListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createExportBodySchema, typeof exportDocumentSchema>;
  retrieve: RetrieveMethod<typeof exportDocumentSchema>;
  /** The CSV, for 24 hours. */
  download: (id: string, options?: RequestOptions) => Promise<CaseFileContent>;
}

/** C132.1 (Workflow 8B): queues; `setMembers` replaces the whole member list. */
interface CaseQueueMethods extends PageMethods<
  typeof listCaseQueuesQuerySchema,
  typeof caseQueueListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseQueueBodySchema, typeof caseQueueDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseQueueDocumentSchema>;
  update: UpdateMethod<typeof updateCaseQueueBodySchema, typeof caseQueueDocumentSchema>;
  setMembers: (
    id: string,
    members: SetCaseQueueMembersBody['data']['attributes']['members'],
    options?: RequestOptions,
  ) => Answer<typeof caseQueueDocumentSchema>;
}

/** C132.2 (Workflow 8B): assignment policies. */
interface CaseAssignmentPolicyMethods extends PageMethods<
  typeof listCaseAssignmentPoliciesQuerySchema,
  typeof caseAssignmentPolicyListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createCaseAssignmentPolicyBodySchema,
    typeof caseAssignmentPolicyDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof caseAssignmentPolicyDocumentSchema>;
  update: UpdateMethod<
    typeof updateCaseAssignmentPolicyBodySchema,
    typeof caseAssignmentPolicyDocumentSchema
  >;
}

/** C133.1 (Workflow 8B): SLA policies; an edit is a new revision. */
interface CaseSlaPolicyMethods extends PageMethods<
  typeof listCaseSlaPoliciesQuerySchema,
  typeof caseSlaPolicyListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseSlaPolicyBodySchema, typeof caseSlaPolicyDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseSlaPolicyDocumentSchema>;
  update: UpdateMethod<typeof updateCaseSlaPolicyBodySchema, typeof caseSlaPolicyDocumentSchema>;
}

/** C133.2 (Workflow 8B): business calendars, and a holiday CSV import. */
interface CaseCalendarMethods extends PageMethods<
  typeof listCaseCalendarsQuerySchema,
  typeof caseCalendarListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseCalendarBodySchema, typeof caseCalendarDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseCalendarDocumentSchema>;
  update: UpdateMethod<typeof updateCaseCalendarBodySchema, typeof caseCalendarDocumentSchema>;
  /** C133.2: a `date,label` CSV; refused rows come back by number and code. */
  importHolidays: (
    id: string,
    attributes: ImportCaseCalendarHolidaysBody['data']['attributes'],
    options?: RequestOptions,
  ) => Answer<typeof caseCalendarImportDocumentSchema>;
}

/** C138.1 (Workflow 8B): exports, read and downloaded by their creator alone (P26). */
interface CaseExportMethods extends PageMethods<
  typeof listCaseExportsQuerySchema,
  typeof caseExportListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseExportBodySchema, typeof caseExportDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseExportDocumentSchema>;
  /** The file, for 24 hours; each download re-checks `cases:export` (and `pii:view`). */
  download: (id: string, options?: RequestOptions) => Promise<CaseFileContent>;
}

/** C134.2 (Workflow 8B): append-only, so a comment's one write is its redaction. */
interface CaseCommentMethods {
  redact: ActionMethod<typeof redactCaseCommentBodySchema, typeof caseCommentDocumentSchema>;
}

/** C140.1 (Workflow 8B): case actions. */
interface CaseActionMethods extends PageMethods<
  typeof listCaseActionsQuerySchema,
  typeof caseActionListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createCaseActionBodySchema, typeof caseActionDocumentSchema>;
  retrieve: RetrieveMethod<typeof caseActionDocumentSchema>;
  update: UpdateMethod<typeof updateCaseActionBodySchema, typeof caseActionDocumentSchema>;
  /** C140.1: needs the version's grant as well as `workflows:trigger` and `cases:read`. */
  run: (
    caseId: string,
    data: RunCaseActionBody['data'],
    options?: RequestOptions,
  ) => Answer<typeof runCaseActionDocumentSchema>;
  /** C140.1: filtered by the caller's grant, prefilled under the caller's mask. */
  available: (
    caseId: string,
    options?: RequestOptions,
  ) => Answer<typeof caseAvailableActionListDocumentSchema>;
}

/** Owner decision 7 after Workflow 7B: a type's versions, newest first. */
type TransactionTypeVersionMethods = PageMethods<
  typeof listTransactionTypeVersionsQuerySchema,
  typeof transactionTypeVersionListDocumentSchema,
  true
>;

/** Owner decision 7 after Workflow 7B: a template's versions, newest first. */
type GraphQueryTemplateVersionMethods = PageMethods<
  typeof listGraphQueryTemplateVersionsQuerySchema,
  typeof graphQueryTemplateVersionListDocumentSchema,
  true
>;

/** C102.1 (Workflow 7B): query templates and their versions: a draft, then published. */
interface GraphQueryTemplateMethods extends PageMethods<
  typeof listGraphQueryTemplatesQuerySchema,
  typeof graphQueryTemplateListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createGraphQueryTemplateBodySchema,
    typeof graphQueryTemplateDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof graphQueryTemplateDocumentSchema>;
  update: UpdateMethod<
    typeof updateGraphQueryTemplateBodySchema,
    typeof graphQueryTemplateDocumentSchema
  >;
  archive: RetrieveMethod<typeof graphQueryTemplateDocumentSchema>;
  versions: {
    create: CreateMethod<
      typeof createGraphQueryTemplateVersionBodySchema,
      typeof graphQueryTemplateVersionDocumentSchema
    >;
    retrieve: RetrieveMethod<typeof graphQueryTemplateVersionDocumentSchema>;
    update: UpdateMethod<
      typeof updateGraphQueryTemplateVersionBodySchema,
      typeof graphQueryTemplateVersionDocumentSchema
    >;
    publish: ActionMethod<
      typeof publishGraphQueryTemplateVersionBodySchema,
      typeof graphQueryTemplateVersionDocumentSchema
    >;
  };
}

/** C2 and C11: inquiry templates. Their list takes no creation range. */
interface InquiryTemplateMethods extends PageMethods<
  typeof listInquiryTemplatesQuerySchema,
  typeof inquiryTemplateListDocumentSchema,
  false
> {
  create: CreateMethod<
    typeof createInquiryTemplateBodySchema,
    typeof inquiryTemplateDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof inquiryTemplateDocumentSchema>;
  update: UpdateMethod<
    typeof updateInquiryTemplateBodySchema,
    typeof inquiryTemplateDocumentSchema
  >;
}

/** C11: template versions, drafted then published. */
interface InquiryTemplateVersionMethods extends PageMethods<
  typeof listInquiryTemplateVersionsQuerySchema,
  typeof inquiryTemplateVersionListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createInquiryTemplateVersionBodySchema,
    typeof inquiryTemplateVersionDocumentSchema
  >;
  update: UpdateMethod<
    typeof updateInquiryTemplateVersionBodySchema,
    typeof inquiryTemplateVersionDocumentSchema
  >;
  publish: ActionMethod<
    typeof publishInquiryTemplateVersionBodySchema,
    typeof inquiryTemplateVersionDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof inquiryTemplateVersionDocumentSchema>;
}

/** C2: verifications with their checks; `include: 'selfies'` adds a selfie's captures. */
interface VerificationMethods {
  retrieve: (
    id: string,
    params?: { include?: 'selfies' },
    options?: RequestOptions,
  ) => Answer<typeof verificationDocumentSchema>;
}

/** C40.1: selfie captures (never their nonce or device data). */
interface SelfieMethods {
  retrieve: RetrieveMethod<typeof selfieCaptureDocumentSchema>;
}

/** C13: accounts, their tags, relations, consolidation and redaction. */
/** What `accountExports.fileContent` answers: a listed file's bytes and their type. */
export interface AccountExportFileContent {
  bytes: Uint8Array;
  mimeType: string | null;
}

/**
 * C253 (Workflow 11B): an account's access export. `create` answers the export `pending` (202);
 * `manifest` is the `openverify.account-export.v1` document once it is `ready`; `fileContent` is a
 * file the manifest lists, served whole from the live object (410 once it was redacted). Needs the
 * scope `account-access:export` and `pii:view`.
 */
interface AccountExportMethods {
  create: (
    accountId: string,
    options?: RequestOptions,
  ) => Answer<typeof accountExportDocumentSchema>;
  retrieve: RetrieveMethod<typeof accountExportDocumentSchema>;
  manifest: (id: string, options?: RequestOptions) => Answer<typeof accountExportManifestSchema>;
  fileContent: (
    id: string,
    fileId: string,
    options?: RequestOptions,
  ) => Promise<AccountExportFileContent>;
}

interface AccountMethods extends PageMethods<
  typeof listAccountsQuerySchema,
  typeof accountListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createAccountBodySchema, typeof accountDocumentSchema>;
  /**
   * `include: 'reports'` (C70.5) adds the account's reports to `included`; `'list-matches'` and
   * `'transactions'` (Workflow 7B) add those.
   */
  retrieve: (
    id: string,
    params?: { include?: AccountInclude | readonly AccountInclude[] },
    options?: RequestOptions,
  ) => Answer<typeof accountIncludeDocumentSchema>;
  update: UpdateMethod<typeof updateAccountBodySchema, typeof accountDocumentSchema>;
  addTag: MetaActionMethod<typeof addTagBodySchema, typeof accountDocumentSchema>;
  removeTag: MetaActionMethod<typeof removeTagBodySchema, typeof accountDocumentSchema>;
  setTags: MetaActionMethod<typeof setTagsBodySchema, typeof accountDocumentSchema>;
  addRelation: MetaActionMethod<typeof addAccountRelationBodySchema, typeof accountDocumentSchema>;
  removeRelation: MetaActionMethod<
    typeof removeAccountRelationBodySchema,
    typeof accountDocumentSchema
  >;
  /** Relations in both directions; not paged. */
  listRelations: (
    id: string,
    options?: RequestOptions,
  ) => Answer<typeof accountRelationListDocumentSchema>;
  /** C101.6: the account's graph component; needs `graph:read`. */
  graphComponent: (
    id: string,
    options?: RequestOptions,
  ) => Answer<typeof accountGraphComponentDocumentSchema>;
  consolidate: MetaActionMethod<typeof consolidateAccountsBodySchema, typeof accountDocumentSchema>;
  addObjects: MetaActionMethod<typeof addAccountObjectsBodySchema, typeof accountDocumentSchema>;
  removeObjects: MetaActionMethod<
    typeof removeAccountObjectsBodySchema,
    typeof accountDocumentSchema
  >;
  redact: ActionMethod<typeof redactAccountBodySchema, typeof accountDocumentSchema>;
}

/** C13: account types. */
interface AccountTypeMethods extends PageMethods<
  typeof listAccountTypesQuerySchema,
  typeof accountTypeListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createAccountTypeBodySchema, typeof accountTypeDocumentSchema>;
  retrieve: RetrieveMethod<typeof accountTypeDocumentSchema>;
  /**
   * C25.3: the name and the whole new `fields-schema`, which may only add keys and change
   * labels (422 with a pointer to each key it would remove or retype).
   */
  update: UpdateMethod<typeof updateAccountTypeBodySchema, typeof accountTypeDocumentSchema>;
}

/**
 * C2 and C14: webhooks. `create`, `clone` and `rotateSecret` return the secret once. Their list
 * takes no creation range.
 */
interface WebhookMethods extends PageMethods<
  typeof listWebhooksQuerySchema,
  typeof webhookListDocumentSchema,
  false
> {
  create: CreateMethod<typeof createWebhookBodySchema, typeof createdWebhookDocumentSchema>;
  retrieve: RetrieveMethod<typeof webhookDocumentSchema>;
  update: UpdateMethod<typeof updateWebhookBodySchema, typeof webhookDocumentSchema>;
  enable: ActionMethod<typeof enableWebhookBodySchema, typeof webhookDocumentSchema>;
  disable: ActionMethod<typeof disableWebhookBodySchema, typeof webhookDocumentSchema>;
  /** Final: an archived webhook never receives events again. */
  archive: ActionMethod<typeof archiveWebhookBodySchema, typeof webhookDocumentSchema>;
  clone: ActionMethod<typeof cloneWebhookBodySchema, typeof createdWebhookDocumentSchema>;
  rotateSecret: ActionMethod<
    typeof rotateWebhookSecretBodySchema,
    typeof rotateWebhookSecretDocumentSchema
  >;
  simulate: MetaActionMethod<
    typeof simulateWebhookBodySchema,
    typeof simulateWebhookDocumentSchema
  >;
  replay: MetaActionMethod<typeof replayWebhookBodySchema, typeof replayWebhookDocumentSchema>;
}

/** A Connect action on one object that takes no body (C231.4, C232.4). */
type ConnectIdAction<Schema extends z.ZodType> = (
  id: string,
  options?: RequestOptions,
) => Answer<Schema>;

/**
 * C230-C231 (Workflow 11A): connections, both directions. Organisation-level writes need a
 * production principal; the activation is the destination's, in the console only (C231.3).
 */
interface ConnectConnectionMethods extends PageMethods<
  typeof listConnectionsQuerySchema,
  typeof connectionListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createConnectionBodySchema, typeof connectionDocumentSchema>;
  retrieve: RetrieveMethod<typeof connectionDocumentSchema>;
  deactivate: ConnectIdAction<typeof connectionDocumentSchema>;
  /** The source only: an inactive connection back to `pending`. */
  reactivate: ConnectIdAction<typeof connectionDocumentSchema>;
  /** The source only: version n+1; an active connection goes back to `pending`. */
  changeSharePolicy: UpdateMethod<
    typeof changeSharePolicyBodySchema,
    typeof connectionDocumentSchema
  >;
}

/**
 * C232-C234 (Workflow 11A): share tokens, outbound and inbound. A token id is a handle, not a
 * secret. `peek` reads the source data in the `{visibility, value}` envelope (C233; counted, at most
 * ten a token); `redeem` answers 202 and the copy is made by a job (C234).
 */
interface ConnectShareTokenMethods extends PageMethods<
  typeof listShareTokensQuerySchema,
  typeof shareTokenListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createShareTokenBodySchema, typeof shareTokenDocumentSchema>;
  retrieve: RetrieveMethod<typeof shareTokenDocumentSchema>;
  peek: RetrieveMethod<typeof shareTokenDocumentSchema>;
  /** The source only, while `created`. */
  expire: ConnectIdAction<typeof shareTokenDocumentSchema>;
  /** `destinationId` makes a hydrate; without it a clone (C234.1). */
  redeem: (
    id: string,
    meta: z.input<typeof redeemShareTokenBodySchema>['meta'],
    destinationId?: string,
    options?: RequestOptions,
  ) => Answer<typeof shareTokenDocumentSchema>;
}

/** C236-C237 (Workflow 11A): consent records; an attested record is not witnessed (C236.2). */
interface ConnectConsentRecordMethods extends PageMethods<
  typeof listConsentRecordsQuerySchema,
  typeof consentRecordListDocumentSchema,
  true
> {
  attest: CreateMethod<typeof attestConsentRecordBodySchema, typeof consentRecordDocumentSchema>;
  retrieve: RetrieveMethod<typeof consentRecordDocumentSchema>;
  withdraw: (
    id: string,
    attributes?: Attributes<typeof withdrawConsentRecordBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof consentRecordDocumentSchema>;
}

/** C14: webhook deliveries with their attempts. */
interface WebhookDeliveryMethods extends PageMethods<
  typeof listWebhookDeliveriesQuerySchema,
  typeof webhookDeliveryListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof webhookDeliveryDocumentSchema>;
}

/**
 * C5 and C12: events. Simulated events are listed only with `simulated: true`;
 * `filter: { 'inquiry-id' }` (C25.7) lists an inquiry's timeline.
 */
interface EventMethods extends PageMethods<
  typeof listEventsQuerySchema,
  typeof eventListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof eventDocumentSchema>;
}

/**
 * C12: API keys. `create` and `clone` return the token once (`meta.token`); `create` takes
 * `expires-in-seconds` (C25.5), and every answer says `pii-masked` (C25.6).
 */
interface ApiKeyMethods extends PageMethods<
  typeof listApiKeysQuerySchema,
  typeof apiKeyListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createApiKeyBodySchema, typeof createdApiKeyDocumentSchema>;
  retrieve: RetrieveMethod<typeof apiKeyDocumentSchema>;
  update: UpdateMethod<typeof updateApiKeyBodySchema, typeof apiKeyDocumentSchema>;
  clone: ActionMethod<typeof cloneApiKeyBodySchema, typeof createdApiKeyDocumentSchema>;
  expire: MetaActionMethod<typeof expireApiKeyBodySchema, typeof apiKeyDocumentSchema>;
}

/** C12: API logs; `filter: { 'user-id' }` (C25.9) lists a user's dashboard requests. */
interface ApiLogMethods extends PageMethods<
  typeof listApiLogsQuerySchema,
  typeof apiLogListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof apiLogDocumentSchema>;
}

/** C12: the caller's rate limits. */
interface RateLimitMethods {
  list: (options?: RequestOptions) => Answer<typeof rateLimitListDocumentSchema>;
}

/**
 * C55.11: the codes the sandbox SMS sender kept for a number, newest first. Needs a key of a
 * sandbox environment with `sandbox:read`; the route exists only while the sandbox sender is bound
 * outside production mode. The number goes in the body, never in the URL.
 */
interface SandboxSmsMessageMethods {
  search: (
    phoneNumber: string,
    options?: RequestOptions,
  ) => Answer<typeof sandboxSmsSearchResponseSchema>;
}

/** C126.4 (Workflow 8A): what a workflow's messages recorded in the sandbox, each by its own key. */
interface SandboxEmailMessageMethods {
  search: (
    emailAddress: string,
    options?: RequestOptions,
  ) => Answer<typeof sandboxEmailSearchResponseSchema>;
}

interface SandboxSlackMessageMethods {
  search: (
    secretId: string,
    options?: RequestOptions,
  ) => Answer<typeof sandboxSlackSearchResponseSchema>;
}

interface SandboxWorkflowSmsMessageMethods {
  search: (
    phoneNumber: string,
    options?: RequestOptions,
  ) => Answer<typeof sandboxWorkflowSmsSearchResponseSchema>;
}

/**
 * C125 (Workflow 8A): workflow secrets, read as metadata only and addressed by key. A value route
 * acts on the caller's own environment; a value is written once and never returned.
 */
interface WorkflowSecretMethods extends PageMethods<
  typeof listWorkflowSecretsQuerySchema,
  typeof workflowSecretListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createWorkflowSecretBodySchema, typeof workflowSecretDocumentSchema>;
  retrieve: RetrieveMethod<typeof workflowSecretDocumentSchema>;
  update: UpdateMethod<typeof updateWorkflowSecretBodySchema, typeof workflowSecretDocumentSchema>;
  putValue: (
    key: string,
    environmentId: string,
    secretValue: string,
    options?: RequestOptions,
  ) => Answer<typeof workflowSecretDocumentSchema>;
  rotateValue: (
    key: string,
    environmentId: string,
    secretValue: string,
    options?: RequestOptions,
  ) => Answer<typeof workflowSecretDocumentSchema>;
  /** Refused with 409 `secret_in_use` while a published version references the key. */
  delete: (key: string, options?: RequestOptions) => Answer<typeof workflowSecretDocumentSchema>;
}

/** C15: user audit logs. */
interface UserAuditLogMethods extends PageMethods<
  typeof listUserAuditLogsQuerySchema,
  typeof userAuditLogListDocumentSchema,
  true
> {
  retrieve: RetrieveMethod<typeof userAuditLogDocumentSchema>;
}

/** `data.attributes` of a body whose data carries no type (dismiss, review). */
type DataAttributes<Body extends z.ZodType> =
  z.input<Body> extends { data: { attributes: infer A } } ? A : never;

/** C72.1: what `reports.create` sends under `data.attributes`, by type. */
export type CreateReportAttributes = z.input<typeof createReportBodySchema>['data']['attributes'];
/** C72.1: the creation `meta` (account linking and the processing mode). */
export type CreateReportMeta = NonNullable<z.input<typeof createReportBodySchema>['meta']>;

/**
 * C72 (Phase 6): reports, their tags, review, monitoring, history and redaction. `create` names
 * the type (`report/watchlist`) and takes the public body; `redact` is `DELETE /reports/:id`.
 */
interface ReportMethods extends PageMethods<
  typeof listReportsQuerySchema,
  typeof reportListDocumentSchema,
  true
> {
  create: (
    type: ReportResourceType,
    attributes: CreateReportAttributes,
    meta?: CreateReportMeta,
    options?: RequestOptions,
  ) => Answer<typeof reportDocumentSchema>;
  retrieve: RetrieveMethod<typeof reportDocumentSchema>;
  /** Redaction (C73.5): the report's PII nulled; answers the redacted report. */
  redact: (id: string, options?: RequestOptions) => Answer<typeof reportDocumentSchema>;
  addTag: MetaActionMethod<typeof addTagBodySchema, typeof reportDocumentSchema>;
  removeTag: MetaActionMethod<typeof removeTagBodySchema, typeof reportDocumentSchema>;
  setTags: MetaActionMethod<typeof setTagsBodySchema, typeof reportDocumentSchema>;
  /**
   * C75.2: the body under `data.attributes`, as the public endpoint takes it. Needs
   * `reports:review` and a key that is not PII-masked: 403 otherwise (owner decision 16).
   */
  dismiss: (
    id: string,
    attributes: DataAttributes<typeof dismissReportBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof reportDocumentSchema>;
  /** C75.5: the body under `data.attributes`. Needs what `dismiss` needs. */
  review: (
    id: string,
    attributes: DataAttributes<typeof reviewReportBodySchema>,
    options?: RequestOptions,
  ) => Answer<typeof reportDocumentSchema>;
  pause: ActionMethod<typeof pauseReportBodySchema, typeof reportDocumentSchema>;
  resume: ActionMethod<typeof resumeReportBodySchema, typeof reportDocumentSchema>;
  run: ActionMethod<typeof runReportBodySchema, typeof reportDocumentSchema>;
  /** C74.2: one page of runs and actions, newest first. */
  history: (
    id: string,
    params?: { page?: { after?: string; size?: number } },
    options?: RequestOptions,
  ) => Answer<typeof reportHistoryDocumentSchema>;
  /** C74.2: every run and action, page after page. */
  historyAll: (
    id: string,
    params?: { page?: { size?: number } },
    options?: RequestOptions,
  ) => AsyncGenerator<Item<typeof reportHistoryDocumentSchema>, void, undefined>;
}

/** C71: report templates; creating one publishes its version 1. */
interface ReportTemplateMethods extends PageMethods<
  typeof listReportTemplatesQuerySchema,
  typeof reportTemplateListDocumentSchema,
  true
> {
  create: CreateMethod<typeof createReportTemplateBodySchema, typeof reportTemplateDocumentSchema>;
  retrieve: RetrieveMethod<typeof reportTemplateDocumentSchema>;
  update: UpdateMethod<typeof updateReportTemplateBodySchema, typeof reportTemplateDocumentSchema>;
}

/** C71: report template versions, drafted then published. */
interface ReportTemplateVersionMethods extends PageMethods<
  typeof listReportTemplateVersionsQuerySchema,
  typeof reportTemplateVersionListDocumentSchema,
  true
> {
  create: CreateMethod<
    typeof createReportTemplateVersionBodySchema,
    typeof reportTemplateVersionDocumentSchema
  >;
  retrieve: RetrieveMethod<typeof reportTemplateVersionDocumentSchema>;
  update: UpdateMethod<
    typeof updateReportTemplateVersionBodySchema,
    typeof reportTemplateVersionDocumentSchema
  >;
  publish: ActionMethod<
    typeof publishReportTemplateVersionBodySchema,
    typeof reportTemplateVersionDocumentSchema
  >;
}

/** The C18 client: one group of methods per resource. */
export interface OpenVerifyClient {
  inquiries: InquiryMethods;
  inquirySessions: InquirySessionMethods;
  devices: DeviceMethods;
  decisions: DecisionMethods;
  lists: ListMethods;
  listItems: ListItemMethods;
  listMatches: ListMatchMethods;
  importers: ImporterMethods;
  transactions: TransactionMethods;
  transactionTypes: TransactionTypeMethods;
  graphQueries: GraphQueryMethods;
  /** C112, C116, C118, C122.4, C140.5 (Workflow 8A). */
  workflows: WorkflowMethods;
  workflowVersions: WorkflowVersionMethods;
  workflowRuns: WorkflowRunMethods;
  workflowTestRuns: WorkflowTestRunMethods;
  accountActions: AccountActionMethods;
  /** C129-C140 (Workflow 8B). */
  cases: CaseMethods;
  caseTemplates: CaseTemplateMethods;
  caseTemplateVersions: CaseTemplateVersionMethods;
  caseComments: CaseCommentMethods;
  caseActions: CaseActionMethods;
  /** C132, C133 (Workflow 8B): queues, policies and calendars. */
  caseQueues: CaseQueueMethods;
  caseAssignmentPolicies: CaseAssignmentPolicyMethods;
  caseSlaPolicies: CaseSlaPolicyMethods;
  caseCalendars: CaseCalendarMethods;
  /** C138 (Workflow 8B). */
  caseExports: CaseExportMethods;
  graphQueryTemplates: GraphQueryTemplateMethods;
  graphQueryTemplateVersions: GraphQueryTemplateVersionMethods;
  transactionTypeVersions: TransactionTypeVersionMethods;
  inquiryTemplates: InquiryTemplateMethods;
  inquiryTemplateVersions: InquiryTemplateVersionMethods;
  /** C154.7, C162.7 (Workflow 9A). */
  deployments: DeploymentMethods;
  inquiryTemplateTranslations: InquiryTemplateTranslationMethods;
  /** C160 (Workflow 9A). */
  themeSets: ThemeSetMethods;
  /** C164.8, C166 (Workflow 9B). */
  analytics: AnalyticsMethods;
  exports: ExportMethods;
  verifications: VerificationMethods;
  selfies: SelfieMethods;
  accounts: AccountMethods;
  /** C253 (Workflow 11B). */
  accountExports: AccountExportMethods;
  accountTypes: AccountTypeMethods;
  webhooks: WebhookMethods;
  /** C230-C231 (Workflow 11A): Connect connections. */
  connectConnections: ConnectConnectionMethods;
  /** C232-C234 (Workflow 11A): Connect share tokens, with peek and redeem. */
  connectShareTokens: ConnectShareTokenMethods;
  /** C236-C237 (Workflow 11A): consent records, attested and withdrawn. */
  connectConsentRecords: ConnectConsentRecordMethods;
  webhookDeliveries: WebhookDeliveryMethods;
  events: EventMethods;
  apiKeys: ApiKeyMethods;
  apiLogs: ApiLogMethods;
  rateLimits: RateLimitMethods;
  sandboxSmsMessages: SandboxSmsMessageMethods;
  /** C126.4 (Workflow 8A). */
  sandboxEmailMessages: SandboxEmailMessageMethods;
  sandboxSlackMessages: SandboxSlackMessageMethods;
  sandboxWorkflowSmsMessages: SandboxWorkflowSmsMessageMethods;
  /** C125 (Workflow 8A). */
  workflowSecrets: WorkflowSecretMethods;
  userAuditLogs: UserAuditLogMethods;
  // Phase 6 (C72).
  reports: ReportMethods;
  reportTemplates: ReportTemplateMethods;
  reportTemplateVersions: ReportTemplateVersionMethods;
}

/** Builds the resource methods on a transport. */
function resources(t: Transport): OpenVerifyClient {
  const at = (base: string, id: string, action?: string) =>
    `${base}/${encodeURIComponent(id)}${action === undefined ? '' : `/${action}`}`;

  const get = <Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    options?: RequestOptions,
    query?: URLSearchParams,
  ) => t.request({ method: 'GET', url: t.url(path, query), schema, options });

  const write = <Schema extends z.ZodType>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    schema: Schema,
    options?: RequestOptions,
  ) => t.request({ method, url: t.url(path), body, schema, options });

  /** `POST <base>` with `{ data: { type, attributes } }`. */
  const create =
    <Body extends z.ZodType, Schema extends z.ZodType>(
      base: string,
      type: string,
      _body: Body,
      schema: Schema,
    ) =>
    async (attributes: Attributes<Body>, options?: RequestOptions) =>
      write('POST', base, document(type, attributes), schema, options);

  /** `PATCH <base>/:id` with `{ data: { type, attributes } }`. */
  const update =
    <Body extends z.ZodType, Schema extends z.ZodType>(
      base: string,
      type: string,
      _body: Body,
      schema: Schema,
    ) =>
    async (id: string, attributes: Attributes<Body>, options?: RequestOptions) =>
      write('PATCH', at(base, id), document(type, attributes), schema, options);

  const retrieve =
    <Schema extends z.ZodType>(base: string, schema: Schema) =>
    async (id: string, options?: RequestOptions) =>
      get(at(base, id), schema, options);

  /** `POST <base>/:id/<action>` whose meta may be left out. */
  const action =
    <Body extends z.ZodType, Schema extends z.ZodType>(
      base: string,
      name: string,
      _body: Body,
      schema: Schema,
    ) =>
    async (id: string, meta?: Meta<Body>, options?: RequestOptions) =>
      write('POST', at(base, id, name), actionBody(meta), schema, options);

  /** `POST <base>/:id/<action>` that needs its meta. */
  const metaAction =
    <Body extends z.ZodType, Schema extends z.ZodType>(
      base: string,
      name: string,
      _body: Body,
      schema: Schema,
    ) =>
    async (id: string, meta: Meta<Body>, options?: RequestOptions) =>
      write('POST', at(base, id, name), actionBody(meta), schema, options);

  /**
   * `list()` (one page) and `listAll()` (every item of every page). `createdAt: false` for a
   * list whose query has no creation range: its filter type leaves it out, and a caller that
   * sends it anyway (from JavaScript) gets a `TypeError` before anything is sent.
   */
  const pages = <
    Query extends z.ZodType,
    Schema extends z.ZodType,
    CreatedAt extends boolean = true,
  >(
    base: string,
    _query: Query,
    schema: Schema,
    range?: { createdAt: CreatedAt },
  ) => {
    const query = (params: ListParams | undefined) => {
      if (range?.createdAt === false) {
        refuseCreatedAt(params);
      }
      return listQuery(params);
    };
    return {
      list: async (params?: ListParams<FilterNames<Query, CreatedAt>>, options?: RequestOptions) =>
        get(base, schema, options, query(params)),
      async *listAll(
        params?: ListParams<FilterNames<Query, CreatedAt>>,
        options?: RequestOptions,
      ): AsyncGenerator<Item<Schema>, void, undefined> {
        let url = t.url(base, query(params));
        for (;;) {
          const page = (await t.request({ method: 'GET', url, schema, options })) as {
            data: Item<Schema>[];
            links: { next: string | null };
          };
          yield* page.data;
          if (page.links.next === null) {
            return;
          }
          url = t.nextUrl(page.links.next);
        }
      },
    };
  };

  const INQUIRIES = '/inquiries';
  const SESSIONS = '/inquiry-sessions';
  const DEVICES = '/devices';
  const DECISIONS = '/decisions';
  const LISTS = '/lists';
  const LIST_ITEMS = '/list-items';
  const LIST_MATCHES = '/list-matches';
  const IMPORTERS = '/importers';
  const GRAPH_QUERIES = '/graph-queries';
  const GRAPH_TEMPLATES = '/graph-query-templates';
  const GRAPH_TEMPLATE_VERSIONS = '/graph-query-template-versions';
  const TRANSACTIONS = '/transactions';
  const TRANSACTION_TYPES = '/transaction-types';
  const TRANSACTION_TYPE_VERSIONS = '/transaction-type-versions';
  const TEMPLATES = '/inquiry-templates';
  const VERSIONS = '/inquiry-template-versions';
  const ACCOUNTS = '/accounts';
  const WORKFLOWS = '/workflows';
  const WORKFLOW_VERSIONS = '/workflow-versions';
  const WORKFLOW_RUNS = '/workflow-runs';
  const ACCOUNT_ACTIONS = '/account-actions';
  const CASES = '/cases';
  const CASE_TEMPLATES = '/case-templates';
  const CASE_TEMPLATE_VERSIONS = '/case-template-versions';
  const CASE_COMMENTS = '/case-comments';
  const CASE_ACTIONS = '/case-actions';
  const CASE_QUEUES = '/case-queues';
  const DEPLOYMENTS = '/deployments';
  const ANALYTICS = '/analytics';
  const EXPORTS = '/exports';
  /** A query object as URL parameters, its members in order; a list joins with commas. */
  const queryParams = (
    query: Readonly<Record<string, string | number | readonly string[] | undefined>>,
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.append(key, typeof value === 'object' ? value.join(',') : String(value));
      }
    }
    return params;
  };
  const analyticsRead =
    <Document extends z.ZodType>(report: string, schema: Document) =>
    async (
      query: Readonly<Record<string, string | number | readonly string[] | undefined>>,
      options?: RequestOptions,
    ) =>
      get(`${ANALYTICS}/${report}`, schema, options, queryParams(query));
  const THEME_SETS = '/theme-sets';
  const CASE_ASSIGNMENT_POLICIES = '/case-assignment-policies';
  const CASE_SLA_POLICIES = '/case-sla-policies';
  const CASE_CALENDARS = '/case-calendars';
  const CASE_EXPORTS = '/case-exports';

  /** A file of the case routes, as bytes with their type. */
  const fileAt = async (
    path: string,
    options: RequestOptions | undefined,
    query?: URLSearchParams,
  ): Promise<CaseFileContent> => {
    const { bytes, mimeType } = await t.requestRaw({
      method: 'GET',
      url: t.url(path, query),
      options,
    });
    return { bytes, mimeType };
  };
  const WORKFLOW_SECRETS = '/workflow-secrets';
  const ACCOUNT_TYPES = '/account-types';
  const WEBHOOKS = '/webhooks';
  const CONNECT_CONNECTIONS = '/connect/connections';
  const CONNECT_SHARE_TOKENS = '/connect/share-tokens';
  const CONNECT_CONSENT_RECORDS = '/connect/consent-records';
  const DELIVERIES = '/webhook-deliveries';
  const EVENTS = '/events';
  const API_KEYS = '/api-keys';
  const API_LOGS = '/api-logs';
  const AUDIT_LOGS = '/user-audit-logs';

  return {
    /** C2, C10 and C13: inquiries, their actions and sandbox simulation. */
    inquiries: {
      create: create(INQUIRIES, 'inquiry', createInquiryBodySchema, inquiryDocumentSchema),
      /**
       * `include: 'verifications'` adds them to `included`; `'selfies'` (C40.1) adds the
       * captures; a list asks for both.
       */
      retrieve: async (
        id: string,
        params?: { include?: InquiryInclude | readonly InquiryInclude[] },
        options?: RequestOptions,
      ) =>
        get(
          at(INQUIRIES, id),
          inquiryIncludeDocumentSchema,
          options,
          includeQuery(params?.include),
        ),
      ...pages(INQUIRIES, listInquiriesQuerySchema, inquiryListDocumentSchema),
      update: update(INQUIRIES, 'inquiry', updateInquiryBodySchema, inquiryDocumentSchema),
      /** A new session token and hosted-flow URL (`meta`). */
      resume: action(INQUIRIES, 'resume', emptyActionBodySchema, resumeInquiryDocumentSchema),
      approve: action(INQUIRIES, 'approve', approveInquiryBodySchema, inquiryDocumentSchema),
      decline: action(INQUIRIES, 'decline', declineInquiryBodySchema, inquiryDocumentSchema),
      reopen: metaAction(INQUIRIES, 'reopen', reopenInquiryBodySchema, inquiryDocumentSchema),
      markForReview: action(
        INQUIRIES,
        'mark-for-review',
        markInquiryForReviewBodySchema,
        inquiryDocumentSchema,
      ),
      expire: action(INQUIRIES, 'expire', expireInquiryBodySchema, inquiryDocumentSchema),
      addTag: metaAction(INQUIRIES, 'add-tag', addTagBodySchema, inquiryDocumentSchema),
      removeTag: metaAction(INQUIRIES, 'remove-tag', removeTagBodySchema, inquiryDocumentSchema),
      setTags: metaAction(INQUIRIES, 'set-tags', setTagsBodySchema, inquiryDocumentSchema),
      generateOneTimeLink: action(
        INQUIRIES,
        'generate-one-time-link',
        generateOneTimeLinkBodySchema,
        generateOneTimeLinkDocumentSchema,
      ),
      redact: action(INQUIRIES, 'redact', redactInquiryBodySchema, inquiryDocumentSchema),
      /** Sandbox only (production answers 403 `sandbox-only`). */
      performSimulateActions: metaAction(
        INQUIRIES,
        'perform-simulate-actions',
        performSimulateActionsBodySchema,
        inquiryDocumentSchema,
      ),
    },

    /** C10: inquiry sessions. */
    inquirySessions: {
      ...pages(SESSIONS, listInquirySessionsQuerySchema, inquirySessionListDocumentSchema),
      // C91.1 (Phase 7): a session may carry its network (and device) in `included`.
      retrieve: async (
        id: string,
        params?: { include?: InquirySessionInclude | readonly InquirySessionInclude[] },
        options?: RequestOptions,
      ) =>
        get(
          at(SESSIONS, id),
          inquirySessionIncludeDocumentSchema,
          options,
          includeQuery(params?.include),
        ),
      generateOneTimeLink: action(
        SESSIONS,
        'generate-one-time-link',
        generateOneTimeLinkBodySchema,
        generateSessionOneTimeLinkDocumentSchema,
      ),
      expire: action(
        SESSIONS,
        'expire',
        expireInquirySessionBodySchema,
        inquirySessionDocumentSchema,
      ),
      /** Expires every active session of `meta.inquiry-id`. */
      expireAll: async (
        meta: Meta<typeof expireAllInquirySessionsBodySchema>,
        options?: RequestOptions,
      ) =>
        write(
          'POST',
          `${SESSIONS}/expire-all`,
          actionBody(meta),
          expireAllInquirySessionsResponseSchema,
          options,
        ),
    },

    /** C91.2 (Phase 7): devices, listed for one inquiry session (`filter[inquiry-session-id]`). */
    devices: {
      ...pages(DEVICES, listDevicesQuerySchema, deviceListDocumentSchema),
      retrieve: retrieve(DEVICES, deviceDocumentSchema),
      trust: metaAction(DEVICES, 'trust', trustDeviceBodySchema, deviceDocumentSchema),
    },

    /** C128.1 (Workflow 8A): the decision records of one subject. */
    decisions: {
      ...pages(DECISIONS, listDecisionsQuerySchema, decisionListDocumentSchema),
    },

    /** C97 (Workflow 7B): lists, created on their kind's path. */
    lists: {
      ...pages(LISTS, listListsQuerySchema, listResourceListDocumentSchema),
      create: async (kind, attributes, options) =>
        write(
          'POST',
          `/list/${kind}`,
          document(`list/${listKindOf(kind)}`, attributes),
          listResourceDocumentSchema,
          options,
        ),
      retrieve: retrieve(LISTS, listResourceDocumentSchema),
      update: async (id, attributes, options) =>
        write(
          'PATCH',
          at(LISTS, id),
          { data: { attributes } },
          listResourceDocumentSchema,
          options,
        ),
      archive: async (id, options) =>
        write('DELETE', at(LISTS, id), undefined, listResourceDocumentSchema, options),
      match: async (attributes, options) =>
        write(
          'POST',
          `${LISTS}/match`,
          { data: { attributes } },
          matchListsResponseSchema,
          options,
        ),
    },

    /** C97.1 (Workflow 7B): items, on their kind's path. */
    listItems: {
      ...pages(LIST_ITEMS, listListItemsQuerySchema, listItemListDocumentSchema, {
        createdAt: false,
      }),
      create: async (kind, attributes, options) =>
        write(
          'POST',
          `/list-item/${kind}`,
          document(`list-item/${listKindOf(kind)}`, attributes),
          listItemDocumentSchema,
          options,
        ),
      retrieve: async (kind, id, options) =>
        get(at(`/list-item/${kind}`, id), listItemDocumentSchema, options),
      archive: async (kind, id, options) =>
        write('DELETE', at(`/list-item/${kind}`, id), undefined, listItemDocumentSchema, options),
    },

    /** C99.3 (Workflow 7B): list matches. */
    listMatches: {
      ...pages(LIST_MATCHES, listListMatchesQuerySchema, listMatchListDocumentSchema),
      retrieve: retrieve(LIST_MATCHES, listMatchDocumentSchema),
      dismiss: async (id, attributes, options) =>
        write(
          'POST',
          at(LIST_MATCHES, id, 'dismiss'),
          { data: { attributes } },
          listMatchDocumentSchema,
          options,
        ),
    },

    /** C100 (Workflow 7B): list importers. */
    importers: {
      ...pages(IMPORTERS, listImportersQuerySchema, importerListDocumentSchema),
      create: async (kind, attributes, options) =>
        write(
          'POST',
          `/importer/list-item/${kind}`,
          { data: { attributes } },
          importerDocumentSchema,
          options,
        ),
      retrieve: retrieve(IMPORTERS, importerDocumentSchema),
      errors: async (id, options) =>
        get(at(IMPORTERS, id, 'errors'), importerErrorListDocumentSchema, options),
    },

    /** C112, C116, C118, C122.4, C140.5 (Workflow 8A). */
    workflows: {
      create: create(WORKFLOWS, 'workflow', createWorkflowBodySchema, workflowDocumentSchema),
      retrieve: async (id, params, options) =>
        get(
          at(WORKFLOWS, id),
          workflowIncludeDocumentSchema,
          options,
          includeQuery(params?.include),
        ),
      ...pages(WORKFLOWS, listWorkflowsQuerySchema, workflowListDocumentSchema),
      update: update(WORKFLOWS, 'workflow', updateWorkflowBodySchema, workflowDocumentSchema),
      pause: action(WORKFLOWS, 'pause', pauseWorkflowBodySchema, workflowDocumentSchema),
      activate: action(WORKFLOWS, 'activate', activateWorkflowBodySchema, workflowDocumentSchema),
      archive: action(WORKFLOWS, 'archive', archiveWorkflowBodySchema, workflowDocumentSchema),
      draft: async (id, options) =>
        get(at(WORKFLOWS, id, 'draft'), workflowVersionDocumentSchema, options),
      saveDraft: async (id, attributes, options) =>
        write(
          'PUT',
          at(WORKFLOWS, id, 'draft'),
          document('workflow-version', attributes),
          workflowVersionDocumentSchema,
          options,
        ),
      validateDraft: async (id, definition, options) =>
        write(
          'POST',
          at(WORKFLOWS, id, 'draft/validate'),
          definition === undefined ? {} : document('workflow-version', { definition }),
          workflowDefinitionCheckDocumentSchema,
          options,
        ),
      publish: action(
        WORKFLOWS,
        'publish',
        publishWorkflowBodySchema,
        workflowVersionDocumentSchema,
      ),
      rollout: metaAction(
        WORKFLOWS,
        'rollout',
        rolloutWorkflowBodySchema,
        workflowVersionDocumentSchema,
      ),
      restore: metaAction(
        WORKFLOWS,
        'restore',
        restoreWorkflowBodySchema,
        workflowVersionDocumentSchema,
      ),
      promote: metaAction(
        WORKFLOWS,
        'promote',
        promoteWorkflowBodySchema,
        workflowVersionDocumentSchema,
      ),
      trigger: async (id, fields, options) =>
        write(
          'POST',
          at(WORKFLOWS, id, 'trigger'),
          { data: { attributes: { fields } } },
          workflowRunDocumentSchema,
          options,
        ),
      manualRuns: async (id, attributes, options) =>
        write(
          'POST',
          at(WORKFLOWS, id, 'manual-runs'),
          document('workflow-run', attributes),
          workflowManualRunsDocumentSchema,
          options,
        ),
      cancelRuns: metaAction(
        WORKFLOWS,
        'cancel-runs',
        cancelWorkflowRunsBodySchema,
        cancelWorkflowRunsDocumentSchema,
      ),
      actions: async (options) =>
        get('/workflow-actions', workflowActionListDocumentSchema, options),
      recipes: async (options) =>
        get('/workflow-recipes', workflowRecipeListDocumentSchema, options),
      installRecipe: async (key, options) =>
        write(
          'POST',
          `/workflow-recipes/${encodeURIComponent(key)}/install`,
          {},
          workflowDocumentSchema,
          options,
        ),
    },

    /** C112.6: published versions and the draft, newest first, for one workflow. */
    workflowVersions: {
      ...pages(
        WORKFLOW_VERSIONS,
        listWorkflowVersionsQuerySchema,
        workflowVersionListDocumentSchema,
      ),
      retrieve: retrieve(WORKFLOW_VERSIONS, workflowVersionDocumentSchema),
      diff: async (id, against, options) =>
        get(
          at(WORKFLOW_VERSIONS, id, 'diff'),
          workflowVersionDiffDocumentSchema,
          options,
          new URLSearchParams({ against }),
        ),
    },

    /** C120 (Workflow 8A): runs read with `workflow-runs:read`, and their values mask fail closed. */
    workflowRuns: {
      ...pages(WORKFLOW_RUNS, listWorkflowRunsQuerySchema, workflowRunListDocumentSchema),
      retrieve: async (id, params, options) =>
        get(
          at(WORKFLOW_RUNS, id),
          workflowRunIncludeDocumentSchema,
          options,
          includeQuery(params?.include),
        ),
      steps: async (id, params, options) =>
        get(
          at(WORKFLOW_RUNS, id, 'steps'),
          workflowRunStepListDocumentSchema,
          options,
          listQuery(params),
        ),
      deliveries: async (params, options) =>
        get(
          '/workflow-trigger-deliveries',
          workflowTriggerDeliveryListDocumentSchema,
          options,
          listQuery(params),
        ),
      resume: action(
        WORKFLOW_RUNS,
        'resume',
        resumeWorkflowRunBodySchema,
        workflowRunDocumentSchema,
      ),
      rerun: action(WORKFLOW_RUNS, 'rerun', rerunWorkflowRunBodySchema, workflowRunDocumentSchema),
      cancel: action(
        WORKFLOW_RUNS,
        'cancel',
        cancelWorkflowRunBodySchema,
        workflowRunDocumentSchema,
      ),
      redact: async (id, options) =>
        write('DELETE', at(WORKFLOW_RUNS, id), undefined, workflowRunDocumentSchema, options),
    },

    /** C120.7 (Workflow 8A): sandbox environments only. */
    workflowTestRuns: {
      create: async (workflowId, attributes, meta, options) =>
        write(
          'POST',
          at(WORKFLOWS, workflowId, 'test-runs'),
          {
            ...document('workflow-run', attributes),
            ...(meta === undefined ? {} : { meta }),
          },
          workflowRunDocumentSchema,
          options,
        ),
    },

    /** C118.7 (Workflow 8A): bound account actions, and running one on an account. */
    accountActions: {
      create: create(
        ACCOUNT_ACTIONS,
        'account-action',
        createAccountActionBodySchema,
        accountActionDocumentSchema,
      ),
      retrieve: retrieve(ACCOUNT_ACTIONS, accountActionDocumentSchema),
      ...pages(ACCOUNT_ACTIONS, listAccountActionsQuerySchema, accountActionListDocumentSchema),
      update: update(
        ACCOUNT_ACTIONS,
        'account-action',
        updateAccountActionBodySchema,
        accountActionDocumentSchema,
      ),
      run: async (accountId, data, options) =>
        write(
          'POST',
          at('/accounts', accountId, 'run-action'),
          { data },
          runAccountActionDocumentSchema,
          options,
        ),
      available: async (accountId, options) =>
        get(
          at('/accounts', accountId, 'available-actions'),
          accountAvailableActionListDocumentSchema,
          options,
        ),
    },

    /** C129.5 (Workflow 8B): cases; a body is public, and each action names its `meta`. */
    cases: {
      ...pages(CASES, listCasesQuerySchema, caseListDocumentSchema),
      create: async (attributes, meta, options) =>
        write(
          'POST',
          CASES,
          { ...document('case', attributes), ...actionBody(meta) },
          caseDocumentSchema,
          options,
        ),
      retrieve: async (id, params, options) =>
        get(at(CASES, id), caseIncludeDocumentSchema, options, includeQuery(params?.include)),
      update: async (id, body, options) =>
        write('PATCH', at(CASES, id), body, caseDocumentSchema, options),
      redact: async (id, options) =>
        write('DELETE', at(CASES, id), undefined, caseDocumentSchema, options),
      setStatus: metaAction(CASES, 'set-status', setCaseStatusBodySchema, caseDocumentSchema),
      addComment: metaAction(CASES, 'add-comment', addCaseCommentBodySchema, caseDocumentSchema),
      addObjects: metaAction(CASES, 'add-objects', addCaseObjectsBodySchema, caseDocumentSchema),
      removeObjects: metaAction(
        CASES,
        'remove-objects',
        removeCaseObjectsBodySchema,
        caseDocumentSchema,
      ),
      addTag: metaAction(CASES, 'add-tag', addCaseTagBodySchema, caseDocumentSchema),
      removeTag: metaAction(CASES, 'remove-tag', removeCaseTagBodySchema, caseDocumentSchema),
      setTags: metaAction(CASES, 'set-tags', setCaseTagsBodySchema, caseDocumentSchema),
      print: action(CASES, 'print', printCaseBodySchema, caseDocumentSchema),
      search: async (body, options) =>
        write('POST', `${CASES}/search`, body, caseSearchDocumentSchema, options),
      bulk: async (body, options) =>
        write('POST', `${CASES}/bulk`, body, caseBulkActionDocumentSchema, options),
      bulkAction: retrieve('/case-bulk-actions', caseBulkActionDocumentSchema),
      comments: async (id, params, options) =>
        get(at(CASES, id, 'comments'), caseCommentListDocumentSchema, options, listQuery(params)),
      history: async (id, params, options) =>
        get(at(CASES, id, 'history'), caseHistoryListDocumentSchema, options, listQuery(params)),
      objects: async (id, params, options) =>
        get(at(CASES, id, 'objects'), caseHeldObjectListDocumentSchema, options, listQuery(params)),
      assign: metaAction(CASES, 'assign', assignCaseBodySchema, caseDocumentSchema),
      next: async (meta, options) =>
        write('POST', `${CASES}/next`, actionBody(meta), nextCaseDocumentSchema, options),
      uploadAttachment: async (id, file, options) => {
        const form = new FormData();
        form.append(
          'file',
          new Blob([file.bytes.slice()], { type: file.mimeType ?? '' }),
          file.filename,
        );
        const { status, bytes } = await t.requestRaw({
          method: 'POST',
          url: t.url(at(CASES, id, 'attachments')),
          body: form,
          options,
        });
        return parseApiAnswer(caseDocumentSchema, status, new TextDecoder().decode(bytes));
      },
      attachmentContent: async (id, attachmentId, params, options) =>
        fileAt(
          at(CASES, id, `attachments/${encodeURIComponent(attachmentId)}/content`),
          options,
          params?.page === undefined
            ? undefined
            : new URLSearchParams({ page: String(params.page) }),
        ),
      attachmentOriginal: async (id, attachmentId, options) =>
        fileAt(at(CASES, id, `attachments/${encodeURIComponent(attachmentId)}/original`), options),
      requestReview: async (inquiryId, meta, options) =>
        write(
          'POST',
          at(INQUIRIES, inquiryId, 'review-requests'),
          { meta },
          caseDocumentSchema,
          options,
        ),
    },

    /** C130 (Workflow 8B). */
    caseTemplates: {
      ...pages(CASE_TEMPLATES, listCaseTemplatesQuerySchema, caseTemplateListDocumentSchema),
      create: create(
        CASE_TEMPLATES,
        'case-template',
        createCaseTemplateBodySchema,
        caseTemplateDocumentSchema,
      ),
      retrieve: retrieve(CASE_TEMPLATES, caseTemplateDocumentSchema),
      update: update(
        CASE_TEMPLATES,
        'case-template',
        updateCaseTemplateBodySchema,
        caseTemplateDocumentSchema,
      ),
      archive: action(
        CASE_TEMPLATES,
        'archive',
        archiveCaseTemplateBodySchema,
        caseTemplateDocumentSchema,
      ),
    },

    /** C130.2: published versions never change. */
    caseTemplateVersions: {
      ...pages(
        CASE_TEMPLATE_VERSIONS,
        listCaseTemplateVersionsQuerySchema,
        caseTemplateVersionListDocumentSchema,
      ),
      create: create(
        CASE_TEMPLATE_VERSIONS,
        'case-template-version',
        createCaseTemplateVersionBodySchema,
        caseTemplateVersionDocumentSchema,
      ),
      retrieve: retrieve(CASE_TEMPLATE_VERSIONS, caseTemplateVersionDocumentSchema),
      update: update(
        CASE_TEMPLATE_VERSIONS,
        'case-template-version',
        updateCaseTemplateVersionBodySchema,
        caseTemplateVersionDocumentSchema,
      ),
      publish: action(
        CASE_TEMPLATE_VERSIONS,
        'publish',
        publishCaseTemplateVersionBodySchema,
        caseTemplateVersionDocumentSchema,
      ),
    },

    /** C154.7 (Workflow 9A). */
    deployments: {
      ...pages(DEPLOYMENTS, listDeploymentsQuerySchema, deploymentListDocumentSchema),
      retrieve: retrieve(DEPLOYMENTS, deploymentDocumentSchema),
    },

    /** C160 (Workflow 9A). */
    themeSets: {
      ...pages(THEME_SETS, listThemeSetsQuerySchema, themeSetListDocumentSchema),
      create: create(THEME_SETS, 'theme-set', createThemeSetBodySchema, themeSetDocumentSchema),
      retrieve: retrieve(THEME_SETS, themeSetDocumentSchema),
      update: update(THEME_SETS, 'theme-set', updateThemeSetBodySchema, themeSetDocumentSchema),
      archive: async (id, options) =>
        write('DELETE', at(THEME_SETS, id), undefined, themeSetDocumentSchema, options),
      revisions: async (id, params, options) => {
        const query = new URLSearchParams();
        if (params?.page?.before !== undefined) {
          query.append('page[before]', String(params.page.before));
        }
        if (params?.page?.size !== undefined) {
          query.append('page[size]', String(params.page.size));
        }
        return get(
          at(THEME_SETS, id, 'revisions'),
          themeSetRevisionListDocumentSchema,
          options,
          query,
        );
      },
      restore: async (id, revision, options) =>
        write(
          'POST',
          at(THEME_SETS, id, 'restore'),
          { meta: { revision } },
          themeSetDocumentSchema,
          options,
        ),
      uploadAsset: async (kind, file, options) => {
        const form = new FormData();
        form.append('kind', kind);
        if (options?.unicodeRange !== undefined) {
          form.append('unicode-range', options.unicodeRange);
        }
        if (options?.licenceAttested !== undefined) {
          form.append('meta[licence-attested]', String(options.licenceAttested));
        }
        form.append(
          THEME_ASSET_FILE_FIELD,
          new Blob([file.bytes.slice()], { type: file.mimeType ?? '' }),
          file.filename,
        );
        const { status, bytes } = await t.requestRaw({
          method: 'POST',
          url: t.url(`${THEME_SETS}/assets`),
          body: form,
          options,
        });
        return parseApiAnswer(themeAssetDocumentSchema, status, new TextDecoder().decode(bytes));
      },
      assetContent: async (id, options) =>
        fileAt(`${THEME_SETS}/assets/${encodeURIComponent(id)}/content`, options),
    },

    /** C164.8 (Workflow 9B). */
    analytics: {
      inquiries: analyticsRead('inquiries', analyticsInquiriesDocumentSchema),
      funnel: analyticsRead('funnel', analyticsFunnelDocumentSchema),
      verifications: analyticsRead('verifications', analyticsVerificationsDocumentSchema),
      checks: analyticsRead('checks', analyticsChecksDocumentSchema),
      cases: analyticsRead('cases', analyticsCasesDocumentSchema),
      signals: analyticsRead('signals', analyticsSignalsDocumentSchema),
    },

    /** C166 (Workflow 9B): the creator's own. */
    exports: {
      ...pages(EXPORTS, listExportsQuerySchema, exportListDocumentSchema),
      create: create(EXPORTS, 'export', createExportBodySchema, exportDocumentSchema),
      retrieve: retrieve(EXPORTS, exportDocumentSchema),
      download: async (id, options) => fileAt(at(EXPORTS, id, 'download'), options),
    },

    /** C162.7 (Workflow 9A). */
    inquiryTemplateTranslations: {
      retrieve: async (templateId, options) =>
        get(
          at(TEMPLATES, templateId, 'translations'),
          inquiryTemplateTranslationsDocumentSchema,
          options,
        ),
      import: async (templateId, translations, options) =>
        write(
          'POST',
          at(TEMPLATES, templateId, 'translations'),
          document('inquiry-template-translations', { translations }),
          inquiryTemplateTranslationsDocumentSchema,
          options,
        ),
    },

    /** C132.1 (Workflow 8B). */
    caseQueues: {
      ...pages(CASE_QUEUES, listCaseQueuesQuerySchema, caseQueueListDocumentSchema),
      create: create(CASE_QUEUES, 'case-queue', createCaseQueueBodySchema, caseQueueDocumentSchema),
      retrieve: retrieve(CASE_QUEUES, caseQueueDocumentSchema),
      update: update(CASE_QUEUES, 'case-queue', updateCaseQueueBodySchema, caseQueueDocumentSchema),
      setMembers: async (id, members, options) =>
        write(
          'PUT',
          at(CASE_QUEUES, id, 'members'),
          document('case-queue', { members }),
          caseQueueDocumentSchema,
          options,
        ),
    },

    /** C132.2 (Workflow 8B). */
    caseAssignmentPolicies: {
      ...pages(
        CASE_ASSIGNMENT_POLICIES,
        listCaseAssignmentPoliciesQuerySchema,
        caseAssignmentPolicyListDocumentSchema,
      ),
      create: create(
        CASE_ASSIGNMENT_POLICIES,
        'case-assignment-policy',
        createCaseAssignmentPolicyBodySchema,
        caseAssignmentPolicyDocumentSchema,
      ),
      retrieve: retrieve(CASE_ASSIGNMENT_POLICIES, caseAssignmentPolicyDocumentSchema),
      update: update(
        CASE_ASSIGNMENT_POLICIES,
        'case-assignment-policy',
        updateCaseAssignmentPolicyBodySchema,
        caseAssignmentPolicyDocumentSchema,
      ),
    },

    /** C133.1 (Workflow 8B). */
    caseSlaPolicies: {
      ...pages(CASE_SLA_POLICIES, listCaseSlaPoliciesQuerySchema, caseSlaPolicyListDocumentSchema),
      create: create(
        CASE_SLA_POLICIES,
        'case-sla-policy',
        createCaseSlaPolicyBodySchema,
        caseSlaPolicyDocumentSchema,
      ),
      retrieve: retrieve(CASE_SLA_POLICIES, caseSlaPolicyDocumentSchema),
      update: update(
        CASE_SLA_POLICIES,
        'case-sla-policy',
        updateCaseSlaPolicyBodySchema,
        caseSlaPolicyDocumentSchema,
      ),
    },

    /** C133.2 (Workflow 8B). */
    caseCalendars: {
      ...pages(CASE_CALENDARS, listCaseCalendarsQuerySchema, caseCalendarListDocumentSchema),
      create: create(
        CASE_CALENDARS,
        'case-calendar',
        createCaseCalendarBodySchema,
        caseCalendarDocumentSchema,
      ),
      retrieve: retrieve(CASE_CALENDARS, caseCalendarDocumentSchema),
      update: update(
        CASE_CALENDARS,
        'case-calendar',
        updateCaseCalendarBodySchema,
        caseCalendarDocumentSchema,
      ),
      importHolidays: async (id, attributes, options) =>
        write(
          'POST',
          at(CASE_CALENDARS, id, 'holidays/import'),
          document('case-calendar', attributes),
          caseCalendarImportDocumentSchema,
          options,
        ),
    },

    /** C138.1 (Workflow 8B): the creator's own. */
    caseExports: {
      ...pages(CASE_EXPORTS, listCaseExportsQuerySchema, caseExportListDocumentSchema),
      create: create(
        CASE_EXPORTS,
        'case-export',
        createCaseExportBodySchema,
        caseExportDocumentSchema,
      ),
      retrieve: retrieve(CASE_EXPORTS, caseExportDocumentSchema),
      download: async (id, options) => fileAt(at(CASE_EXPORTS, id, 'download'), options),
    },

    /** C134.2: the author, or a holder of `cases:redact`. */
    caseComments: {
      redact: action(
        CASE_COMMENTS,
        'redact',
        redactCaseCommentBodySchema,
        caseCommentDocumentSchema,
      ),
    },

    /** C140.1 (Workflow 8B). */
    caseActions: {
      create: create(
        CASE_ACTIONS,
        'case-action',
        createCaseActionBodySchema,
        caseActionDocumentSchema,
      ),
      retrieve: retrieve(CASE_ACTIONS, caseActionDocumentSchema),
      ...pages(CASE_ACTIONS, listCaseActionsQuerySchema, caseActionListDocumentSchema),
      update: update(
        CASE_ACTIONS,
        'case-action',
        updateCaseActionBodySchema,
        caseActionDocumentSchema,
      ),
      run: async (caseId, data, options) =>
        write(
          'POST',
          at(CASES, caseId, 'run-action'),
          { data },
          runCaseActionDocumentSchema,
          options,
        ),
      available: async (caseId, options) =>
        get(at(CASES, caseId, 'available-actions'), caseAvailableActionListDocumentSchema, options),
    },

    /** C102, C103 (Workflow 7B): graph queries. */
    graphQueries: {
      create: create(
        GRAPH_QUERIES,
        'graph-query',
        createGraphQueryBodySchema,
        graphQueryDocumentSchema,
      ),
      createSync: async (attributes, options) =>
        write(
          'POST',
          GRAPH_QUERIES,
          { ...document('graph-query', attributes), meta: { 'run-sync': true } },
          graphQueryDocumentSchema,
          options,
        ),
      retrieve: retrieve(GRAPH_QUERIES, graphQueryDocumentSchema),
      ...pages(GRAPH_QUERIES, listGraphQueriesQuerySchema, graphQueryListDocumentSchema),
      rerun: action(GRAPH_QUERIES, 'rerun', rerunGraphQueryBodySchema, graphQueryDocumentSchema),
      cancel: action(GRAPH_QUERIES, 'cancel', cancelGraphQueryBodySchema, graphQueryDocumentSchema),
      expandNode: async (id, nodeId, options) =>
        write(
          'POST',
          at(GRAPH_QUERIES, id, `nodes/${encodeURIComponent(nodeId)}/expand`),
          options?.runSync === true ? { meta: { 'run-sync': true } } : {},
          graphQueryDocumentSchema,
          options,
        ),
      nodeValue: async (id, nodeId, options) =>
        get(at(GRAPH_QUERIES, id, `nodes/${nodeId}/value`), graphNodeValueDocumentSchema, options),
      action: async (id, attributes, options) => {
        if (attributes.action === 'export') {
          throw new TypeError('The export answers CSV: call graphQueries.exportCsv');
        }
        return write(
          'POST',
          at(GRAPH_QUERIES, id, 'actions'),
          { data: { attributes } },
          graphQueryActionResultDocumentSchema,
          options,
        );
      },
      exportCsv: async (id, selection, options) => {
        const { bytes } = await t.requestRaw({
          method: 'POST',
          url: t.url(at(GRAPH_QUERIES, id, 'actions')),
          body: { data: { attributes: { action: 'export', ...selection } } },
          options,
        });
        return new TextDecoder().decode(bytes);
      },
    },

    /** C102.1 (Workflow 7B): query templates and their versions. */
    graphQueryTemplates: {
      create: create(
        GRAPH_TEMPLATES,
        'graph-query-template',
        createGraphQueryTemplateBodySchema,
        graphQueryTemplateDocumentSchema,
      ),
      retrieve: retrieve(GRAPH_TEMPLATES, graphQueryTemplateDocumentSchema),
      ...pages(
        GRAPH_TEMPLATES,
        listGraphQueryTemplatesQuerySchema,
        graphQueryTemplateListDocumentSchema,
      ),
      update: update(
        GRAPH_TEMPLATES,
        'graph-query-template',
        updateGraphQueryTemplateBodySchema,
        graphQueryTemplateDocumentSchema,
      ),
      archive: async (id, options) =>
        write(
          'DELETE',
          at(GRAPH_TEMPLATES, id),
          undefined,
          graphQueryTemplateDocumentSchema,
          options,
        ),
      versions: {
        create: create(
          GRAPH_TEMPLATE_VERSIONS,
          'graph-query-template-version',
          createGraphQueryTemplateVersionBodySchema,
          graphQueryTemplateVersionDocumentSchema,
        ),
        retrieve: retrieve(GRAPH_TEMPLATE_VERSIONS, graphQueryTemplateVersionDocumentSchema),
        update: update(
          GRAPH_TEMPLATE_VERSIONS,
          'graph-query-template-version',
          updateGraphQueryTemplateVersionBodySchema,
          graphQueryTemplateVersionDocumentSchema,
        ),
        publish: action(
          GRAPH_TEMPLATE_VERSIONS,
          'publish',
          publishGraphQueryTemplateVersionBodySchema,
          graphQueryTemplateVersionDocumentSchema,
        ),
      },
    },

    /** Owner decision 7 after Workflow 7B: the version lists. */
    transactionTypeVersions: pages(
      TRANSACTION_TYPE_VERSIONS,
      listTransactionTypeVersionsQuerySchema,
      transactionTypeVersionListDocumentSchema,
    ),
    graphQueryTemplateVersions: pages(
      GRAPH_TEMPLATE_VERSIONS,
      listGraphQueryTemplateVersionsQuerySchema,
      graphQueryTemplateVersionListDocumentSchema,
    ),

    /** C105 (Workflow 7B): transactions. */
    transactions: {
      create: create(
        TRANSACTIONS,
        'transaction',
        createTransactionBodySchema,
        transactionDocumentSchema,
      ),
      retrieve: retrieve(TRANSACTIONS, transactionDocumentSchema),
      ...pages(TRANSACTIONS, listTransactionsQuerySchema, transactionListDocumentSchema),
      update: update(
        TRANSACTIONS,
        'transaction',
        updateTransactionBodySchema,
        transactionDocumentSchema,
      ),
      redact: async (id, options) =>
        write('DELETE', at(TRANSACTIONS, id), undefined, transactionDocumentSchema, options),
      label: metaAction(
        TRANSACTIONS,
        'label',
        labelTransactionBodySchema,
        transactionDocumentSchema,
      ),
      addObjects: metaAction(
        TRANSACTIONS,
        'add-objects',
        transactionObjectsBodySchema,
        transactionDocumentSchema,
      ),
      removeObjects: metaAction(
        TRANSACTIONS,
        'remove-objects',
        transactionObjectsBodySchema,
        transactionDocumentSchema,
      ),
      addTag: metaAction(TRANSACTIONS, 'add-tag', addTagBodySchema, transactionDocumentSchema),
      removeTag: metaAction(
        TRANSACTIONS,
        'remove-tag',
        removeTagBodySchema,
        transactionDocumentSchema,
      ),
      setTags: metaAction(TRANSACTIONS, 'set-tags', setTagsBodySchema, transactionDocumentSchema),
      redactBiometrics: action(
        TRANSACTIONS,
        'redact-biometrics',
        redactTransactionBiometricsBodySchema,
        transactionDocumentSchema,
      ),
      uploadFile: async (id, fieldKey, file, options) => {
        const form = new FormData();
        form.append(
          'file',
          new Blob([file.bytes.slice()], { type: file.mimeType ?? '' }),
          file.filename,
        );
        const { status, bytes } = await t.requestRaw({
          method: 'PUT',
          url: t.url(at(TRANSACTIONS, id, `files/${encodeURIComponent(fieldKey)}`)),
          body: form,
          options,
        });
        return parseApiAnswer(transactionDocumentSchema, status, new TextDecoder().decode(bytes));
      },
      fileContent: async (id, fileId, options) => {
        const { bytes, mimeType } = await t.requestRaw({
          method: 'GET',
          url: t.url(at(TRANSACTIONS, id, `files/${encodeURIComponent(fileId)}/content`)),
          options,
        });
        return { bytes, mimeType };
      },
      statusChanges: async (id, params, options) =>
        get(
          at(TRANSACTIONS, id, 'status-changes'),
          transactionStatusChangeListDocumentSchema,
          options,
          listQuery(params),
        ),
      labels: async (id, params, options) =>
        get(
          at(TRANSACTIONS, id, 'labels'),
          transactionLabelListDocumentSchema,
          options,
          listQuery(params),
        ),
      relations: async (id, params, options) =>
        get(
          at(TRANSACTIONS, id, 'relations'),
          transactionRelationListDocumentSchema,
          options,
          listQuery(params),
        ),
      addRelation: metaAction(
        TRANSACTIONS,
        'add-relation',
        transactionRelationBodySchema,
        transactionDocumentSchema,
      ),
      removeRelation: metaAction(
        TRANSACTIONS,
        'remove-relation',
        transactionRelationBodySchema,
        transactionDocumentSchema,
      ),
    },

    /** C104.1 (Workflow 7B): transaction types and their versions. */
    transactionTypes: {
      create: create(
        TRANSACTION_TYPES,
        'transaction-type',
        createTransactionTypeBodySchema,
        transactionTypeDocumentSchema,
      ),
      retrieve: retrieve(TRANSACTION_TYPES, transactionTypeDocumentSchema),
      ...pages(
        TRANSACTION_TYPES,
        listTransactionTypesQuerySchema,
        transactionTypeListDocumentSchema,
      ),
      update: update(
        TRANSACTION_TYPES,
        'transaction-type',
        updateTransactionTypeBodySchema,
        transactionTypeDocumentSchema,
      ),
      archive: async (id, options) =>
        write(
          'DELETE',
          at(TRANSACTION_TYPES, id),
          undefined,
          transactionTypeDocumentSchema,
          options,
        ),
      versions: {
        create: create(
          TRANSACTION_TYPE_VERSIONS,
          'transaction-type-version',
          createTransactionTypeVersionBodySchema,
          transactionTypeVersionDocumentSchema,
        ),
        retrieve: retrieve(TRANSACTION_TYPE_VERSIONS, transactionTypeVersionDocumentSchema),
        update: update(
          TRANSACTION_TYPE_VERSIONS,
          'transaction-type-version',
          updateTransactionTypeVersionBodySchema,
          transactionTypeVersionDocumentSchema,
        ),
        publish: action(
          TRANSACTION_TYPE_VERSIONS,
          'publish',
          publishTransactionTypeVersionBodySchema,
          transactionTypeVersionDocumentSchema,
        ),
      },
    },

    /** C2 and C11: inquiry templates. */
    inquiryTemplates: {
      create: create(
        TEMPLATES,
        'inquiry-template',
        createInquiryTemplateBodySchema,
        inquiryTemplateDocumentSchema,
      ),
      retrieve: retrieve(TEMPLATES, inquiryTemplateDocumentSchema),
      ...pages(TEMPLATES, listInquiryTemplatesQuerySchema, inquiryTemplateListDocumentSchema, {
        createdAt: false,
      }),
      update: update(
        TEMPLATES,
        'inquiry-template',
        updateInquiryTemplateBodySchema,
        inquiryTemplateDocumentSchema,
      ),
    },

    /** C11: template versions, drafted then published. */
    inquiryTemplateVersions: {
      create: create(
        VERSIONS,
        'inquiry-template-version',
        createInquiryTemplateVersionBodySchema,
        inquiryTemplateVersionDocumentSchema,
      ),
      update: update(
        VERSIONS,
        'inquiry-template-version',
        updateInquiryTemplateVersionBodySchema,
        inquiryTemplateVersionDocumentSchema,
      ),
      publish: action(
        VERSIONS,
        'publish',
        publishInquiryTemplateVersionBodySchema,
        inquiryTemplateVersionDocumentSchema,
      ),
      retrieve: retrieve(VERSIONS, inquiryTemplateVersionDocumentSchema),
      ...pages(
        VERSIONS,
        listInquiryTemplateVersionsQuerySchema,
        inquiryTemplateVersionListDocumentSchema,
      ),
    },

    /** C2: verifications with their checks; `include: 'selfies'` adds a selfie's captures. */
    verifications: {
      retrieve: async (id: string, params?: { include?: 'selfies' }, options?: RequestOptions) =>
        get(
          at('/verifications', id),
          verificationDocumentSchema,
          options,
          includeQuery(params?.include),
        ),
    },

    /** C40.1: selfie captures (never their nonce or device data). */
    selfies: {
      retrieve: retrieve('/selfies', selfieCaptureDocumentSchema),
    },

    /** C13: accounts, their tags, relations, consolidation and redaction. */
    accounts: {
      create: create(ACCOUNTS, 'account', createAccountBodySchema, accountDocumentSchema),
      /** `include: 'reports'` (C70.5) adds the account's reports, as the inquiry include does. */
      retrieve: async (
        id: string,
        params?: { include?: AccountInclude | readonly AccountInclude[] },
        options?: RequestOptions,
      ) =>
        get(at(ACCOUNTS, id), accountIncludeDocumentSchema, options, includeQuery(params?.include)),
      ...pages(ACCOUNTS, listAccountsQuerySchema, accountListDocumentSchema),
      update: update(ACCOUNTS, 'account', updateAccountBodySchema, accountDocumentSchema),
      addTag: metaAction(ACCOUNTS, 'add-tag', addTagBodySchema, accountDocumentSchema),
      removeTag: metaAction(ACCOUNTS, 'remove-tag', removeTagBodySchema, accountDocumentSchema),
      setTags: metaAction(ACCOUNTS, 'set-tags', setTagsBodySchema, accountDocumentSchema),
      addRelation: metaAction(
        ACCOUNTS,
        'add-relation',
        addAccountRelationBodySchema,
        accountDocumentSchema,
      ),
      removeRelation: metaAction(
        ACCOUNTS,
        'remove-relation',
        removeAccountRelationBodySchema,
        accountDocumentSchema,
      ),
      /** Relations in both directions; not paged. */
      listRelations: async (id: string, options?: RequestOptions) =>
        get(at(ACCOUNTS, id, 'relations'), accountRelationListDocumentSchema, options),
      graphComponent: async (id: string, options?: RequestOptions) =>
        get(at(ACCOUNTS, id, 'graph-component'), accountGraphComponentDocumentSchema, options),
      consolidate: metaAction(
        ACCOUNTS,
        'consolidate',
        consolidateAccountsBodySchema,
        accountDocumentSchema,
      ),
      addObjects: metaAction(
        ACCOUNTS,
        'add-objects',
        addAccountObjectsBodySchema,
        accountDocumentSchema,
      ),
      removeObjects: metaAction(
        ACCOUNTS,
        'remove-objects',
        removeAccountObjectsBodySchema,
        accountDocumentSchema,
      ),
      redact: action(ACCOUNTS, 'redact', redactAccountBodySchema, accountDocumentSchema),
    },

    /** C13: account types. */
    accountTypes: {
      create: create(
        ACCOUNT_TYPES,
        'account-type',
        createAccountTypeBodySchema,
        accountTypeDocumentSchema,
      ),
      retrieve: retrieve(ACCOUNT_TYPES, accountTypeDocumentSchema),
      ...pages(ACCOUNT_TYPES, listAccountTypesQuerySchema, accountTypeListDocumentSchema),
      /**
       * C25.3: the name and the whole new `fields-schema`, which may only add keys and change
       * labels (422 with a pointer to each key it would remove or retype).
       */
      update: update(
        ACCOUNT_TYPES,
        'account-type',
        updateAccountTypeBodySchema,
        accountTypeDocumentSchema,
      ),
    },

    /** C2 and C14: webhooks. `create`, `clone` and `rotateSecret` return the secret once. */
    webhooks: {
      create: create(WEBHOOKS, 'webhook', createWebhookBodySchema, createdWebhookDocumentSchema),
      retrieve: retrieve(WEBHOOKS, webhookDocumentSchema),
      ...pages(WEBHOOKS, listWebhooksQuerySchema, webhookListDocumentSchema, { createdAt: false }),
      update: update(WEBHOOKS, 'webhook', updateWebhookBodySchema, webhookDocumentSchema),
      enable: action(WEBHOOKS, 'enable', enableWebhookBodySchema, webhookDocumentSchema),
      disable: action(WEBHOOKS, 'disable', disableWebhookBodySchema, webhookDocumentSchema),
      /** Final: an archived webhook never receives events again. */
      archive: action(WEBHOOKS, 'archive', archiveWebhookBodySchema, webhookDocumentSchema),
      clone: action(WEBHOOKS, 'clone', cloneWebhookBodySchema, createdWebhookDocumentSchema),
      rotateSecret: action(
        WEBHOOKS,
        'rotate-secret',
        rotateWebhookSecretBodySchema,
        rotateWebhookSecretDocumentSchema,
      ),
      simulate: metaAction(
        WEBHOOKS,
        'simulate',
        simulateWebhookBodySchema,
        simulateWebhookDocumentSchema,
      ),
      replay: metaAction(WEBHOOKS, 'replay', replayWebhookBodySchema, replayWebhookDocumentSchema),
    },

    /** C230-C231 (Workflow 11A): Connect connections. */
    connectConnections: {
      create: create(
        CONNECT_CONNECTIONS,
        'connect/connection',
        createConnectionBodySchema,
        connectionDocumentSchema,
      ),
      retrieve: retrieve(CONNECT_CONNECTIONS, connectionDocumentSchema),
      ...pages(CONNECT_CONNECTIONS, listConnectionsQuerySchema, connectionListDocumentSchema),
      deactivate: async (id: string, options?: RequestOptions) =>
        write(
          'POST',
          at(CONNECT_CONNECTIONS, id, 'deactivate'),
          {},
          connectionDocumentSchema,
          options,
        ),
      reactivate: async (id: string, options?: RequestOptions) =>
        write(
          'POST',
          at(CONNECT_CONNECTIONS, id, 'reactivate'),
          {},
          connectionDocumentSchema,
          options,
        ),
      changeSharePolicy: async (
        id: string,
        attributes: Attributes<typeof changeSharePolicyBodySchema>,
        options?: RequestOptions,
      ) =>
        write(
          'POST',
          at(CONNECT_CONNECTIONS, id, 'share-policy'),
          document('connect/connection', attributes),
          connectionDocumentSchema,
          options,
        ),
    },

    /** C232-C234 (Workflow 11A): Connect share tokens, with peek and redeem. */
    connectShareTokens: {
      create: create(
        CONNECT_SHARE_TOKENS,
        'connect/share-token',
        createShareTokenBodySchema,
        shareTokenDocumentSchema,
      ),
      retrieve: retrieve(CONNECT_SHARE_TOKENS, shareTokenDocumentSchema),
      peek: async (id: string, options?: RequestOptions) =>
        get(
          at(CONNECT_SHARE_TOKENS, id),
          shareTokenDocumentSchema,
          options,
          new URLSearchParams({ 'peek-source-data': 'true' }),
        ),
      ...pages(CONNECT_SHARE_TOKENS, listShareTokensQuerySchema, shareTokenListDocumentSchema),
      expire: async (id: string, options?: RequestOptions) =>
        write(
          'POST',
          at(CONNECT_SHARE_TOKENS, id, 'expire'),
          {},
          shareTokenDocumentSchema,
          options,
        ),
      redeem: async (
        id: string,
        meta: z.input<typeof redeemShareTokenBodySchema>['meta'],
        destinationId?: string,
        options?: RequestOptions,
      ) =>
        write(
          'POST',
          at(CONNECT_SHARE_TOKENS, id, 'redeem'),
          destinationId === undefined
            ? { meta }
            : { ...document('connect/share-token', { 'destination-id': destinationId }), meta },
          shareTokenDocumentSchema,
          options,
        ),
    },

    /** C253 (Workflow 11B): an account's access export, its manifest and its listed files. */
    accountExports: {
      create: async (accountId, options) =>
        write(
          'POST',
          at('/accounts', accountId, 'export'),
          {},
          accountExportDocumentSchema,
          options,
        ),
      retrieve: retrieve('/account-exports', accountExportDocumentSchema),
      manifest: async (id, options) =>
        get(at('/account-exports', id, 'manifest'), accountExportManifestSchema, options),
      fileContent: async (id, fileId, options) => {
        const { bytes, mimeType } = await t.requestRaw({
          method: 'GET',
          url: t.url(at('/account-exports', id, `files/${encodeURIComponent(fileId)}`)),
          options,
        });
        return { bytes, mimeType };
      },
    },

    /** C236-C237 (Workflow 11A): consent records, attested and withdrawn. */
    connectConsentRecords: {
      attest: create(
        CONNECT_CONSENT_RECORDS,
        'consent-record',
        attestConsentRecordBodySchema,
        consentRecordDocumentSchema,
      ),
      retrieve: retrieve(CONNECT_CONSENT_RECORDS, consentRecordDocumentSchema),
      ...pages(
        CONNECT_CONSENT_RECORDS,
        listConsentRecordsQuerySchema,
        consentRecordListDocumentSchema,
      ),
      withdraw: async (
        id: string,
        attributes: Attributes<typeof withdrawConsentRecordBodySchema> = {},
        options?: RequestOptions,
      ) =>
        write(
          'POST',
          at(CONNECT_CONSENT_RECORDS, id, 'withdraw'),
          document('consent-record', attributes),
          consentRecordDocumentSchema,
          options,
        ),
    },

    /** C14: webhook deliveries with their attempts. */
    webhookDeliveries: {
      retrieve: retrieve(DELIVERIES, webhookDeliveryDocumentSchema),
      ...pages(DELIVERIES, listWebhookDeliveriesQuerySchema, webhookDeliveryListDocumentSchema),
    },

    /**
     * C5 and C12: events. Simulated events are listed only with `simulated: true`;
     * `filter: { 'inquiry-id' }` (C25.7) lists an inquiry's timeline.
     */
    events: {
      retrieve: retrieve(EVENTS, eventDocumentSchema),
      ...pages(EVENTS, listEventsQuerySchema, eventListDocumentSchema),
    },

    /**
     * C12: API keys. `create` and `clone` return the token once (`meta.token`); `create` takes
     * `expires-in-seconds` (C25.5), and every answer says `pii-masked` (C25.6).
     */
    apiKeys: {
      create: create(API_KEYS, 'api-key', createApiKeyBodySchema, createdApiKeyDocumentSchema),
      retrieve: retrieve(API_KEYS, apiKeyDocumentSchema),
      ...pages(API_KEYS, listApiKeysQuerySchema, apiKeyListDocumentSchema),
      update: update(API_KEYS, 'api-key', updateApiKeyBodySchema, apiKeyDocumentSchema),
      clone: action(API_KEYS, 'clone', cloneApiKeyBodySchema, createdApiKeyDocumentSchema),
      expire: metaAction(API_KEYS, 'expire', expireApiKeyBodySchema, apiKeyDocumentSchema),
    },

    /** C12: API logs; `filter: { 'user-id' }` (C25.9) lists a user's dashboard requests. */
    apiLogs: {
      retrieve: retrieve(API_LOGS, apiLogDocumentSchema),
      ...pages(API_LOGS, listApiLogsQuerySchema, apiLogListDocumentSchema),
    },

    /** C12: the caller's rate limits. */
    rateLimits: {
      list: async (options?: RequestOptions) =>
        get('/rate-limits', rateLimitListDocumentSchema, options),
    },

    /** C126.4 (Workflow 8A): each recorded message kind, searched in the body, never in the URL. */
    sandboxEmailMessages: {
      search: async (emailAddress: string, options?: RequestOptions) =>
        write(
          'POST',
          '/sandbox/email-messages/search',
          { 'email-address': emailAddress },
          sandboxEmailSearchResponseSchema,
          options,
        ),
    },
    sandboxSlackMessages: {
      search: async (secretId: string, options?: RequestOptions) =>
        write(
          'POST',
          '/sandbox/slack-messages/search',
          { 'secret-id': secretId },
          sandboxSlackSearchResponseSchema,
          options,
        ),
    },
    sandboxWorkflowSmsMessages: {
      search: async (phoneNumber: string, options?: RequestOptions) =>
        write(
          'POST',
          '/sandbox/workflow-sms-messages/search',
          { 'phone-number': phoneNumber },
          sandboxWorkflowSmsSearchResponseSchema,
          options,
        ),
    },

    /** C125 (Workflow 8A): workflow secrets, by key. A value goes out once and never comes back. */
    workflowSecrets: {
      create: create(
        WORKFLOW_SECRETS,
        'workflow-secret',
        createWorkflowSecretBodySchema,
        workflowSecretDocumentSchema,
      ),
      retrieve: retrieve(WORKFLOW_SECRETS, workflowSecretDocumentSchema),
      ...pages(WORKFLOW_SECRETS, listWorkflowSecretsQuerySchema, workflowSecretListDocumentSchema),
      update: update(
        WORKFLOW_SECRETS,
        'workflow-secret',
        updateWorkflowSecretBodySchema,
        workflowSecretDocumentSchema,
      ),
      putValue: async (key, environmentId, secretValue, options) =>
        write(
          'PUT',
          at(`${WORKFLOW_SECRETS}/${encodeURIComponent(key)}/values`, environmentId),
          { data: { attributes: { 'secret-value': secretValue } } },
          workflowSecretDocumentSchema,
          options,
        ),
      rotateValue: async (key, environmentId, secretValue, options) =>
        write(
          'POST',
          at(`${WORKFLOW_SECRETS}/${encodeURIComponent(key)}/values`, environmentId, 'rotate'),
          { data: { attributes: { 'secret-value': secretValue } } },
          workflowSecretDocumentSchema,
          options,
        ),
      delete: async (key, options) =>
        write(
          'DELETE',
          at(WORKFLOW_SECRETS, key),
          undefined,
          workflowSecretDocumentSchema,
          options,
        ),
    },

    /** C55.11: the sandbox SMS sink; the number goes in the body, never in the URL. */
    sandboxSmsMessages: {
      search: async (phoneNumber: string, options?: RequestOptions) =>
        write(
          'POST',
          '/sandbox/sms-messages/search',
          { 'phone-number': phoneNumber },
          sandboxSmsSearchResponseSchema,
          options,
        ),
    },

    /** C15: user audit logs. */
    userAuditLogs: {
      retrieve: retrieve(AUDIT_LOGS, userAuditLogDocumentSchema),
      ...pages(AUDIT_LOGS, listUserAuditLogsQuerySchema, userAuditLogListDocumentSchema),
    },

    ...reportGroups(t, { get, write, create, update, retrieve, action, metaAction, pages, at }),
  };
}

/** The resource helpers `resources()` builds, for the groups built beside it. */
interface Helpers {
  get: <Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    options?: RequestOptions,
    query?: URLSearchParams,
  ) => Promise<z.output<Schema>>;
  write: <Schema extends z.ZodType>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    schema: Schema,
    options?: RequestOptions,
  ) => Promise<z.output<Schema>>;
  create: <Body extends z.ZodType, Schema extends z.ZodType>(
    base: string,
    type: string,
    body: Body,
    schema: Schema,
  ) => (attributes: Attributes<Body>, options?: RequestOptions) => Promise<z.output<Schema>>;
  update: <Body extends z.ZodType, Schema extends z.ZodType>(
    base: string,
    type: string,
    body: Body,
    schema: Schema,
  ) => (
    id: string,
    attributes: Attributes<Body>,
    options?: RequestOptions,
  ) => Promise<z.output<Schema>>;
  retrieve: <Schema extends z.ZodType>(
    base: string,
    schema: Schema,
  ) => (id: string, options?: RequestOptions) => Promise<z.output<Schema>>;
  action: <Body extends z.ZodType, Schema extends z.ZodType>(
    base: string,
    name: string,
    body: Body,
    schema: Schema,
  ) => (id: string, meta?: Meta<Body>, options?: RequestOptions) => Promise<z.output<Schema>>;
  metaAction: <Body extends z.ZodType, Schema extends z.ZodType>(
    base: string,
    name: string,
    body: Body,
    schema: Schema,
  ) => (id: string, meta: Meta<Body>, options?: RequestOptions) => Promise<z.output<Schema>>;
  pages: <Query extends z.ZodType, Schema extends z.ZodType>(
    base: string,
    query: Query,
    schema: Schema,
  ) => PageMethods<Query, Schema, true>;
  at: (base: string, id: string, action?: string) => string;
}

/** Phase 6 (C72): the report, report template and report template version groups. */
function reportGroups(
  t: Transport,
  { get, write, create, update, retrieve, action, metaAction, pages, at }: Helpers,
): Pick<OpenVerifyClient, 'reports' | 'reportTemplates' | 'reportTemplateVersions'> {
  const REPORTS = '/reports';
  const REPORT_TEMPLATES = '/report-templates';
  const REPORT_VERSIONS = '/report-template-versions';
  const historyQuery = (page?: { after?: string; size?: number }) =>
    listQuery(page === undefined ? undefined : { page });
  /** POST `<base>/:id/<action>` with `{ data: { attributes } }` (dismiss, review). */
  const dataAction =
    <Body extends z.ZodType>(_body: Body, name: string) =>
    async (id: string, attributes: DataAttributes<Body>, options?: RequestOptions) =>
      write('POST', at(REPORTS, id, name), { data: { attributes } }, reportDocumentSchema, options);

  return {
    reports: {
      create: async (type, attributes, meta, options) =>
        write(
          'POST',
          REPORTS,
          { data: { type, attributes }, ...(meta === undefined ? {} : { meta }) },
          reportDocumentSchema,
          options,
        ),
      retrieve: retrieve(REPORTS, reportDocumentSchema),
      ...pages(REPORTS, listReportsQuerySchema, reportListDocumentSchema),
      redact: async (id, options) =>
        t.request({
          method: 'DELETE',
          url: t.url(at(REPORTS, id)),
          schema: reportDocumentSchema,
          options,
        }),
      addTag: metaAction(REPORTS, 'add-tag', addTagBodySchema, reportDocumentSchema),
      removeTag: metaAction(REPORTS, 'remove-tag', removeTagBodySchema, reportDocumentSchema),
      setTags: metaAction(REPORTS, 'set-tags', setTagsBodySchema, reportDocumentSchema),
      dismiss: dataAction(dismissReportBodySchema, 'dismiss'),
      review: dataAction(reviewReportBodySchema, 'review'),
      pause: action(REPORTS, 'pause', pauseReportBodySchema, reportDocumentSchema),
      resume: action(REPORTS, 'resume', resumeReportBodySchema, reportDocumentSchema),
      run: action(REPORTS, 'run', runReportBodySchema, reportDocumentSchema),
      history: async (id, params, options) =>
        get(
          at(REPORTS, id, 'history'),
          reportHistoryDocumentSchema,
          options,
          historyQuery(params?.page),
        ),
      async *historyAll(id, params, options) {
        let url = t.url(at(REPORTS, id, 'history'), historyQuery(params?.page));
        for (;;) {
          const page = await t.request({
            method: 'GET',
            url,
            schema: reportHistoryDocumentSchema,
            options,
          });
          yield* page.data;
          if (page.links.next === null) {
            return;
          }
          url = t.nextUrl(page.links.next);
        }
      },
    },
    reportTemplates: {
      create: create(
        REPORT_TEMPLATES,
        'report-template',
        createReportTemplateBodySchema,
        reportTemplateDocumentSchema,
      ),
      retrieve: retrieve(REPORT_TEMPLATES, reportTemplateDocumentSchema),
      ...pages(REPORT_TEMPLATES, listReportTemplatesQuerySchema, reportTemplateListDocumentSchema),
      update: update(
        REPORT_TEMPLATES,
        'report-template',
        updateReportTemplateBodySchema,
        reportTemplateDocumentSchema,
      ),
    },
    reportTemplateVersions: {
      create: create(
        REPORT_VERSIONS,
        'report-template-version',
        createReportTemplateVersionBodySchema,
        reportTemplateVersionDocumentSchema,
      ),
      retrieve: retrieve(REPORT_VERSIONS, reportTemplateVersionDocumentSchema),
      ...pages(
        REPORT_VERSIONS,
        listReportTemplateVersionsQuerySchema,
        reportTemplateVersionListDocumentSchema,
      ),
      update: update(
        REPORT_VERSIONS,
        'report-template-version',
        updateReportTemplateVersionBodySchema,
        reportTemplateVersionDocumentSchema,
      ),
      publish: action(
        REPORT_VERSIONS,
        'publish',
        publishReportTemplateVersionBodySchema,
        reportTemplateVersionDocumentSchema,
      ),
    },
  };
}

/**
 * A client for the OpenVerify server API.
 * @throws {TypeError} for a missing API key or a base URL that is not http(s).
 * @throws {RangeError} for a negative `maxRetries` or a non-positive `timeoutMs`.
 */
export function createClient(options: ClientOptions): OpenVerifyClient {
  return resources(createTransport(options));
}
