/**
 * Every C2 and C10-C14 server endpoint has a client method: right method, path and body, and the
 * response parsed with the endpoint's contract schema.
 */
import {
  buildCreatedWebhookResource,
  buildInquiryTemplateResource,
  buildWebhookResource,
  defaultInquiryTemplateAttributes,
  inquiryDocumentSchema,
  newId,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { createClient, type OpenVerifyClient } from './client.js';
import { apiFixture, scriptedFetch } from './test-support.js';

const AT = new Date('2026-10-20T12:00:00.000Z');
const ID = {
  inquiry: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
  template: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
  version: 'itmplv_01M5A0GTG0RSTVX9PHA0V7P3X6',
  session: 'iqse_01M5CJZC30W7PFE0GD30HJWEA4',
  verification: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
  account: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
  other: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC9',
  accountType: 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W',
  webhook: 'wbh_01M5CJXJF8RTHTZ2WC4QENGB0C',
  delivery: 'whd_01M5CK55MG5CV42K2QC9PQH0WE',
  event: 'evt_01M5CK4VW0MRQ4HKKTBDT6PXEM',
  key: newId('key'),
  log: 'alog_01M5CJXJF8RTHTZ2WC4QENGB0C',
  audit: 'aud_01M5CJXJF8RTHTZ2WC4QENGB0C',
  selfie: 'self_01M5CJXHG07XPHF3HRM6NREDH9',
};

/** Their answers are bytes or CSV, not a JSON document: `raw-answers.test.ts` covers them. */
const RAW_METHODS: ReadonlySet<string> = new Set([
  'transactions.uploadFile',
  'transactions.fileContent',
  'graphQueries.exportCsv',
  // C135, C138 (Workflow 8B): an attachment's bytes and an export's file (raw-answers.test.ts).
  'cases.uploadAttachment',
  'cases.attachmentContent',
  'cases.attachmentOriginal',
  'caseExports.download',
  // C160.6 (Workflow 9A): a theme asset's upload and its bytes (raw-answers.test.ts).
  'themeSets.uploadAsset',
  'themeSets.assetContent',
  // C166.4 (Workflow 9B): an export's file (raw-answers.test.ts).
  'exports.download',
  // C253 (Workflow 11B): the access export group, with its 202 and its file's bytes
  // (account-exports.test.ts).
  'accountExports.create',
  'accountExports.retrieve',
  'accountExports.manifest',
  'accountExports.fileContent',
]);
const ENVIRONMENT = 'env_01M5CM00000000000000000005';
const list = (data: unknown) => ({ data: [data], links: { next: null } });

/** The Workflow 9A groups (C154.7, C160, C162.7), reached through their own shape. */
interface Phase9aGroups {
  deployments: {
    retrieve: (id: string) => Promise<unknown>;
    list: (params: { filter: Record<string, string[]> }) => Promise<unknown>;
  };
  themeSets: {
    list: (params: { filter: Record<string, string[]> }) => Promise<unknown>;
    create: (attributes: Record<string, unknown>) => Promise<unknown>;
    retrieve: (id: string) => Promise<unknown>;
    update: (id: string, attributes: Record<string, unknown>) => Promise<unknown>;
    archive: (id: string) => Promise<unknown>;
    revisions: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
    restore: (id: string, revision: number) => Promise<unknown>;
  };
  inquiryTemplateTranslations: {
    retrieve: (templateId: string) => Promise<unknown>;
    import: (
      templateId: string,
      translations: readonly Record<string, unknown>[],
    ) => Promise<unknown>;
  };
}
const phase9a = (client: unknown) => client as Phase9aGroups;

/** The Workflow 9B groups (C164.8, C166), reached through their own shape. */
interface Phase9bGroups {
  analytics: Record<
    'inquiries' | 'funnel' | 'verifications' | 'checks' | 'cases' | 'signals',
    (query: Record<string, string>) => Promise<unknown>
  >;
  exports: {
    create: (attributes: Record<string, unknown>) => Promise<unknown>;
    retrieve: (id: string) => Promise<unknown>;
    list: () => Promise<unknown>;
  };
}
const phase9b = (client: unknown) => client as Phase9bGroups;
const WINDOW = { 'filter[from]': '2026-10-27', 'filter[to]': '2026-10-29' };
const WINDOW_QUERY = '?filter%5Bfrom%5D=2026-10-27&filter%5Bto%5D=2026-10-29';
const one = (name: string) => apiFixture(name);

/** The Connect groups (C230-C237; Workflow 11A integration-11a), reached through their own shape. */
interface ConnectGroups {
  connectConnections: Record<string, (...args: never[]) => Promise<unknown>>;
  connectShareTokens: Record<string, (...args: never[]) => Promise<unknown>>;
  connectConsentRecords: Record<string, (...args: never[]) => Promise<unknown>>;
}
type AnyMethod = (...args: unknown[]) => Promise<unknown>;
const connectOf = (client: unknown, group: keyof ConnectGroups, method: string): AnyMethod => {
  const found = (client as ConnectGroups)[group] as Record<string, AnyMethod> | undefined;
  const call = found?.[method];
  if (call === undefined) {
    throw new Error(`${group}.${method} is not built`);
  }
  return call;
};
const CXN = 'cxn_01M5CN0000000000000011A100';
const CNST = 'cnst_01M5CN0000000000000011A200';
const CNSR = 'cnsr_01M5CN0000000000000011A410';
const connectFixture = (name: string) => apiFixture(`connect/${name}`);
const resourceOf = (name: string) => apiFixture(name).data;

/** Phase 6 (C72): the golden report, template and version, and their ids. */
const report = one('report-watchlist');
const REPORT = (report.data as { id: string }).id;
const reportTemplate = one('report-template');
const REPORT_TEMPLATE = (reportTemplate.data as { id: string }).id;
const reportVersion = one('report-template-version');
const REPORT_VERSION = (reportVersion.data as { id: string }).id;
const MATCH = 'rpm_01M5CJXHG07XPHF3HRM6NREDH8';
const history = one('report-history');

/** C97, C99, C100 (Workflow 7B): the golden list, email item, match and importer. */
const LIST = resourceOf('list') as { id: string };
const ITEM_EMAIL = (one('list-items').data as { type: string; id: string }[]).find(
  ({ type }) => type === 'list-item/email-address',
) as { id: string };
const LIST_MATCH = resourceOf('list-match') as { id: string };
const IMPORTER = resourceOf('importer') as { id: string };

/** C104, C105 (Workflow 7B): the golden transaction, its type and version. */
const TRANSACTION = resourceOf('transaction') as { id: string };
const TRANSACTION_TYPE = resourceOf('transaction-type') as { id: string };
const TRANSACTION_TYPE_VERSION = resourceOf('transaction-type-version') as { id: string };

/** C102 (Workflow 7B): the golden query, template, version and node. */
const GRAPH_QUERY = resourceOf('graph-query') as { id: string };
const GRAPH_TEMPLATE = resourceOf('graph-query-template') as { id: string };
const GRAPH_VERSION = resourceOf('graph-query-template-version') as { id: string };
const GRAPH_NODE = resourceOf('graph-node-value') as { id: string };

/** C112, C118.7, C120 (Workflow 8A): the golden workflow, version, run, action and catalogue. */
const workflow = one('workflow');
const WORKFLOW = resourceOf('workflow') as { id: string };
const workflowVersion = one('workflow-version');
const WORKFLOW_VERSION = resourceOf('workflow-version') as {
  id: string;
  attributes: { definition: unknown };
};
const workflowRun = one('workflow-run');
const WORKFLOW_RUN = resourceOf('workflow-run') as { id: string };
/** C129-C140 (Workflow 8B): the golden case, template, version, comment, action and bulk action. */
const caseDocument = one('case');
const CASE = (caseDocument.data as { id: string }).id;
const caseTemplate = one('case-template');
const CASE_TEMPLATE = resourceOf('case-template') as { id: string };
const caseTemplateVersion = one('case-template-version');
const CASE_TEMPLATE_VERSION = resourceOf('case-template-version') as { id: string };
const caseComment = one('case-comment');
const CASE_COMMENT = resourceOf('case-comment') as { id: string };
const caseAction = one('case-action');
const CASE_ACTION = resourceOf('case-action') as { id: string };
const caseBulkAction = one('case-bulk-action');
const CASE_BULK_ACTION = resourceOf('case-bulk-action') as { id: string };
/** C132, C133 (Workflow 8B, the (Q) family): queues, policies and calendars. */
const caseQueue = one('case-queue');
const CASE_QUEUE = resourceOf('case-queue') as { id: string };
const caseAssignmentPolicy = one('case-assignment-policy');
const CASE_ASSIGNMENT_POLICY = resourceOf('case-assignment-policy') as { id: string };
const caseSlaPolicy = one('case-sla-policy');
const CASE_SLA_POLICY = resourceOf('case-sla-policy') as { id: string };
const caseCalendar = one('case-calendar');
const CASE_CALENDAR = resourceOf('case-calendar') as { id: string };
const USER_ID = 'usr_01M5CN00000000000000000011';
/** C138 (Workflow 8B, the (F) family). */
const caseExport = one('case-export');
const CASE_EXPORT = resourceOf('case-export') as { id: string };

const accountAction = one('account-action');
const ACCOUNT_ACTION = resourceOf('account-action') as { id: string };

/** C91.2 (Phase 7): a synthetic web device, masked fingerprints as a principal without pii:view sees them. */
const DEVICE = {
  type: 'device',
  id: 'dev_01M5CJZC30W7PFE0GD30HJWEC6',
  attributes: {
    'created-at': '2026-10-20T12:00:20.000Z',
    'device-vendor-id': null,
    'device-fingerprint': null,
    'browser-fingerprint': null,
    'device-class': 'b'.repeat(64),
    platform: 'web',
    'collector-version': 1,
    'fingerprint-randomised': false,
    'key-id': 'AbCdEfGh_-1',
    'session-count': 1,
    'first-seen-at': '2026-10-20T12:00:20.000Z',
    'last-seen-at': '2026-10-20T12:00:20.000Z',
    'trusted-at': null,
    'trusted-by': null,
    'trust-reason': null,
  },
};

const workflowSecret = one('workflow-secret');
const inquiry = one('inquiry');
// C40.1: a selfie capture, included by `?include=selfies` on inquiries and verifications.
const selfieCapture = resourceOf('selfie');
const inquiryWithVerifications = inquiryDocumentSchema.parse(one('inquiry-with-verifications'));
const inquiryWithSelfies = {
  data: {
    ...inquiryWithVerifications.data,
    relationships: {
      ...inquiryWithVerifications.data.relationships,
      selfies: { data: [{ type: 'selfie', id: ID.selfie }] },
    },
  },
  included: [...(inquiryWithVerifications.included ?? []), selfieCapture],
};
const verificationWithSelfies = {
  ...one('verification-selfie'),
  included: [selfieCapture],
};
const defaults = defaultInquiryTemplateAttributes();
const template = {
  data: buildInquiryTemplateResource({
    id: ID.template,
    name: 'Synthetic template',
    createdAt: AT,
    updatedAt: AT,
    currentVersion: {
      id: ID.version,
      versionNumber: 1,
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
      createdAt: AT,
    },
  }),
};
const webhookRecord = {
  id: ID.webhook,
  url: 'https://hooks.example.test/openverify',
  enabledEvents: ['*'],
  status: 'enabled' as const,
  secretLast4: 'abcd',
  createdAt: AT,
  updatedAt: AT,
};
const webhook = { data: buildWebhookResource(webhookRecord) };
const createdWebhook = {
  data: buildCreatedWebhookResource(webhookRecord, `wbhsec_${'a'.repeat(39)}abcd`),
};
const apiKey = one('api-key');
const createdApiKey = {
  ...apiKey,
  meta: { token: `ov_sbx_Test${'b'.repeat(39)}` },
};
const resumed = {
  ...inquiry,
  meta: {
    'session-token': `ovs_${'c'.repeat(43)}`,
    'flow-url': `https://flow.example.test/#inquiry-id=${ID.inquiry}&session-token=ovs_${'c'.repeat(43)}`,
  },
};
const oneTimeLink = {
  ...inquiry,
  meta: {
    'one-time-link': `https://flow.example.test/#inquiry-id=${ID.inquiry}&one-time-token=ovo_${'d'.repeat(43)}`,
    'expires-at': '2026-10-21T12:00:00.000Z',
  },
};

type Invoke = (client: OpenVerifyClient) => Promise<unknown>;

/** [name, call, method, path (after /api/v1), body sent, response]. */
/** C133.2: a week closed every day, for a calendar to open one of. */
const EMPTY_WEEK = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

const ENDPOINTS: [string, Invoke, string, string, unknown, unknown][] = [
  // C2 and C11: inquiry templates
  [
    'inquiryTemplates.create',
    (c) =>
      c.inquiryTemplates.create({
        name: 'Synthetic template',
        flow: defaults.flow,
        'verification-config': defaults['verification-config'],
      }),
    'POST',
    '/inquiry-templates',
    {
      data: {
        type: 'inquiry-template',
        attributes: {
          name: 'Synthetic template',
          flow: defaults.flow,
          'verification-config': defaults['verification-config'],
        },
      },
    },
    template,
  ],
  [
    'inquiryTemplates.retrieve',
    (c) => c.inquiryTemplates.retrieve(ID.template),
    'GET',
    `/inquiry-templates/${ID.template}`,
    undefined,
    template,
  ],
  [
    'inquiryTemplates.list',
    (c) => c.inquiryTemplates.list(),
    'GET',
    '/inquiry-templates',
    undefined,
    list(template.data),
  ],
  [
    'inquiryTemplates.update',
    (c) => c.inquiryTemplates.update(ID.template, { status: 'archived' }),
    'PATCH',
    `/inquiry-templates/${ID.template}`,
    { data: { type: 'inquiry-template', attributes: { status: 'archived' } } },
    template,
  ],
  // C11: template versions
  [
    'inquiryTemplateVersions.create',
    (c) =>
      c.inquiryTemplateVersions.create({
        'inquiry-template-id': ID.template,
        flow: defaults.flow,
        'verification-config': defaults['verification-config'],
      }),
    'POST',
    '/inquiry-template-versions',
    {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          'inquiry-template-id': ID.template,
          flow: defaults.flow,
          'verification-config': defaults['verification-config'],
        },
      },
    },
    one('inquiry-template-version'),
  ],
  [
    'inquiryTemplateVersions.update',
    (c) =>
      c.inquiryTemplateVersions.update(ID.version, {
        settings: { 'inquiry-expiration-seconds': 3600 },
      }),
    'PATCH',
    `/inquiry-template-versions/${ID.version}`,
    {
      data: {
        type: 'inquiry-template-version',
        attributes: { settings: { 'inquiry-expiration-seconds': 3600 } },
      },
    },
    one('inquiry-template-version'),
  ],
  [
    'inquiryTemplateVersions.publish',
    (c) => c.inquiryTemplateVersions.publish(ID.version),
    'POST',
    `/inquiry-template-versions/${ID.version}/publish`,
    {},
    one('inquiry-template-version'),
  ],
  [
    'inquiryTemplateVersions.retrieve',
    (c) => c.inquiryTemplateVersions.retrieve(ID.version),
    'GET',
    `/inquiry-template-versions/${ID.version}`,
    undefined,
    one('inquiry-template-version'),
  ],
  [
    'inquiryTemplateVersions.list',
    (c) => c.inquiryTemplateVersions.list({ filter: { 'inquiry-template-id': ID.template } }),
    'GET',
    `/inquiry-template-versions?filter%5Binquiry-template-id%5D=${ID.template}`,
    undefined,
    list(resourceOf('inquiry-template-version')),
  ],
  // C2 and C10: inquiries
  [
    'inquiries.create',
    (c) => c.inquiries.create({ 'inquiry-template-id': ID.template, 'account-id': ID.account }),
    'POST',
    '/inquiries',
    {
      data: {
        type: 'inquiry',
        attributes: { 'inquiry-template-id': ID.template, 'account-id': ID.account },
      },
    },
    inquiry,
  ],
  [
    'inquiries.retrieve',
    (c) => c.inquiries.retrieve(ID.inquiry, { include: 'verifications' }),
    'GET',
    `/inquiries/${ID.inquiry}?include=verifications`,
    undefined,
    one('inquiry-with-verifications'),
  ],
  [
    'inquiries.retrieve with its captures (C40.1)',
    (c) => c.inquiries.retrieve(ID.inquiry, { include: ['verifications', 'selfies'] }),
    'GET',
    `/inquiries/${ID.inquiry}?include=verifications%2Cselfies`,
    undefined,
    inquiryWithSelfies,
  ],
  [
    'inquiries.list',
    (c) => c.inquiries.list({ filter: { status: ['approved', 'declined'], tag: 'vip' } }),
    'GET',
    '/inquiries?filter%5Bstatus%5D=approved%2Cdeclined&filter%5Btag%5D=vip',
    undefined,
    list(inquiry.data),
  ],
  [
    'inquiries.update',
    (c) => c.inquiries.update(ID.inquiry, { note: 'Synthetic note.' }),
    'PATCH',
    `/inquiries/${ID.inquiry}`,
    { data: { type: 'inquiry', attributes: { note: 'Synthetic note.' } } },
    inquiry,
  ],
  [
    'inquiries.resume',
    (c) => c.inquiries.resume(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/resume`,
    {},
    resumed,
  ],
  [
    'inquiries.approve',
    (c) => c.inquiries.approve(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/approve`,
    {},
    inquiry,
  ],
  [
    'inquiries.decline',
    (c) => c.inquiries.decline(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/decline`,
    {},
    inquiry,
  ],
  [
    'inquiries.markForReview',
    (c) => c.inquiries.markForReview(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/mark-for-review`,
    {},
    inquiry,
  ],
  [
    'inquiries.expire',
    (c) => c.inquiries.expire(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/expire`,
    {},
    inquiry,
  ],
  [
    'inquiries.addTag',
    (c) => c.inquiries.addTag(ID.inquiry, { 'tag-name': 'vip' }),
    'POST',
    `/inquiries/${ID.inquiry}/add-tag`,
    { meta: { 'tag-name': 'vip' } },
    inquiry,
  ],
  [
    'inquiries.removeTag',
    (c) => c.inquiries.removeTag(ID.inquiry, { 'tag-name': 'vip' }),
    'POST',
    `/inquiries/${ID.inquiry}/remove-tag`,
    { meta: { 'tag-name': 'vip' } },
    inquiry,
  ],
  [
    'inquiries.setTags',
    (c) => c.inquiries.setTags(ID.inquiry, { 'tag-names': ['a', 'b'] }),
    'POST',
    `/inquiries/${ID.inquiry}/set-tags`,
    { meta: { 'tag-names': ['a', 'b'] } },
    inquiry,
  ],
  [
    'inquiries.generateOneTimeLink',
    (c) => c.inquiries.generateOneTimeLink(ID.inquiry, { 'expires-in-seconds': 3600 }),
    'POST',
    `/inquiries/${ID.inquiry}/generate-one-time-link`,
    { meta: { 'expires-in-seconds': 3600 } },
    oneTimeLink,
  ],
  [
    'inquiries.redact',
    (c) => c.inquiries.redact(ID.inquiry),
    'POST',
    `/inquiries/${ID.inquiry}/redact`,
    {},
    inquiry,
  ],
  [
    'inquiries.performSimulateActions',
    (c) =>
      c.inquiries.performSimulateActions(ID.inquiry, { actions: [{ type: 'complete_inquiry' }] }),
    'POST',
    `/inquiries/${ID.inquiry}/perform-simulate-actions`,
    { meta: { actions: [{ type: 'complete_inquiry' }] } },
    inquiry,
  ],
  // C10: inquiry sessions
  [
    'inquirySessions.list',
    (c) => c.inquirySessions.list({ filter: { 'inquiry-id': ID.inquiry } }),
    'GET',
    `/inquiry-sessions?filter%5Binquiry-id%5D=${ID.inquiry}`,
    undefined,
    list(resourceOf('inquiry-session')),
  ],
  [
    'inquirySessions.retrieve',
    (c) => c.inquirySessions.retrieve(ID.session),
    'GET',
    `/inquiry-sessions/${ID.session}`,
    undefined,
    one('inquiry-session'),
  ],
  [
    'inquirySessions.retrieve with its network and device (C91.1)',
    (c) => c.inquirySessions.retrieve(ID.session, { include: ['network', 'device'] }),
    'GET',
    `/inquiry-sessions/${ID.session}?include=network%2Cdevice`,
    undefined,
    one('inquiry-session'),
  ],
  [
    'inquirySessions.generateOneTimeLink',
    (c) => c.inquirySessions.generateOneTimeLink(ID.session, { 'expires-in-seconds': 600 }),
    'POST',
    `/inquiry-sessions/${ID.session}/generate-one-time-link`,
    { meta: { 'expires-in-seconds': 600 } },
    {
      data: resourceOf('inquiry-session'),
      meta: {
        'one-time-link': 'https://flow.example.test/#inquiry-id=x',
        'one-time-link-short': null,
        'expires-at': '2026-10-20T12:10:00.000Z',
      },
    },
  ],
  [
    'inquirySessions.expire',
    (c) => c.inquirySessions.expire(ID.session),
    'POST',
    `/inquiry-sessions/${ID.session}/expire`,
    {},
    // An action answers the session alone; only a read includes its network (C91.1).
    { data: resourceOf('inquiry-session') },
  ],
  [
    'inquirySessions.expireAll',
    (c) => c.inquirySessions.expireAll({ 'inquiry-id': ID.inquiry }),
    'POST',
    '/inquiry-sessions/expire-all',
    { meta: { 'inquiry-id': ID.inquiry } },
    { meta: { 'expired-count': 2 } },
  ],
  // C91.2 (Phase 7): devices, listed for one session
  [
    'devices.list',
    (c) => c.devices.list({ filter: { 'inquiry-session-id': ID.session } }),
    'GET',
    `/devices?filter%5Binquiry-session-id%5D=${ID.session}`,
    undefined,
    list(DEVICE),
  ],
  [
    'devices.retrieve',
    (c) => c.devices.retrieve(DEVICE.id),
    'GET',
    `/devices/${DEVICE.id}`,
    undefined,
    { data: DEVICE },
  ],
  // C97, C99, C100 (Workflow 7B): lists, items, matches and importers.
  [
    'lists.create',
    (c) => c.lists.create('email-addresses', { name: 'Synthetic blocked emails' }),
    'POST',
    '/list/email-addresses',
    {
      data: { type: 'list/email-address', attributes: { name: 'Synthetic blocked emails' } },
    },
    one('list'),
  ],
  [
    'lists.retrieve',
    (c) => c.lists.retrieve(LIST.id),
    'GET',
    `/lists/${LIST.id}`,
    undefined,
    one('list'),
  ],
  ['lists.list', (c) => c.lists.list(), 'GET', '/lists', undefined, list(LIST)],
  [
    'lists.update',
    (c) => c.lists.update(LIST.id, { 'screen-at-completion': false }),
    'PATCH',
    `/lists/${LIST.id}`,
    { data: { attributes: { 'screen-at-completion': false } } },
    one('list'),
  ],
  [
    'lists.archive',
    (c) => c.lists.archive(LIST.id),
    'DELETE',
    `/lists/${LIST.id}`,
    undefined,
    one('list'),
  ],
  [
    'lists.match',
    (c) => c.lists.match({ probes: [{ kind: 'email-address', value: 'probe@example.org' }] }),
    'POST',
    '/lists/match',
    {
      data: {
        attributes: { probes: [{ kind: 'email-address', value: 'probe@example.org' }] },
      },
    },
    one('list-match-result'),
  ],
  [
    'listItems.create',
    (c) =>
      c.listItems.create('email-addresses', { 'list-id': LIST.id, value: 'listed@example.org' }),
    'POST',
    '/list-item/email-addresses',
    {
      data: {
        type: 'list-item/email-address',
        attributes: { 'list-id': LIST.id, value: 'listed@example.org' },
      },
    },
    { data: ITEM_EMAIL },
  ],
  [
    'listItems.retrieve',
    (c) => c.listItems.retrieve('email-addresses', ITEM_EMAIL.id),
    'GET',
    `/list-item/email-addresses/${ITEM_EMAIL.id}`,
    undefined,
    { data: ITEM_EMAIL },
  ],
  [
    'listItems.archive',
    (c) => c.listItems.archive('email-addresses', ITEM_EMAIL.id),
    'DELETE',
    `/list-item/email-addresses/${ITEM_EMAIL.id}`,
    undefined,
    { data: ITEM_EMAIL },
  ],
  [
    'listItems.list',
    (c) => c.listItems.list({ filter: { 'list-id': LIST.id } }),
    'GET',
    `/list-items?filter%5Blist-id%5D=${LIST.id}`,
    undefined,
    list(ITEM_EMAIL),
  ],
  [
    'listMatches.list',
    (c) => c.listMatches.list({ filter: { status: 'open' } }),
    'GET',
    '/list-matches?filter%5Bstatus%5D=open',
    undefined,
    list(LIST_MATCH),
  ],
  [
    'listMatches.retrieve',
    (c) => c.listMatches.retrieve(LIST_MATCH.id),
    'GET',
    `/list-matches/${LIST_MATCH.id}`,
    undefined,
    { data: LIST_MATCH },
  ],
  [
    'listMatches.dismiss',
    (c) => c.listMatches.dismiss(LIST_MATCH.id, { reason: 'Synthetic reason' }),
    'POST',
    `/list-matches/${LIST_MATCH.id}/dismiss`,
    { data: { attributes: { reason: 'Synthetic reason' } } },
    { data: LIST_MATCH },
  ],
  [
    'importers.create',
    (c) => c.importers.create('email-addresses', { 'list-id': LIST.id, file: 'dmFsdWU=' }),
    'POST',
    '/importer/list-item/email-addresses',
    { data: { attributes: { 'list-id': LIST.id, file: 'dmFsdWU=' } } },
    one('importer'),
  ],
  [
    'importers.retrieve',
    (c) => c.importers.retrieve(IMPORTER.id),
    'GET',
    `/importers/${IMPORTER.id}`,
    undefined,
    one('importer'),
  ],
  ['importers.list', (c) => c.importers.list(), 'GET', '/importers', undefined, list(IMPORTER)],
  [
    'importers.errors',
    (c) => c.importers.errors(IMPORTER.id),
    'GET',
    `/importers/${IMPORTER.id}/errors`,
    undefined,
    one('importer-errors'),
  ],
  // C104, C105 (Workflow 7B): transactions and their types.
  [
    'transactions.create',
    (c) => c.transactions.create({ 'transaction-type-id': TRANSACTION_TYPE.id }),
    'POST',
    '/transactions',
    {
      data: {
        type: 'transaction',
        attributes: { 'transaction-type-id': TRANSACTION_TYPE.id },
      },
    },
    one('transaction'),
  ],
  [
    'transactions.retrieve',
    (c) => c.transactions.retrieve(TRANSACTION.id),
    'GET',
    `/transactions/${TRANSACTION.id}`,
    undefined,
    one('transaction'),
  ],
  [
    'transactions.list',
    (c) => c.transactions.list({ filter: { 'reference-id': 'ref-test-001' } }),
    'GET',
    '/transactions?filter%5Breference-id%5D=ref-test-001',
    undefined,
    list(TRANSACTION),
  ],
  [
    'transactions.update',
    (c) => c.transactions.update(TRANSACTION.id, { status: 'approved' }),
    'PATCH',
    `/transactions/${TRANSACTION.id}`,
    { data: { type: 'transaction', attributes: { status: 'approved' } } },
    one('transaction'),
  ],
  [
    'transactions.redact',
    (c) => c.transactions.redact(TRANSACTION.id),
    'DELETE',
    `/transactions/${TRANSACTION.id}`,
    undefined,
    one('transaction'),
  ],
  [
    'transactions.label',
    (c) => c.transactions.label(TRANSACTION.id, { label: 'chargeback' }),
    'POST',
    `/transactions/${TRANSACTION.id}/label`,
    { meta: { label: 'chargeback' } },
    one('transaction'),
  ],
  [
    'transactions.addTag',
    (c) => c.transactions.addTag(TRANSACTION.id, { 'tag-name': 'synthetic' }),
    'POST',
    `/transactions/${TRANSACTION.id}/add-tag`,
    { meta: { 'tag-name': 'synthetic' } },
    one('transaction'),
  ],
  [
    'transactions.removeTag',
    (c) => c.transactions.removeTag(TRANSACTION.id, { 'tag-name': 'synthetic' }),
    'POST',
    `/transactions/${TRANSACTION.id}/remove-tag`,
    { meta: { 'tag-name': 'synthetic' } },
    one('transaction'),
  ],
  [
    'transactions.setTags',
    (c) => c.transactions.setTags(TRANSACTION.id, { 'tag-names': ['synthetic'] }),
    'POST',
    `/transactions/${TRANSACTION.id}/set-tags`,
    { meta: { 'tag-names': ['synthetic'] } },
    one('transaction'),
  ],
  [
    'transactions.redactBiometrics',
    (c) => c.transactions.redactBiometrics(TRANSACTION.id),
    'POST',
    `/transactions/${TRANSACTION.id}/redact-biometrics`,
    {},
    one('transaction'),
  ],
  [
    'transactions.statusChanges',
    (c) => c.transactions.statusChanges(TRANSACTION.id, { page: { size: 5 } }),
    'GET',
    `/transactions/${TRANSACTION.id}/status-changes?page%5Bsize%5D=5`,
    undefined,
    { data: [], links: { next: null } },
  ],
  [
    'transactions.labels',
    (c) => c.transactions.labels(TRANSACTION.id),
    'GET',
    `/transactions/${TRANSACTION.id}/labels`,
    undefined,
    { data: [], links: { next: null } },
  ],
  [
    'transactions.relations',
    (c) => c.transactions.relations(TRANSACTION.id, { page: { size: 5 } }),
    'GET',
    `/transactions/${TRANSACTION.id}/relations?page%5Bsize%5D=5`,
    undefined,
    { data: [], links: { next: null } },
  ],
  [
    'transactions.addObjects',
    (c) => c.transactions.addObjects(TRANSACTION.id, { 'object-ids': [ID.inquiry] }),
    'POST',
    `/transactions/${TRANSACTION.id}/add-objects`,
    { meta: { 'object-ids': [ID.inquiry] } },
    one('transaction'),
  ],
  [
    'transactions.addRelation',
    (c) =>
      c.transactions.addRelation(TRANSACTION.id, {
        'relation-schema-key': 'buyer',
        'target-object-id': ID.account,
      }),
    'POST',
    `/transactions/${TRANSACTION.id}/add-relation`,
    { meta: { 'relation-schema-key': 'buyer', 'target-object-id': ID.account } },
    one('transaction'),
  ],
  [
    'transactionTypes.create',
    (c) => c.transactionTypes.create({ name: 'Synthetic payment' }),
    'POST',
    '/transaction-types',
    { data: { type: 'transaction-type', attributes: { name: 'Synthetic payment' } } },
    one('transaction-type'),
  ],
  [
    'transactionTypes.retrieve',
    (c) => c.transactionTypes.retrieve(TRANSACTION_TYPE.id),
    'GET',
    `/transaction-types/${TRANSACTION_TYPE.id}`,
    undefined,
    one('transaction-type'),
  ],
  [
    'transactionTypes.versions',
    (c) => c.transactionTypes.versions.publish(TRANSACTION_TYPE_VERSION.id),
    'POST',
    `/transaction-type-versions/${TRANSACTION_TYPE_VERSION.id}/publish`,
    {},
    one('transaction-type-version'),
  ],
  [
    'transactionTypes.versions.create',
    (c) => c.transactionTypes.versions.create({ 'transaction-type-id': TRANSACTION_TYPE.id }),
    'POST',
    '/transaction-type-versions',
    {
      data: {
        type: 'transaction-type-version',
        attributes: { 'transaction-type-id': TRANSACTION_TYPE.id },
      },
    },
    one('transaction-type-version'),
  ],
  [
    'transactionTypes.versions.retrieve',
    (c) => c.transactionTypes.versions.retrieve(TRANSACTION_TYPE_VERSION.id),
    'GET',
    `/transaction-type-versions/${TRANSACTION_TYPE_VERSION.id}`,
    undefined,
    one('transaction-type-version'),
  ],
  [
    'transactionTypes.versions.update',
    (c) =>
      c.transactionTypes.versions.update(TRANSACTION_TYPE_VERSION.id, {
        'allow-card-like-strings': false,
      }),
    'PATCH',
    `/transaction-type-versions/${TRANSACTION_TYPE_VERSION.id}`,
    {
      data: {
        type: 'transaction-type-version',
        attributes: { 'allow-card-like-strings': false },
      },
    },
    one('transaction-type-version'),
  ],
  [
    'transactionTypeVersions.list',
    (c) =>
      c.transactionTypeVersions.list({
        filter: { 'transaction-type-id': TRANSACTION_TYPE.id },
      }),
    'GET',
    `/transaction-type-versions?filter%5Btransaction-type-id%5D=${TRANSACTION_TYPE.id}`,
    undefined,
    { data: [TRANSACTION_TYPE_VERSION], links: { next: null } },
  ],
  [
    'graphQueryTemplateVersions.list',
    (c) => c.graphQueryTemplateVersions.list(),
    'GET',
    '/graph-query-template-versions',
    undefined,
    { data: [], links: { next: null } },
  ],
  [
    'transactionTypes.list',
    (c) => c.transactionTypes.list(),
    'GET',
    '/transaction-types',
    undefined,
    list(TRANSACTION_TYPE),
  ],
  [
    'transactionTypes.update',
    (c) => c.transactionTypes.update(TRANSACTION_TYPE.id, { name: 'Synthetic refund' }),
    'PATCH',
    `/transaction-types/${TRANSACTION_TYPE.id}`,
    { data: { type: 'transaction-type', attributes: { name: 'Synthetic refund' } } },
    one('transaction-type'),
  ],
  [
    'transactionTypes.archive',
    (c) => c.transactionTypes.archive(TRANSACTION_TYPE.id),
    'DELETE',
    `/transaction-types/${TRANSACTION_TYPE.id}`,
    undefined,
    one('transaction-type'),
  ],
  [
    'transactions.removeObjects',
    (c) => c.transactions.removeObjects(TRANSACTION.id, { 'object-ids': [ID.inquiry] }),
    'POST',
    `/transactions/${TRANSACTION.id}/remove-objects`,
    { meta: { 'object-ids': [ID.inquiry] } },
    one('transaction'),
  ],
  [
    'transactions.removeRelation',
    (c) =>
      c.transactions.removeRelation(TRANSACTION.id, {
        'relation-schema-key': 'buyer',
        'target-object-id': ID.account,
      }),
    'POST',
    `/transactions/${TRANSACTION.id}/remove-relation`,
    { meta: { 'relation-schema-key': 'buyer', 'target-object-id': ID.account } },
    one('transaction'),
  ],
  // C102, C103 (Workflow 7B): graph queries and their templates.
  [
    'graphQueries.create',
    (c) =>
      c.graphQueries.create({
        'graph-query-template-id': GRAPH_TEMPLATE.id,
        'parameter-map': { email: 'linked@example.test' },
      }),
    'POST',
    '/graph-queries',
    {
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': GRAPH_TEMPLATE.id,
          'parameter-map': { email: 'linked@example.test' },
        },
      },
    },
    one('graph-query'),
  ],
  [
    'graphQueries.createSync',
    (c) =>
      c.graphQueries.createSync({
        'graph-query-template-id': GRAPH_TEMPLATE.id,
        'parameter-map': { email: 'linked@example.test' },
      }),
    'POST',
    '/graph-queries',
    {
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': GRAPH_TEMPLATE.id,
          'parameter-map': { email: 'linked@example.test' },
        },
      },
      meta: { 'run-sync': true },
    },
    one('graph-query'),
  ],
  [
    'graphQueries.retrieve',
    (c) => c.graphQueries.retrieve(GRAPH_QUERY.id),
    'GET',
    `/graph-queries/${GRAPH_QUERY.id}`,
    undefined,
    one('graph-query'),
  ],
  [
    'graphQueries.list',
    (c) => c.graphQueries.list(),
    'GET',
    '/graph-queries',
    undefined,
    list(GRAPH_QUERY),
  ],
  [
    'graphQueries.rerun',
    (c) => c.graphQueries.rerun(GRAPH_QUERY.id),
    'POST',
    `/graph-queries/${GRAPH_QUERY.id}/rerun`,
    {},
    one('graph-query'),
  ],
  [
    'graphQueries.cancel',
    (c) => c.graphQueries.cancel(GRAPH_QUERY.id),
    'POST',
    `/graph-queries/${GRAPH_QUERY.id}/cancel`,
    {},
    one('graph-query'),
  ],
  [
    'graphQueries.nodeValue',
    (c) => c.graphQueries.nodeValue(GRAPH_QUERY.id, GRAPH_NODE.id),
    'GET',
    `/graph-queries/${GRAPH_QUERY.id}/nodes/${GRAPH_NODE.id}/value`,
    undefined,
    one('graph-node-value'),
  ],
  [
    'graphQueries.action',
    (c) =>
      c.graphQueries.action(GRAPH_QUERY.id, { action: 'add-tag', tag: 'synthetic', all: true }),
    'POST',
    `/graph-queries/${GRAPH_QUERY.id}/actions`,
    { data: { attributes: { action: 'add-tag', tag: 'synthetic', all: true } } },
    one('graph-query-action-result'),
  ],
  [
    'graphQueryTemplates.create',
    (c) => c.graphQueryTemplates.create({ name: 'Synthetic' }),
    'POST',
    '/graph-query-templates',
    { data: { type: 'graph-query-template', attributes: { name: 'Synthetic' } } },
    one('graph-query-template'),
  ],
  [
    'graphQueryTemplates.retrieve',
    (c) => c.graphQueryTemplates.retrieve(GRAPH_TEMPLATE.id),
    'GET',
    `/graph-query-templates/${GRAPH_TEMPLATE.id}`,
    undefined,
    one('graph-query-template'),
  ],
  [
    'graphQueryTemplates.list',
    (c) => c.graphQueryTemplates.list(),
    'GET',
    '/graph-query-templates',
    undefined,
    list(GRAPH_TEMPLATE),
  ],
  [
    'graphQueryTemplates.update',
    (c) => c.graphQueryTemplates.update(GRAPH_TEMPLATE.id, { name: 'Renamed' }),
    'PATCH',
    `/graph-query-templates/${GRAPH_TEMPLATE.id}`,
    { data: { type: 'graph-query-template', attributes: { name: 'Renamed' } } },
    one('graph-query-template'),
  ],
  [
    'graphQueryTemplates.archive',
    (c) => c.graphQueryTemplates.archive(GRAPH_TEMPLATE.id),
    'DELETE',
    `/graph-query-templates/${GRAPH_TEMPLATE.id}`,
    undefined,
    one('graph-query-template'),
  ],
  [
    'graphQueryTemplates.versions',
    (c) => c.graphQueryTemplates.versions.publish(GRAPH_VERSION.id),
    'POST',
    `/graph-query-template-versions/${GRAPH_VERSION.id}/publish`,
    {},
    one('graph-query-template-version'),
  ],
  [
    'graphQueryTemplates.versions.retrieve',
    (c) => c.graphQueryTemplates.versions.retrieve(GRAPH_VERSION.id),
    'GET',
    `/graph-query-template-versions/${GRAPH_VERSION.id}`,
    undefined,
    one('graph-query-template-version'),
  ],
  // C2: verifications
  [
    'verifications.retrieve',
    (c) => c.verifications.retrieve(ID.verification),
    'GET',
    `/verifications/${ID.verification}`,
    undefined,
    one('verification-government-id'),
  ],
  [
    'verifications.retrieve with its captures (C40.1)',
    (c) => c.verifications.retrieve(ID.verification, { include: 'selfies' }),
    'GET',
    `/verifications/${ID.verification}?include=selfies`,
    undefined,
    verificationWithSelfies,
  ],
  // C40.1: selfie captures
  [
    'selfies.retrieve',
    (c) => c.selfies.retrieve(ID.selfie),
    'GET',
    `/selfies/${ID.selfie}`,
    undefined,
    one('selfie'),
  ],
  // C13: accounts
  [
    'accounts.create',
    (c) => c.accounts.create({ 'reference-id': 'ref-synthetic' }),
    'POST',
    '/accounts',
    { data: { type: 'account', attributes: { 'reference-id': 'ref-synthetic' } } },
    one('account'),
  ],
  [
    'accounts.retrieve',
    (c) => c.accounts.retrieve(ID.account),
    'GET',
    `/accounts/${ID.account}`,
    undefined,
    one('account'),
  ],
  [
    'accounts.retrieve with its reports (C70.5)',
    (c) => c.accounts.retrieve(ID.account, { include: 'reports' }),
    'GET',
    `/accounts/${ID.account}?include=reports`,
    undefined,
    { data: one('account').data, included: [report.data] },
  ],
  [
    'accounts.retrieve with its list matches and transactions (Workflow 7B)',
    (c) => c.accounts.retrieve(ID.account, { include: ['list-matches', 'transactions'] }),
    'GET',
    `/accounts/${ID.account}?include=list-matches%2Ctransactions`,
    undefined,
    { data: one('account').data, included: [] },
  ],
  [
    'accounts.list',
    (c) => c.accounts.list({ filter: { 'reference-id': 'ref,with,commas' } }),
    'GET',
    '/accounts?filter%5Breference-id%5D=ref%2Cwith%2Ccommas',
    undefined,
    list(resourceOf('account')),
  ],
  [
    'accounts.update',
    (c) => c.accounts.update(ID.account, { status: 'archived' }),
    'PATCH',
    `/accounts/${ID.account}`,
    { data: { type: 'account', attributes: { status: 'archived' } } },
    one('account'),
  ],
  [
    'accounts.addTag',
    (c) => c.accounts.addTag(ID.account, { 'tag-name': 'vip' }),
    'POST',
    `/accounts/${ID.account}/add-tag`,
    { meta: { 'tag-name': 'vip' } },
    one('account'),
  ],
  [
    'accounts.removeTag',
    (c) => c.accounts.removeTag(ID.account, { 'tag-name': 'vip' }),
    'POST',
    `/accounts/${ID.account}/remove-tag`,
    { meta: { 'tag-name': 'vip' } },
    one('account'),
  ],
  [
    'accounts.setTags',
    (c) => c.accounts.setTags(ID.account, { 'tag-names': [] }),
    'POST',
    `/accounts/${ID.account}/set-tags`,
    { meta: { 'tag-names': [] } },
    one('account'),
  ],
  [
    'accounts.addRelation',
    (c) =>
      c.accounts.addRelation(ID.account, {
        'related-account-id': ID.other,
        'relation-type': 'spouse',
      }),
    'POST',
    `/accounts/${ID.account}/add-relation`,
    { meta: { 'related-account-id': ID.other, 'relation-type': 'spouse' } },
    one('account'),
  ],
  [
    'accounts.removeRelation',
    (c) =>
      c.accounts.removeRelation(ID.account, {
        'related-account-id': ID.other,
        'relation-type': 'spouse',
      }),
    'POST',
    `/accounts/${ID.account}/remove-relation`,
    { meta: { 'related-account-id': ID.other, 'relation-type': 'spouse' } },
    one('account'),
  ],
  [
    'accounts.listRelations',
    (c) => c.accounts.listRelations(ID.account),
    'GET',
    `/accounts/${ID.account}/relations`,
    undefined,
    { data: [] },
  ],
  [
    'accounts.graphComponent',
    (c) => c.accounts.graphComponent(ID.account),
    'GET',
    `/accounts/${ID.account}/graph-component`,
    undefined,
    {
      data: {
        type: 'account-graph-component',
        id: ID.account,
        attributes: { state: 'not-computed', size: null, 'computed-at': null },
      },
    },
  ],
  [
    'accounts.consolidate',
    (c) => c.accounts.consolidate(ID.account, { 'source-account-ids': [ID.other] }),
    'POST',
    `/accounts/${ID.account}/consolidate`,
    { meta: { 'source-account-ids': [ID.other] } },
    one('account'),
  ],
  [
    'accounts.addObjects',
    (c) => c.accounts.addObjects(ID.account, { objects: [{ type: 'inquiry', id: ID.inquiry }] }),
    'POST',
    `/accounts/${ID.account}/add-objects`,
    { meta: { objects: [{ type: 'inquiry', id: ID.inquiry }] } },
    one('account'),
  ],
  [
    'accounts.removeObjects',
    (c) => c.accounts.removeObjects(ID.account, { objects: [{ type: 'inquiry', id: ID.inquiry }] }),
    'POST',
    `/accounts/${ID.account}/remove-objects`,
    { meta: { objects: [{ type: 'inquiry', id: ID.inquiry }] } },
    one('account'),
  ],
  [
    'accounts.redact',
    (c) => c.accounts.redact(ID.account),
    'POST',
    `/accounts/${ID.account}/redact`,
    {},
    one('account'),
  ],
  // C13: account types
  [
    'accountTypes.create',
    (c) => c.accountTypes.create({ name: 'business', 'fields-schema': {} }),
    'POST',
    '/account-types',
    { data: { type: 'account-type', attributes: { name: 'business', 'fields-schema': {} } } },
    one('account-type'),
  ],
  [
    'accountTypes.retrieve',
    (c) => c.accountTypes.retrieve(ID.accountType),
    'GET',
    `/account-types/${ID.accountType}`,
    undefined,
    one('account-type'),
  ],
  [
    'accountTypes.list',
    (c) => c.accountTypes.list(),
    'GET',
    '/account-types',
    undefined,
    list(resourceOf('account-type')),
  ],
  // C25.3 (Workflow 2E)
  [
    'accountTypes.update',
    (c) =>
      c.accountTypes.update(ID.accountType, {
        name: 'customer',
        'fields-schema': { tier: { type: 'string', label: 'Tier' } },
      }),
    'PATCH',
    `/account-types/${ID.accountType}`,
    {
      data: {
        type: 'account-type',
        attributes: {
          name: 'customer',
          'fields-schema': { tier: { type: 'string', label: 'Tier' } },
        },
      },
    },
    one('account-type'),
  ],
  // C2 and C14: webhooks
  [
    'webhooks.create',
    (c) =>
      c.webhooks.create({ url: 'https://hooks.example.test/openverify', 'enabled-events': ['*'] }),
    'POST',
    '/webhooks',
    {
      data: {
        type: 'webhook',
        attributes: { url: 'https://hooks.example.test/openverify', 'enabled-events': ['*'] },
      },
    },
    createdWebhook,
  ],
  [
    'webhooks.retrieve',
    (c) => c.webhooks.retrieve(ID.webhook),
    'GET',
    `/webhooks/${ID.webhook}`,
    undefined,
    webhook,
  ],
  [
    'webhooks.list',
    (c) => c.webhooks.list({ page: { size: 10 } }),
    'GET',
    '/webhooks?page%5Bsize%5D=10',
    undefined,
    list(webhook.data),
  ],
  [
    'webhooks.update',
    (c) => c.webhooks.update(ID.webhook, { status: 'disabled' }),
    'PATCH',
    `/webhooks/${ID.webhook}`,
    { data: { type: 'webhook', attributes: { status: 'disabled' } } },
    webhook,
  ],
  [
    'webhooks.enable',
    (c) => c.webhooks.enable(ID.webhook),
    'POST',
    `/webhooks/${ID.webhook}/enable`,
    {},
    webhook,
  ],
  [
    'webhooks.disable',
    (c) => c.webhooks.disable(ID.webhook),
    'POST',
    `/webhooks/${ID.webhook}/disable`,
    {},
    webhook,
  ],
  [
    'webhooks.archive',
    (c) => c.webhooks.archive(ID.webhook),
    'POST',
    `/webhooks/${ID.webhook}/archive`,
    {},
    webhook,
  ],
  [
    'webhooks.clone',
    (c) => c.webhooks.clone(ID.webhook),
    'POST',
    `/webhooks/${ID.webhook}/clone`,
    {},
    createdWebhook,
  ],
  [
    'webhooks.rotateSecret',
    (c) => c.webhooks.rotateSecret(ID.webhook, { 'previous-secret-expires-in-seconds': 0 }),
    'POST',
    `/webhooks/${ID.webhook}/rotate-secret`,
    { meta: { 'previous-secret-expires-in-seconds': 0 } },
    { ...createdWebhook, meta: { 'previous-secret-expires-at': '2026-10-20T12:00:00.000Z' } },
  ],
  [
    'webhooks.simulate',
    (c) => c.webhooks.simulate(ID.webhook, { 'event-name': 'inquiry.approved' }),
    'POST',
    `/webhooks/${ID.webhook}/simulate`,
    { meta: { 'event-name': 'inquiry.approved' } },
    { ...webhook, meta: { 'event-id': ID.event } },
  ],
  [
    'webhooks.replay',
    (c) => c.webhooks.replay(ID.webhook, { 'event-ids': [ID.event] }),
    'POST',
    `/webhooks/${ID.webhook}/replay`,
    { meta: { 'event-ids': [ID.event] } },
    { ...webhook, meta: { 'replayed-count': 1 } },
  ],
  // C14: webhook deliveries
  [
    'webhookDeliveries.retrieve',
    (c) => c.webhookDeliveries.retrieve(ID.delivery),
    'GET',
    `/webhook-deliveries/${ID.delivery}`,
    undefined,
    one('webhook-delivery'),
  ],
  [
    'webhookDeliveries.list',
    (c) => c.webhookDeliveries.list({ filter: { 'webhook-id': ID.webhook } }),
    'GET',
    `/webhook-deliveries?filter%5Bwebhook-id%5D=${ID.webhook}`,
    undefined,
    list(resourceOf('webhook-delivery')),
  ],
  // C2 and C12: events
  [
    'events.retrieve',
    (c) => c.events.retrieve(ID.event),
    'GET',
    `/events/${ID.event}`,
    undefined,
    one('event-inquiry-approved'),
  ],
  [
    'events.list',
    (c) => c.events.list({ filter: { name: ['inquiry.approved'], 'object-id': ID.inquiry } }),
    'GET',
    `/events?filter%5Bname%5D=inquiry.approved&filter%5Bobject-id%5D=${ID.inquiry}`,
    undefined,
    list(resourceOf('event-inquiry-approved')),
  ],
  // C25.7 (Workflow 2E): an inquiry's timeline
  [
    'events.list',
    (c) => c.events.list({ filter: { 'inquiry-id': [ID.inquiry, ID.inquiry] } }),
    'GET',
    `/events?filter%5Binquiry-id%5D=${ID.inquiry}%2C${ID.inquiry}`,
    undefined,
    list(resourceOf('event-inquiry-approved')),
  ],
  // C12: API keys
  [
    'apiKeys.create',
    (c) => c.apiKeys.create({ name: 'Backend', scopes: ['inquiries:read'] }),
    'POST',
    '/api-keys',
    { data: { type: 'api-key', attributes: { name: 'Backend', scopes: ['inquiries:read'] } } },
    createdApiKey,
  ],
  // C25.5 (Workflow 2E): a key that expires
  [
    'apiKeys.create',
    (c) =>
      c.apiKeys.create({ name: 'Backend', scopes: ['inquiries:read'], 'expires-in-seconds': 3600 }),
    'POST',
    '/api-keys',
    {
      data: {
        type: 'api-key',
        attributes: { name: 'Backend', scopes: ['inquiries:read'], 'expires-in-seconds': 3600 },
      },
    },
    createdApiKey,
  ],
  [
    'apiKeys.retrieve',
    (c) => c.apiKeys.retrieve(ID.key),
    'GET',
    `/api-keys/${ID.key}`,
    undefined,
    apiKey,
  ],
  ['apiKeys.list', (c) => c.apiKeys.list(), 'GET', '/api-keys', undefined, list(apiKey.data)],
  [
    'apiKeys.update',
    (c) => c.apiKeys.update(ID.key, { name: 'Renamed' }),
    'PATCH',
    `/api-keys/${ID.key}`,
    { data: { type: 'api-key', attributes: { name: 'Renamed' } } },
    apiKey,
  ],
  [
    'apiKeys.clone',
    (c) => c.apiKeys.clone(ID.key),
    'POST',
    `/api-keys/${ID.key}/clone`,
    {},
    createdApiKey,
  ],
  [
    'apiKeys.expire',
    (c) => c.apiKeys.expire(ID.key, { 'expires-in-seconds': 0 }),
    'POST',
    `/api-keys/${ID.key}/expire`,
    { meta: { 'expires-in-seconds': 0 } },
    apiKey,
  ],
  // C12: API logs and rate limits
  [
    'apiLogs.retrieve',
    (c) => c.apiLogs.retrieve(ID.log),
    'GET',
    `/api-logs/${ID.log}`,
    undefined,
    one('api-log'),
  ],
  [
    'apiLogs.list',
    (c) => c.apiLogs.list({ filter: { status: '4xx', method: 'POST' } }),
    'GET',
    '/api-logs?filter%5Bstatus%5D=4xx&filter%5Bmethod%5D=POST',
    undefined,
    list(resourceOf('api-log')),
  ],
  // C25.9 (Workflow 2E): the requests of a user's dashboard sessions
  [
    'apiLogs.list',
    (c) => c.apiLogs.list({ filter: { 'user-id': 'usr_01M5CJXHG03PHEQZPRWAH2RXM5' } }),
    'GET',
    '/api-logs?filter%5Buser-id%5D=usr_01M5CJXHG03PHEQZPRWAH2RXM5',
    undefined,
    list(resourceOf('api-log')),
  ],
  [
    'rateLimits.list',
    (c) => c.rateLimits.list(),
    'GET',
    '/rate-limits',
    undefined,
    one('rate-limit'),
  ],
  // C55.11: the sandbox SMS sink, the number in the body
  [
    'sandboxSmsMessages.search',
    (c) => c.sandboxSmsMessages.search('+12025550147'),
    'POST',
    '/sandbox/sms-messages/search',
    { 'phone-number': '+12025550147' },
    { data: [{ code: '042817', 'sent-at': '2026-10-20T12:00:05.000Z' }] },
  ],
  // C15: user audit logs
  [
    'userAuditLogs.retrieve',
    (c) => c.userAuditLogs.retrieve(ID.audit),
    'GET',
    `/user-audit-logs/${ID.audit}`,
    undefined,
    one('user-audit-log'),
  ],
  [
    'userAuditLogs.list',
    (c) => c.userAuditLogs.list({ filter: { action: 'webhook.secret-rotated' } }),
    'GET',
    '/user-audit-logs?filter%5Baction%5D=webhook.secret-rotated',
    undefined,
    list(resourceOf('user-audit-log')),
  ],
  // C72 (Phase 6): reports
  [
    'reports.create',
    (c) =>
      c.reports.create(
        'report/watchlist',
        { 'report-template-id': REPORT_TEMPLATE, query: { term: 'Avery Quillfeather' } },
        { 'auto-create-account': false, 'processing-mode': 'sync' },
      ),
    'POST',
    '/reports',
    {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': REPORT_TEMPLATE,
          query: { term: 'Avery Quillfeather' },
        },
      },
      meta: { 'auto-create-account': false, 'processing-mode': 'sync' },
    },
    report,
  ],
  [
    'reports.retrieve',
    (c) => c.reports.retrieve(REPORT),
    'GET',
    `/reports/${REPORT}`,
    undefined,
    report,
  ],
  [
    'reports.list',
    (c) => c.reports.list({ filter: { 'has-match': false, type: 'report/watchlist' } }),
    'GET',
    '/reports?filter%5Bhas-match%5D=false&filter%5Btype%5D=report%2Fwatchlist',
    undefined,
    list(report.data),
  ],
  [
    'reports.redact',
    (c) => c.reports.redact(REPORT),
    'DELETE',
    `/reports/${REPORT}`,
    undefined,
    report,
  ],
  [
    'reports.addTag',
    (c) => c.reports.addTag(REPORT, { 'tag-name': 'onboarding' }),
    'POST',
    `/reports/${REPORT}/add-tag`,
    { meta: { 'tag-name': 'onboarding' } },
    report,
  ],
  [
    'reports.removeTag',
    (c) => c.reports.removeTag(REPORT, { 'tag-name': 'onboarding' }),
    'POST',
    `/reports/${REPORT}/remove-tag`,
    { meta: { 'tag-name': 'onboarding' } },
    report,
  ],
  [
    'reports.setTags',
    (c) => c.reports.setTags(REPORT, { 'tag-names': ['onboarding'] }),
    'POST',
    `/reports/${REPORT}/set-tags`,
    { meta: { 'tag-names': ['onboarding'] } },
    report,
  ],
  [
    'reports.dismiss',
    (c) => c.reports.dismiss(REPORT, { reason: 'Not the subject' }),
    'POST',
    `/reports/${REPORT}/dismiss`,
    { data: { attributes: { reason: 'Not the subject' } } },
    report,
  ],
  [
    'reports.review',
    (c) =>
      c.reports.review(REPORT, {
        'review-type': 'record',
        'record-token': MATCH,
        'review-status': 'true_positive',
      }),
    'POST',
    `/reports/${REPORT}/review`,
    {
      data: {
        attributes: {
          'review-type': 'record',
          'record-token': MATCH,
          'review-status': 'true_positive',
        },
      },
    },
    report,
  ],
  ['reports.pause', (c) => c.reports.pause(REPORT), 'POST', `/reports/${REPORT}/pause`, {}, report],
  [
    'reports.resume',
    (c) => c.reports.resume(REPORT),
    'POST',
    `/reports/${REPORT}/resume`,
    {},
    report,
  ],
  ['reports.run', (c) => c.reports.run(REPORT), 'POST', `/reports/${REPORT}/run`, {}, report],
  [
    'reports.history',
    (c) => c.reports.history(REPORT, { page: { size: 10 } }),
    'GET',
    `/reports/${REPORT}/history?page%5Bsize%5D=10`,
    undefined,
    history,
  ],
  [
    'reports.historyAll',
    async (c) => {
      const entries = [];
      for await (const entry of c.reports.historyAll(REPORT)) {
        entries.push(entry);
      }
      return { data: entries, links: { next: null } };
    },
    'GET',
    `/reports/${REPORT}/history`,
    undefined,
    history,
  ],
  // C71 (Phase 6): report templates and versions
  [
    'reportTemplates.create',
    (c) =>
      c.reportTemplates.create({
        name: 'Default watchlist',
        'report-type': 'watchlist',
        config: { 'recurrence-interval-days': 30 },
      }),
    'POST',
    '/report-templates',
    {
      data: {
        type: 'report-template',
        attributes: {
          name: 'Default watchlist',
          'report-type': 'watchlist',
          config: { 'recurrence-interval-days': 30 },
        },
      },
    },
    reportTemplate,
  ],
  [
    'reportTemplates.retrieve',
    (c) => c.reportTemplates.retrieve(REPORT_TEMPLATE),
    'GET',
    `/report-templates/${REPORT_TEMPLATE}`,
    undefined,
    reportTemplate,
  ],
  [
    'reportTemplates.list',
    (c) => c.reportTemplates.list({ filter: { 'report-type': 'watchlist' } }),
    'GET',
    '/report-templates?filter%5Breport-type%5D=watchlist',
    undefined,
    list(reportTemplate.data),
  ],
  [
    'reportTemplates.update',
    (c) => c.reportTemplates.update(REPORT_TEMPLATE, { status: 'archived' }),
    'PATCH',
    `/report-templates/${REPORT_TEMPLATE}`,
    { data: { type: 'report-template', attributes: { status: 'archived' } } },
    reportTemplate,
  ],
  [
    'reportTemplateVersions.create',
    (c) =>
      c.reportTemplateVersions.create({
        'report-template-id': REPORT_TEMPLATE,
        config: { 'search-lists': ['openverify-sandbox'] },
      }),
    'POST',
    '/report-template-versions',
    {
      data: {
        type: 'report-template-version',
        attributes: {
          'report-template-id': REPORT_TEMPLATE,
          config: { 'search-lists': ['openverify-sandbox'] },
        },
      },
    },
    reportVersion,
  ],
  [
    'reportTemplateVersions.retrieve',
    (c) => c.reportTemplateVersions.retrieve(REPORT_VERSION),
    'GET',
    `/report-template-versions/${REPORT_VERSION}`,
    undefined,
    reportVersion,
  ],
  [
    'reportTemplateVersions.list',
    (c) => c.reportTemplateVersions.list({ filter: { 'report-template-id': REPORT_TEMPLATE } }),
    'GET',
    `/report-template-versions?filter%5Breport-template-id%5D=${REPORT_TEMPLATE}`,
    undefined,
    list(reportVersion.data),
  ],
  [
    'reportTemplateVersions.update',
    (c) => c.reportTemplateVersions.update(REPORT_VERSION, { config: {} }),
    'PATCH',
    `/report-template-versions/${REPORT_VERSION}`,
    { data: { type: 'report-template-version', attributes: { config: {} } } },
    reportVersion,
  ],
  [
    'reportTemplateVersions.publish',
    (c) => c.reportTemplateVersions.publish(REPORT_VERSION),
    'POST',
    `/report-template-versions/${REPORT_VERSION}/publish`,
    {},
    reportVersion,
  ],
  // C112, C116, C118, C120, C122.4, C140.5 (Workflow 8A).
  [
    'workflows.create',
    (c) => c.workflows.create({ name: 'Review on match' }),
    'POST',
    '/workflows',
    { data: { type: 'workflow', attributes: { name: 'Review on match' } } },
    workflow,
  ],
  [
    'workflows.retrieve',
    (c) => c.workflows.retrieve(WORKFLOW.id, { include: ['active-deployment'] }),
    'GET',
    `/workflows/${WORKFLOW.id}?include=active-deployment`,
    undefined,
    { ...workflow, included: [one('workflow-deployment').data] },
  ],
  [
    'workflows.list',
    (c) => c.workflows.list({ filter: { status: 'running' } }),
    'GET',
    '/workflows?filter%5Bstatus%5D=running',
    undefined,
    list(workflow.data),
  ],
  [
    'workflows.update',
    (c) => c.workflows.update(WORKFLOW.id, { name: 'Renamed' }),
    'PATCH',
    `/workflows/${WORKFLOW.id}`,
    { data: { type: 'workflow', attributes: { name: 'Renamed' } } },
    workflow,
  ],
  [
    'workflows.pause',
    (c) => c.workflows.pause(WORKFLOW.id),
    'POST',
    `/workflows/${WORKFLOW.id}/pause`,
    {},
    workflow,
  ],
  [
    'workflows.activate',
    (c) => c.workflows.activate(WORKFLOW.id),
    'POST',
    `/workflows/${WORKFLOW.id}/activate`,
    {},
    workflow,
  ],
  [
    'workflows.archive',
    (c) => c.workflows.archive(WORKFLOW.id),
    'POST',
    `/workflows/${WORKFLOW.id}/archive`,
    {},
    workflow,
  ],
  [
    'workflows.draft',
    (c) => c.workflows.draft(WORKFLOW.id),
    'GET',
    `/workflows/${WORKFLOW.id}/draft`,
    undefined,
    workflowVersion,
  ],
  [
    'workflows.saveDraft',
    (c) =>
      c.workflows.saveDraft(WORKFLOW.id, {
        definition: WORKFLOW_VERSION.attributes.definition as never,
        'lock-version': 3,
      }),
    'PUT',
    `/workflows/${WORKFLOW.id}/draft`,
    {
      data: {
        type: 'workflow-version',
        attributes: { definition: WORKFLOW_VERSION.attributes.definition, 'lock-version': 3 },
      },
    },
    workflowVersion,
  ],
  [
    'workflows.validateDraft',
    (c) => c.workflows.validateDraft(WORKFLOW.id),
    'POST',
    `/workflows/${WORKFLOW.id}/draft/validate`,
    {},
    one('workflow-definition-check'),
  ],
  [
    'workflows.publish',
    (c) => c.workflows.publish(WORKFLOW.id, { 'rollout-percentage': 25 }),
    'POST',
    `/workflows/${WORKFLOW.id}/publish`,
    { meta: { 'rollout-percentage': 25 } },
    workflowVersion,
  ],
  [
    'workflows.rollout',
    (c) => c.workflows.rollout(WORKFLOW.id, { 'rollout-percentage': 100 }),
    'POST',
    `/workflows/${WORKFLOW.id}/rollout`,
    { meta: { 'rollout-percentage': 100 } },
    workflowVersion,
  ],
  [
    'workflows.restore',
    (c) => c.workflows.restore(WORKFLOW.id, { 'version-id': WORKFLOW_VERSION.id }),
    'POST',
    `/workflows/${WORKFLOW.id}/restore`,
    { meta: { 'version-id': WORKFLOW_VERSION.id } },
    workflowVersion,
  ],
  [
    'workflows.promote',
    (c) => c.workflows.promote(WORKFLOW.id, { 'environment-id': ENVIRONMENT }),
    'POST',
    `/workflows/${WORKFLOW.id}/promote`,
    { meta: { 'environment-id': ENVIRONMENT } },
    workflowVersion,
  ],
  [
    'workflows.trigger',
    (c) => c.workflows.trigger(WORKFLOW.id, { reference_id: 'ref-test-001' }),
    'POST',
    `/workflows/${WORKFLOW.id}/trigger`,
    { data: { attributes: { fields: { reference_id: 'ref-test-001' } } } },
    workflowRun,
  ],
  [
    'workflows.manualRuns',
    (c) => c.workflows.manualRuns(WORKFLOW.id, { 'object-ids': [ID.inquiry] }),
    'POST',
    `/workflows/${WORKFLOW.id}/manual-runs`,
    { data: { type: 'workflow-run', attributes: { 'object-ids': [ID.inquiry] } } },
    one('workflow-manual-runs'),
  ],
  [
    'workflows.cancelRuns',
    (c) => c.workflows.cancelRuns(WORKFLOW.id, { 'before-version-id': WORKFLOW_VERSION.id }),
    'POST',
    `/workflows/${WORKFLOW.id}/cancel-runs`,
    { meta: { 'before-version-id': WORKFLOW_VERSION.id } },
    { meta: { 'canceled-count': 2 } },
  ],
  [
    'workflows.actions',
    (c) => c.workflows.actions(),
    'GET',
    '/workflow-actions',
    undefined,
    one('workflow-actions'),
  ],
  [
    'workflows.recipes',
    (c) => c.workflows.recipes(),
    'GET',
    '/workflow-recipes',
    undefined,
    one('workflow-recipes'),
  ],
  [
    'workflows.installRecipe',
    (c) => c.workflows.installRecipe('review-on-report-match'),
    'POST',
    '/workflow-recipes/review-on-report-match/install',
    {},
    workflow,
  ],
  [
    'workflowVersions.list',
    (c) => c.workflowVersions.list({ filter: { 'workflow-id': WORKFLOW.id } }),
    'GET',
    `/workflow-versions?filter%5Bworkflow-id%5D=${WORKFLOW.id}`,
    undefined,
    list(workflowVersion.data),
  ],
  [
    'workflowVersions.retrieve',
    (c) => c.workflowVersions.retrieve(WORKFLOW_VERSION.id),
    'GET',
    `/workflow-versions/${WORKFLOW_VERSION.id}`,
    undefined,
    workflowVersion,
  ],
  [
    'workflowVersions.diff',
    (c) => c.workflowVersions.diff(WORKFLOW_VERSION.id, WORKFLOW_VERSION.id),
    'GET',
    `/workflow-versions/${WORKFLOW_VERSION.id}/diff?against=${WORKFLOW_VERSION.id}`,
    undefined,
    one('workflow-version-diff'),
  ],
  [
    'workflowRuns.list',
    (c) => c.workflowRuns.list({ filter: { 'workflow-id': WORKFLOW.id } }),
    'GET',
    `/workflow-runs?filter%5Bworkflow-id%5D=${WORKFLOW.id}`,
    undefined,
    list(workflowRun.data),
  ],
  [
    'workflowRuns.retrieve',
    (c) => c.workflowRuns.retrieve(WORKFLOW_RUN.id, { include: ['workflow'] }),
    'GET',
    `/workflow-runs/${WORKFLOW_RUN.id}?include=workflow`,
    undefined,
    { ...workflowRun, included: [workflow.data] },
  ],
  [
    'workflowRuns.steps',
    (c) => c.workflowRuns.steps(WORKFLOW_RUN.id),
    'GET',
    `/workflow-runs/${WORKFLOW_RUN.id}/steps`,
    undefined,
    one('workflow-run-steps'),
  ],
  [
    'workflowRuns.deliveries',
    (c) => c.workflowRuns.deliveries({ filter: { status: 'refused' } }),
    'GET',
    '/workflow-trigger-deliveries?filter%5Bstatus%5D=refused',
    undefined,
    one('workflow-trigger-deliveries'),
  ],
  [
    'workflowRuns.resume',
    (c) => c.workflowRuns.resume(WORKFLOW_RUN.id, { 'skip-unknown-effects': true }),
    'POST',
    `/workflow-runs/${WORKFLOW_RUN.id}/resume`,
    { meta: { 'skip-unknown-effects': true } },
    workflowRun,
  ],
  [
    'workflowRuns.rerun',
    (c) => c.workflowRuns.rerun(WORKFLOW_RUN.id),
    'POST',
    `/workflow-runs/${WORKFLOW_RUN.id}/rerun`,
    {},
    workflowRun,
  ],
  [
    'workflowRuns.cancel',
    (c) => c.workflowRuns.cancel(WORKFLOW_RUN.id),
    'POST',
    `/workflow-runs/${WORKFLOW_RUN.id}/cancel`,
    {},
    workflowRun,
  ],
  [
    'workflowRuns.redact',
    (c) => c.workflowRuns.redact(WORKFLOW_RUN.id),
    'DELETE',
    `/workflow-runs/${WORKFLOW_RUN.id}`,
    undefined,
    workflowRun,
  ],
  [
    'workflowTestRuns.create',
    (c) =>
      c.workflowTestRuns.create(
        WORKFLOW.id,
        { 'object-id': ID.inquiry },
        { acknowledgements: ['irreversible:forget'] },
      ),
    'POST',
    `/workflows/${WORKFLOW.id}/test-runs`,
    {
      data: { type: 'workflow-run', attributes: { 'object-id': ID.inquiry } },
      meta: { acknowledgements: ['irreversible:forget'] },
    },
    workflowRun,
  ],
  // C127.9, C128 (Workflow 8A).
  [
    'inquiries.reopen',
    (c) => c.inquiries.reopen(ID.inquiry, { comment: 'Asked for review' }),
    'POST',
    `/inquiries/${ID.inquiry}/reopen`,
    { meta: { comment: 'Asked for review' } },
    one('inquiry'),
  ],
  [
    'inquiries.decline with a declared flag',
    (c) => c.inquiries.decline(ID.inquiry, { 'solely-automated': true }),
    'POST',
    `/inquiries/${ID.inquiry}/decline`,
    { meta: { 'solely-automated': true } },
    one('inquiry'),
  ],
  [
    'devices.trust',
    (c) => c.devices.trust(DEVICE.id, { 'trust-reason': 'manual_review_passed' }),
    'POST',
    `/devices/${DEVICE.id}/trust`,
    { meta: { 'trust-reason': 'manual_review_passed' } },
    one('device'),
  ],
  [
    'decisions.list',
    (c) => c.decisions.list({ filter: { 'subject-id': ID.inquiry } }),
    'GET',
    `/decisions?filter%5Bsubject-id%5D=${ID.inquiry}`,
    undefined,
    one('decisions'),
  ],
  // C125, C126.4 (Workflow 8A).
  [
    'workflowSecrets.create',
    (c) => c.workflowSecrets.create({ key: 'partner_token', 'allowed-hosts': ['api.example.com'] }),
    'POST',
    '/workflow-secrets',
    {
      data: {
        type: 'workflow-secret',
        attributes: { key: 'partner_token', 'allowed-hosts': ['api.example.com'] },
      },
    },
    workflowSecret,
  ],
  [
    'workflowSecrets.retrieve',
    (c) => c.workflowSecrets.retrieve('partner_token'),
    'GET',
    '/workflow-secrets/partner_token',
    undefined,
    workflowSecret,
  ],
  [
    'workflowSecrets.list',
    (c) => c.workflowSecrets.list(),
    'GET',
    '/workflow-secrets',
    undefined,
    list(workflowSecret.data),
  ],
  [
    'workflowSecrets.update',
    (c) => c.workflowSecrets.update('partner_token', { description: 'Partner' }),
    'PATCH',
    '/workflow-secrets/partner_token',
    { data: { type: 'workflow-secret', attributes: { description: 'Partner' } } },
    workflowSecret,
  ],
  [
    'workflowSecrets.putValue',
    (c) => c.workflowSecrets.putValue('partner_token', ENVIRONMENT, 'change-me-canary'),
    'PUT',
    `/workflow-secrets/partner_token/values/${ENVIRONMENT}`,
    { data: { attributes: { 'secret-value': 'change-me-canary' } } },
    workflowSecret,
  ],
  [
    'workflowSecrets.rotateValue',
    (c) => c.workflowSecrets.rotateValue('partner_token', ENVIRONMENT, 'change-me-canary'),
    'POST',
    `/workflow-secrets/partner_token/values/${ENVIRONMENT}/rotate`,
    { data: { attributes: { 'secret-value': 'change-me-canary' } } },
    workflowSecret,
  ],
  [
    'workflowSecrets.delete',
    (c) => c.workflowSecrets.delete('partner_token'),
    'DELETE',
    '/workflow-secrets/partner_token',
    undefined,
    workflowSecret,
  ],
  [
    'sandboxEmailMessages.search',
    (c) => c.sandboxEmailMessages.search('person@example.test'),
    'POST',
    '/sandbox/email-messages/search',
    { 'email-address': 'person@example.test' },
    one('sandbox-email-messages'),
  ],
  [
    'sandboxSlackMessages.search',
    (c) => c.sandboxSlackMessages.search((workflowSecret.data as { id: string }).id),
    'POST',
    '/sandbox/slack-messages/search',
    { 'secret-id': (workflowSecret.data as { id: string }).id },
    one('sandbox-slack-messages'),
  ],
  [
    'sandboxWorkflowSmsMessages.search',
    (c) => c.sandboxWorkflowSmsMessages.search('+15550100'),
    'POST',
    '/sandbox/workflow-sms-messages/search',
    { 'phone-number': '+15550100' },
    one('sandbox-workflow-sms-messages'),
  ],
  // C118.7 (Workflow 8A).
  [
    'accountActions.create',
    (c) =>
      c.accountActions.create({
        'workflow-id': WORKFLOW.id,
        'account-type-id': ID.accountType,
        label: 'Re-check',
      }),
    'POST',
    '/account-actions',
    {
      data: {
        type: 'account-action',
        attributes: {
          'workflow-id': WORKFLOW.id,
          'account-type-id': ID.accountType,
          label: 'Re-check',
        },
      },
    },
    accountAction,
  ],
  [
    'accountActions.retrieve',
    (c) => c.accountActions.retrieve(ACCOUNT_ACTION.id),
    'GET',
    `/account-actions/${ACCOUNT_ACTION.id}`,
    undefined,
    accountAction,
  ],
  [
    'accountActions.list',
    (c) => c.accountActions.list(),
    'GET',
    '/account-actions',
    undefined,
    list(accountAction.data),
  ],
  [
    'accountActions.update',
    (c) => c.accountActions.update(ACCOUNT_ACTION.id, { label: 'Renamed' }),
    'PATCH',
    `/account-actions/${ACCOUNT_ACTION.id}`,
    { data: { type: 'account-action', attributes: { label: 'Renamed' } } },
    accountAction,
  ],
  [
    'accountActions.run',
    (c) =>
      c.accountActions.run(ID.account, {
        'account-action-id': ACCOUNT_ACTION.id,
        parameters: { note: 'synthetic' },
      }),
    'POST',
    `/accounts/${ID.account}/run-action`,
    { data: { 'account-action-id': ACCOUNT_ACTION.id, parameters: { note: 'synthetic' } } },
    one('account-run-action'),
  ],
  [
    'accountActions.available',
    (c) => c.accountActions.available(ID.account),
    'GET',
    `/accounts/${ID.account}/available-actions`,
    undefined,
    one('account-available-actions'),
  ],
  // C129-C140 (Workflow 8B).
  [
    'cases.create',
    (c) => c.cases.create({ 'case-template-id': CASE_TEMPLATE.id }, { 'object-ids': [ID.inquiry] }),
    'POST',
    '/cases',
    {
      data: { type: 'case', attributes: { 'case-template-id': CASE_TEMPLATE.id } },
      meta: { 'object-ids': [ID.inquiry] },
    },
    caseDocument,
  ],
  [
    'cases.retrieve',
    (c) => c.cases.retrieve(CASE, { include: ['case-template', 'case-comments'] }),
    'GET',
    `/cases/${CASE}?include=case-template%2Ccase-comments`,
    undefined,
    one('case-included'),
  ],
  [
    'cases.list',
    (c) => c.cases.list({ filter: { 'status-category': 'end' } }),
    'GET',
    '/cases?filter%5Bstatus-category%5D=end',
    undefined,
    list(caseDocument.data),
  ],
  [
    'cases.update',
    (c) => c.cases.update(CASE, { meta: { 'sla-expires-in-seconds': null } }),
    'PATCH',
    `/cases/${CASE}`,
    { meta: { 'sla-expires-in-seconds': null } },
    caseDocument,
  ],
  [
    'cases.redact',
    (c) => c.cases.redact(CASE),
    'DELETE',
    `/cases/${CASE}`,
    undefined,
    caseDocument,
  ],
  [
    'cases.setStatus',
    (c) => c.cases.setStatus(CASE, { status: 'approved' }),
    'POST',
    `/cases/${CASE}/set-status`,
    { meta: { status: 'approved' } },
    caseDocument,
  ],
  [
    'cases.addComment',
    (c) => c.cases.addComment(CASE, { message: 'Synthetic' }),
    'POST',
    `/cases/${CASE}/add-comment`,
    { meta: { message: 'Synthetic' } },
    caseDocument,
  ],
  [
    'cases.addObjects',
    (c) => c.cases.addObjects(CASE, { 'object-ids': [ID.account] }),
    'POST',
    `/cases/${CASE}/add-objects`,
    { meta: { 'object-ids': [ID.account] } },
    caseDocument,
  ],
  [
    'cases.removeObjects',
    (c) => c.cases.removeObjects(CASE, { 'object-ids': [ID.account] }),
    'POST',
    `/cases/${CASE}/remove-objects`,
    { meta: { 'object-ids': [ID.account] } },
    caseDocument,
  ],
  [
    'cases.addTag',
    (c) => c.cases.addTag(CASE, { 'tag-name': 'urgent' }),
    'POST',
    `/cases/${CASE}/add-tag`,
    { meta: { 'tag-name': 'urgent' } },
    caseDocument,
  ],
  [
    'cases.removeTag',
    (c) => c.cases.removeTag(CASE, { 'tag-name': 'urgent' }),
    'POST',
    `/cases/${CASE}/remove-tag`,
    { meta: { 'tag-name': 'urgent' } },
    caseDocument,
  ],
  [
    'cases.setTags',
    (c) => c.cases.setTags(CASE, { 'tag-names': ['urgent'] }),
    'POST',
    `/cases/${CASE}/set-tags`,
    { meta: { 'tag-names': ['urgent'] } },
    caseDocument,
  ],
  ['cases.print', (c) => c.cases.print(CASE), 'POST', `/cases/${CASE}/print`, {}, caseDocument],
  [
    'cases.search',
    (c) => c.cases.search({ query: { attribute: 'status', operator: 'eq', value: 'open' } }),
    'POST',
    '/cases/search',
    { query: { attribute: 'status', operator: 'eq', value: 'open' } },
    one('case-search'),
  ],
  [
    'cases.bulk',
    (c) =>
      c.cases.bulk({
        data: { attributes: { action: 'add-tags', 'case-ids': [CASE] } },
        meta: { 'tag-names': ['urgent'] },
      }),
    'POST',
    '/cases/bulk',
    {
      data: { attributes: { action: 'add-tags', 'case-ids': [CASE] } },
      meta: { 'tag-names': ['urgent'] },
    },
    caseBulkAction,
  ],
  [
    'cases.bulkAction',
    (c) => c.cases.bulkAction(CASE_BULK_ACTION.id),
    'GET',
    `/case-bulk-actions/${CASE_BULK_ACTION.id}`,
    undefined,
    caseBulkAction,
  ],
  [
    'cases.comments',
    (c) => c.cases.comments(CASE),
    'GET',
    `/cases/${CASE}/comments`,
    undefined,
    list(caseComment.data),
  ],
  [
    'cases.history',
    (c) => c.cases.history(CASE),
    'GET',
    `/cases/${CASE}/history`,
    undefined,
    one('case-history'),
  ],
  [
    'cases.objects',
    (c) => c.cases.objects(CASE),
    'GET',
    `/cases/${CASE}/objects`,
    undefined,
    one('case-held-objects'),
  ],
  [
    'cases.requestReview',
    (c) => c.cases.requestReview(ID.inquiry, { statement: 'Synthetic' }),
    'POST',
    `/inquiries/${ID.inquiry}/review-requests`,
    { meta: { statement: 'Synthetic' } },
    caseDocument,
  ],
  [
    'cases.assign',
    (c) => c.cases.assign(CASE, { 'user-id': USER_ID }),
    'POST',
    `/cases/${CASE}/assign`,
    { meta: { 'user-id': USER_ID } },
    caseDocument,
  ],
  [
    'cases.next',
    (c) => c.cases.next({ 'case-queue-ids': [CASE_QUEUE.id] }),
    'POST',
    '/cases/next',
    { meta: { 'case-queue-ids': [CASE_QUEUE.id] } },
    one('case-next'),
  ],
  [
    'caseQueues.create',
    (c) => c.caseQueues.create({ name: 'Second line' }),
    'POST',
    '/case-queues',
    { data: { type: 'case-queue', attributes: { name: 'Second line' } } },
    caseQueue,
  ],
  [
    'caseQueues.retrieve',
    (c) => c.caseQueues.retrieve(CASE_QUEUE.id),
    'GET',
    `/case-queues/${CASE_QUEUE.id}`,
    undefined,
    caseQueue,
  ],
  [
    'caseQueues.list',
    (c) => c.caseQueues.list({ filter: { 'member-id': USER_ID } }),
    'GET',
    `/case-queues?filter%5Bmember-id%5D=${USER_ID}`,
    undefined,
    list(caseQueue.data),
  ],
  [
    'caseQueues.update',
    (c) => c.caseQueues.update(CASE_QUEUE.id, { status: 'archived' }),
    'PATCH',
    `/case-queues/${CASE_QUEUE.id}`,
    { data: { type: 'case-queue', attributes: { status: 'archived' } } },
    caseQueue,
  ],
  [
    'caseQueues.setMembers',
    (c) => c.caseQueues.setMembers(CASE_QUEUE.id, [{ 'user-id': USER_ID, 'max-open': 10 }]),
    'PUT',
    `/case-queues/${CASE_QUEUE.id}/members`,
    {
      data: {
        type: 'case-queue',
        attributes: { members: [{ 'user-id': USER_ID, 'max-open': 10 }] },
      },
    },
    caseQueue,
  ],
  [
    'caseAssignmentPolicies.create',
    (c) =>
      c.caseAssignmentPolicies.create({
        name: 'Fewest open',
        distribution: 'fewest-open',
        sources: [{ type: 'case-queue', id: CASE_QUEUE.id }],
      }),
    'POST',
    '/case-assignment-policies',
    {
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Fewest open',
          distribution: 'fewest-open',
          sources: [{ type: 'case-queue', id: CASE_QUEUE.id }],
        },
      },
    },
    caseAssignmentPolicy,
  ],
  [
    'caseAssignmentPolicies.retrieve',
    (c) => c.caseAssignmentPolicies.retrieve(CASE_ASSIGNMENT_POLICY.id),
    'GET',
    `/case-assignment-policies/${CASE_ASSIGNMENT_POLICY.id}`,
    undefined,
    caseAssignmentPolicy,
  ],
  [
    'caseAssignmentPolicies.list',
    (c) => c.caseAssignmentPolicies.list(),
    'GET',
    '/case-assignment-policies',
    undefined,
    list(caseAssignmentPolicy.data),
  ],
  [
    'caseAssignmentPolicies.update',
    (c) => c.caseAssignmentPolicies.update(CASE_ASSIGNMENT_POLICY.id, { sort: 'created-at' }),
    'PATCH',
    `/case-assignment-policies/${CASE_ASSIGNMENT_POLICY.id}`,
    { data: { type: 'case-assignment-policy', attributes: { sort: 'created-at' } } },
    caseAssignmentPolicy,
  ],
  [
    'caseSlaPolicies.create',
    (c) => c.caseSlaPolicies.create({ name: 'Four hours', 'target-minutes': 240 }),
    'POST',
    '/case-sla-policies',
    {
      data: { type: 'case-sla-policy', attributes: { name: 'Four hours', 'target-minutes': 240 } },
    },
    caseSlaPolicy,
  ],
  [
    'caseSlaPolicies.retrieve',
    (c) => c.caseSlaPolicies.retrieve(CASE_SLA_POLICY.id),
    'GET',
    `/case-sla-policies/${CASE_SLA_POLICY.id}`,
    undefined,
    caseSlaPolicy,
  ],
  [
    'caseSlaPolicies.list',
    (c) => c.caseSlaPolicies.list(),
    'GET',
    '/case-sla-policies',
    undefined,
    list(caseSlaPolicy.data),
  ],
  [
    'caseSlaPolicies.update',
    (c) => c.caseSlaPolicies.update(CASE_SLA_POLICY.id, { 'on-reopen': 'restart' }),
    'PATCH',
    `/case-sla-policies/${CASE_SLA_POLICY.id}`,
    { data: { type: 'case-sla-policy', attributes: { 'on-reopen': 'restart' } } },
    caseSlaPolicy,
  ],
  [
    'caseCalendars.create',
    (c) =>
      c.caseCalendars.create({
        name: 'Around the week',
        'time-zone': 'UTC',
        week: { ...EMPTY_WEEK, monday: [{ start: '00:00', end: '24:00' }] },
      }),
    'POST',
    '/case-calendars',
    {
      data: {
        type: 'case-calendar',
        attributes: {
          name: 'Around the week',
          'time-zone': 'UTC',
          week: { ...EMPTY_WEEK, monday: [{ start: '00:00', end: '24:00' }] },
        },
      },
    },
    caseCalendar,
  ],
  [
    'caseCalendars.retrieve',
    (c) => c.caseCalendars.retrieve(CASE_CALENDAR.id),
    'GET',
    `/case-calendars/${CASE_CALENDAR.id}`,
    undefined,
    caseCalendar,
  ],
  [
    'caseCalendars.list',
    (c) => c.caseCalendars.list(),
    'GET',
    '/case-calendars',
    undefined,
    list(caseCalendar.data),
  ],
  [
    'caseCalendars.update',
    (c) => c.caseCalendars.update(CASE_CALENDAR.id, { holidays: [] }),
    'PATCH',
    `/case-calendars/${CASE_CALENDAR.id}`,
    { data: { type: 'case-calendar', attributes: { holidays: [] } } },
    caseCalendar,
  ],
  [
    'caseCalendars.importHolidays',
    (c) => c.caseCalendars.importHolidays(CASE_CALENDAR.id, { csv: 'date,label\r\n' }),
    'POST',
    `/case-calendars/${CASE_CALENDAR.id}/holidays/import`,
    { data: { type: 'case-calendar', attributes: { csv: 'date,label\r\n' } } },
    one('case-calendar-import'),
  ],
  [
    'caseExports.create',
    (c) => c.caseExports.create({ format: 'csv', filter: { 'sla-state': ['expired'] } }),
    'POST',
    '/case-exports',
    {
      data: {
        type: 'case-export',
        attributes: { format: 'csv', filter: { 'sla-state': ['expired'] } },
      },
    },
    caseExport,
  ],
  [
    'caseExports.retrieve',
    (c) => c.caseExports.retrieve(CASE_EXPORT.id),
    'GET',
    `/case-exports/${CASE_EXPORT.id}`,
    undefined,
    caseExport,
  ],
  [
    'caseExports.list',
    (c) => c.caseExports.list({ filter: { status: 'completed' } }),
    'GET',
    '/case-exports?filter%5Bstatus%5D=completed',
    undefined,
    list(caseExport.data),
  ],
  // C154.7, C162.7 (Workflow 9A).
  [
    'deployments.retrieve',
    (c) => phase9a(c).deployments.retrieve('dply_01M5CN00000000000000009A30'),
    'GET',
    '/deployments/dply_01M5CN00000000000000009A30',
    undefined,
    one('deployment'),
  ],
  [
    'deployments.list',
    (c) =>
      phase9a(c).deployments.list({
        filter: { 'inquiry-template-id': ['itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6'] },
      }),
    'GET',
    '/deployments?filter%5Binquiry-template-id%5D=itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
    undefined,
    one('deployments'),
  ],
  [
    'inquiryTemplateTranslations.retrieve',
    (c) => phase9a(c).inquiryTemplateTranslations.retrieve('itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6'),
    'GET',
    '/inquiry-templates/itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6/translations',
    undefined,
    one('inquiry-template-translations'),
  ],
  [
    'inquiryTemplateTranslations.import',
    (c) =>
      phase9a(c).inquiryTemplateTranslations.import('itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6', [
        {
          step: null,
          'step-display-name': null,
          component: null,
          'attribute-name': 'flow.completion',
          'locale-values': [{ locale: 'es', value: 'Gracias' }],
        },
      ]),
    'POST',
    '/inquiry-templates/itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6/translations',
    {
      data: {
        type: 'inquiry-template-translations',
        attributes: {
          translations: [
            {
              step: null,
              'step-display-name': null,
              component: null,
              'attribute-name': 'flow.completion',
              'locale-values': [{ locale: 'es', value: 'Gracias' }],
            },
          ],
        },
      },
    },
    one('inquiry-template-translations'),
  ],
  // C160.1, C160.5 (Workflow 9A).
  [
    'themeSets.list',
    (c) => phase9a(c).themeSets.list({ filter: { status: ['active'] } }),
    'GET',
    '/theme-sets?filter%5Bstatus%5D=active',
    undefined,
    one('theme-sets'),
  ],
  [
    'themeSets.create',
    (c) => phase9a(c).themeSets.create({ name: 'Storefront', styles: { shape: { radius: 8 } } }),
    'POST',
    '/theme-sets',
    {
      data: {
        type: 'theme-set',
        attributes: { name: 'Storefront', styles: { shape: { radius: 8 } } },
      },
    },
    one('theme-set'),
  ],
  [
    'themeSets.retrieve',
    (c) => phase9a(c).themeSets.retrieve('theset_01M5CN00000000000000009A40'),
    'GET',
    '/theme-sets/theset_01M5CN00000000000000009A40',
    undefined,
    one('theme-set'),
  ],
  [
    'themeSets.update',
    (c) => phase9a(c).themeSets.update('theset_01M5CN00000000000000009A40', { name: 'Renamed' }),
    'PATCH',
    '/theme-sets/theset_01M5CN00000000000000009A40',
    { data: { type: 'theme-set', attributes: { name: 'Renamed' } } },
    one('theme-set'),
  ],
  [
    'themeSets.archive',
    (c) => phase9a(c).themeSets.archive('theset_01M5CN00000000000000009A40'),
    'DELETE',
    '/theme-sets/theset_01M5CN00000000000000009A40',
    undefined,
    one('theme-set'),
  ],
  [
    'themeSets.revisions',
    (c) =>
      phase9a(c).themeSets.revisions('theset_01M5CN00000000000000009A40', { page: { before: 3 } }),
    'GET',
    '/theme-sets/theset_01M5CN00000000000000009A40/revisions?page%5Bbefore%5D=3',
    undefined,
    one('theme-set-revisions'),
  ],
  [
    'themeSets.restore',
    (c) => phase9a(c).themeSets.restore('theset_01M5CN00000000000000009A40', 1),
    'POST',
    '/theme-sets/theset_01M5CN00000000000000009A40/restore',
    { meta: { revision: 1 } },
    one('theme-set'),
  ],
  [
    'caseTemplates.create',
    (c) => c.caseTemplates.create({ name: 'Review', key: 'KYC' }),
    'POST',
    '/case-templates',
    { data: { type: 'case-template', attributes: { name: 'Review', key: 'KYC' } } },
    caseTemplate,
  ],
  [
    'caseTemplates.retrieve',
    (c) => c.caseTemplates.retrieve(CASE_TEMPLATE.id),
    'GET',
    `/case-templates/${CASE_TEMPLATE.id}`,
    undefined,
    caseTemplate,
  ],
  [
    'caseTemplates.list',
    (c) => c.caseTemplates.list(),
    'GET',
    '/case-templates',
    undefined,
    list(caseTemplate.data),
  ],
  [
    'caseTemplates.update',
    (c) => c.caseTemplates.update(CASE_TEMPLATE.id, { name: 'Renamed' }),
    'PATCH',
    `/case-templates/${CASE_TEMPLATE.id}`,
    { data: { type: 'case-template', attributes: { name: 'Renamed' } } },
    caseTemplate,
  ],
  [
    'caseTemplates.archive',
    (c) => c.caseTemplates.archive(CASE_TEMPLATE.id),
    'POST',
    `/case-templates/${CASE_TEMPLATE.id}/archive`,
    {},
    caseTemplate,
  ],
  [
    'caseTemplateVersions.create',
    (c) => c.caseTemplateVersions.create({ 'case-template-id': CASE_TEMPLATE.id }),
    'POST',
    '/case-template-versions',
    {
      data: {
        type: 'case-template-version',
        attributes: { 'case-template-id': CASE_TEMPLATE.id },
      },
    },
    caseTemplateVersion,
  ],
  [
    'caseTemplateVersions.retrieve',
    (c) => c.caseTemplateVersions.retrieve(CASE_TEMPLATE_VERSION.id),
    'GET',
    `/case-template-versions/${CASE_TEMPLATE_VERSION.id}`,
    undefined,
    caseTemplateVersion,
  ],
  [
    'caseTemplateVersions.list',
    (c) => c.caseTemplateVersions.list({ filter: { 'case-template-id': CASE_TEMPLATE.id } }),
    'GET',
    `/case-template-versions?filter%5Bcase-template-id%5D=${CASE_TEMPLATE.id}`,
    undefined,
    list(caseTemplateVersion.data),
  ],
  [
    'caseTemplateVersions.update',
    (c) => c.caseTemplateVersions.update(CASE_TEMPLATE_VERSION.id, { 'sla-starts-on': 'assigned' }),
    'PATCH',
    `/case-template-versions/${CASE_TEMPLATE_VERSION.id}`,
    { data: { type: 'case-template-version', attributes: { 'sla-starts-on': 'assigned' } } },
    caseTemplateVersion,
  ],
  [
    'caseTemplateVersions.publish',
    (c) => c.caseTemplateVersions.publish(CASE_TEMPLATE_VERSION.id),
    'POST',
    `/case-template-versions/${CASE_TEMPLATE_VERSION.id}/publish`,
    {},
    caseTemplateVersion,
  ],
  [
    'caseComments.redact',
    (c) => c.caseComments.redact(CASE_COMMENT.id),
    'POST',
    `/case-comments/${CASE_COMMENT.id}/redact`,
    {},
    caseComment,
  ],
  [
    'caseActions.create',
    (c) =>
      c.caseActions.create({
        'workflow-id': WORKFLOW.id,
        'case-template-ids': [CASE_TEMPLATE.id],
        label: 'Re-check',
      }),
    'POST',
    '/case-actions',
    {
      data: {
        type: 'case-action',
        attributes: {
          'workflow-id': WORKFLOW.id,
          'case-template-ids': [CASE_TEMPLATE.id],
          label: 'Re-check',
        },
      },
    },
    caseAction,
  ],
  [
    'caseActions.retrieve',
    (c) => c.caseActions.retrieve(CASE_ACTION.id),
    'GET',
    `/case-actions/${CASE_ACTION.id}`,
    undefined,
    caseAction,
  ],
  [
    'caseActions.list',
    (c) => c.caseActions.list(),
    'GET',
    '/case-actions',
    undefined,
    list(caseAction.data),
  ],
  [
    'caseActions.update',
    (c) => c.caseActions.update(CASE_ACTION.id, { label: 'Renamed' }),
    'PATCH',
    `/case-actions/${CASE_ACTION.id}`,
    { data: { type: 'case-action', attributes: { label: 'Renamed' } } },
    caseAction,
  ],
  [
    'caseActions.run',
    (c) =>
      c.caseActions.run(CASE, {
        'case-action-id': CASE_ACTION.id,
        parameters: { note: 'synthetic' },
      }),
    'POST',
    `/cases/${CASE}/run-action`,
    { data: { 'case-action-id': CASE_ACTION.id, parameters: { note: 'synthetic' } } },
    one('case-run-action'),
  ],
  [
    'caseActions.available',
    (c) => c.caseActions.available(CASE),
    'GET',
    `/cases/${CASE}/available-actions`,
    undefined,
    one('case-available-actions'),
  ],
  // C164.8, C166 (Workflow 9B).
  ...(['inquiries', 'funnel', 'verifications', 'checks', 'cases', 'signals'] as const).map(
    (report): [string, Invoke, string, string, unknown, unknown] => [
      `analytics.${report}`,
      (c) => phase9b(c).analytics[report](WINDOW),
      'GET',
      `/analytics/${report}${WINDOW_QUERY}`,
      undefined,
      one(`analytics-${report}`),
    ],
  ),
  [
    'exports.create',
    (c) =>
      phase9b(c).exports.create({
        'object-type': 'inquiries',
        format: 'csv',
        filter: { 'filter[status]': ['completed'] },
      }),
    'POST',
    '/exports',
    {
      data: {
        type: 'export',
        attributes: {
          'object-type': 'inquiries',
          format: 'csv',
          filter: { 'filter[status]': ['completed'] },
        },
      },
    },
    one('export'),
  ],
  [
    'exports.retrieve',
    (c) => phase9b(c).exports.retrieve('exp_01M5CN00000000000000009B33'),
    'GET',
    '/exports/exp_01M5CN00000000000000009B33',
    undefined,
    one('export'),
  ],
  ['exports.list', (c) => phase9b(c).exports.list(), 'GET', '/exports', undefined, one('exports')],
  // Owner decision 20 after Workflow 7B: a stored property node expanded into a new query.
  [
    'graphQueries.expandNode',
    (c) =>
      (
        c as unknown as {
          graphQueries: { expandNode: (id: string, nodeId: string) => Promise<unknown> };
        }
      ).graphQueries.expandNode('grphq_01M5CN00000000000000009B63', 'gn_AAAAAAAAAAAAAAAAAAAAAA'),
    'POST',
    '/graph-queries/grphq_01M5CN00000000000000009B63/nodes/gn_AAAAAAAAAAAAAAAAAAAAAA/expand',
    {},
    one('graph-query-expanded'),
  ],
  // C230-C237 (Workflow 11A integration-11a): the connect group.
  [
    'connectConnections.create',
    (c) =>
      connectOf(
        c,
        'connectConnections',
        'create',
      )({
        'destination-organization-id': 'org_01M5CN0000000000000011A010',
        'share-policy': connectFixture('share-policy'),
      }),
    'POST',
    '/connect/connections',
    {
      data: {
        type: 'connect/connection',
        attributes: {
          'destination-organization-id': 'org_01M5CN0000000000000011A010',
          'share-policy': connectFixture('share-policy'),
        },
      },
    },
    connectFixture('connection-pending-source'),
  ],
  [
    'connectConnections.list',
    (c) => connectOf(c, 'connectConnections', 'list')({ filter: { status: ['active'] } }),
    'GET',
    '/connect/connections?filter%5Bstatus%5D=active',
    undefined,
    list(connectFixture('connection-source').data),
  ],
  [
    'connectConnections.retrieve',
    (c) => connectOf(c, 'connectConnections', 'retrieve')(CXN),
    'GET',
    `/connect/connections/${CXN}`,
    undefined,
    connectFixture('connection-source'),
  ],
  [
    'connectConnections.deactivate',
    (c) => connectOf(c, 'connectConnections', 'deactivate')(CXN),
    'POST',
    `/connect/connections/${CXN}/deactivate`,
    {},
    connectFixture('connection-source'),
  ],
  [
    'connectConnections.reactivate',
    (c) => connectOf(c, 'connectConnections', 'reactivate')(CXN),
    'POST',
    `/connect/connections/${CXN}/reactivate`,
    {},
    connectFixture('connection-pending-source'),
  ],
  [
    'connectConnections.changeSharePolicy',
    (c) =>
      connectOf(
        c,
        'connectConnections',
        'changeSharePolicy',
      )(CXN, {
        'share-policy': connectFixture('share-policy'),
      }),
    'POST',
    `/connect/connections/${CXN}/share-policy`,
    {
      data: {
        type: 'connect/connection',
        attributes: { 'share-policy': connectFixture('share-policy') },
      },
    },
    connectFixture('connection-pending-source'),
  ],
  [
    'connectShareTokens.create',
    (c) =>
      connectOf(
        c,
        'connectShareTokens',
        'create',
      )({
        'connection-id': CXN,
        'source-id': ID.inquiry,
        'consent-record-id': CNSR,
      }),
    'POST',
    '/connect/share-tokens',
    {
      data: {
        type: 'connect/share-token',
        attributes: { 'connection-id': CXN, 'source-id': ID.inquiry, 'consent-record-id': CNSR },
      },
    },
    connectFixture('share-token-outbound'),
  ],
  [
    'connectShareTokens.list',
    (c) => connectOf(c, 'connectShareTokens', 'list')({ filter: { direction: 'inbound' } }),
    'GET',
    '/connect/share-tokens?filter%5Bdirection%5D=inbound',
    undefined,
    list(connectFixture('share-token-inbound').data),
  ],
  [
    'connectShareTokens.retrieve',
    (c) => connectOf(c, 'connectShareTokens', 'retrieve')(CNST),
    'GET',
    `/connect/share-tokens/${CNST}`,
    undefined,
    connectFixture('share-token-inbound'),
  ],
  [
    'connectShareTokens.peek',
    (c) => connectOf(c, 'connectShareTokens', 'peek')(CNST),
    'GET',
    `/connect/share-tokens/${CNST}?peek-source-data=true`,
    undefined,
    connectFixture('share-token-peek'),
  ],
  [
    'connectShareTokens.expire',
    (c) => connectOf(c, 'connectShareTokens', 'expire')(CNST),
    'POST',
    `/connect/share-tokens/${CNST}/expire`,
    {},
    connectFixture('share-token-outbound'),
  ],
  [
    'connectShareTokens.redeem',
    (c) =>
      connectOf(
        c,
        'connectShareTokens',
        'redeem',
      )(CNST, connectFixture('redeem-clone-inquiry').meta),
    'POST',
    `/connect/share-tokens/${CNST}/redeem`,
    connectFixture('redeem-clone-inquiry'),
    connectFixture('share-token-redeem-accepted'),
  ],
  [
    'connectConsentRecords.attest',
    (c) =>
      connectOf(
        c,
        'connectConsentRecords',
        'attest',
      )(
        (connectFixture('consent-record-attest-destination').data as { attributes: unknown })
          .attributes,
      ),
    'POST',
    '/connect/consent-records',
    connectFixture('consent-record-attest-destination'),
    connectFixture('consent-record-destination-attested'),
  ],
  [
    'connectConsentRecords.list',
    (c) => connectOf(c, 'connectConsentRecords', 'list')({ filter: { 'subject-id': ID.inquiry } }),
    'GET',
    `/connect/consent-records?filter%5Bsubject-id%5D=${ID.inquiry}`,
    undefined,
    list(connectFixture('consent-record-source-flow').data),
  ],
  [
    'connectConsentRecords.retrieve',
    (c) => connectOf(c, 'connectConsentRecords', 'retrieve')(CNSR),
    'GET',
    `/connect/consent-records/${CNSR}`,
    undefined,
    connectFixture('consent-record-source-flow'),
  ],
  [
    'connectConsentRecords.withdraw',
    (c) =>
      connectOf(
        c,
        'connectConsentRecords',
        'withdraw',
      )(CNSR, {
        'withdrawal-reason': 'subject-request',
      }),
    'POST',
    `/connect/consent-records/${CNSR}/withdraw`,
    connectFixture('consent-record-withdraw'),
    connectFixture('consent-record-withdrawn'),
  ],
];

describe('resource methods', () => {
  it.each(ENDPOINTS)('%s', async (_name, invoke, method, path, body, response) => {
    const fake = scriptedFetch([{ status: method === 'POST' ? 201 : 200, body: response }]);
    const client = createClient({
      apiKey: 'ov_sbx_synthetictesttokenaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.example.test',
      fetch: fake.fetch,
    });

    const result = await invoke(client);

    expect(result).toEqual(response);
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.method).toBe(method);
    expect(request?.url).toBe(`https://api.example.test/api/v1${path}`);
    expect(request?.body).toEqual(body);
  });

  it('covers every resource group of C2 and C10-C14', () => {
    const client = createClient({ apiKey: 'ov_sbx_x', baseUrl: 'https://api.example.test' });
    const groups = Object.keys(client).sort();

    expect(groups).toEqual(
      [
        // C118.7 (Workflow 8A).
        'accountActions',
        // C253 (Workflow 11B).
        'accountExports',
        'accountTypes',
        // C230-C237 (Workflow 11A).
        'connectConnections',
        'connectConsentRecords',
        'connectShareTokens',
        // C129-C140 (Workflow 8B).
        'caseActions',
        'caseAssignmentPolicies',
        'caseCalendars',
        'caseExports',
        'caseQueues',
        'caseSlaPolicies',
        'caseComments',
        'caseTemplateVersions',
        'caseTemplates',
        'cases',
        'accounts',
        'apiKeys',
        'apiLogs',
        // C128.1 (Workflow 8A).
        'decisions',
        // C154.7, C162.7 (Workflow 9A).
        'deployments',
        // C164.8, C166 (Workflow 9B).
        'analytics',
        'exports',
        'inquiryTemplateTranslations',
        // C160 (Workflow 9A).
        'themeSets',
        // C91.2 (Phase 7).
        'devices',
        'events',
        // C102 (Workflow 7B).
        'graphQueries',
        'graphQueryTemplateVersions',
        'graphQueryTemplates',
        // C100 (Workflow 7B).
        'importers',
        'inquiries',
        'inquirySessions',
        'inquiryTemplateVersions',
        'inquiryTemplates',
        // C97, C99 (Workflow 7B).
        'listItems',
        'listMatches',
        'lists',
        'rateLimits',
        'reportTemplateVersions',
        'reportTemplates',
        'reports',
        'sandboxSmsMessages',
        'selfies',
        // C104, C105 (Workflow 7B).
        'transactionTypeVersions',
        'transactionTypes',
        'transactions',
        'userAuditLogs',
        'verifications',
        'webhookDeliveries',
        'webhooks',
        // C112, C120 (Workflow 8A).
        'workflowRuns',
        // C125, C126.4 (Workflow 8A).
        'workflowSecrets',
        'sandboxEmailMessages',
        'sandboxSlackMessages',
        'sandboxWorkflowSmsMessages',
        'workflowTestRuns',
        'workflowVersions',
        'workflows',
      ].sort(),
    );
    const methods = ENDPOINTS.map(([name]) => name);
    for (const group of groups) {
      for (const method of Object.keys(
        (client as unknown as Record<string, object>)[group] ?? {},
      )) {
        if (method === 'listAll' || RAW_METHODS.has(`${group}.${method}`)) continue;
        expect(methods, `${group}.${method} has no endpoint test`).toContain(`${group}.${method}`);
      }
    }
  });

  it('lists every page of each paged resource with listAll()', async () => {
    const fake = scriptedFetch([{ status: 200, body: list(resourceOf('account')) }]);
    const client = createClient({
      apiKey: 'ov_sbx_synthetic',
      baseUrl: 'https://api.example.test',
      fetch: fake.fetch,
    });

    const accounts = [];
    for await (const account of client.accounts.listAll({ filter: { status: 'active' } })) {
      accounts.push(account);
    }

    expect(accounts).toEqual([resourceOf('account')]);
  });
});

describe('Workflow 2E answers (C25)', () => {
  it('keeps pii-masked and the pinned template version the server sends', async () => {
    const fake = scriptedFetch([
      { status: 200, body: apiKey },
      { status: 200, body: inquiry },
    ]);
    const client = createClient({
      apiKey: 'ov_sbx_synthetic',
      baseUrl: 'https://api.example.test',
      fetch: fake.fetch,
    });

    const key = await client.apiKeys.retrieve(ID.key);
    const read = await client.inquiries.retrieve(ID.inquiry);

    expect(key.data.attributes).toMatchObject({ 'pii-masked': false });
    expect(read.data.relationships).toMatchObject({
      'inquiry-template-version': {
        data: { type: 'inquiry-template-version', id: 'itmplv_01M5A0GTG0VF5QW51511984D0G' },
      },
    });
  });
});
