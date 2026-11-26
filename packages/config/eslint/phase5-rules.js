// @ts-check
/**
 * Lint rules of the Phase 5 folders (C53.8, C58.7), spread into the root `eslint.config.js`:
 * - a log call (`log.info({ ... })`, `request.log.warn(...)`, ...) may not carry a personal name
 *   such as `phoneNumber`, `email`, `destination` or `code`: personal data goes under `pii`, which
 *   both loggers redact whole, or under one of {@link REDACTED_PERSONAL_LOG_KEYS}, which they
 *   redact by name. No generic key (`code`, `message`, `values`) is ever redacted, so logged
 *   errors keep their message and code;
 * - eslint-plugin-regexp's recommended rules, with super-linear backtracking and moves refused,
 *   because the matchers read untrusted text (C58.7, P27);
 * - (Workflow 11B, C252.2) everywhere, no regular expression built at run time outside the
 *   reviewed call sites of `operator-patterns.js`;
 * - (Workflow 11C, C260.1) everywhere, eslint-plugin-security's rules from `security.js`.
 */

import regexp from 'eslint-plugin-regexp';
import { OPERATOR_PATTERN_SELECTORS, regexpAllowlistGlobs } from './operator-patterns.js';
import { securityConfig } from './security.js';

/** The folders and files Phase 5 adds, where these rules apply, and Phase 6's matching folders. */
export const PHASE5_FOLDERS = Object.freeze([
  'apps/api/src/cache/**',
  'apps/api/src/dns/**',
  'apps/api/src/http/**',
  'apps/api/src/contact/**',
  'apps/api/src/trust-anchors/**',
  'apps/api/src/providers/{sms,database,evm-rpc,business-registry,domain-age,malicious-website,backlink}/**',
  'apps/api/src/services/{otp,inputs,crypto-challenges,chip-challenges,guidance,attributes,submit,publish,sub-resources}/**',
  'apps/api/src/jobs/types/**',
  'apps/api/src/jobs/repeatable/**',
  'apps/api/src/routes/flow/{inputs,otp,crypto-wallet,government-id-nfc}.ts',
  'apps/api/src/routes/server/sandbox-sms.ts',
  'packages/checks/src/{contact,crypto,matching,database,document,business,nfc}/**',
  'packages/emrtd/src/**',
  // Phase 6 (Workflow 6A Stage 1a): the list parsers and matcher, and the report risk logic, read
  // untrusted lists and subjects too (C77.2, C78, C82).
  'packages/watchlist/src/**',
  'packages/checks/src/reports/**',
  // Workflow 6A Stage 1b: the API folders that hold report subjects, matches and articles.
  'apps/api/src/services/reports/**',
  'apps/api/src/jobs/{reports,report-types}/**',
  'apps/api/src/watchlists/**',
  'apps/api/src/providers/{adverse-media,email-intelligence,phone-intelligence,address-verification,crypto-exposure}/**',
  'apps/api/src/routes/server/{reports,report-templates,report-template-versions}.ts',
  'apps/api/src/routes/dashboard/{reports,watchlist-sources}.ts',
  // Workflow 7B (C53.8, C107.5): list values, CSV rows, graph parameters and transaction fields.
  // All of it is new code, so it takes the regexp style rules too.
  'apps/api/src/services/{lists,importers,graph,transactions}/**',
  'apps/api/src/jobs/{lists,importers,graph}/**',
  'apps/api/src/routes/server/{lists,list-items,list-matches,importers}.ts',
  'apps/api/src/routes/server/{graph-queries,graph-query-templates,graph-query-template-versions}.ts',
  'apps/api/src/routes/server/{transactions,transaction-types,transaction-type-versions}.ts',
  'packages/checks/src/{lists,csv}/**',
  'packages/core/src/transactions/**',
  // Workflow 8A (C117.11, C143.5): run values, messages and secrets. All of it is new code, so it
  // takes the regexp style rules too.
  'packages/workflow-engine/src/**',
  'packages/workflow-engine/bin/**',
  'apps/api/src/workflows/**',
  'apps/api/src/jobs/workflows/**',
  'apps/api/src/services/{decisions,workflow-secrets}/**',
  'apps/api/src/routes/server/{workflows,workflow-versions,workflow-runs,workflow-test-runs}.ts',
  'apps/api/src/routes/server/{workflow-triggers,workflow-actions,workflow-recipes}.ts',
  'apps/api/src/routes/server/{workflow-secrets,account-actions,inquiry-decisions,device-trust}.ts',
  'apps/api/src/routes/server/sandbox-messages.ts',
  // Workflow 8B (C143.5): case fields, comments, attachments and exports. All of it is new code, so
  // it takes the regexp style rules too. `apps/api/src/workflows/**` above holds the case actions.
  'packages/core/src/cases/**',
  'apps/api/src/services/cases/**',
  'apps/api/src/jobs/cases/**',
  'apps/api/src/providers/attachment-scanner/**',
  'apps/api/src/routes/server/{cases,case-templates,case-comments,case-actions,case-print}.ts',
  'apps/api/src/routes/server/{case-attachments,case-exports,inquiry-review-requests}.ts',
  'apps/api/src/routes/server/{case-queues,case-assignment,case-assignment-policies}.ts',
  'apps/api/src/routes/server/{case-sla-policies,case-calendars}.ts',
  'apps/api/src/routes/dashboard/{notifications,file-renditions}.ts',
]);

