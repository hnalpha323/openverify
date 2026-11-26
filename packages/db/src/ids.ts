import { randomBytes } from 'node:crypto';

/**
 * C1 and C9 identifier prefixes (docs/plans/phase-1.plan.md, phase-2.plan.md). Callers
 * generate the ids; the database only checks their format,
 * `<prefix>_<26 uppercase Crockford base32 chars>`.
 */
export const ID_PREFIXES = {
  organization: 'org',
  environment: 'env',
  apiKey: 'key',
  user: 'usr',
  userSession: 'uss',
  inquiryTemplate: 'itmpl',
  inquiryTemplateVersion: 'itmplv',
  inquiry: 'inq',
  inquirySession: 'iqse',
  verification: 'ver',
  file: 'file',
  event: 'evt',
  webhook: 'wbh',
  webhookDelivery: 'whd',
  account: 'acc',
  accountType: 'acctp',
  role: 'role',
  auditLog: 'aud',
  apiLog: 'alog',
  mfaFactor: 'mfa',
  // Phase 4 (C40.5, C42.1, C42.5).
  selfieCapture: 'self',
  faceTemplate: 'ftpl',
  selfieBackground: 'sbg',
  // Phase 5, Workflow 5A (C53.2): the OTP and crypto-wallet challenges.
  otpChallenge: 'otpc',
  cryptoChallenge: 'cwc',
  // Phase 5, Workflow 5B (C53.3): the Active Authentication challenge.
  chipChallenge: 'chc',
  // Phase 6 (C70.1): reports, report templates and versions, runs, actions, and matches (a
  // match's `record-token`).
  report: 'rep',
  reportTemplate: 'rptp',
  reportTemplateVersion: 'rptpv',
  reportRun: 'rpr',
  reportAction: 'ract',
  reportMatch: 'rpm',
  // Phase 7 (C91.2, C91.3): devices and networks.
  device: 'dev',
  network: 'net',
  // C96.3: handoff token rows.
  handoff: 'hnd',
  // Workflow 7B (C97.1, C99.3, C100.1): lists, their item kinds, list matches and importers.
  list: 'lst',
  listItemBrowserFingerprint: 'libf',
  listItemDeviceFingerprint: 'lidf',
  listItemCountry: 'lic',
  listItemEmailAddress: 'liea',
  listItemFace: 'lifc',
  listItemGeolocation: 'ligl',
  listItemGovernmentIdNumber: 'ligin',
  listItemField: 'liif',
  listItemIpAddress: 'liip',
  listItemName: 'lin',
  listItemPhoneNumber: 'lipn',
  listItemSelfieBackground: 'lisb',
  listItemString: 'lis',
  listMatch: 'lmt',
  importer: 'mprt',
  // Workflow 7B (C104.1, C105): transactions, their types, versions, labels and files.
  transaction: 'txn',
  transactionType: 'txntp',
  transactionTypeVersion: 'txntpv',
  transactionLabel: 'txnl',
  transactionFile: 'txnf',
  // Workflow 7B (C102): graph queries, their templates and versions.
  graphQuery: 'grphq',
  graphQueryTemplate: 'grqt',
  graphQueryTemplateVersion: 'grqtv',
  // Phase 8, Workflow 8A (C112.1): workflows, versions, deployments, runs, scheduled runs, account
  // actions and secrets are public; a decision record (C128.1) is served; the step, delivery,
  // schedule, effect and file rows are internal, served only inside a run's step list.
  workflow: 'wfl',
  workflowVersion: 'wfv',
  workflowDeployment: 'wfd',
  workflowRun: 'wfr',
  scheduledRun: 'srrun',
  accountAction: 'accac',
  workflowSecret: 'wsec',
  // C125.1: a secret's value in one environment, the row its seal is bound to. Never served.
  workflowSecretValue: 'wsecv',
  workflowRunStep: 'wfst',
  workflowTriggerDelivery: 'wftd',
  workflowSchedule: 'wfsc',
  workflowEffect: 'wfef',
  workflowRunFile: 'wfrf',
  inquiryDecision: 'idec',
  // Phase 8, Workflow 8B (C129.1): the public case prefixes, then ours; the bulk action and the
  // notification are Stage 1a amendment 5.
  case: 'case',
  caseTemplate: 'ctmpl',
  caseTemplateVersion: 'ctmplv',
  caseQueue: 'cqueue',
  caseComment: 'cscm',
  caseAssignmentPolicy: 'cap',
  caseAttachment: 'catt',
  caseAction: 'cact',
  caseSlaPolicy: 'cslap',
  caseCalendar: 'ccal',
  caseExport: 'cexp',
  caseBulkAction: 'cblk',
  userNotification: 'unot',
  // Phase 9, Workflow 9A (C174.1): the public theme set and deployment, then ours: a theme set's
  // asset and a user's simulation preset. Step records, action waits, theme revisions and rollup
  // rows have no public id.
  themeSet: 'theset',
  deployment: 'dply',
  themeAsset: 'tsa',
  simulationPreset: 'ssp',
  // Phase 9, Workflow 9B (C174.1), all ours: an export, a saved view and a bulk report job.
  export: 'exp',
  savedView: 'svw',
  reportBulkJob: 'rbulk',
  // Phase 10, Workflow 10B (C211.3, C221.2), ours: an integrity challenge (POST /api/v1/flow/integrity-challenges).
  integrityChallenge: 'ich',
  // Phase 11, Workflow 11A (C230.1): a connection and a share token (public), then ours: a
  // share-policy version and a consent record.
  connection: 'cxn',
  shareToken: 'cnst',
  sharePolicy: 'cxnp',
  consentRecord: 'cnsr',
  // Phase 11, Workflow 11B (C253.1), ours: an account's access export.
  accountExport: 'aexp',
  // Phase 11, Workflow 11B (C248.3), ours: an organisation's OIDC identity provider.
  ssoProvider: 'ssop',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** POSIX regular expression for one prefix, as used by the `<table>_id_format` checks. */
export const idPattern = (prefix: IdPrefix): string => `^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A C1 id (`<prefix>_<ULID>`): 10 characters of millisecond time, then 80 random bits, so
 * ids sort by creation time. Callers normally pass ids in; repositories use this only for
 * rows a Phase 1 caller cannot know about, such as the account `createInquiry` creates
 * when it is given none, or an audit entry's public id. Not exported from the package.
 */
export function generateId(prefix: IdPrefix, now: number = Date.now()): string {
  let time = now;
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = CROCKFORD.charAt(time % 32) + timePart;
    time = Math.floor(time / 32);
  }
  let randomPart = '';
  for (const byte of randomBytes(16)) {
    randomPart += CROCKFORD.charAt(byte % 32);
  }
  return `${prefix}_${timePart}${randomPart}`;
}