/**
 * Phase 7, Workflow 7A Stage 1b (C93.7, P06): the network folders, which hold client addresses,
 * IP locations and the operator-synced data. Their logs carry the ASN, the country and the reason
 * codes only; an address, a point, a fingerprint or a user agent goes under `pii`. They take the
 * log rule and the super-linear rules (their parsers read untrusted publisher files), not the
 * regexp style rules, which their code predates.
 */
export const WORKFLOW_7A_NETWORK_FOLDERS = Object.freeze([
  'apps/api/src/network/**',
  'apps/api/src/sync/**',
  'apps/api/src/providers/ip-reputation/**',
  'apps/api/src/routes/dashboard/network-sources.ts',
  'packages/signals/src/**',
]);

/**
 * C53.8: the personal names a log line may carry, because the API and worker loggers redact them
 * at every depth they log (`apps/api/src/logger.ts`, `PERSONAL_LOG_KEYS`).
 */
export const REDACTED_PERSONAL_LOG_KEYS = Object.freeze([
  'otpCode',
  'otpDestination',
  'challengeMessage',
  'signedMessage',
  'inputValues',
  'walletAddress',
  'chipFile',
  'aaResponse',
  // Phase 6 (Workflow 6A Stage 1b): a report's screened query, a matched or listed name, an
  // article title, and the re-screen's subject index.
  'reportQuery',
  'matchedName',
  'listEntryName',
  'articleTitle',
  'subjectIndex',
]);

/**
 * Names of personal data a log call in a Phase 5 folder may not carry, whatever their case or
 * spelling (`phoneNumber`, `phone_number`, `phone-number`): contact details, codes, messages and
 * signatures, entered values, addresses, names and dates of birth, document and registration
 * numbers, chip data groups and portraits, URLs and domains; (Workflow 7A, C93.7) client
 * addresses, IP locations, fingerprints and user agents; (Workflow 7B, C107.5) graph
 * parameters, file names, CSV rows and records, matched values and dismissal reasons; and
 * (Workflow 8A, C117.11) a run's variables and outputs, template output, secrets and bodies; and
 * (Workflow 8B, C143.5) a review request's statement and who a comment mentions.
 */
export const REFUSED_LOG_KEY_PATTERN =
  '^(?:phone(?:[-_]?number)?|e-?mail(?:[-_]?address)?|destination|otp|code|signature|message|' +
  'values?|inputs?|fields|wallet|address|nonce|name(?:[-_]?(?:first|middle|last))?|' +
  '(?:first|middle|last)[-_]?name|birth[-_]?date|dob|' +
  '(?:document|identification|registration)[-_]?number|dg[0-9]+|sod|portrait|url|' +
  'host(?:name)?|domain|' +
  // C93.7 (Workflow 7A): client addresses, IP locations, fingerprints and user agents.
  'ip(?:[-_]?address)?|(?:remote|client)[-_]?address|lat(?:itude)?|lon(?:gitude)?|lng|' +
  'coordinates?|(?:browser|device)?[-_]?fingerprint|user[-_]?agent|' +
  // C107.5 (Workflow 7B): a graph query's parameters, an upload's name, what a CSV row holds, a
  // matched list value and a dismissal's free text.
  '(?:parameter|variable)[-_]?map|params|file[-_]?name|(?:csv[-_]?)?rows?|records?|' +
  'matched[-_]?value|dismissal[-_]?reason|' +
  // C117.11 (Workflow 8A): a run's values, whatever a template rendered, secrets, bodies, comments.
  'variables?|outputs?|trigger[-_]?snapshot|template[-_]?output|secrets?|' +
  '(?:request[-_]?|response[-_]?)?body|comments?|' +
  // C143.5 (Workflow 8B): a person's statement, and who a comment names.
  'statements?|mentions?)$';

const LOG_CALL =
  "CallExpression[callee.type='MemberExpression']" +
  '[callee.property.name=/^(?:trace|debug|info|warn|error|fatal)$/] > ObjectExpression';
/** Properties under a `pii` key are redacted whole, so anything may go there. */
const UNDER_PII = ":not(Property[key.name='pii'] Property, Property[key.value='pii'] Property)";
const LOG_MESSAGE =
  'C53.8: log personal data only under `pii` or one of ' +
  `${REDACTED_PERSONAL_LOG_KEYS.join(', ')}, which the loggers redact; ids, statuses and counts ` +
  'are fine.';

/**
 * C240.5 (V04), Workflow 11A Stage 1b (C): the one module that may reach another tenant's rows.
 * Every read and write of the counterparty's environment goes through it.
 */
export const CONNECT_CROSS_TENANT_MODULE = 'apps/api/src/services/connect/cross-tenant.ts';

/**
 * What only {@link CONNECT_CROSS_TENANT_MODULE} may import: the Connect repositories'
 * cross-environment functions (`@openverify/db/cross-env`, every `*.cross-env` module) and the
 * counterparty entry points of the event and audit writers (`services/connect/counterparty-events`,
 * `services/connect/audit`). `packages/db/src/cross-env.ts`, the entry that serves the twins, is the
 * one other file allowed to name them.
 */
export const CONNECT_CROSS_TENANT_IMPORT_PATTERNS = Object.freeze([
  '@openverify/db/cross-env',
  '**/*.cross-env',
  '**/*.cross-env.js',
  '**/*.cross-env.ts',
  '**/services/connect/counterparty-events',
  '**/services/connect/counterparty-events.js',
  '**/services/connect/audit',
  '**/services/connect/audit.js',
]);

/** Inside `services/connect/`, the same two modules by their relative names. */
const CONNECT_SIBLING_PATTERNS = Object.freeze([
  './counterparty-events',
  './counterparty-events.js',
  './audit',
  './audit.js',
]);

const CROSS_TENANT_MESSAGE =
  'C240.5: only apps/api/src/services/connect/cross-tenant.ts may import the cross-environment ' +
  'repositories and the counterparty event and audit writers; call cross-tenant.ts instead.';

/** @param {readonly string[]} group */
const crossTenantImports = (group) => [
  'error',
  { patterns: [{ group: [...group], message: CROSS_TENANT_MESSAGE }] },
];

/**
 * The flat config of the Phase 5 folders.
 * @returns {import('eslint').Linter.Config[]}
 */
export function phase5Config() {
  const logKeySelectors = [
    {
      selector: `${LOG_CALL} Property[key.name=/${REFUSED_LOG_KEY_PATTERN}/i]${UNDER_PII}`,
      message: LOG_MESSAGE,
    },
    {
      selector: `${LOG_CALL} Property[key.value=/${REFUSED_LOG_KEY_PATTERN}/i]${UNDER_PII}`,
      message: LOG_MESSAGE,
    },
  ];
  /** @type {import('eslint').Linter.RulesRecord} */
  const shared = {
    'regexp/no-super-linear-backtracking': 'error',
    'regexp/no-super-linear-move': 'error',
    'no-restricted-syntax': ['error', ...logKeySelectors],
  };
  // C252.2 (Workflow 11B): the run-time pattern selectors (`operator-patterns.js`) apply to every
  // source file outside their allowlist. In the Phase 5 and 7A folders they join the shared list
  // beside the log-key selectors: a later `no-restricted-syntax` for the same files replaces an
  // earlier one whole, so each folder block is followed by one that repeats both lists for every
  // file the allowlist does not name.
  const allowlist = regexpAllowlistGlobs();
  /** @type {import('eslint').Linter.RulesRecord} */
  const sharedWithPatterns = {
    'no-restricted-syntax': ['error', ...logKeySelectors, ...OPERATOR_PATTERN_SELECTORS],
  };
  return [
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs'],
      ignores: allowlist,
      rules: { 'no-restricted-syntax': ['error', ...OPERATOR_PATTERN_SELECTORS] },
    },
    {
      files: /** @type {string[]} */ (PHASE5_FOLDERS),
      plugins: { regexp },
      rules: { ...regexp.configs['flat/recommended'].rules, ...shared },
    },
    // C252.2: the same folders (a copy, so the Phase 5 block above stays the one entry for them),
    // outside the allowlist.
    { files: [...PHASE5_FOLDERS], ignores: allowlist, rules: sharedWithPatterns },
    {
      files: /** @type {string[]} */ (WORKFLOW_7A_NETWORK_FOLDERS),
      plugins: { regexp },
      rules: shared,
    },
    { files: [...WORKFLOW_7A_NETWORK_FOLDERS], ignores: allowlist, rules: sharedWithPatterns },
    // C240.5 (Workflow 11A): one cross-tenant path, everywhere in the repository.
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
      ignores: [CONNECT_CROSS_TENANT_MODULE, 'packages/db/src/cross-env.ts'],
      rules: {
        'no-restricted-imports': crossTenantImports(CONNECT_CROSS_TENANT_IMPORT_PATTERNS),
      },
    },
    {
      files: ['apps/api/src/services/connect/**'],
      ignores: [CONNECT_CROSS_TENANT_MODULE],
      rules: {
        'no-restricted-imports': crossTenantImports([
          ...CONNECT_CROSS_TENANT_IMPORT_PATTERNS,
          ...CONNECT_SIBLING_PATTERNS,
        ]),
      },
    },
    // C260.1 (Workflow 11C, sast-pii-11c; OD-11C-1): eslint-plugin-security's rules, each with its
    // reason, after the pattern selectors and the cross-tenant entries; the root config is unchanged.
    ...securityConfig(),
  ];
}
